#!/usr/bin/env node

const readline = require("readline");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const API = process.env.API_URL || "http://localhost:3000";
const ID_FILE = path.join(__dirname, ".user_id");
const SETTINGS_FILE = path.join(__dirname, ".settings.json");

const DEFAULT_SETTINGS = {
	disabled_courses: [],       // course IDs temporarily excluded from course picker
	session_size: 10,           // items per session (min 5); also used as limit per tier in fetch
	review_pct: 30,             // % of session drawn from review tiers (0/1/2/4); rest from tier 3 (new)
	last_selected_courses: [],  // last course IDs chosen at session start; used as default
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
const hr = () => console.log("\n" + "─".repeat(60));
const stripAccents = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Shuffle the values across option keys, keeping the displayed letters (a/b/c/d) the same.
 * Returns shuffledOptions (same keys, values reassigned) and keyToOriginal (display key → original key).
 * When the user picks display key "a", keyToOriginal["a"] gives the real answer key to submit.
 */
function shuffleOptions(options) {
	const keys = Object.keys(options);
	if (keys.length <= 1) {
		return { shuffledOptions: options, keyToOriginal: Object.fromEntries(keys.map((k) => [k.toLowerCase(), k.toLowerCase()])) };
	}
	// Fisher-Yates on index array
	const indices = keys.map((_, i) => i);
	for (let i = indices.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[indices[i], indices[j]] = [indices[j], indices[i]];
	}
	const shuffledOptions = {};
	const keyToOriginal = {};
	keys.forEach((displayKey, i) => {
		const originalKey = keys[indices[i]];
		shuffledOptions[displayKey] = options[originalKey];
		keyToOriginal[displayKey.toLowerCase()] = originalKey.toLowerCase();
	});
	return { shuffledOptions, keyToOriginal };
}
const clear = () => process.stdout.write("\x1Bc");

function progressBar(completed, total, width = 20) {
	if (total === 0) return "░".repeat(width);
	const filled = Math.round((completed / total) * width);
	return "▓".repeat(filled) + "░".repeat(width - filled);
}

// ── session composition ───────────────────────────────────────────────────────

/**
 * Given the flat tiered fetch result, compose a session of `sessionSize` items.
 * reviewPct (0–100) controls what fraction comes from review tiers (0/1/2/4).
 * Tier 3 = new items. If one bucket is short, the other fills the remainder.
 * Final order: randomly interleaved across tiers, priority DESC preserved within each tier.
 */
function composeSession(items, sessionSize, reviewPct) {
	const newItems    = items.filter((i) => i.priority >= 300).sort((a, b) => b.priority - a.priority);
	const reviewItems = items.filter((i) => i.priority >= 0 && i.priority < 300).sort((a, b) => b.priority - a.priority);

	const targetNew    = Math.max(0, Math.floor(sessionSize * (1 - reviewPct / 100)));
	const targetReview = sessionSize - targetNew;

	const fromNew    = newItems.slice(0, targetNew);
	const fromReview = reviewItems.slice(0, targetReview);

	const chosen = [...fromNew, ...fromReview];

	// Fill gaps
	if (fromNew.length < targetNew) {
		const gap = targetNew - fromNew.length;
		chosen.push(...reviewItems.slice(targetReview, targetReview + gap));
	} else if (fromReview.length < targetReview) {
		const gap = targetReview - fromReview.length;
		chosen.push(...newItems.slice(targetNew, targetNew + gap));
	}

	// Group into per-tier buckets sorted by priority DESC (preserves within-tier order)
	const tierMap = new Map();
	for (const item of chosen) {
		const tier = Math.floor(item.priority / 100);
		if (!tierMap.has(tier)) tierMap.set(tier, []);
		tierMap.get(tier).push(item);
	}
	const buckets = [...tierMap.values()].map((b) => b.sort((a, b) => b.priority - a.priority));

	// Randomly interleave across tiers: pick a random non-empty bucket at each step
	const result = [];
	while (buckets.some((b) => b.length > 0)) {
		const nonEmpty = buckets.filter((b) => b.length > 0);
		const bucket = nonEmpty[Math.floor(Math.random() * nonEmpty.length)];
		result.push(bucket.shift());
	}
	return result;
}

// ── settings menu ─────────────────────────────────────────────────────────────

async function settingsMenu(settings) {
	while (true) {
		clear();
		console.log("Settings\n");
		console.log(`  1.  Session size   [${settings.session_size} items]  — items shown per session (min 5)`);
		console.log(`  2.  Review %       [${settings.review_pct}%]  — portion of session from review tiers (0=all new, 100=all review)`);
		console.log("\n  b.  Back");

		const input = (await ask("\n> ")).trim().toLowerCase();
		if (input === "1") {
			const raw = (await ask("  Session size (min 5): ")).trim();
			const n = parseInt(raw, 10);
			if (!isNaN(n) && n >= 5) {
				settings.session_size = n;
				saveSettings(settings);
			} else {
				console.log("  Invalid — minimum 5.");
				await pause();
			}
		} else if (input === "2") {
			const raw = (await ask("  Review % (0–100): ")).trim();
			const n = parseInt(raw, 10);
			if (!isNaN(n) && n >= 0 && n <= 100) {
				settings.review_pct = n;
				saveSettings(settings);
			} else {
				console.log("  Invalid — enter 0–100.");
				await pause();
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
		console.log(`\n  p.  ${paused ? "Resume" : "Pause"} this course`);
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
				console.log(`\n  "${course.name}" paused.`);
			}
			saveSettings(settings);
			await pause();
		} else if (input === "u") {
			const confirm = (await ask(`\n  Unenroll from "${course.name}"? This cannot be undone. (y/N) `)).trim().toLowerCase();
			if (confirm === "y") {
				await api("DELETE", "/syllabus/enroll", { user_id: userId, course_id: course.id });
				const di = settings.disabled_courses.indexOf(course.id);
				if (di >= 0) settings.disabled_courses.splice(di, 1);
				// Remove from last_selected_courses if present
				settings.last_selected_courses = (settings.last_selected_courses || [])
					.filter((id) => id !== course.id);
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

// ── course picker ─────────────────────────────────────────────────────────────

/**
 * Prompt the user to select which courses to study.
 * Defaults to last_selected_courses. Returns an array of course IDs.
 */
async function pickCourses(userId, settings) {
	const enrolled = await api("GET", `/enrollments?user_id=${userId}`);
	const available = enrolled.filter((c) => !settings.disabled_courses.includes(c.id));

	if (available.length === 0) {
		console.log("\nNo active courses. Use Manage courses to enroll or resume a paused course.\n");
		return null;
	}

	if (available.length === 1) {
		// Only one option — skip the picker
		return [available[0].id];
	}

	// Determine defaults
	const last = (settings.last_selected_courses || []).filter((id) =>
		available.some((c) => c.id === id)
	);
	const defaultSet = last.length > 0 ? last : available.map((c) => c.id);

	console.log("\nSelect courses for this session (space-separated numbers, Enter for default):\n");
	available.forEach((c, i) => {
		const isDefault = defaultSet.includes(c.id) ? "*" : " ";
		console.log(`  ${isDefault} ${i + 1}.  ${c.name}`);
	});
	console.log("\n  (* = default selection)");

	const input = (await ask("\n> ")).trim();
	let selected;

	if (!input) {
		selected = available.filter((c) => defaultSet.includes(c.id));
	} else {
		const indices = input.split(/\s+/).map((s) => parseInt(s, 10) - 1);
		const invalid = indices.filter((i) => isNaN(i) || i < 0 || i >= available.length);
		if (invalid.length) {
			console.log("Invalid selection.");
			return null;
		}
		selected = indices.map((i) => available[i]);
	}

	if (selected.length === 0) {
		console.log("No courses selected.");
		return null;
	}

	const ids = selected.map((c) => c.id);
	settings.last_selected_courses = ids;
	saveSettings(settings);
	return ids;
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
 */
async function askQuestion(data) {
	if (data.passage) {
		console.log('\n--- Context ---');
		console.log(data.passage);
		console.log('---------------');
	}
	console.log(`\n\n\n${data.question_text}\n`);

	let userAnswer;
	let correctness = 0;

	const validKeys = data.options ? Object.keys(data.options).map((k) => k.toLowerCase()) : [];

	if (data.question_type === "singleChoice") {
		const { shuffledOptions, keyToOriginal } = shuffleOptions(data.options);
		console.log(formatOptions(shuffledOptions) + "\n");
		let input;
		while (true) {
			input = (await ask("Answer: ")).trim().toLowerCase();
			if (input && validKeys.includes(input)) break;
			console.log(`  Enter one of: ${validKeys.join(", ")}`);
		}
		userAnswer = keyToOriginal[input];
		const isCorrect = userAnswer === String(data.answer).toLowerCase();
		correctness = isCorrect ? 4 : 0;
		if (isCorrect) {
			console.log("\n  ✓ Correct!");
		} else {
			const correctText = data.options?.[data.answer] ? `${data.answer}) ${data.options[data.answer]}` : data.answer;
			console.log(`\n  ✗ Incorrect — answer: ${correctText}`);
		}
		if (data.explanation) console.log(`\n  ${data.explanation}`);

	} else if (data.question_type === "multiChoice") {
		const { shuffledOptions, keyToOriginal } = shuffleOptions(data.options);
		console.log(formatOptions(shuffledOptions) + "\n");
		let parts;
		while (true) {
			const input = (await ask("Answer (comma-separated, e.g. a,c): ")).trim().toLowerCase();
			parts = input.split(",").map((s) => s.trim()).filter(Boolean);
			if (parts.length > 0 && parts.every((k) => validKeys.includes(k))) break;
			console.log(`  Enter one or more of: ${validKeys.join(", ")}`);
		}
		userAnswer = parts.map((k) => keyToOriginal[k]);
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
		if (isCorrect) {
			correctness = 4;
			console.log("\n  ✓ Correct!");
			if (data.explanation) console.log(`\n  ${data.explanation}`);
		} else {
			// Deterministic match failed — fall back to AI to check for equivalent answers
			return { correctness: 0, userAnswer, needsAiGrading: true };
		}

	} else if (data.question_type === "ordering") {
		const { shuffledOptions, keyToOriginal } = shuffleOptions(data.options);
		console.log(formatOptions(shuffledOptions) + "\n");
		let parts;
		while (true) {
			const input = (await ask("Order (comma-separated, e.g. b,d,a,c): ")).trim().toLowerCase();
			parts = input.split(",").map((s) => s.trim()).filter(Boolean);
			if (parts.length === validKeys.length && parts.every((k) => validKeys.includes(k))) break;
			console.log(`  Enter all ${validKeys.length} keys in order: ${validKeys.join(", ")}`);
		}
		userAnswer = parts.map((k) => keyToOriginal[k]);
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
	// Course picker
	const courseIds = await pickCourses(userId, settings);
	if (!courseIds) return;

	const sessionSize = Math.max(5, settings.session_size ?? 10);
	const reviewPct   = Math.max(0, Math.min(100, settings.review_pct ?? 30));

	const courseIdsParam = courseIds.map(encodeURIComponent).join(",");
	const questionOnlyQuery = questionOnly ? "&question_only=true" : "";

	const rawItems = await api(
		"GET",
		`/queue?user_id=${userId}&course_ids=${courseIdsParam}&limit=${sessionSize}${questionOnlyQuery}`
	).catch((err) => {
		console.error("Failed to fetch queue:", err.message);
		return [];
	});

	if (!rawItems.length) {
		console.log("\nNothing in your queue for the selected courses.\n");
		await pause();
		return;
	}

	const items = composeSession(rawItems, sessionSize, reviewPct);

	if (!items.length) {
		console.log("\nYour queue is empty — nothing due right now.\n");
		await pause();
		return;
	}

	const hasReview = items.some((i) => i.priority >= 0 && i.priority < 300);
	console.log(`\n${items.length} item${items.length > 1 ? "s" : ""} in session${hasReview ? " (includes review)" : ""}`);
	await pause();

	let correct = 0;
	let total = 0;

	for (const item of items) {
		clear();
		if (item.item_data?.breadcrumb) console.log(`\n  ${item.item_data.breadcrumb}\n`);
		const data = item.item_data;

		if (item.item_type === "content") {
			if (data.body && data.body.trim()) {
				await showContent(data);
			}
			await api("DELETE", `/queue/${item.id}`).catch(() => {});

		} else {
			hr();
			let { correctness, userAnswer, needsAiGrading } = await askQuestion(data);
			const submitBody = { question_id: data.id, user_id: userId, user_answer: userAnswer };
			if (data.question_type !== "freeText" && !needsAiGrading) submitBody.correctness = correctness;
			const submitted = await api("POST", "/responses", submitBody);

			if (submitted.needs_grading) {
				console.log("\n  Grading...");
				const graded = await api(
					"POST", `/responses/${submitted.id}/grade-ai`, { user_id: userId }
				).catch(() => null);
				if (graded) {
					const labels = ["Wrong", "Mostly wrong", "Partial", "Mostly correct", "Correct"];
					console.log(`  Grade: ${graded.correctness}/4 — ${labels[graded.correctness] ?? "?"}`);
					if (data.answer) {
						const answerLabel = data.question_type === "exactMatch" ? "Accepted" : "Example answer";
						const answerText = Array.isArray(data.answer) ? data.answer.join(" / ") : data.answer;
						console.log(`\n  ${answerLabel}: ${answerText}`);
					}
					if (data.explanation) console.log(`\n  ${data.explanation}`);
					correctness = graded.correctness;
				} else {
					console.log("  (Grading failed — marked as incorrect.)");
					correctness = 0;
					await api("PATCH", `/responses/${submitted.id}/grade`, { user_id: userId, correctness: 0 }).catch(() => {});
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
