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
	if (!success) return 400 + Math.floor(Math.random() * 99); // fail → 400–498 (499 left for prereq content)
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
 * Promote all locked items for a subtopic from -1 to tier 3 using position-based priorities.
 *
 * Content items (301–398, order-preserving):
 *   N content items divide the 98-slot range into N equal segments.
 *   Earlier items (lower sort_order) get higher-priority segments.
 *
 * Ungated questions (content_ids = []): fixed priority 399 (shown before any content).
 *
 * Gated questions (content_ids non-empty): random in [max(300, p−25), p−1]
 *   where p is the priority of the anchor content block (latest prereq).
 *   Multiple questions under the same block are assigned order-preserving
 *   sub-segments within the band; ties occur when the band is narrower than M.
 */
async function promoteSubtopicItems(userId, subtopicId) {
	const CONTENT_LO = 301, CONTENT_HI = 398, CONTENT_RANGE = CONTENT_HI - CONTENT_LO + 1;

	// ── Content items ─────────────────────────────────────────────────────────
	const contentRes = await pool.query(
		`SELECT sq.id AS queue_id, c.id AS content_id, c.sort_order
		 FROM study_queue sq
		 JOIN content c ON c.id = sq.item_id
		 WHERE sq.user_id = $1 AND sq.subtopic_id = $2
		   AND sq.item_type = 'content' AND sq.priority = -1
		 ORDER BY c.sort_order`,
		[userId, subtopicId]
	);

	const contentItems = contentRes.rows;
	const N = contentItems.length;
	const contentPriorityMap = {}; // content_id → assigned priority
	const updates = [];             // { queue_id, priority }

	for (let i = 0; i < N; i++) {
		const segLo = CONTENT_LO + Math.floor(((N - 1 - i) * CONTENT_RANGE) / N);
		const segHi = CONTENT_LO + Math.floor(((N - i) * CONTENT_RANGE) / N) - 1;
		const priority = segLo >= segHi
			? segLo
			: segLo + Math.floor(Math.random() * (segHi - segLo + 1));
		contentPriorityMap[contentItems[i].content_id] = priority;
		updates.push({ queue_id: contentItems[i].queue_id, priority });
	}

	// ── Questions ─────────────────────────────────────────────────────────────
	const questionRes = await pool.query(
		`SELECT sq.id AS queue_id, q.content_ids, q.sort_order
		 FROM study_queue sq
		 JOIN question q ON q.id = sq.item_id
		 WHERE sq.user_id = $1 AND sq.subtopic_id = $2
		   AND sq.item_type = 'question' AND sq.priority = -1`,
		[userId, subtopicId]
	);

	// Group gated questions by their anchor content (latest prereq = min priority value)
	const ungated = [];
	const gatedGroups = new Map(); // anchorContentId → [{ queue_id, sort_order }]

	for (const q of questionRes.rows) {
		const contentIds = q.content_ids ?? [];
		if (contentIds.length === 0) {
			ungated.push(q);
		} else {
			let anchorId = contentIds[0];
			let minPrio = contentPriorityMap[anchorId] ?? CONTENT_LO;
			for (const id of contentIds.slice(1)) {
				const p = contentPriorityMap[id] ?? CONTENT_LO;
				if (p < minPrio) { minPrio = p; anchorId = id; }
			}
			if (!gatedGroups.has(anchorId)) gatedGroups.set(anchorId, []);
			gatedGroups.get(anchorId).push({ queue_id: q.queue_id, sort_order: q.sort_order });
		}
	}

	// Ungated → 399
	for (const q of ungated) {
		updates.push({ queue_id: q.queue_id, priority: 399 });
	}

	// Gated → order-preserving within [max(300, p−25), p−1]
	for (const [anchorId, questions] of gatedGroups) {
		const p = contentPriorityMap[anchorId] ?? CONTENT_LO;
		const bandLo = Math.max(300, p - 25);
		const bandHi = p - 1;
		const bandSize = bandHi - bandLo + 1;
		const M = questions.length;

		questions.sort((a, b) => a.sort_order - b.sort_order);

		for (let j = 0; j < M; j++) {
			const segLo = bandLo + Math.floor(((M - 1 - j) * bandSize) / M);
			const segHi = bandLo + Math.floor(((M - j) * bandSize) / M) - 1;
			const priority = segLo >= segHi
				? segLo
				: segLo + Math.floor(Math.random() * (segHi - segLo + 1));
			updates.push({ queue_id: questions[j].queue_id, priority });
		}
	}

	// ── Bulk UPDATE ───────────────────────────────────────────────────────────
	if (updates.length === 0) return;
	const queueIds  = updates.map((u) => u.queue_id);
	const priorities = updates.map((u) => u.priority);
	await pool.query(
		`UPDATE study_queue sq
		 SET priority = v.priority
		 FROM unnest($1::uuid[], $2::int[]) AS v(queue_id, priority)
		 WHERE sq.id = v.queue_id`,
		[queueIds, priorities]
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

	// On fail, push prereq content items to a random priority above the question (within tier 4)
	if (!success) {
		await pool.query(
			`UPDATE study_queue sq
			 SET priority = $3 + 1 + floor(random() * (499 - $3))::int
			 FROM question q
			 WHERE q.id = $2
			   AND sq.user_id = $1
			   AND sq.item_type = 'content'
			   AND sq.item_id = ANY(q.content_ids)
			   AND sq.priority >= 0`,
			[userId, questionId, newPriority]
		);
	}
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

/**
 * Bump existing tier-3 items for a course by 20, capped at 399.
 * excludeSubtopicIds: subtopics just unlocked (their items were just placed into tier 3).
 */
async function bumpCourseTier3(userId, courseId, excludeSubtopicIds) {
	if (!excludeSubtopicIds.length) return;
	await pool.query(
		`UPDATE study_queue
		 SET priority = LEAST(priority + 20, 399)
		 WHERE user_id = $1 AND course_id = $2
		   AND subtopic_id != ANY($3)
		   AND priority BETWEEN 300 AND 399`,
		[userId, courseId, excludeSubtopicIds]
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
	insertLocked, promoteSubtopicItems, bumpCourseTier3,
	consumeContent, transitionQuestionTier, regressSubtopicItems,
	clearCourseItems, getSubtopicScore,
	tierOf, randInTier, nextPriority,
};
