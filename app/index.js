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
	course_weights: {},         // course ID → integer multiplier (default 1, omitted if 1)
	session_length: null,       // null = unlimited; number = max shown items per session
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
const stripAccents = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const clear = () => process.stdout.write("\x1Bc");

function progressBar(completed, total, width = 20) {
	if (total === 0) return "░".repeat(width);
	const filled = Math.round((completed / total) * width);
	return "▓".repeat(filled) + "░".repeat(width - filled);
}

// ── settings menu ─────────────────────────────────────────────────────────────

async function settingsMenu(settings) {
	while (true) {
		clear();
		console.log("Settings\n");
		console.log(`  1.  Interleave courses    [${on(settings.interleave_courses)}]  — mix subtopics from all courses in one session`);
		console.log(`  2.  Interleave subtopics  [${on(settings.interleave_subtopics)}]  — study all active subtopics per session vs. one at a time`);
		const sl = settings.session_length;
		console.log(`  3.  Session length        [${sl ? sl + " items" : "unlimited"}]  — items shown per session (0 to clear)`);
		console.log("\n  b.  Back");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "1") {
			settings.interleave_courses = !settings.interleave_courses;
			saveSettings(settings);
		} else if (input === "2") {
			settings.interleave_subtopics = !settings.interleave_subtopics;
			saveSettings(settings);
		} else if (input === "3") {
			const raw = (await ask("  Session length (number of items, or 0 for unlimited): ")).trim();
			const n = parseInt(raw, 10);
			if (!isNaN(n) && n >= 0) {
				settings.session_length = n === 0 ? null : n;
				saveSettings(settings);
			}
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

	const input = await ask("\nEnter number(s) to enroll (space-separated, or Enter to cancel): ");
	if (!input.trim()) return;

	const indices = input.trim().split(/\s+/).map((s) => parseInt(s, 10) - 1);
	const invalid = indices.filter((i) => isNaN(i) || i < 0 || i >= allCourses.length);
	if (invalid.length) {
		console.log("Invalid selection(s).");
		return;
	}

	for (const idx of indices) {
		const course = allCourses[idx];
		const result = await api("POST", "/syllabus/enroll", { user_id: userId, course_id: course.id });
		console.log(`\nEnrolled in "${course.name}" — ${result.enrolled} subtopic(s) created.`);
	}
}

async function showCourseProgress(userId, course, settings) {
	while (true) {
		clear();
		const progress = await api(
			"GET",
			`/course-progress?user_id=${userId}&course_id=${encodeURIComponent(course.id)}`
		);

		console.log(`\n  ${course.name}  (${progress.completed} / ${progress.total})\n`);
		hr();

		for (const topic of progress.topics) {
			console.log(`\n  ${topic.name}`);
			for (const sub of topic.subtopics) {
				const icon = sub.status === "completed" ? "✓" : sub.status === "active" ? "→" : " ";
				console.log(`    ${icon}  ${sub.name}`);
			}
		}

		const paused = settings.disabled_courses.includes(course.id);
		const weight = settings.course_weights[course.id] ?? 1;
		console.log(`\n  p.  ${paused ? "Resume" : "Pause"} this course`);
		console.log(`  w.  Set weight  (currently ${weight}×)`);
		console.log("  u.  Unenroll from this course");
		console.log("  b.  Back");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "b" || input === "") return;
		if (input === "p") {
			const i = settings.disabled_courses.indexOf(course.id);
			if (i >= 0) {
				settings.disabled_courses.splice(i, 1);
				console.log(`\n  "${course.name}" resumed.`);
			} else {
				settings.disabled_courses.push(course.id);
				await api("DELETE", `/queue?user_id=${userId}&course_id=${encodeURIComponent(course.id)}`).catch(() => {});
				console.log(`\n  "${course.name}" paused.`);
			}
			saveSettings(settings);
			await pause();
		} else if (input === "w") {
			const raw = (await ask("  Weight (1–5, default 1): ")).trim();
			const w = parseInt(raw, 10);
			if (!isNaN(w) && w >= 1 && w <= 5) {
				if (w === 1) {
					delete settings.course_weights[course.id];
				} else {
					settings.course_weights[course.id] = w;
				}
				saveSettings(settings);
				console.log(`\n  Weight set to ${w}×.`);
			} else {
				console.log("\n  Invalid — enter a number between 1 and 5.");
			}
			await pause();
		} else if (input === "u") {
			const confirm = (await ask(`\n  Unenroll from "${course.name}"? This cannot be undone. (y/N) `)).trim().toLowerCase();
			if (confirm === "y") {
				await api("DELETE", "/syllabus/enroll", { user_id: userId, course_id: course.id });
				const di = settings.disabled_courses.indexOf(course.id);
				if (di >= 0) settings.disabled_courses.splice(di, 1);
				delete settings.course_weights[course.id];
				saveSettings(settings);
				console.log(`\n  Unenrolled from "${course.name}".`);
				await pause();
				return;
			}
		}
	}
}

async function manageCoursesMenu(userId, settings) {
	while (true) {
		clear();
		console.log("Manage courses\n");

		const enrolled = await api("GET", `/enrollments?user_id=${userId}`);

		if (enrolled.length === 0) {
			console.log("  Not enrolled in any courses yet.\n");
		} else {
			const progresses = await Promise.all(
				enrolled.map((c) =>
					api("GET", `/course-progress?user_id=${userId}&course_id=${encodeURIComponent(c.id)}`)
						.catch(() => ({ completed: 0, total: 0 }))
				)
			);

			enrolled.forEach((c, i) => {
				const paused = settings.disabled_courses.includes(c.id);
				const { completed, total } = progresses[i];
				const bar  = progressBar(completed, total);
				const frac = `${completed} / ${total}`;
				console.log(`  ${i + 1}.  [${paused ? "paused" : "active"}]  ${c.name}`);
				console.log(`       ${bar}  ${frac}`);
			});

			console.log("\n  Select a number to view details.");
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
				await showCourseProgress(userId, enrolled[idx], settings);
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
	console.log(`\n\n\n  ${data.title}\n`);
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
	console.log(`\n\n\n${data.question_text}\n`);

	let userAnswer;
	let correctness = 0;

	const validKeys = data.options ? Object.keys(data.options).map((k) => k.toLowerCase()) : [];

	if (data.question_type === "singleChoice") {
		console.log(formatOptions(data.options) + "\n");
		let input;
		while (true) {
			input = (await ask("Answer: ")).trim().toLowerCase();
			if (input && validKeys.includes(input)) break;
			console.log(`  Enter one of: ${validKeys.join(", ")}`);
		}
		userAnswer = input;
		const isCorrect = input === String(data.answer).toLowerCase();
		correctness = isCorrect ? 4 : 0;
		if (isCorrect) {
			console.log("\n  ✓ Correct!");
		} else {
			const correctText = data.options?.[data.answer] ? `${data.answer}) ${data.options[data.answer]}` : data.answer;
			console.log(`\n  ✗ Incorrect — answer: ${correctText}`);
		}
		if (data.explanation) console.log(`\n  ${data.explanation}`);

	} else if (data.question_type === "multiChoice") {
		console.log(formatOptions(data.options) + "\n");
		let parts;
		while (true) {
			const input = (await ask("Answer (comma-separated, e.g. a,c): ")).trim().toLowerCase();
			parts = input.split(",").map((s) => s.trim()).filter(Boolean);
			if (parts.length > 0 && parts.every((k) => validKeys.includes(k))) break;
			console.log(`  Enter one or more of: ${validKeys.join(", ")}`);
		}
		userAnswer = parts;
		const expected = (Array.isArray(data.answer) ? data.answer : [data.answer]).map((v) => String(v).trim().toLowerCase());
		const isCorrect = JSON.stringify([...userAnswer].sort()) === JSON.stringify([...expected].sort());
		correctness = isCorrect ? 4 : 0;
		if (isCorrect) {
			console.log("\n  ✓ Correct!");
		} else {
			const correctText = expected.map((k) => data.options?.[k] ? `${k}) ${data.options[k]}` : k).join(", ");
			console.log(`\n  ✗ Incorrect — answer: ${correctText}`);
		}
		if (data.explanation) console.log(`\n  ${data.explanation}`);

	} else if (data.question_type === "exactMatch") {
		let input;
		while (true) {
			input = (await ask("Answer: ")).trim();
			if (input) break;
			console.log("  Please enter an answer.");
		}
		userAnswer = input;
		const answers = Array.isArray(data.answer) ? data.answer : [data.answer];
		const isCorrect = answers.some((a) => {
			const expected = String(a).trim();
			if (data.case_sensitive) {
				return input === expected || stripAccents(input) === stripAccents(expected);
			}
			return input.toLowerCase() === expected.toLowerCase() ||
				stripAccents(input).toLowerCase() === stripAccents(expected).toLowerCase();
		});
		correctness = isCorrect ? 4 : 0;
		console.log(isCorrect ? "\n  ✓ Correct!" : `\n  ✗ Incorrect — accepted: ${answers.join(" / ")}`);
		if (data.explanation) console.log(`\n  ${data.explanation}`);

	} else if (data.question_type === "ordering") {
		console.log(formatOptions(data.options) + "\n");
		let parts;
		while (true) {
			const input = (await ask("Order (comma-separated, e.g. b,d,a,c): ")).trim().toLowerCase();
			parts = input.split(",").map((s) => s.trim()).filter(Boolean);
			if (parts.length === validKeys.length && parts.every((k) => validKeys.includes(k))) break;
			console.log(`  Enter all ${validKeys.length} keys in order: ${validKeys.join(", ")}`);
		}
		userAnswer = parts;
		const expected = (Array.isArray(data.answer) ? data.answer : []).map((k) => String(k).toLowerCase());
		correctness = JSON.stringify(userAnswer) === JSON.stringify(expected) ? 4 : 0;
		const correctOrder = (Array.isArray(data.answer) ? data.answer : [])
			.map((k) => data.options?.[k] ? `${k}) ${data.options[k]}` : k).join(" → ");
		if (correctness === 4) {
			console.log("\n  ✓ Correct!");
		} else {
			console.log(`\n  ✗ Incorrect — correct order: ${correctOrder}`);
		}
		if (data.explanation) console.log(`\n  ${data.explanation}`);

	} else {
		// freeText
		let input;
		while (true) {
			input = await ask("Answer: ");
			if (input.trim()) break;
			console.log("  Please enter an answer.");
		}
		userAnswer = input;
	}

	return { correctness, userAnswer };
}

async function studySession(userId, settings, questionOnly = false) {
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
	const weightParam = Object.entries(settings.course_weights ?? {})
		.map(([id, w]) => `${id}:${w}`)
		.join(",");
	const weightsQuery = weightParam ? `&weights=${encodeURIComponent(weightParam)}` : "";
	const sessionLimit = settings.session_length ?? null;
	// Over-fetch slightly to account for empty-body content items that are consumed silently
	const fetchLimit = sessionLimit ? Math.min(sessionLimit + 20, 100) : 50;
	const sessionLengthQuery = sessionLimit ? `&session_length=${sessionLimit}` : "";
	const questionOnlyQuery = questionOnly ? "&question_only=true" : "";
	let items = await api("GET", `/queue?user_id=${userId}&limit=${fetchLimit}${weightsQuery}${sessionLengthQuery}${questionOnlyQuery}`);

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
	if (sessionLimit) {
		console.log(`\nSession: up to ${sessionLimit} item${sessionLimit > 1 ? "s" : ""}${hasReview ? " (includes review)" : ""}`);
	} else {
		console.log(`\n${items.length} item${items.length > 1 ? "s" : ""} in session${hasReview ? " (includes review)" : ""}`);
	}
	await pause();

	let correct = 0;
	let total = 0;
	let shownCount = 0;

	for (const item of items) {
		if (sessionLimit && shownCount >= sessionLimit) break;

		clear();
		if (item.item_data.breadcrumb) console.log(`\n  ${item.item_data.breadcrumb}\n`);
		const data = item.item_data;

		if (item.item_type === "content") {
			if (data.body && data.body.trim()) {
				await showContent(data);
				shownCount++;
			}
			// DELETE triggers content_view upsert server-side (even for empty-body parent records)
			await api("DELETE", `/queue/${item.id}`).catch(() => {});

		} else {
			shownCount++;
			hr();
			let { correctness, userAnswer } = await askQuestion(data);
			// Submit response before dequeuing so a crash between the two leaves the item in queue
			// Omit correctness for freeText so server stores it as ungraded (needs_grading: true)
			const submitBody = { question_id: data.id, user_id: userId, user_answer: userAnswer };
			if (data.question_type !== "freeText") submitBody.correctness = correctness;
			const submitted = await api("POST", "/responses", submitBody);

			if (submitted.needs_grading) {
				console.log("\n  Grading...");
				const graded = await api(
					"POST", `/responses/${submitted.id}/grade-ai`, { user_id: userId }
				).catch(() => null);
				if (graded) {
					const labels = ["Wrong", "Mostly wrong", "Partial", "Mostly correct", "Correct"];
					console.log(`  Grade: ${graded.correctness}/4 — ${labels[graded.correctness] ?? "?"}`);
					if (data.answer) console.log(`\n  Example answer: ${data.answer}`);
					if (data.explanation) console.log(`\n  ${data.explanation}`);
					correctness = graded.correctness;
				} else {
					console.log("  (Grading failed — will be retried by server.)");
				}
				await pause();
			} else {
				await pause();
			}

			await api("DELETE", `/queue/${item.id}`).catch(() => {});

			if (data.question_type !== "freeText") {
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
		console.log("  1.  Study  ← Enter");
		console.log("  2.  Quiz");
		console.log("  3.  Manage courses");
		console.log("  4.  Settings");
		console.log("  5.  Quit");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "1" || input === "") {
			await studySession(userId, settings);
		} else if (input === "2") {
			await studySession(userId, settings, true);
		} else if (input === "3") {
			await manageCoursesMenu(userId, settings);
		} else if (input === "4") {
			await settingsMenu(settings);
		} else if (input === "5" || input === "q") {
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
