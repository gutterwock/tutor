#!/usr/bin/env node
/**
 * Ingest courseData/ into the API server.
 *
 * Supports both markdown (.md) and legacy JSON course formats.
 * Markdown is the primary format produced by /generate-course.
 *
 * Usage:
 *   node scripts/ingest.js                  # ingest all courses
 *   node scripts/ingest.js aws-security-specialty
 *   node scripts/ingest.js aws-security-specialty japanese-phonetics
 *
 * Options:
 *   --base-url <url>   API server base URL (default: http://localhost:3000)
 *   --dry-run          Print what would be uploaded without making requests
 *   --convert-only     Parse markdown and write JSON to courseData/{id}/converted/ (no upload)
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
let convertOnly = false;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--base-url") {
		baseUrl = args[++i];
	} else if (args[i] === "--dry-run") {
		dryRun = true;
	} else if (args[i] === "--convert-only") {
		convertOnly = true;
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
						reject(new Error(`HTTP ${res.statusCode} from ${url}: ${raw}`));
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

/** Collect all subtopic IDs from the parsed syllabus tree. */
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
// Markdown parsers
// ---------------------------------------------------------------------------

/**
 * Parse syllabus.md into the JSON object expected by POST /syllabus/upload.
 *
 * Format:
 *   # Course Name
 *   id: course-id
 *   description: ...
 *   prerequisites:
 *   - item
 *   exam: Exam name
 *
 *   ## Topic Name
 *   id: topic-id
 *   description: ...
 *
 *   ### Subtopic Name
 *   id: subtopic-id
 *   objectives:
 *   - obj
 *   prerequisites:
 *   - subtopic-id
 */
function parseSyllabusMarkdown(source) {
	const lines = source.split("\n");
	const course = { id: null, name: null, description: null, prerequisites: [], exam: null, topics: [] };

	let currentTopic = null;
	let currentSubtopic = null;
	let listTarget = null; // "prerequisites" | "objectives" | null

	for (const line of lines) {
		// Headings reset list context
		if (line.startsWith("# ") && !line.startsWith("## ")) {
			course.name = line.slice(2).trim();
			currentTopic = null;
			currentSubtopic = null;
			listTarget = null;
		} else if (line.startsWith("## ") && !line.startsWith("### ")) {
			currentTopic = { id: null, name: line.slice(3).trim(), description: null, sub_topics: [] };
			course.topics.push(currentTopic);
			currentSubtopic = null;
			listTarget = null;
		} else if (line.startsWith("### ")) {
			currentSubtopic = { id: null, name: line.slice(4).trim(), description: null, objectives: [], prerequisites: [] };
			if (currentTopic) currentTopic.sub_topics.push(currentSubtopic);
			listTarget = null;
		} else if (/^id:\s/.test(line)) {
			const val = line.slice(line.indexOf(":") + 1).trim();
			if (currentSubtopic) currentSubtopic.id = val;
			else if (currentTopic) currentTopic.id = val;
			else course.id = val;
			listTarget = null;
		} else if (/^description:\s/.test(line)) {
			const val = line.slice(line.indexOf(":") + 1).trim();
			if (currentSubtopic) currentSubtopic.description = val;
			else if (currentTopic) currentTopic.description = val;
			else course.description = val;
			listTarget = null;
		} else if (/^exam:\s/.test(line)) {
			const val = line.slice(line.indexOf(":") + 1).trim();
			if (currentSubtopic) currentSubtopic.exam = val;
			else if (currentTopic) currentTopic.exam = val;
			else course.exam = val;
			listTarget = null;
		} else if (line.trim() === "prerequisites:") {
			listTarget = "prerequisites";
		} else if (line.trim() === "objectives:") {
			listTarget = "objectives";
		} else if (line.startsWith("- ") && listTarget) {
			const val = line.slice(2).trim();
			if (listTarget === "prerequisites") {
				if (currentSubtopic) currentSubtopic.prerequisites.push(val);
				else course.prerequisites.push(val);
			} else if (listTarget === "objectives") {
				if (currentSubtopic) currentSubtopic.objectives.push(val);
			}
		} else if (line.trim() !== "") {
			// Non-empty, non-list line breaks list context
			listTarget = null;
		}
	}

	return course;
}

/**
 * Parse a subtopic .md file into arrays of content and question records.
 *
 * Content record shape (for POST /content):
 *   { syllabus_id, title, body, content_type, tags[], metadata? }
 *
 * Question record shape (for POST /questions):
 *   { syllabus_id, question_type, difficulty, question_text, options?, answer, tags[], explanation? }
 *
 * Answer encoding per type:
 *   singleChoice  → string "b"
 *   multiChoice   → array ["a","b","c"]   (parsed from "abc")
 *   ordering      → array ["b","c","a"]   (parsed from "bca")
 *   freeText      → string
 *   exactMatch    → array of accepted strings (one per answer: line)
 */
function parseSubtopicMarkdown(source) {
	const lines = source.split("\n");
	const content = [];
	const questions = [];

	let syllabusId = null;

	// Content→question linking: tracks which content block each question gates on.
	// Incremented each time a content block is finalized; -1 = ungated (before any content).
	let contentBlockIdx = -1;
	let currentContentNonPhaseTags = []; // non-phase tags of the most recently finalized content block

	// Current block being built
	let block = null;
	let inFence = false; // inside ``` fence within content body

	function finalizeBlock() {
		if (!block) return;
		if (block.type === "content") {
			// Update gating state BEFORE pushing so questions created after this block see updated values
			contentBlockIdx++;
			currentContentNonPhaseTags = block.tags; // tags: line only has non-phase tags
			content.push(buildContentRecord(block, syllabusId));
		} else if (block.type === "question") {
			questions.push(buildQuestionRecord(block, syllabusId));
		}
		block = null;
		inFence = false;
	}

	for (const line of lines) {
		// Track fenced code blocks within content bodies (so ## inside fences is not a heading)
		if (block && block.type === "content" && block.inBody) {
			if (line.startsWith("```")) inFence = !inFence;
			if (inFence || line.startsWith("```")) {
				block.bodyLines.push(line);
				continue;
			}
		}

		// Whether we're inside a fenced block inside question text
		const questionInFence = block && block.type === "question" && block.inFence;

		// Content block heading: ## [phase:X] Title
		if (!inFence && !questionInFence && /^## (?!#)/.test(line)) {
			finalizeBlock();
			const m = line.match(/^## \[phase:(\w+)\]\s*(.+)/);
			if (m) {
				block = {
					type: "content",
					phase: m[1],
					title: m[2].trim(),
					tags: [],
					contentType: "text",
					metadata: {},
					inBody: false,
					seenBlank: false,
					bodyLines: [],
				};
			}
			continue;
		}

		// Question block heading: ### question <type> [caseSensitive] difficulty:N
		if (!inFence && !questionInFence && /^### question /.test(line)) {
			finalizeBlock();
			const m = line.match(/^### question (\w+)(?:\s+caseSensitive)?\s+difficulty:(\d)/);
			if (m) {
				block = {
					type: "question",
					questionType: m[1],
					difficulty: parseInt(m[2], 10),
					caseSensitive: /caseSensitive/.test(line),
					tags: [],
					// Content→question linking: captured at question creation time
					contentBlockIdx,               // -1 = ungated; ≥0 = index into content[]
					inheritedTags: currentContentNonPhaseTags, // non-phase tags from gating content block
					questionTextLines: [],
					options: {},
					answers: [],
					explanation: null,
					inFence: false, // tracks ``` fences inside question text
					state: "tags", // → text → options → done
				};
			}
			continue;
		}

		// Header area (before first block)
		if (!block) {
			if (line.startsWith("syllabus_id:")) {
				syllabusId = line.slice("syllabus_id:".length).trim();
			}
			// Ignore # title lines and blank lines
			continue;
		}

		// Dispatch to block-specific line handler
		if (block.type === "content") {
			processContentLine(block, line);
		} else if (block.type === "question") {
			processQuestionLine(block, line);
		}
	}

	finalizeBlock();
	return { content, questions };
}

function processContentLine(block, line) {
	if (block.inBody) {
		block.bodyLines.push(line);
		return;
	}

	// Metadata phase: collect tags/type/meta.* before the body starts.
	// Pattern: blank line after metadata → transition to body on next non-blank.
	// We use seenBlank to detect the separator blank line(s).

	if (line === "") {
		block.seenBlank = true;
		return;
	}

	if (line.startsWith("tags:")) {
		block.tags = line.slice("tags:".length).trim().split(",").map((s) => s.trim()).filter(Boolean);
		block.seenBlank = false;
		return;
	}

	if (line.startsWith("type:")) {
		block.contentType = line.slice("type:".length).trim();
		block.seenBlank = false;
		return;
	}

	if (line.startsWith("src:")) {
		block.metadata.src = line.slice("src:".length).trim();
		block.seenBlank = false;
		return;
	}

	if (line.startsWith("meta.")) {
		const colonIdx = line.indexOf(":");
		const key = line.slice("meta.".length, colonIdx).trim();
		const val = line.slice(colonIdx + 1).trim();
		block.metadata[key] = val;
		block.seenBlank = false;
		return;
	}

	// Any other non-blank line (and we've seen a blank after the last metadata) → body starts
	if (block.seenBlank) {
		block.inBody = true;
		block.bodyLines.push(line);
	}
	// If we haven't seen a blank yet and hit an unknown line, treat as body too
	// (handles case where metadata is omitted entirely)
	else {
		block.inBody = true;
		block.bodyLines.push(line);
	}
}

function processQuestionLine(block, line) {
	// Tags line
	if (block.state === "tags") {
		if (line.startsWith("tags:")) {
			block.tags = line.slice("tags:".length).trim().split(",").map((s) => s.trim()).filter(Boolean);
			block.state = "text";
			return;
		}
		// No tags line found — move to text state and fall through
		block.state = "text";
	}

	// Blank lines are skipped in question blocks (but not inside fences)
	if (line === "" && !block.inFence) return;

	// Track fenced code blocks in question text — options/answers inside fences are literal text
	if (line.startsWith("```")) {
		block.inFence = !block.inFence;
		block.questionTextLines.push(line);
		return;
	}
	if (block.inFence) {
		block.questionTextLines.push(line);
		return;
	}

	if (block.state === "text") {
		// Option line: single letter followed by colon-space
		if (/^[a-e]: /.test(line)) {
			block.state = "options";
			// fall through to options handler
		} else if (line.startsWith("answer:")) {
			block.state = "answer";
			// fall through
		} else if (line.startsWith("explanation:")) {
			block.explanation = line.slice("explanation:".length).trim();
			block.state = "done";
			return;
		} else {
			block.questionTextLines.push(line);
			return;
		}
	}

	if (block.state === "options") {
		if (/^[a-e]: /.test(line)) {
			const key = line[0];
			const val = line.slice(3).trim();
			block.options[key] = val;
			return;
		}
		if (line.startsWith("answer:")) {
			block.state = "answer";
			// fall through
		} else {
			return; // unexpected line in options — ignore
		}
	}

	if (block.state === "answer") {
		if (line.startsWith("answer:")) {
			block.answers.push(line.slice("answer:".length).trim());
			return;
		}
		if (line.startsWith("explanation:")) {
			block.explanation = line.slice("explanation:".length).trim();
			block.state = "done";
			return;
		}
		// Anything else after answer — ignore
		return;
	}
}

function buildContentRecord(block, syllabusId) {
	// Phase tag comes from the heading; tags: line lists additional tags (no phase there)
	const tags = [`phase:${block.phase}`, ...block.tags];
	const uniqueTags = [...new Set(tags)];

	const record = {
		syllabus_id: syllabusId,
		title: block.title,
		body: block.bodyLines.join("\n").trim(),
		content_type: block.contentType,
		tags: uniqueTags,
	};

	if (Object.keys(block.metadata).length > 0) {
		record.metadata = block.metadata;
	}

	return record;
}

function buildQuestionRecord(block, syllabusId) {
	const questionText = block.questionTextLines.join("\n").trim();
	const type = block.questionType;
	const hasOptions = Object.keys(block.options).length > 0;

	// Parse answer into the correct shape for each question type
	let answer;
	if (type === "multiChoice" || type === "ordering") {
		// Markdown: "answer: abc" → ["a","b","c"]
		const raw = block.answers[0] ?? "";
		answer = raw.split("").filter((c) => /[a-e]/i.test(c)).map((c) => c.toLowerCase());
	} else if (type === "exactMatch") {
		// Multiple answer: lines → array of accepted strings
		answer = block.answers;
	} else {
		// singleChoice, freeText → plain string
		answer = block.answers[0] ?? "";
	}

	// Inherit non-phase tags from the gating content block (deduped)
	const tags = [...new Set([...block.tags, ...block.inheritedTags])];

	const record = {
		syllabus_id: syllabusId,
		question_type: type,
		difficulty: block.difficulty,
		question_text: questionText,
		answer,
		tags,
		// _contentBlockIdx is a temporary index resolved to a real UUID by the upload flow.
		// -1 = ungated (diagnostic question before any content block).
		_contentBlockIdx: block.contentBlockIdx,
	};

	if (hasOptions) {
		record.options = block.options;
	}

	if (block.explanation) {
		record.explanation = block.explanation;
	}

	return record;
}

// ---------------------------------------------------------------------------
// Per-step upload functions
// ---------------------------------------------------------------------------

/**
 * Load syllabus from .md or .json and return the parsed object.
 * Returns null if no syllabus file found.
 */
function loadSyllabus(courseDir, courseId) {
	const mdFile = path.join(courseDir, "syllabus.md");
	const jsonFile = path.join(courseDir, "syllabus.json");

	if (fs.existsSync(mdFile)) {
		return { syllabus: parseSyllabusMarkdown(fs.readFileSync(mdFile, "utf8")), format: "md" };
	}
	if (fs.existsSync(jsonFile)) {
		return { syllabus: readJson(jsonFile), format: "json" };
	}

	warn(`No syllabus.md or syllabus.json found for ${courseId} — skipping`);
	return null;
}

/**
 * Load content and question records for a subtopic.
 * Prefers {subtopicId}.md; falls back to content/{subtopicId}.json + questions/{subtopicId}.json.
 */
function loadSubtopic(courseDir, subtopicId, format) {
	const mdFile = path.join(courseDir, `${subtopicId}.md`);

	if (format === "md" || fs.existsSync(mdFile)) {
		if (!fs.existsSync(mdFile)) {
			warn(`  No markdown file for ${subtopicId} — skipping`);
			return null;
		}
		return parseSubtopicMarkdown(fs.readFileSync(mdFile, "utf8"));
	}

	// Legacy JSON
	const contentFile = path.join(courseDir, "content", `${subtopicId}.json`);
	const questionsFile = path.join(courseDir, "questions", `${subtopicId}.json`);

	const content = fs.existsSync(contentFile) ? readJson(contentFile) : [];
	const questions = fs.existsSync(questionsFile) ? readJson(questionsFile) : [];

	return { content, questions };
}

async function uploadSyllabus(syllabus, courseId) {
	if (dryRun) {
		const subtopicCount = collectSubtopicIds(syllabus).length;
		log(`  [dry-run] POST /syllabus/upload  (${courseId}, ${subtopicCount} subtopics)`);
		return;
	}
	const result = await post(`${baseUrl}/syllabus/upload`, syllabus);
	log(`  syllabus  inserted=${result.inserted} skipped=${result.skipped} total=${result.total}`);
}

/**
 * Upload content records. Returns the ordered array of inserted UUIDs (used to
 * resolve content_ids on questions). Returns [] if skipped or dry-run.
 */
async function uploadContent(records, subtopicId) {
	if (!records || records.length === 0) {
		warn(`  No content for ${subtopicId} — skipping`);
		return [];
	}
	if (dryRun) {
		log(`    [dry-run] POST /content  (${subtopicId}, ${records.length} records)`);
		return records.map((_, i) => `dry-run-${subtopicId}-content-${i}`);
	}
	const result = await post(`${baseUrl}/content`, records);
	log(`    content   ${subtopicId}  count=${result.count}`);
	return result.ids; // ordered UUIDs matching input record order
}

/**
 * Resolve _contentBlockIdx on each question record to a real content_ids array
 * using the ordered content UUIDs returned by uploadContent, then upload.
 */
async function uploadQuestions(records, subtopicId, contentIds = []) {
	if (!records || records.length === 0) {
		warn(`  No questions for ${subtopicId} — skipping`);
		return;
	}

	// Resolve _contentBlockIdx → content_ids and strip the temporary field
	const resolved = records.map(({ _contentBlockIdx, ...rest }) => ({
		...rest,
		content_ids: (_contentBlockIdx >= 0 && contentIds[_contentBlockIdx])
			? [contentIds[_contentBlockIdx]]
			: [],
	}));

	if (dryRun) {
		const gated = resolved.filter((q) => q.content_ids.length > 0).length;
		log(`    [dry-run] POST /questions  (${subtopicId}, ${resolved.length} records, ${gated} gated)`);
		return;
	}
	const result = await post(`${baseUrl}/questions`, resolved);
	log(`    questions ${subtopicId}  count=${result.count}`);
}

// ---------------------------------------------------------------------------
// Convert-only: write parsed JSON to courseData/{id}/converted/
// ---------------------------------------------------------------------------

function convertCourse(courseId) {
	const courseDir = path.join(COURSE_DATA_DIR, courseId);
	const outDir = path.join(courseDir, "converted");

	const loaded = loadSyllabus(courseDir, courseId);
	if (!loaded) return;
	const { syllabus, format } = loaded;

	if (format === "json") {
		log(`  ${courseId} already uses JSON format — nothing to convert`);
		return;
	}

	fs.mkdirSync(path.join(outDir, "content"), { recursive: true });
	fs.mkdirSync(path.join(outDir, "questions"), { recursive: true });

	// Write syllabus
	fs.writeFileSync(path.join(outDir, "syllabus.json"), JSON.stringify(syllabus, null, 2));
	log(`  wrote converted/syllabus.json`);

	// Write per-subtopic files
	const subtopicIds = collectSubtopicIds(syllabus);
	let totalContent = 0;
	let totalQuestions = 0;

	for (const subtopicId of subtopicIds) {
		const mdFile = path.join(courseDir, `${subtopicId}.md`);
		if (!fs.existsSync(mdFile)) {
			warn(`  No markdown file for ${subtopicId} — skipping`);
			continue;
		}
		const { content, questions } = parseSubtopicMarkdown(fs.readFileSync(mdFile, "utf8"));

		fs.writeFileSync(
			path.join(outDir, "content", `${subtopicId}.json`),
			JSON.stringify(content, null, 2)
		);
		fs.writeFileSync(
			path.join(outDir, "questions", `${subtopicId}.json`),
			JSON.stringify(questions, null, 2)
		);

		log(`    ${subtopicId}  content=${content.length}  questions=${questions.length}`);
		totalContent += content.length;
		totalQuestions += questions.length;
	}

	log(`  done: ${courseId}  total content=${totalContent}  total questions=${totalQuestions}`);
	log(`  output: ${outDir}`);
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

	const loaded = loadSyllabus(courseDir, courseId);
	if (!loaded) return;
	const { syllabus, format } = loaded;

	log(`  format: ${format}`);
	await uploadSyllabus(syllabus, courseId);

	const subtopicIds = collectSubtopicIds(syllabus);
	log(`  ${subtopicIds.length} subtopics found`);

	for (const subtopicId of subtopicIds) {
		const subtopic = loadSubtopic(courseDir, subtopicId, format);
		if (!subtopic) continue;
		// Content must be uploaded first; returned IDs are used to resolve content_ids on questions.
		const contentIds = await uploadContent(subtopic.content, subtopicId);
		await uploadQuestions(subtopic.questions, subtopicId, contentIds);
	}

	log(`  done: ${courseId}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	let courseIds = courseArgs;

	if (courseIds.length === 0) {
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

	if (convertOnly) {
		log(`Courses:    ${courseIds.join(", ")}`);
		log("Mode:       convert-only\n");
		for (const courseId of courseIds) {
			log(`\nConverting: ${courseId}`);
			convertCourse(courseId);
		}
		log("\nConvert complete.");
		return;
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
