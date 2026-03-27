/**
 * Cron — adaptive engine.
 *
 * Runs on a configurable interval. For every user with active content_progress:
 *   1. Check whether active subtopics are now complete.
 *   2. Unlock the next subtopic for any course that had a completion.
 *   3. Reactivate regressed subtopics (completed subtopics with declining scores).
 *
 * Environment variables:
 *   CRON_INTERVAL_MS     Polling interval in ms          (default: 60000)
 */

const pool = require("../config/db");
const queueModel = require("../models/queueModel");
const { isSubtopicComplete, unlockNextForCourse } = require("./pipeline");

const CRON_INTERVAL_MS        = parseInt(process.env.CRON_INTERVAL_MS        || "60000", 10);
const REGRESSION_THRESHOLD    = parseFloat(process.env.REGRESSION_THRESHOLD  || "1.5");
const MIN_RESPONSES_REGRESS   = parseInt(process.env.MIN_RESPONSES_REGRESS   || "5",     10);

// ── DB helpers ────────────────────────────────────────────────────────────────

/** All distinct user_ids that have at least one active subtopic (complete or not). */
async function getActiveUserIds() {
	const res = await pool.query(
		`SELECT DISTINCT user_id
		 FROM content_progress
		 WHERE active = true`
	);
	return res.rows.map((r) => r.user_id);
}

// ── Regression detection ──────────────────────────────────────────────────────

async function reactivateRegressions(userId, skipSubtopics = new Set()) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		const res = await client.query(
			`SELECT subtopic_id FROM content_progress
			 WHERE user_id = $1 AND completed = true
			 FOR UPDATE`,
			[userId]
		);
		for (const { subtopic_id } of res.rows) {
			if (skipSubtopics.has(subtopic_id)) continue;
			const { responseCount, avgCorrectness } =
				await queueModel.getSubtopicScore(userId, subtopic_id, MIN_RESPONSES_REGRESS);
			if (responseCount >= MIN_RESPONSES_REGRESS && avgCorrectness < REGRESSION_THRESHOLD) {
				await client.query(
					`UPDATE content_progress SET completed = false, active = true
					 WHERE user_id = $1 AND subtopic_id = $2`,
					[userId, subtopic_id]
				);
				await queueModel.regressSubtopicItems(userId, subtopic_id);
				console.log(`  [cron] regression — reactivated ${subtopic_id} for ${userId.slice(0, 8)}`);
			}
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

// ── Per-user pipeline ─────────────────────────────────────────────────────────

async function runForUser(userId) {
	console.log(`[cron] processing user ${userId.slice(0, 8)}`);

	// 1. Check active subtopics for completion
	const activeRes = await pool.query(
		`SELECT subtopic_id
		 FROM content_progress
		 WHERE user_id = $1 AND active = true AND completed = false`,
		[userId]
	);

	const justCompleted = new Set();
	for (const { subtopic_id } of activeRes.rows) {
		const complete = await isSubtopicComplete(userId, subtopic_id);
		if (complete) {
			await pool.query(
				`UPDATE content_progress SET completed = true WHERE user_id = $1 AND subtopic_id = $2`,
				[userId, subtopic_id]
			);
			justCompleted.add(subtopic_id);
			console.log(`  [cron] completed ${subtopic_id} for user ${userId.slice(0, 8)}`);
		}
	}

	// 2. Unlock next subtopic for every course the user is enrolled in.
	const coursesRes = await pool.query(
		`SELECT DISTINCT syllabus_id FROM content_progress WHERE user_id = $1`,
		[userId]
	);
	for (const { syllabus_id } of coursesRes.rows) {
		const unlocked = await unlockNextForCourse(userId, syllabus_id);
		if (unlocked.length > 0) console.log(`  [cron] unlocked ${unlocked} for user ${userId.slice(0, 8)}`);
	}

	// 3. Regression detection — disabled for now
	// await reactivateRegressions(userId, justCompleted);
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
