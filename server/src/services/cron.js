/**
 * Cron — adaptive engine.
 *
 * Runs on a configurable interval. For every user with active content_progress:
 *   1. Grade any ungraded freeText / ordering responses.
 *   2. Check whether active subtopics are now complete.
 *   3. Unlock the next subtopic for any course that had a completion.
 *
 * Environment variables:
 *   CRON_INTERVAL_MS     Polling interval in ms          (default: 60000)
 *   AI_MODE              "local" | "cloud"               (default: local)
 */

const pool = require("../config/db");
const scheduler = require("./scheduler");
const { gradeOrdering, gradeFreeText } = require("./grading");
const { isSubtopicComplete, unlockNextForCourse } = require("./pipeline");

const CRON_INTERVAL_MS = parseInt(process.env.CRON_INTERVAL_MS || "60000", 10);

// ── DB helpers ────────────────────────────────────────────────────────────────

/** All distinct user_ids that currently have at least one active, incomplete subtopic. */
async function getActiveUserIds() {
	const res = await pool.query(
		`SELECT DISTINCT user_id
		 FROM content_progress
		 WHERE active = true AND completed = false`
	);
	return res.rows.map((r) => r.user_id);
}

/**
 * Responses that need grading: freeText (AI) or ordering (deterministic) where graded_at IS NULL.
 * singleChoice / multiChoice / exactMatch are graded immediately on submission and never appear here.
 */
async function getUngradedResponses(userId) {
	const res = await pool.query(
		`SELECT r.id, r.user_answer,
		        q.question_text, q.answer, q.question_type
		 FROM response r
		 JOIN question q ON q.id = r.question_id
		 WHERE r.user_id = $1
		   AND r.graded_at IS NULL
		   AND q.question_type IN ('freeText', 'ordering')`,
		[userId]
	);
	return res.rows;
}

async function setCorrectness(responseId, correctness) {
	await pool.query(
		`UPDATE response SET correctness = $1, graded_at = $2 WHERE id = $3`,
		[correctness, Date.now(), responseId]
	);
}

// ── Per-user pipeline ─────────────────────────────────────────────────────────

async function runForUser(userId) {
	console.log(`[cron] processing user ${userId.slice(0, 8)}`);

	// 1. Grade ungraded freeText / ordering responses
	const ungraded = await getUngradedResponses(userId);
	for (const r of ungraded) {
		try {
			let score;
			if (r.question_type === "ordering") {
				score = gradeOrdering(r.user_answer, r.answer);
			} else {
				score = await gradeFreeText(r.question_text, r.answer, r.user_answer);
			}
			await setCorrectness(r.id, score);
			console.log(`  [cron] graded response ${r.id}: ${score}/4 (${r.question_type})`);
		} catch (err) {
			console.error(`  [cron] grading failed for response ${r.id}:`, err.message);
		}
	}

	// 2. Check active subtopics for completion
	const activeRes = await pool.query(
		`SELECT subtopic_id
		 FROM content_progress
		 WHERE user_id = $1 AND active = true AND completed = false`,
		[userId]
	);

	for (const { subtopic_id } of activeRes.rows) {
		const complete = await isSubtopicComplete(userId, subtopic_id);
		if (complete) {
			await pool.query(
				`UPDATE content_progress SET completed = true WHERE user_id = $1 AND subtopic_id = $2`,
				[userId, subtopic_id]
			);
			console.log(`  [cron] completed ${subtopic_id} for user ${userId.slice(0, 8)}`);
		}
	}

	// 3. Refill study queue (also handles regression detection)
	await scheduler.refillIfNeeded(userId).catch((err) =>
		console.error(`  [cron] queue refill failed for ${userId.slice(0, 8)}:`, err.message)
	);

	// 4. Unlock next subtopic for every course the user is enrolled in.
	// Running this unconditionally (not just on new completions) ensures recovery
	// if a previous unlock failed after the subtopic was already marked complete.
	const coursesRes = await pool.query(
		`SELECT DISTINCT syllabus_id FROM content_progress WHERE user_id = $1`,
		[userId]
	);
	for (const { syllabus_id } of coursesRes.rows) {
		const unlocked = await unlockNextForCourse(userId, syllabus_id);
		if (unlocked) console.log(`  [cron] unlocked ${unlocked} for user ${userId.slice(0, 8)}`);
	}
}

// ── Cron runner ───────────────────────────────────────────────────────────────

let _handle = null;
let _running = false;

async function runCron() {
	if (_running) {
		console.log("[cron] previous tick still running — skipping");
		return;
	}
	_running = true;
	try {
		const userIds = await getActiveUserIds();
		if (userIds.length === 0) return;
		console.log(`[cron] tick — ${userIds.length} active user(s)`);
		for (const userId of userIds) {
			await runForUser(userId);
		}
	} catch (err) {
		console.error("[cron] tick error:", err);
	} finally {
		_running = false;
	}
}

function startCron() {
	if (_handle) return;
	console.log(`[cron] starting (interval: ${CRON_INTERVAL_MS}ms)`);
	// Delay first tick by 10s to allow the DB to finish initialising before the
	// server starts querying. Subsequent ticks run on the normal interval.
	setTimeout(() => {
		runCron();
		_handle = setInterval(runCron, CRON_INTERVAL_MS);
	}, 10_000);
}

function stopCron() {
	if (_handle) {
		clearInterval(_handle);
		_handle = null;
		console.log("[cron] stopped");
	}
}

module.exports = { startCron, stopCron, runCron, runForUser };
