#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API = process.env.API_URL || "http://localhost:3000";
const ID_FILE = path.join(__dirname, ".user_id");
const SETTINGS_FILE = path.join(__dirname, ".settings.json");

const DEFAULT_SETTINGS = {
	interleave_courses: true,   // mix subtopics from all enrolled courses in one session
	interleave_subtopics: true, // study all active subtopics per session (vs. one at a time)
	disabled_courses: [],       // course IDs temporarily excluded from study sessions
};

// ── persistence ───────────────────────────────────────────────────────────────

function loadOrCreateUserId() {
	if (fs.existsSync(ID_FILE)) return fs.readFileSync(ID_FILE, "utf8").trim();
	const id = crypto.randomUUID();
	fs.writeFileSync(ID_FILE, id);
	return id;
}

function loadSettings() {
	if (fs.existsSync(SETTINGS_FILE)) {
		try {
			return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
		} catch {}
	}
	return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
	fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function api(method, urlPath, body) {
	const res = await fetch(`${API}${urlPath}`, {
		method,
		headers: body ? { "Content-Type": "application/json" } : {},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`${method} ${urlPath} → ${res.status}: ${text}`);
	}
	const text = await res.text();
	return text ? JSON.parse(text) : {};
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));
const pause = () => ask("\nPress Enter to continue...");
const on = (v) => (v ? "ON " : "OFF");
const hr = () => console.log("\n" + "─".repeat(60));
const clear = () => process.stdout.write("\x1Bc");

// ── settings menu ─────────────────────────────────────────────────────────────

async function settingsMenu(settings) {
	while (true) {
		clear();
		console.log("Settings\n");
		console.log(`  1.  Interleave courses    [${on(settings.interleave_courses)}]  — mix subtopics from all courses in one session`);
		console.log(`  2.  Interleave subtopics  [${on(settings.interleave_subtopics)}]  — study all active subtopics per session vs. one at a time`);
		console.log("\n  b.  Back");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "1") {
			settings.interleave_courses = !settings.interleave_courses;
			saveSettings(settings);
		} else if (input === "2") {
			settings.interleave_subtopics = !settings.interleave_subtopics;
			saveSettings(settings);
		} else if (input === "b" || input === "") {
			return;
		}
	}
}

// ── course management ─────────────────────────────────────────────────────────

async function enrollFlow(userId) {
	const allCourses = await api("GET", "/syllabus");
	if (allCourses.length === 0) {
		console.log("\nNo courses available on this server.");
		return;
	}
	console.log("\nAvailable courses:\n");
	allCourses.forEach((c, i) => console.log(`  ${i + 1}.  ${c.name}`));

	const input = await ask("\nEnter number to enroll (or Enter to cancel): ");
	if (!input.trim()) return;
	const idx = parseInt(input, 10) - 1;
	if (isNaN(idx) || idx < 0 || idx >= allCourses.length) {
		console.log("Invalid selection.");
		return;
	}

	const course = allCourses[idx];
	const result = await api("POST", "/syllabus/enroll", { user_id: userId, course_id: course.id });
	console.log(`\nEnrolled in "${course.name}" — ${result.enrolled} subtopic(s) created.`);
}

async function manageCoursesMenu(userId, settings) {
	while (true) {
		clear();
		console.log("Manage courses\n");

		const enrolled = await api("GET", `/enrollments?user_id=${userId}`);

		if (enrolled.length === 0) {
			console.log("  Not enrolled in any courses yet.\n");
		} else {
			enrolled.forEach((c, i) => {
				const paused = settings.disabled_courses.includes(c.id);
				console.log(`  ${i + 1}.  [${paused ? "paused" : "active"}]  ${c.name}`);
			});
			console.log("\n  Select a number to pause/resume that course.");
		}

		console.log("\n  e.  Enroll in a new course");
		console.log("  b.  Back");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "b" || input === "") {
			return;
		} else if (input === "e") {
			await enrollFlow(userId);
			await pause();
		} else {
			const idx = parseInt(input, 10) - 1;
			if (!isNaN(idx) && idx >= 0 && idx < enrolled.length) {
				const courseId = enrolled[idx].id;
				const i = settings.disabled_courses.indexOf(courseId);
				if (i >= 0) {
					settings.disabled_courses.splice(i, 1);
					console.log(`\n  "${enrolled[idx].name}" resumed.`);
				} else {
					settings.disabled_courses.push(courseId);
					console.log(`\n  "${enrolled[idx].name}" paused.`);
				}
				saveSettings(settings);
				await pause();
			}
		}
	}
}

// ── study session ─────────────────────────────────────────────────────────────

function formatOptions(options) {
	if (!options || typeof options !== "object") return "";
	return Object.entries(options).map(([k, v]) => `  ${k})  ${v}`).join("\n");
}

/** Display a content item. Returns after the user presses Enter. */
async function showContent(data) {
	console.log(`\n  ${data.title}\n`);
	hr();
	console.log(data.body);
	if (Array.isArray(data.links) && data.links.length) {
		console.log("\n  Links:");
		data.links.forEach((l) => console.log(`    ${typeof l === "string" ? l : l.url ?? JSON.stringify(l)}`));
	}
	await pause();
}

/**
 * Ask a question and return { correctness, userAnswer }.
 * Grading logic is identical to the previous quizSubtopic function.
 */
async function askQuestion(data) {
	console.log(`\n${data.question_text}\n`);

	let userAnswer;
	let correctness = 0;

	if (data.question_type === "singleChoice") {
		console.log(formatOptions(data.options) + "\n");
		const input = (await ask("Answer: ")).trim().toLowerCase();
		userAnswer = input;
		const isCorrect = input === String(data.answer).toLowerCase();
		correctness = isCorrect ? 4 : 0;
		console.log(isCorrect ? "\n  ✓ Correct!" : `\n  ✗ Incorrect — answer: ${data.answer}`);

	} else if (data.question_type === "multiChoice") {
		console.log(formatOptions(data.options) + "\n");
		const input = (await ask("Answer (comma-separated, e.g. a,c): ")).trim().toLowerCase();
		userAnswer = input.split(",").map((s) => s.trim()).filter(Boolean);
		const expected = (Array.isArray(data.answer) ? data.answer : [data.answer]).map((v) => String(v).trim().toLowerCase());
		const isCorrect =
			JSON.stringify([...userAnswer].sort()) === JSON.stringify([...expected].sort());
		correctness = isCorrect ? 4 : 0;
		console.log(isCorrect ? "\n  ✓ Correct!" : `\n  ✗ Incorrect — answer: ${expected.join(", ")}`);

	} else if (data.question_type === "ordering") {
		console.log(formatOptions(data.options) + "\n");
		const input = (await ask("Order (comma-separated, e.g. b,d,a,c): ")).trim().toLowerCase();
		userAnswer = input.split(",").map((s) => s.trim()).filter(Boolean);
		console.log("\n  Response recorded.");

	} else {
		// freeText
		userAnswer = await ask("Answer: ");
	}

	return { correctness, userAnswer };
}

async function studySession(userId, settings) {
	// Determine which courses to include
	const enrolled = await api("GET", `/enrollments?user_id=${userId}`);
	const enabledCourses = enrolled.filter((c) => !settings.disabled_courses.includes(c.id));

	if (!enabledCourses.length) {
		console.log("\nNo active courses. Use Manage courses to enroll or resume a paused course.\n");
		await pause();
		return;
	}

	let activeCourseIds = enabledCourses.map((c) => c.id);

	// If not interleaving courses, let user pick one
	if (!settings.interleave_courses && activeCourseIds.length > 1) {
		console.log("\nWhich course?\n");
		enabledCourses
			.filter((c) => activeCourseIds.includes(c.id))
			.forEach((c, i) => console.log(`  ${i + 1}.  ${c.name}`));
		const input = await ask("\n> ");
		const idx = parseInt(input, 10) - 1;
		if (isNaN(idx) || idx < 0 || idx >= activeCourseIds.length) {
			console.log("Invalid selection.");
			await pause();
			return;
		}
		activeCourseIds = [activeCourseIds[idx]];
	}

	// Fetch queue (server refills if low)
	let items = await api("GET", `/queue?user_id=${userId}&limit=50`);

	// Filter to enabled courses
	items = items.filter((item) => activeCourseIds.includes(item.course_id));

	// If not interleaving subtopics, keep only the first subtopic per course
	if (!settings.interleave_subtopics) {
		const firstSub = {};
		items = items.filter((item) => {
			if (firstSub[item.course_id]) return item.subtopic_id === firstSub[item.course_id];
			firstSub[item.course_id] = item.subtopic_id;
			return true;
		});
	}

	if (!items.length) {
		console.log("\nYour queue is empty — nothing due right now. Check back later or enroll in more courses.\n");
		await pause();
		return;
	}

	// Label: show "review" tag if any items are reviews
	const hasReview = items.some((i) => i.is_review);
	console.log(`\n${items.length} item${items.length > 1 ? "s" : ""} in session${hasReview ? " (includes review)" : ""}`);
	await pause();

	let correct = 0;
	let total = 0;

	for (const item of items) {
		clear();
		const data = item.item_data;

		// Fetch full body on-demand (item_data no longer stores body/question_text)
		const full = await api(
			"GET",
			item.item_type === "content"
				? `/content/${data.id}`
				: `/questions/${data.id}`
		);
		Object.assign(data, full);

		if (item.item_type === "content") {
			await showContent(data);
			// DELETE triggers content_view upsert server-side
			await api("DELETE", `/queue/${item.id}`).catch(() => {});

		} else {
			hr();
			let { correctness, userAnswer } = await askQuestion(data);
			// Submit response before dequeuing so a crash between the two leaves the item in queue
			// Omit correctness for freeText so server stores it as ungraded (needs_grading: true) and ordering (deterministic)
			const submitBody = { question_id: data.id, user_id: userId, user_answer: userAnswer };
			if (data.question_type === "singleChoice" || data.question_type === "multiChoice") submitBody.correctness = correctness;
			const submitted = await api("POST", "/responses", submitBody);

			if (submitted.needs_grading) {
				console.log("\n  Grading...");
				const graded = await api(
					"POST", `/responses/${submitted.id}/grade-ai`, { user_id: userId }
				).catch(() => null);
				if (graded) {
					const labels = ["Wrong", "Mostly wrong", "Partial", "Mostly correct", "Correct"];
					console.log(`  Grade: ${graded.correctness}/4 — ${labels[graded.correctness] ?? "?"}`);
					correctness = graded.correctness;
				} else {
					console.log("  (Grading failed — will be retried by server.)");
				}
				await pause();
			}

			await api("DELETE", `/queue/${item.id}`).catch(() => {});

			if (data.question_type === "singleChoice" || data.question_type === "multiChoice") {
				if (correctness === 4) correct++;
				total++;
			}
		}
	}

	hr();
	console.log("\nSession complete!");
	if (total > 0) {
		const pct = Math.round((correct / total) * 100);
		console.log(`Score: ${correct}/${total}  (${pct}%)`);
	}

	// Check for struggling subtopics and offer background generation
	const struggling = await api("GET", `/struggling?user_id=${userId}`).catch(() => []);
	if (struggling.length) {
		console.log("\nStruggling detected on:");
		struggling.forEach((s) =>
			console.log(`  • ${s.subtopic_name} (${s.course_name})  avg ${Number(s.avg_correctness).toFixed(1)}/4`)
		);
		const input = (await ask("\nGenerate extra practice content? (y/n) ")).trim().toLowerCase();
		if (input === "y") {
			for (const s of struggling) {
				await api("POST", "/generate-adaptive", { user_id: userId, subtopic_id: s.subtopic_id });
			}
			console.log("  Generating in background — new items will appear in your next session.");
		}
	}

	console.log("");
	await pause();
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
	const userId = loadOrCreateUserId();
	const settings = loadSettings();

	while (true) {
		clear();
		console.log(`tutor.ai  (user: ${userId.slice(0, 8)}…)\n`);
		console.log("  1.  Study");
		console.log("  2.  Manage courses");
		console.log("  3.  Settings");
		console.log("  4.  Quit");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "1") {
			await studySession(userId, settings);
		} else if (input === "2") {
			await manageCoursesMenu(userId, settings);
		} else if (input === "3") {
			await settingsMenu(settings);
		} else if (input === "4" || input === "q") {
			break;
		}
	}

	rl.close();
}

main().catch((err) => {
	console.error("\nError:", err.message);
	rl.close();
	process.exit(1);
});
