#!/usr/bin/env node
/**
 * Mark tier-3 items as viewed, moving them to tier 2.
 *
 * For content items: calls DELETE /queue/:id (records content view, promotes gated questions).
 * For question items: calls PATCH /queue/:id with a random tier-2 priority (200–299).
 *
 * Usage:
 *   node scripts/mark-viewed.js --user <uuid> [options]
 *
 * Scope (at least one of --topics / --subtopics is recommended; omitting both processes all):
 *   --topics <id1,id2,...>      Topic IDs — all subtopics beneath each topic are included
 *   --subtopics <id1,id2,...>   Specific subtopic IDs
 *
 * Filters:
 *   --type content|questions    Item type to process (default: both)
 *   --course <id>               Limit to a specific course (default: all enrolled courses)
 *
 * Other:
 *   --base-url <url>            API base URL (default: http://localhost:3000)
 *   --dry-run                   Print what would be changed without making changes
 */

const http = require("http");
const https = require("https");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let userId = null;
let courseFilter = null;
let topicFilter = [];
let subtopicFilter = [];
let typeFilter = null; // null = both
let baseUrl = "http://localhost:3000";
let dryRun = false;

for (let i = 0; i < args.length; i++) {
	if      (args[i] === "--user")     { userId       = args[++i]; }
	else if (args[i] === "--course")   { courseFilter = args[++i]; }
	else if (args[i] === "--topics")   { topicFilter     = args[++i].split(",").map((s) => s.trim()).filter(Boolean); }
	else if (args[i] === "--subtopics"){ subtopicFilter  = args[++i].split(",").map((s) => s.trim()).filter(Boolean); }
	else if (args[i] === "--type")     { typeFilter   = args[++i]; }
	else if (args[i] === "--base-url") { baseUrl      = args[++i]; }
	else if (args[i] === "--dry-run")  { dryRun       = true; }
}

if (!userId) {
	console.error(
		"Usage: node scripts/mark-viewed.js --user <uuid>\n" +
		"         [--topics <id1,id2,...>] [--subtopics <id1,id2,...>]\n" +
		"         [--type content|questions] [--course <id>]\n" +
		"         [--base-url url] [--dry-run]"
	);
	process.exit(1);
}

if (typeFilter && typeFilter !== "content" && typeFilter !== "questions") {
	console.error("--type must be 'content' or 'questions'");
	process.exit(1);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function request(method, url, body) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const lib = parsed.protocol === "https:" ? https : http;
		const data = body ? JSON.stringify(body) : null;

		const req = lib.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname + parsed.search,
				method,
				headers: {
					"Content-Type": "application/json",
					...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
				},
			},
			(res) => {
				let raw = "";
				res.on("data", (chunk) => (raw += chunk));
				res.on("end", () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						resolve(raw ? JSON.parse(raw) : {});
					} else {
						reject(new Error(`HTTP ${res.statusCode} ${method} ${url}: ${raw}`));
					}
				});
			}
		);
		req.on("error", reject);
		if (data) req.write(data);
		req.end();
	});
}

const get   = (path)        => request("GET",    `${baseUrl}${path}`);
const del   = (path)        => request("DELETE", `${baseUrl}${path}`);
const patch = (path, body)  => request("PATCH",  `${baseUrl}${path}`, body);

function randTier2() {
	return 200 + Math.floor(Math.random() * 100);
}

// ---------------------------------------------------------------------------
// Subtopic filter resolution
// ---------------------------------------------------------------------------

/**
 * Returns true if a subtopic_id falls under a given topic ID.
 * Topic IDs use slug hierarchy: course-id.T → subtopics are course-id.T.S
 */
function subtopicUnderTopic(subtopicId, topicId) {
	return subtopicId.startsWith(topicId + ".");
}

function matchesScope(subtopicId) {
	if (subtopicFilter.length === 0 && topicFilter.length === 0) return true;
	if (subtopicFilter.includes(subtopicId)) return true;
	return topicFilter.some((t) => subtopicUnderTopic(subtopicId, t));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	// Resolve course IDs
	let courseIds;
	if (courseFilter) {
		courseIds = [courseFilter];
	} else {
		const enrollments = await get(`/enrollments?user_id=${userId}`);
		courseIds = enrollments.map((e) => e.course_id ?? e.id).filter(Boolean);
		if (courseIds.length === 0) {
			console.log("No enrolled courses found.");
			return;
		}
	}

	console.log(`User:       ${userId}`);
	console.log(`Courses:    ${courseIds.join(", ")}`);
	if (topicFilter.length)    console.log(`Topics:     ${topicFilter.join(", ")}`);
	if (subtopicFilter.length) console.log(`Subtopics:  ${subtopicFilter.join(", ")}`);
	if (typeFilter)            console.log(`Type:       ${typeFilter}`);
	if (dryRun) console.log("(dry run — no changes will be made)");
	console.log();

	let totalContent = 0;
	let totalQuestions = 0;

	for (const courseId of courseIds) {
		let doneContent = 0;
		let doneQuestions = 0;

		// Fetch all unlocked queue items for this course (may need multiple passes for content
		// since DELETE promotes gated questions which can cause new tier-3 items to appear)
		let pass = 0;
		while (true) {
			pass++;
			const items = await get(
				`/queue?user_id=${userId}&course_ids=${courseId}&limit=500`
			);

			// Tier-3 items matching scope and type
			const tier3 = items.filter(
				(i) =>
					i.priority >= 300 &&
					i.priority <= 399 &&
					matchesScope(i.subtopic_id) &&
					(typeFilter === null || i.item_type === (typeFilter === "questions" ? "question" : typeFilter))
			);

			if (tier3.length === 0) break;

			const contentItems   = tier3.filter((i) => i.item_type === "content");
			const questionItems  = tier3.filter((i) => i.item_type === "question");

			for (const item of contentItems) {
				const label = item.item_data?.title ?? item.item_id;
				if (dryRun) {
					console.log(`  [dry] content:  ${label}  (${item.subtopic_id})`);
				} else {
					await del(`/queue/${item.id}`);
					console.log(`  viewed: ${label}`);
				}
				doneContent++;
			}

			for (const item of questionItems) {
				const label = item.item_data?.question_text ?? item.item_id;
				if (dryRun) {
					console.log(`  [dry] question: ${label.slice(0, 80)}  (${item.subtopic_id})`);
				} else {
					await patch(`/queue/${item.id}`, { priority: randTier2() });
					console.log(`  skipped: ${label.slice(0, 80)}`);
				}
				doneQuestions++;
			}

			// If we only processed questions (no content DELETEs that could unlock new items),
			// or if nothing changed, no need for another pass
			if (contentItems.length === 0) break;
		}

		const parts = [];
		if (doneContent)   parts.push(`${doneContent} content`);
		if (doneQuestions) parts.push(`${doneQuestions} question${doneQuestions !== 1 ? "s" : ""}`);
		console.log(`${courseId}: ${parts.length ? parts.join(", ") + " marked viewed" : "nothing to process"}`);

		totalContent   += doneContent;
		totalQuestions += doneQuestions;
	}

	const total = totalContent + totalQuestions;
	console.log(`\nDone. ${total} item${total !== 1 ? "s" : ""} total (${totalContent} content, ${totalQuestions} questions).`);
}

main().catch((err) => {
	console.error(err.message);
	process.exit(1);
});
