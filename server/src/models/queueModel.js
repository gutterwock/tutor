const pool = require("../config/db");

// ── Tier helpers ───────────────────────────────────────────────────────────────

const TIER_RANGES = [
	{ tier: 4, min: 400, max: 499 },
	{ tier: 3, min: 300, max: 399 },
	{ tier: 2, min: 200, max: 299 },
	{ tier: 1, min: 100, max: 199 },
	{ tier: 0, min:   0, max:  99 },
];

function tierOf(priority) {
	if (priority < 0) return -1;
	return Math.floor(priority / 100);
}

/** Random priority within a tier band. */
function randInTier(tier) {
	return tier * 100 + Math.floor(Math.random() * 100);
}

/**
 * Compute new priority after consumption.
 * success = correctness >= 3 (or true for content items).
 * currentPriority is the item's current priority value.
 */
function nextPriority(currentPriority, success) {
	const tier = tierOf(currentPriority);
	if (!success) return randInTier(4);        // fail → tier 4
	if (tier === 4) return randInTier(2);       // tier 4 success → tier 2
	if (tier === 0) return randInTier(0);       // tier 0 stays in tier 0
	return randInTier(Math.max(0, tier - 1));   // down one tier
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch up to `limitPerTier` items from each tier (0–4) for a user.
 * courseIds filters to selected courses. Items at -1 (locked) are excluded.
 * Returns a flat array ordered: tier4 first, then 3, 2, 1, 0.
 */
async function tieredFetch(userId, courseIds, limitPerTier = 10, questionOnly = false) {
	if (!courseIds || courseIds.length === 0) return [];

	const typeFilter = questionOnly ? `AND item_type = 'question'` : "";
	const parts = [];
	const params = [userId, courseIds, limitPerTier];

	for (const { min, max } of TIER_RANGES) {
		parts.push(`
			(SELECT id, user_id, course_id, subtopic_id, item_type, item_id, priority
			 FROM study_queue
			 WHERE user_id = $1 AND course_id = ANY($2) ${typeFilter}
			   AND priority BETWEEN ${min} AND ${max}
			 ORDER BY priority DESC
			 LIMIT $3)`);
	}

	const result = await pool.query(parts.join("\nUNION ALL\n"), params);
	return result.rows;
}

/** Count unlocked items (priority >= 0) for a user. */
async function queueSize(userId) {
	const result = await pool.query(
		`SELECT COUNT(*) AS count FROM study_queue WHERE user_id = $1 AND priority >= 0`,
		[userId]
	);
	return parseInt(result.rows[0].count, 10);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-insert queue items at priority -1 (locked).
 * ON CONFLICT DO NOTHING — safe to call multiple times.
 */
async function insertLocked(items) {
	if (!items.length) return;
	const values = [];
	const params = [];
	let p = 1;
	for (const item of items) {
		values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},-1)`);
		params.push(item.user_id, item.course_id, item.subtopic_id, item.item_type, item.item_id);
		p += 5;
	}
	await pool.query(
		`INSERT INTO study_queue (user_id, course_id, subtopic_id, item_type, item_id, priority)
		 VALUES ${values.join(",")}
		 ON CONFLICT (user_id, item_type, item_id) DO NOTHING`,
		params,
	);
}

/**
 * Promote unlocked items for a subtopic from -1 to tier 3.
 * Content items and ungated questions (content_ids = '{}') are promoted immediately.
 * Gated questions remain at -1 until promoteGatedQuestions is called.
 * `bias` shifts the random range up within the tier (e.g. 74 → rand 374–399).
 */
async function promoteSubtopicItems(userId, subtopicId, bias = 0) {
	const lo = 300 + bias;
	const range = 100 - bias;

	// Promote content items
	await pool.query(
		`UPDATE study_queue
		 SET priority = ${lo} + floor(random() * ${range})::int
		 WHERE user_id = $1 AND subtopic_id = $2 AND item_type = 'content' AND priority = -1`,
		[userId, subtopicId]
	);

	// Promote ungated questions (content_ids empty)
	await pool.query(
		`UPDATE study_queue sq
		 SET priority = ${lo} + floor(random() * ${range})::int
		 FROM question q
		 WHERE sq.user_id = $1 AND sq.subtopic_id = $2
		   AND sq.item_type = 'question' AND sq.priority = -1
		   AND q.id = sq.item_id
		   AND (q.content_ids = '{}' OR q.content_ids IS NULL)`,
		[userId, subtopicId]
	);
}

/**
 * After a content item is viewed, promote any gated questions in the same subtopic
 * whose required content_ids have all been viewed by this user.
 */
async function promoteGatedQuestions(userId, subtopicId) {
	await pool.query(
		`UPDATE study_queue sq
		 SET priority = 300 + floor(random() * 100)::int
		 FROM question q
		 WHERE sq.user_id = $1 AND sq.subtopic_id = $2
		   AND sq.item_type = 'question' AND sq.priority = -1
		   AND q.id = sq.item_id
		   AND array_length(q.content_ids, 1) > 0
		   AND NOT EXISTS (
		     SELECT 1 FROM unnest(q.content_ids) AS cid
		     WHERE NOT EXISTS (
		       SELECT 1 FROM content_view WHERE content_id = cid AND user_id = $1
		     )
		   )`,
		[userId, subtopicId]
	);
}

/**
 * Update priority of a content item when consumed (viewed).
 * Content always moves down one tier on consumption.
 * Returns the updated row (including subtopic_id for gated-question promotion).
 */
async function consumeContent(queueId) {
	// Fetch current state
	const row = await pool.query(
		`SELECT id, user_id, item_id, subtopic_id, priority FROM study_queue WHERE id = $1`,
		[queueId]
	);
	if (!row.rows.length) return null;
	const item = row.rows[0];
	const newPriority = nextPriority(item.priority, true);
	await pool.query(`UPDATE study_queue SET priority = $1 WHERE id = $2`, [newPriority, queueId]);
	return { ...item, priority: newPriority };
}

/**
 * Update priority of a question item after grading.
 * correctness: 0–4. Success = correctness >= 3.
 */
async function transitionQuestionTier(userId, questionId, correctness) {
	const success = correctness >= 3;
	const row = await pool.query(
		`SELECT id, priority FROM study_queue
		 WHERE user_id = $1 AND item_type = 'question' AND item_id = $2`,
		[userId, questionId]
	);
	if (!row.rows.length) return;
	const { id, priority } = row.rows[0];
	const newPriority = nextPriority(priority, success);
	await pool.query(`UPDATE study_queue SET priority = $1 WHERE id = $2`, [newPriority, id]);
}

/**
 * Push all non-locked, non-tier4 items for a subtopic back to tier 3.
 * Used when regression is detected on a completed subtopic.
 */
async function regressSubtopicItems(userId, subtopicId) {
	await pool.query(
		`UPDATE study_queue
		 SET priority = 300 + floor(random() * 100)::int
		 WHERE user_id = $1 AND subtopic_id = $2
		   AND priority BETWEEN 0 AND 399`,
		[userId, subtopicId]
	);
}

/** Clear all queue items for a course (used on unenroll). */
async function clearCourseItems(userId, courseId) {
	await pool.query(
		`DELETE FROM study_queue WHERE user_id = $1 AND course_id = $2`,
		[userId, courseId]
	);
}

// ── Performance aggregates ────────────────────────────────────────────────────

/**
 * Aggregate correctness of the last `window` graded responses for a subtopic.
 * Returns { responseCount, avgCorrectness }.
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

module.exports = {
	tieredFetch, queueSize,
	insertLocked, promoteSubtopicItems, promoteGatedQuestions,
	consumeContent, transitionQuestionTier, regressSubtopicItems,
	clearCourseItems, getSubtopicScore,
	tierOf, randInTier, nextPriority,
};
