const pool = require("../config/db");

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Return the next `limit` ready items for a user, ordered by priority ASC.
 * `item_data` contains the full denormalized content or question record.
 */
async function peekQueue(userId, limit = 10) {
	const result = await pool.query(
		`SELECT id, user_id, course_id, subtopic_id, item_type, item_id,
		        item_data, priority, is_review, created_at
		 FROM study_queue
		 WHERE user_id = $1
		 ORDER BY priority ASC, created_at ASC
		 LIMIT $2`,
		[userId, limit]
	);
	return result.rows;
}

/** Count of items in the queue for a user. */
async function queueSize(userId) {
	const result = await pool.query(
		`SELECT COUNT(*) AS count FROM study_queue WHERE user_id = $1`,
		[userId]
	);
	return parseInt(result.rows[0].count, 10);
}

/**
 * Set of "type:id" strings for all items currently in the queue.
 * Used by the scheduler to skip items that are already queued.
 */
async function getQueuedItemKeys(userId) {
	const result = await pool.query(
		`SELECT item_type, item_id FROM study_queue WHERE user_id = $1`,
		[userId]
	);
	return new Set(result.rows.map((r) => `${r.item_type}:${r.item_id}`));
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-insert queue items. ON CONFLICT DO NOTHING makes this idempotent —
 * items already in the queue are untouched.
 */
async function insertItems(items) {
	if (!items.length) return;
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		for (const item of items) {
			await client.query(
				`INSERT INTO study_queue
				   (user_id, course_id, subtopic_id, item_type, item_id, item_data, priority, is_review)
				 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
				 ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
				[
					item.user_id, item.course_id, item.subtopic_id,
					item.item_type, item.item_id, JSON.stringify(item.item_data),
					item.priority, item.is_review ?? false,
				]
			);
		}
		await client.query("COMMIT");
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Remove one item from the queue. Returns the deleted row, or null if not found.
 */
async function deleteItem(id) {
	const result = await pool.query(
		`DELETE FROM study_queue WHERE id = $1 RETURNING *`,
		[id]
	);
	return result.rows[0] ?? null;
}

/**
 * Clear all queue items for a subtopic (used when the scheduler detects that
 * a subtopic has become struggling and needs immediate re-prioritisation).
 */
async function clearSubtopicItems(userId, subtopicId) {
	await pool.query(
		`DELETE FROM study_queue WHERE user_id = $1 AND subtopic_id = $2`,
		[userId, subtopicId]
	);
}

// ── Performance aggregates (used by the scheduler) ────────────────────────────

/**
 * Aggregate correctness of the last `window` graded responses for a subtopic.
 * Returns { responseCount, avgCorrectness } or { responseCount: 0, avgCorrectness: null }.
 */
async function getSubtopicScore(userId, subtopicId, window = 10) {
	const result = await pool.query(
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
		[userId, subtopicId, window]
	);
	const row = result.rows[0];
	return {
		responseCount: row.response_count,
		avgCorrectness: row.avg_correctness,
	};
}

/**
 * Per-question performance for questions in a list of subtopics.
 * Returns a map of question_id → { avgCorrectness, lastRespondedAt }.
 */
async function getQuestionScores(userId, subtopicIds) {
	if (!subtopicIds.length) return {};
	const result = await pool.query(
		`SELECT r.question_id,
		        AVG(r.correctness)::float AS avg_correctness,
		        MAX(r.responded_at) AS last_responded_at
		 FROM response r
		 JOIN question q ON q.id = r.question_id
		 WHERE r.user_id = $1
		   AND q.syllabus_id = ANY($2)
		   AND (r.graded_at IS NOT NULL OR q.question_type NOT IN ('freeText', 'ordering'))
		 GROUP BY r.question_id`,
		[userId, subtopicIds]
	);
	const map = {};
	for (const row of result.rows) {
		map[row.question_id] = {
			avgCorrectness: row.avg_correctness,
			lastRespondedAt: parseInt(row.last_responded_at, 10),
		};
	}
	return map;
}

/**
 * Per-content view state for content in a list of subtopics.
 * Returns a map of content_id → { viewCount, lastShown }.
 */
async function getContentViews(userId, subtopicIds) {
	if (!subtopicIds.length) return {};
	const result = await pool.query(
		`SELECT cv.content_id, cv.view_count, cv.last_shown
		 FROM content_view cv
		 JOIN content c ON c.id = cv.content_id
		 WHERE cv.user_id = $1 AND c.syllabus_id = ANY($2)`,
		[userId, subtopicIds]
	);
	const map = {};
	for (const row of result.rows) {
		map[row.content_id] = {
			viewCount: row.view_count,
			lastShown: parseInt(row.last_shown, 10),
		};
	}
	return map;
}

module.exports = {
	peekQueue, queueSize, getQueuedItemKeys,
	insertItems, deleteItem, clearSubtopicItems,
	getSubtopicScore, getQuestionScores, getContentViews,
};
