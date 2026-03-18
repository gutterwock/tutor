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

const COMPLETION_THRESHOLD   = parseFloat(process.env.COMPLETION_THRESHOLD   || "2.5");
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

async function isSubtopicComplete(userId, subtopicId) {
	const contentRes = await pool.query(
		`SELECT c.id,
		        EXISTS (
		          SELECT 1 FROM content_view cv
		          WHERE cv.content_id = c.id AND cv.user_id = $1
		        ) AS viewed
		 FROM content c
		 WHERE c.syllabus_id = $2 AND c.active = true AND c.base_content = true`,
		[userId, subtopicId]
	);
	if (contentRes.rows.length === 0) return false;
	if (!contentRes.rows.every((r) => r.viewed)) return false;

	const scoreRes = await pool.query(
		`SELECT COUNT(r.id) AS response_count,
		        AVG(r.correctness)::float AS avg_correctness
		 FROM response r
		 JOIN question q ON q.id = r.question_id
		 WHERE r.user_id = $1 AND q.syllabus_id = $2 AND q.active = true
		   AND NOT (q.question_type IN ('freeText', 'ordering') AND r.graded_at IS NULL)`,
		[userId, subtopicId]
	);
	const row = scoreRes.rows[0];
	if (!row || parseInt(row.response_count, 10) === 0) return false;
	return row.avg_correctness >= COMPLETION_THRESHOLD;
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
		`SELECT cp.subtopic_id, cp.active, cp.completed
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.subtopic_id
		 JOIN syllabus t ON t.id = s.parent_id
		 WHERE cp.user_id = $1 AND cp.syllabus_id = $2
		 ORDER BY t.sort_order, s.sort_order`,
		[userId, courseId]
	);

	const rows = res.rows;
	if (rows.length === 0) return null;

	let lastCompletedIdx = -1;
	for (let i = 0; i < rows.length; i++) {
		if (rows[i].completed) lastCompletedIdx = i;
	}

	const nextIdx = lastCompletedIdx + 1;
	if (nextIdx >= rows.length) return null;

	const next = rows[nextIdx];
	if (next.active) return null;

	await pool.query(
		`UPDATE content_progress SET active = true
		 WHERE user_id = $1 AND subtopic_id = $2`,
		[userId, next.subtopic_id]
	);

	// Promote unlocked items from -1 to tier 3 in the queue
	await queueModel.promoteSubtopicItems(userId, next.subtopic_id);

	return next.subtopic_id;
}

async function unlockNext(userId) {
	const coursesRes = await pool.query(
		`SELECT DISTINCT syllabus_id FROM content_progress WHERE user_id = $1`,
		[userId]
	);

	const unlocked = [];
	for (const { syllabus_id } of coursesRes.rows) {
		const subtopicId = await unlockNextForCourse(userId, syllabus_id);
		if (subtopicId) unlocked.push(subtopicId);
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
