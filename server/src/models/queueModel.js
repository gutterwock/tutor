const pool = require("../config/db");

const FREETEXT_PASS_THRESHOLD = parseInt(process.env.FREETEXT_PASS_THRESHOLD || "3", 10);

// ── Priority constants ─────────────────────────────────────────────────────────
//
//   0          locked (not yet unlocked)
//   1          jail (mastered but never shown)
//   2–4        mastered (visible) — circulates 4→3→2→4 on each success/view
//   5–53       revision bottom band
//   54–103     revision middle band
//   104–153    revision top band
//   154–253    new (just unlocked, not yet seen)
//   254        failed question
//   255        prereq content for a failed question
//
// ORDER BY priority DESC — higher value = shown sooner.

const LOCKED   = 0;
const JAIL     = 1;
const MASTERED = { lo: 2, hi: 4 };
const REV_BOT  = { lo:   5, hi:  53 };
const REV_MID  = { lo:  54, hi: 103 };
const REV_TOP  = { lo: 104, hi: 153 };
const NEW_BAND = { lo: 154, hi: 253 };
const FAILED_Q = 254;
const FAILED_C = 255;

function randInBand({ lo, hi }) {
	return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Return the named band for a priority value.
 */
function bandOf(priority) {
	if (priority === LOCKED)     return "locked";
	if (priority === JAIL)       return "jail";
	if (priority <= MASTERED.hi) return "mastered";
	if (priority <= REV_BOT.hi)  return "rev_bot";
	if (priority <= REV_MID.hi)  return "rev_mid";
	if (priority <= REV_TOP.hi)  return "rev_top";
	if (priority <= NEW_BAND.hi) return "new";
	if (priority === FAILED_Q)   return "failed_q";
	if (priority === FAILED_C)   return "failed_c";
	return "unknown";
}

/**
 * Compute new priority after a question answer (success/fail) or content view (always success).
 *
 * Progression on success/view:
 *   new (154–253) → rev top (104–153)
 *   rev top       → rev mid (54–103)
 *   rev mid       → rev bot (5–53)
 *   rev bot       → mastered entry (4)
 *   mastered      → circulates 4→3→2→4
 *
 * On failure: always → 254 (FAILED_Q).
 */
function nextPriority(currentPriority, success) {
	if (!success) return FAILED_Q;
	if (currentPriority >= NEW_BAND.lo) return randInBand(REV_TOP); // new + failed → rev top
	if (currentPriority >= REV_TOP.lo)  return randInBand(REV_MID);
	if (currentPriority >= REV_MID.lo)  return randInBand(REV_BOT);
	if (currentPriority >= REV_BOT.lo)  return 4;
	// mastered circulation: 4→3→2→4
	if (currentPriority === 4) return 3;
	if (currentPriority === 3) return 2;
	return 4;
}

// ── Read ──────────────────────────────────────────────────────────────────────

const FETCH_RANGES = [
	{ min: FAILED_C,     max: FAILED_C     }, // 255: prereq content for failed question
	{ min: FAILED_Q,     max: FAILED_Q     }, // 254: failed question
	{ min: NEW_BAND.lo,  max: NEW_BAND.hi  }, // 154–253: new
	{ min: REV_TOP.lo,   max: REV_TOP.hi   }, // 104–153: revision top
	{ min: REV_MID.lo,   max: REV_MID.hi   }, //  54–103: revision middle
	{ min: REV_BOT.lo,   max: REV_BOT.hi   }, //    5–53: revision bottom
	{ min: MASTERED.lo,  max: MASTERED.hi  }, //    2–4: mastered
	// jail (1) is never fetched
];

/**
 * Fetch up to `limitPerTier` items from each priority band for a user.
 * Locked items (priority = 0) are never returned.
 * Returns a flat array ordered: failed_c, failed_q, new, rev_top, rev_mid, rev_bot, mastered.
 */
async function tieredFetch(userId, courseIds, limitPerTier = 10, questionOnly = false) {
	if (!courseIds || courseIds.length === 0) return [];

	const typeFilter = questionOnly ? `AND item_type = 'question'` : "";
	const parts = [];
	const params = [userId, courseIds, limitPerTier];

	for (const { min, max } of FETCH_RANGES) {
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

/**
 * Count items per band for a user+course.
 * Returns { locked, mastered, revision, new_items, failed }.
 */
async function getTierCounts(userId, courseId) {
	const result = await pool.query(
		`SELECT
		   COUNT(*) FILTER (WHERE priority = 0)                 AS locked,
		   COUNT(*) FILTER (WHERE priority IN (1, 2, 3, 4))    AS mastered,
		   COUNT(*) FILTER (WHERE priority BETWEEN 5   AND 153) AS revision,
		   COUNT(*) FILTER (WHERE priority BETWEEN 154 AND 253) AS new_items,
		   COUNT(*) FILTER (WHERE priority >= 254)              AS failed
		 FROM study_queue
		 WHERE user_id = $1 AND course_id = $2`,
		[userId, courseId]
	);
	const r = result.rows[0];
	return {
		locked:    parseInt(r.locked,    10),
		mastered:  parseInt(r.mastered,  10),
		revision:  parseInt(r.revision,  10),
		new_items: parseInt(r.new_items, 10),
		failed:    parseInt(r.failed,    10),
	};
}

/** Count unlocked items (priority > 0) for a user. */
async function queueSize(userId) {
	const result = await pool.query(
		`SELECT COUNT(*) AS count FROM study_queue WHERE user_id = $1 AND priority > ${LOCKED}`,
		[userId]
	);
	return parseInt(result.rows[0].count, 10);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Bulk-insert queue items at priority 0 (locked).
 * ON CONFLICT DO NOTHING — safe to call multiple times.
 */
async function insertLocked(items) {
	if (!items.length) return;
	const values = [];
	const params = [];
	let p = 1;
	for (const item of items) {
		values.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},${LOCKED})`);
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
 * Promote all locked items for a subtopic from 0 to the new band using position-based priorities.
 *
 * Content items (154–252, order-preserving):
 *   N content items divide the 99-slot range into N equal segments.
 *   Earlier items (lower sort_order) get higher-priority segments.
 *
 * Ungated questions (content_ids = []): fixed priority 253 (shown before any content).
 *
 * Gated questions (content_ids non-empty): random in [max(154, p−25), p−1]
 *   where p is the priority of the anchor content block (latest prereq).
 */
async function promoteSubtopicItems(userId, subtopicId) {
	const CONTENT_LO = NEW_BAND.lo;          // 154
	const CONTENT_HI = NEW_BAND.hi - 1;      // 252
	const CONTENT_RANGE = CONTENT_HI - CONTENT_LO + 1; // 99

	// ── Content items ─────────────────────────────────────────────────────────
	const contentRes = await pool.query(
		`SELECT sq.id AS queue_id, c.id AS content_id, c.sort_order
		 FROM study_queue sq
		 JOIN content c ON c.id = sq.item_id
		 WHERE sq.user_id = $1 AND sq.subtopic_id = $2
		   AND sq.item_type = 'content' AND sq.priority = ${LOCKED}
		 ORDER BY c.sort_order`,
		[userId, subtopicId]
	);

	const contentItems = contentRes.rows;
	const N = contentItems.length;
	const contentPriorityMap = {};
	const updates = [];

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
		   AND sq.item_type = 'question' AND sq.priority = ${LOCKED}`,
		[userId, subtopicId]
	);

	const ungated = [];
	const gatedGroups = new Map();

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

	// Ungated → top of new band (253)
	for (const q of ungated) {
		updates.push({ queue_id: q.queue_id, priority: NEW_BAND.hi });
	}

	// Gated → order-preserving within [max(154, p−25), p−1]
	for (const [anchorId, questions] of gatedGroups) {
		const p = contentPriorityMap[anchorId] ?? CONTENT_LO;
		const bandLo = Math.max(NEW_BAND.lo, p - 25);
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
 * Update priority of a content item when viewed.
 * Returns the updated row.
 */
async function consumeContent(queueId) {
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
 * On fail: question → 254, all associated content → 255.
 * On 254 fail again: stays 254, associated content → 255.
 */
async function transitionQuestionTier(userId, questionId, correctness) {
	const success = correctness >= FREETEXT_PASS_THRESHOLD;
	const row = await pool.query(
		`SELECT id, priority FROM study_queue
		 WHERE user_id = $1 AND item_type = 'question' AND item_id = $2`,
		[userId, questionId]
	);
	if (!row.rows.length) return;
	const { id, priority } = row.rows[0];
	const newPriority = nextPriority(priority, success);
	await pool.query(`UPDATE study_queue SET priority = $1 WHERE id = $2`, [newPriority, id]);

	if (!success) {
		await pool.query(
			`UPDATE study_queue sq
			 SET priority = ${FAILED_C}
			 FROM question q
			 WHERE q.id = $2
			   AND sq.user_id = $1
			   AND sq.item_type = 'content'
			   AND sq.item_id = ANY(q.content_ids)
			   AND sq.priority > ${LOCKED}`,
			[userId, questionId]
		);
	}
}

/**
 * Push mastered/revision items for a subtopic back into the revision top band.
 * Used when regression is detected on a completed subtopic.
 * Items in new/failed bands and locked items are unaffected.
 */
async function regressSubtopicItems(userId, subtopicId) {
	await pool.query(
		`UPDATE study_queue
		 SET priority = ${REV_TOP.lo} + floor(random() * ${REV_TOP.hi - REV_TOP.lo + 1})::int
		 WHERE user_id = $1 AND subtopic_id = $2
		   AND priority >= ${JAIL} AND priority < ${NEW_BAND.lo}`,
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

/** Directly set the priority of a queue item (admin/script use). */
async function setItemPriority(queueId, priority) {
	await pool.query(
		`UPDATE study_queue SET priority = $1 WHERE id = $2`,
		[priority, queueId]
	);
}

/**
 * Set all items in a subtopic to a target band.
 *
 * targetTier:
 *   0 → locked (0)
 *   1 → jail (1, mastered but never shown)
 *   2 → mastered (random 2–4, visible)
 *   3 → revision bottom (random 5–53)
 *   4 → revision middle (random 54–103)
 *   5 → revision top (random 104–153)
 *   6 → new (random 154–253)
 *
 * itemType: optional 'content' or 'question'; if omitted, all types.
 * Returns count of affected rows.
 */
async function setSubtopicItemsTier(userId, subtopicId, targetTier, itemType = null) {
	const priority = tierToPriority(targetTier);
	const typeFilter = itemType ? `AND item_type = $4` : "";
	const params = [userId, subtopicId, priority];
	if (itemType) params.push(itemType);

	const result = await pool.query(
		`UPDATE study_queue
		 SET priority = $3
		 WHERE user_id = $1 AND subtopic_id = $2 ${typeFilter}`,
		params
	);
	return result.rowCount;
}

/**
 * Set all items in a topic (all subtopics under it) to a target band.
 * Same targetTier semantics as setSubtopicItemsTier.
 */
async function setTopicItemsTier(userId, topicId, targetTier, itemType = null) {
	const priority = tierToPriority(targetTier);
	const typeFilter = itemType ? `AND sq.item_type = $4` : "";
	const params = [userId, topicId, priority];
	if (itemType) params.push(itemType);

	const result = await pool.query(
		`UPDATE study_queue sq
		 SET priority = $3
		 WHERE sq.user_id = $1
		   AND sq.subtopic_id IN (
		     SELECT id FROM syllabus WHERE parent_id = $2
		   ) ${typeFilter}`,
		params
	);
	return result.rowCount;
}

function tierToPriority(targetTier) {
	switch (targetTier) {
		case 0:  return LOCKED;
		case 1:  return JAIL;
		case 2:  return randInBand(MASTERED);
		case 3:  return randInBand(REV_BOT);
		case 4:  return randInBand(REV_MID);
		case 5:  return randInBand(REV_TOP);
		case 6:  return randInBand(NEW_BAND);
		default: return LOCKED;
	}
}

module.exports = {
	tieredFetch, queueSize, getTierCounts, setItemPriority,
	insertLocked, promoteSubtopicItems,
	consumeContent, transitionQuestionTier, regressSubtopicItems,
	clearCourseItems, getSubtopicScore,
	setSubtopicItemsTier, setTopicItemsTier,
	bandOf, nextPriority,
};
