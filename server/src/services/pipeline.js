/**
 * Post-response pipeline: completion check → subtopic unlock → struggling detection.
 *
 * Used by:
 *   - responseController  (runs eagerly after server-graded responses)
 *   - cron                (runs on each tick as background sweep)
 *
 * Returns { completed, unlocked, struggling } so callers can report state to clients.
 */

const pool = require("../config/db");
const queueModel = require("../models/queueModel");

const STRUGGLING_THRESHOLD   = parseFloat(process.env.STRUGGLING_THRESHOLD   || "1.5");
const MIN_RESPONSES_STRUGGLE = parseInt(process.env.MIN_RESPONSES_STRUGGLE   || "3",  10);
const RESPONSE_WINDOW        = parseInt(process.env.RESPONSE_WINDOW          || "10", 10);

async function runPipeline(userId) {
	const completed = await checkAndComplete(userId);
	const unlocked  = await unlockNext(userId);
	const struggling = await checkStruggling(userId);
	return { completed, unlocked, struggling };
}

// ── Completion check ──────────────────────────────────────────────────────────

/**
 * A subtopic is complete when all its items have moved out of the new and failed
 * bands — i.e., no items with priority = 0 (locked) or priority >= 154 remain.
 * Requires at least one item to exist (guards against empty subtopics).
 */
async function isSubtopicComplete(userId, subtopicId) {
	const res = await pool.query(
		`SELECT
		   (COUNT(*) FILTER (WHERE priority = 0 OR priority >= 154) = 0 AND COUNT(*) > 0)
		   AS is_passed
		 FROM study_queue
		 WHERE user_id = $1 AND subtopic_id = $2`,
		[userId, subtopicId]
	);
	return res.rows[0].is_passed;
}

async function checkAndComplete(userId) {
	const res = await pool.query(
		`SELECT subtopic_id
		 FROM content_progress
		 WHERE user_id = $1 AND active = true AND completed = false`,
		[userId]
	);

	const completed = [];
	for (const { subtopic_id } of res.rows) {
		if (await isSubtopicComplete(userId, subtopic_id)) {
			await pool.query(
				`UPDATE content_progress SET completed = true
				 WHERE user_id = $1 AND subtopic_id = $2`,
				[userId, subtopic_id]
			);
			completed.push(subtopic_id);
		}
	}
	return completed;
}

// ── Subtopic unlock ───────────────────────────────────────────────────────────

async function unlockNextForCourse(userId, courseId) {
	const res = await pool.query(
		`SELECT cp.subtopic_id, cp.active, cp.completed, s.prerequisites,
		        EXISTS (
		          SELECT 1 FROM study_queue sq
		          WHERE sq.user_id = $1
		            AND sq.subtopic_id = cp.subtopic_id
		            AND sq.priority >= 154
		        ) AS has_new
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.subtopic_id
		 JOIN syllabus t ON t.id = s.parent_id
		 WHERE cp.user_id = $1 AND cp.syllabus_id = $2
		 ORDER BY t.sort_order, s.sort_order`,
		[userId, courseId]
	);

	const rows = res.rows;
	if (rows.length === 0) return [];

	// A subtopic is "passed" if formally completed, or active with nothing left in new/failed bands
	const passedIds = new Set(
		rows.filter((r) => r.completed || (r.active && !r.has_new)).map((r) => r.subtopic_id)
	);
	const unlocked = [];

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];
		if (row.active) continue;

		const prereqs = row.prerequisites ?? [];
		let canUnlock;
		if (prereqs.length > 0) {
			canUnlock = prereqs.every((p) => passedIds.has(p));
		} else {
			canUnlock = i === 0 || passedIds.has(rows[i - 1].subtopic_id);
		}

		if (canUnlock) {
			await pool.query(
				`UPDATE content_progress SET active = true
				 WHERE user_id = $1 AND subtopic_id = $2`,
				[userId, row.subtopic_id]
			);
			await queueModel.promoteSubtopicItems(userId, row.subtopic_id);
			unlocked.push(row.subtopic_id);
		}
	}

	return unlocked;
}

async function unlockNext(userId) {
	const coursesRes = await pool.query(
		`SELECT DISTINCT syllabus_id FROM content_progress WHERE user_id = $1`,
		[userId]
	);

	const unlocked = [];
	for (const { syllabus_id } of coursesRes.rows) {
		const ids = await unlockNextForCourse(userId, syllabus_id);
		unlocked.push(...ids);
	}
	return unlocked;
}

// ── Struggling detection ──────────────────────────────────────────────────────

async function checkStruggling(userId) {
	const res = await pool.query(
		`SELECT cp.subtopic_id, cp.syllabus_id AS course_id, s.name AS subtopic_name
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.subtopic_id
		 WHERE cp.user_id = $1 AND cp.active = true AND cp.completed = false`,
		[userId]
	);

	const struggling = [];
	for (const { subtopic_id, course_id, subtopic_name } of res.rows) {
		const scoreRes = await pool.query(
			`SELECT COUNT(*)::int AS response_count,
			        AVG(correctness)::float AS avg_correctness
			 FROM (
			   SELECT r.correctness
			   FROM response r
			   JOIN question q ON q.id = r.question_id
			   WHERE r.user_id = $1
			     AND q.syllabus_id = $2
			     AND (r.graded_at IS NOT NULL OR q.question_type NOT IN ('freeText', 'ordering'))
			   ORDER BY r.responded_at DESC
			   LIMIT $3
			 ) recent`,
			[userId, subtopic_id, RESPONSE_WINDOW]
		);
		const row = scoreRes.rows[0];
		if (
			row.response_count >= MIN_RESPONSES_STRUGGLE &&
			row.avg_correctness < STRUGGLING_THRESHOLD
		) {
			struggling.push({
				subtopic_id,
				course_id,
				subtopic_name,
				avg_correctness: row.avg_correctness,
				response_count:  row.response_count,
			});
		}
	}
	return struggling;
}

module.exports = {
	runPipeline,
	isSubtopicComplete,
	checkAndComplete,
	unlockNextForCourse,
	unlockNext,
};
