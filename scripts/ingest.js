#!/usr/bin/env node
/**
 * Ingest courseData/ into the API server.
 *
 * Usage:
 *   node scripts/ingest.js                  # ingest all courses
 *   node scripts/ingest.js aws-security-specialty
 *   node scripts/ingest.js aws-security-specialty japanese-phonetics
 *
 * Options:
 *   --base-url <url>   API server base URL (default: http://localhost:3000)
 *   --dry-run          Print what would be uploaded without making requests
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const COURSE_DATA_DIR = path.resolve(__dirname, "../courseData");

const args = process.argv.slice(2);
const courseArgs = [];
let baseUrl = "http://localhost:3000";
let dryRun = false;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--base-url") {
		baseUrl = args[++i];
	} else if (args[i] === "--dry-run") {
		dryRun = true;
	} else {
		courseArgs.push(args[i]);
	}
}

// ---------------------------------------------------------------------------
// HTTP helper (no external deps)
// ---------------------------------------------------------------------------

function post(url, body) {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const lib = parsed.protocol === "https:" ? https : http;
		const data = JSON.stringify(body);

		const req = lib.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname + parsed.search,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(data),
				},
			},
			(res) => {
				let raw = "";
				res.on("data", (chunk) => (raw += chunk));
				res.on("end", () => {
					if (res.statusCode >= 200 && res.statusCode < 300) {
						resolve(JSON.parse(raw));
					} else {
						reject(
							new Error(`HTTP ${res.statusCode} from ${url}: ${raw}`)
						);
					}
				});
			}
		);

		req.on("error", reject);
		req.write(data);
		req.end();
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function log(msg) {
	process.stdout.write(msg + "\n");
}

function warn(msg) {
	process.stderr.write("WARN  " + msg + "\n");
}

/** Collect all subtopic IDs from the syllabus tree. */
function collectSubtopicIds(course) {
	const ids = [];
	for (const topic of course.topics ?? []) {
		for (const sub of topic.sub_topics ?? []) {
			ids.push(sub.id);
		}
	}
	return ids;
}

// ---------------------------------------------------------------------------
// Per-step upload functions
// ---------------------------------------------------------------------------

async function uploadSyllabus(courseDir, courseId) {
	const file = path.join(courseDir, "syllabus.json");
	if (!fs.existsSync(file)) {
		warn(`No syllabus.json found for ${courseId} — skipping`);
		return null;
	}

	const syllabus = readJson(file);

	if (dryRun) {
		log(`  [dry-run] POST /syllabus/upload  (${courseId})`);
		return syllabus;
	}

	const result = await post(`${baseUrl}/syllabus/upload`, syllabus);
	log(`  syllabus  inserted=${result.inserted} skipped=${result.skipped} total=${result.total}`);
	return syllabus;
}

async function uploadContent(courseDir, subtopicId) {
	const file = path.join(courseDir, "content", `${subtopicId}.json`);
	if (!fs.existsSync(file)) {
		warn(`  No content file for ${subtopicId} — skipping`);
		return;
	}

	const records = readJson(file);
	if (!Array.isArray(records) || records.length === 0) {
		warn(`  Empty content file for ${subtopicId} — skipping`);
		return;
	}

	if (dryRun) {
		log(`    [dry-run] POST /content  (${subtopicId}, ${records.length} records)`);
		return;
	}

	const result = await post(`${baseUrl}/content`, records);
	log(`    content   ${subtopicId}  count=${result.count}`);
}

async function uploadQuestions(courseDir, subtopicId) {
	const file = path.join(courseDir, "questions", `${subtopicId}.json`);
	if (!fs.existsSync(file)) {
		warn(`  No questions file for ${subtopicId} — skipping`);
		return;
	}

	const records = readJson(file);
	if (!Array.isArray(records) || records.length === 0) {
		warn(`  Empty questions file for ${subtopicId} — skipping`);
		return;
	}

	if (dryRun) {
		log(`    [dry-run] POST /questions  (${subtopicId}, ${records.length} records)`);
		return;
	}

	const result = await post(`${baseUrl}/questions`, records);
	log(`    questions ${subtopicId}  count=${result.count}`);
}

// ---------------------------------------------------------------------------
// Per-course ingest
// ---------------------------------------------------------------------------

async function ingestCourse(courseId) {
	const courseDir = path.join(COURSE_DATA_DIR, courseId);

	if (!fs.existsSync(courseDir)) {
		warn(`Course directory not found: ${courseDir}`);
		return;
	}

	log(`\nIngesting: ${courseId}`);

	const syllabus = await uploadSyllabus(courseDir, courseId);
	if (!syllabus) return;

	const subtopicIds = collectSubtopicIds(syllabus);
	log(`  ${subtopicIds.length} subtopics found`);

	for (const subtopicId of subtopicIds) {
		await uploadContent(courseDir, subtopicId);
		await uploadQuestions(courseDir, subtopicId);
	}

	log(`  done: ${courseId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	let courseIds = courseArgs;

	if (courseIds.length === 0) {
		// Ingest all courses found in courseData/
		courseIds = fs
			.readdirSync(COURSE_DATA_DIR)
			.filter(
				(entry) =>
					!entry.startsWith(".") &&
					fs.statSync(path.join(COURSE_DATA_DIR, entry)).isDirectory()
			);
	}

	if (courseIds.length === 0) {
		log("No courses found in courseData/");
		process.exit(1);
	}

	log(`API server: ${baseUrl}`);
	log(`Courses:    ${courseIds.join(", ")}`);
	if (dryRun) log("Mode:       dry-run");

	for (const courseId of courseIds) {
		await ingestCourse(courseId);
	}

	log("\nIngest complete.");
}

main().catch((err) => {
	process.stderr.write("ERROR: " + err.message + "\n");
	process.exit(1);
});
