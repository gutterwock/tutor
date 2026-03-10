/**
 * Scheduler — builds and maintains the per-user study queue.
 *
 * Priority encoding (lower integer = show sooner):
 *
 *   priority = phase_weight + type_weight + difficulty_weight + review_weight + sr_score
 *              − STRUGGLE_BOOST  (if subtopic is struggling)
 *
 *   PHASE_WEIGHT      = 2^27   phase:atomic=0 · phase:complex=1 · phase:integration=2
 *   TYPE_WEIGHT       = 2^23   content=0 · question=1   (content shown before questions)
 *   DIFFICULTY_WEIGHT = 2^20   question difficulty 0–4
 *   REVIEW_WEIGHT     = 2^16   new=0 · review=1         (new items before reviews)
 *   sr_score          = 0–65535  how urgent the review is (lower = more overdue)
 *   STRUGGLE_BOOST    = 2^30   subtracted when subtopic is struggling — dominates all bits
 *
 * Spaced repetition intervals are derived from existing tables (content_view,
 * response) — no separate SR state is stored.
 *
 * After scoring, a round-robin interleave merges per-course sorted lists so
 * courses alternate in the final queue. Priorities are then re-assigned as
 * sequential integers 0, 1, 2, … to preserve the interleaved order.
 *
 * Environment variables:
 *   QUEUE_LOW_WATERMARK     Items remaining that trigger a refill  (default: 10)
 *   QUEUE_FILL_TARGET       Items to add per refill pass           (default: 500)
 *   RESPONSE_WINDOW         Last N responses used for SR/struggle  (default: 10)
 *   STRUGGLING_THRESHOLD    Avg correctness below = struggling     (default: 1.5)
 *   MIN_RESPONSES_STRUGGLE  Min responses before struggle fires    (default: 3)
 *   REGRESSION_THRESHOLD    Avg correctness below = regressed      (default: 1.5)
 *   MIN_RESPONSES_REGRESS   Min responses before regression fires  (default: 5)
 */

const pool = require("../config/db");
const queueModel = require("../models/queueModel");

const QUEUE_LOW_WATERMARK    = parseInt(process.env.QUEUE_LOW_WATERMARK    || "10",  10);
const QUEUE_FILL_TARGET      = parseInt(process.env.QUEUE_FILL_TARGET      || "500", 10);
const RESPONSE_WINDOW        = parseInt(process.env.RESPONSE_WINDOW        || "10",  10);
const STRUGGLING_THRESHOLD   = parseFloat(process.env.STRUGGLING_THRESHOLD  || "1.5");
const MIN_RESPONSES_STRUGGLE = parseInt(process.env.MIN_RESPONSES_STRUGGLE || "3",   10);
const REGRESSION_THRESHOLD              = parseFloat(process.env.REGRESSION_THRESHOLD              || "1.5");
const MIN_RESPONSES_REGRESS             = parseInt(process.env.MIN_RESPONSES_REGRESS             || "5",   10);
const MAINTENANCE_QUESTIONS_PER_COURSE  = parseInt(process.env.MAINTENANCE_QUESTIONS_PER_COURSE  || "5",   10);

// ── Priority weights (bit-packed integer) ─────────────────────────────────────

const PHASE_WEIGHT      = 1 << 27;   // 134,217,728
const TYPE_WEIGHT       = 1 << 23;   //   8,388,608
const DIFFICULTY_WEIGHT = 1 << 20;   //   1,048,576
const REVIEW_WEIGHT     = 1 << 16;   //      65,536
const MAX_SR_SCORE      = (1 << 16) - 1;  // cap sr_score at 65535
const STRUGGLE_BOOST    = 1 << 30;   // 1,073,741,824 — dominates all positive bits

function computePriority({ phaseScore, isQuestion, difficulty, isReview, srScore, struggling }) {
	let p = phaseScore * PHASE_WEIGHT
		+ (isQuestion ? TYPE_WEIGHT : 0)
		+ difficulty * DIFFICULTY_WEIGHT
		+ (isReview ? REVIEW_WEIGHT : 0)
		+ Math.min(srScore, MAX_SR_SCORE);
	if (struggling) p -= STRUGGLE_BOOST;
	return p;
}

// ── Spaced repetition intervals ───────────────────────────────────────────────

const DAY_MS = 86_400_000;

// Content: interval grows with view_count
const CONTENT_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60];

function contentNextDue(viewCount, lastShown) {
	const idx = Math.min(viewCount - 1, CONTENT_INTERVAL_DAYS.length - 1);
	return lastShown + CONTENT_INTERVAL_DAYS[idx] * DAY_MS;
}

// Questions: interval grows with avg correctness
const QUESTION_INTERVAL_BANDS = [
	{ maxAvg: 1.0, days: 1  },
	{ maxAvg: 2.0, days: 3  },
	{ maxAvg: 2.5, days: 7  },
	{ maxAvg: 3.5, days: 14 },
	{ maxAvg: 4.0, days: 30 },
	{ maxAvg: Infinity, days: 60 },
];

function questionNextDue(avgCorrectness, lastRespondedAt) {
	const band = QUESTION_INTERVAL_BANDS.find((b) => avgCorrectness <= b.maxAvg)
		?? QUESTION_INTERVAL_BANDS.at(-1);
	return lastRespondedAt + band.days * DAY_MS;
}

/** srScore: how urgently an overdue item needs review. Lower = more urgent. */
function srScore(nextDue, now) {
	const daysOverdue = Math.max(0, Math.floor((now - nextDue) / DAY_MS));
	return Math.max(0, MAX_SR_SCORE - daysOverdue * 1000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function phaseScore(tags = []) {
	if (tags.includes("phase:atomic"))       return 0;
	if (tags.includes("phase:complex"))      return 1;
	if (tags.includes("phase:integration"))  return 2;
	return 3; // no phase tag — show last
}

function buildItemData(type, row, breadcrumb) {
	if (type === "content") {
		return {
			type: "content",
			id: row.id,
			syllabus_id: row.syllabus_id,
			content_type: row.content_type,
			title: row.title,
			tags: row.tags,
			breadcrumb,
		};
	}
	return {
		type: "question",
		id: row.id,
		syllabus_id: row.syllabus_id,
		difficulty: row.difficulty,
		question_type: row.question_type,
		tags: row.tags,
		breadcrumb,
	};
}

// ── Regression detection ──────────────────────────────────────────────────────

async function reactivateRegressions(userId) {
	const res = await pool.query(
		`SELECT subtopic_id FROM content_progress
		 WHERE user_id = $1 AND completed = true`,
		[userId]
	);
	for (const { subtopic_id } of res.rows) {
		const { responseCount, avgCorrectness } =
			await queueModel.getSubtopicScore(userId, subtopic_id, MIN_RESPONSES_REGRESS);
		if (responseCount >= MIN_RESPONSES_REGRESS && avgCorrectness < REGRESSION_THRESHOLD) {
			await pool.query(
				`UPDATE content_progress SET completed = false, active = true
				 WHERE user_id = $1 AND subtopic_id = $2`,
				[userId, subtopic_id]
			);
			console.log(`  [scheduler] regression — reactivated ${subtopic_id} for ${userId.slice(0, 8)}`);
		}
	}
}

// ── Graduation detection ──────────────────────────────────────────────────────

/** Returns course IDs where every content_progress row for the user is completed. */
async function getGraduatedCourseIds(userId) {
	const res = await pool.query(
		`SELECT syllabus_id AS course_id
		 FROM content_progress
		 WHERE user_id = $1
		 GROUP BY syllabus_id
		 HAVING COUNT(*) > 0
		    AND COUNT(*) = COUNT(CASE WHEN completed = true THEN 1 END)`,
		[userId]
	);
	return res.rows.map((r) => r.course_id);
}

// ── Queue builder ─────────────────────────────────────────────────────────────

async function buildQueue(userId, weights = {}, minTarget = 0, questionOnly = false) {
	const now = Date.now();

	await reactivateRegressions(userId);

	// Active subtopics
	const subtopicsRes = await pool.query(
		`SELECT cp.subtopic_id, cp.syllabus_id AS course_id,
		        c.name AS course_name, t.name AS topic_name, s.name AS subtopic_name
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.subtopic_id
		 JOIN syllabus t ON t.id = s.parent_id
		 JOIN syllabus c ON c.id = cp.syllabus_id
		 WHERE cp.user_id = $1 AND cp.active = true AND cp.completed = false
		 ORDER BY cp.syllabus_id, t.sort_order, s.sort_order`,
		[userId]
	);
	const subtopicIds = subtopicsRes.rows.map((r) => r.subtopic_id);

	// Bulk-fetch performance data (all three return {} / empty Set for empty subtopicIds)
	const questionScores = await queueModel.getQuestionScores(userId, subtopicIds);
	const contentViews   = await queueModel.getContentViews(userId, subtopicIds);
	const inQueue        = await queueModel.getQueuedItemKeys(userId);

	// Score candidates grouped by course
	const byCourse = {};

	for (const { subtopic_id, course_id, course_name, topic_name, subtopic_name } of subtopicsRes.rows) {
		const breadcrumb = `${course_name}  ›  ${topic_name}  ›  ${subtopic_name}`;
		// Struggling check for this subtopic
		const { responseCount, avgCorrectness } =
			await queueModel.getSubtopicScore(userId, subtopic_id, RESPONSE_WINDOW);
		const struggling =
			responseCount >= MIN_RESPONSES_STRUGGLE && avgCorrectness < STRUGGLING_THRESHOLD;

		// If struggling, clear current queue items for this subtopic so they get re-prioritised
		if (struggling) {
			await queueModel.clearSubtopicItems(userId, subtopic_id);
			// Re-fetch in-queue keys after clearing
			const refreshed = await queueModel.getQueuedItemKeys(userId);
			for (const k of inQueue) { if (!refreshed.has(k)) inQueue.delete(k); }
		}

		if (!byCourse[course_id]) byCourse[course_id] = [];

		// ── Content candidates ──
		if (!questionOnly) {
		const contentRes = await pool.query(
			`SELECT id, syllabus_id, content_type, title, tags
			 FROM content WHERE syllabus_id = $1 AND active = true`,
			[subtopic_id]
		);

		for (const c of contentRes.rows) {
			if (inQueue.has(`content:${c.id}`)) continue;

			const view = contentViews[c.id];
			let priority, isReview, sr;

			if (!view) {
				// Never seen
				isReview = false;
				sr = 0;
			} else {
				// Previously seen — skip if not yet due
				const nextDue = contentNextDue(view.viewCount, view.lastShown);
				if (nextDue > now) continue;
				isReview = true;
				sr = srScore(nextDue, now);
			}

			priority = computePriority({
				phaseScore: phaseScore(c.tags),
				isQuestion: false,
				difficulty: 0,
				isReview,
				srScore: sr,
				struggling,
			});

			byCourse[course_id].push({
				user_id: userId, course_id, subtopic_id,
				item_type: "content", item_id: c.id,
				item_data: buildItemData("content", c, breadcrumb),
				priority, is_review: isReview,
			});
		}
		} // end if (!questionOnly)

		// ── Question candidates ──
		const questionRes = await pool.query(
			`SELECT id, syllabus_id, difficulty, question_type, tags, content_ids
			 FROM question WHERE syllabus_id = $1 AND active = true`,
			[subtopic_id]
		);

		for (const q of questionRes.rows) {
			if (inQueue.has(`question:${q.id}`)) continue;

			// Gating: skip questions whose content blocks have not yet been viewed
			if (q.content_ids && q.content_ids.length > 0) {
				if (!q.content_ids.every((id) => contentViews[id])) continue;
			}

			const qp = questionScores[q.id];
			let priority, isReview, sr;

			if (!qp) {
				// Never answered
				isReview = false;
				sr = 0;
			} else {
				// Previously answered — skip if not yet due
				const nextDue = questionNextDue(qp.avgCorrectness, qp.lastRespondedAt);
				if (nextDue > now) continue;
				isReview = true;
				sr = srScore(nextDue, now);
			}

			// For struggling subtopics, boost easy questions (difficulty 0–1) extra
			const extraBoost = struggling && q.difficulty <= 1;

			priority = computePriority({
				phaseScore: phaseScore(q.tags),
				isQuestion: true,
				difficulty: q.difficulty,
				isReview,
				srScore: sr,
				struggling: struggling || extraBoost,
			});

			byCourse[course_id].push({
				user_id: userId, course_id, subtopic_id,
				item_type: "question", item_id: q.id,
				item_data: buildItemData("question", q, breadcrumb),
				priority, is_review: isReview,
			});
		}

	}

	// ── Weighted round-robin interleave across courses ────────────────────────
	// Sort each course's list by priority, then merge with per-course weights so
	// a course with weight 2 gets twice as many slots per round as weight 1.
	const courseQueues = Object.entries(byCourse).map(([courseId, items]) => ({
		queue:  items.sort((a, b) => a.priority - b.priority),
		weight: Math.max(1, Math.round(weights[courseId] ?? 1)),
	}));

	const fillTarget = Math.max(QUEUE_FILL_TARGET, minTarget);
	const merged = [];
	while (merged.length < fillTarget) {
		let added = false;
		for (const { queue, weight } of courseQueues) {
			for (let i = 0; i < weight && queue.length && merged.length < fillTarget; i++) {
				merged.push(queue.shift());
				added = true;
			}
		}
		if (!added) break;
	}

	// ── Maintenance: semi-random questions from graduated courses ──────────────
	// Shows questions from fully-completed courses so the user retains the
	// material and regression detection continues to receive fresh responses.
	// If accuracy drops, reactivateRegressions() (called above) will
	// automatically reactivate the relevant subtopics on the next tick.
	const activeCourseSet = new Set(subtopicsRes.rows.map((r) => r.course_id));
	const graduatedIds = await getGraduatedCourseIds(userId);

	for (const courseId of graduatedIds) {
		if (activeCourseSet.has(courseId)) continue; // regression already reactivated a subtopic
		if (merged.length >= fillTarget) break;
		const limit = Math.min(MAINTENANCE_QUESTIONS_PER_COURSE, fillTarget - merged.length);

		const qRes = await pool.query(
			`SELECT q.id, q.syllabus_id, q.difficulty, q.question_type, q.tags,
			        sub.name AS subtopic_name, top.name AS topic_name, crs.name AS course_name
			 FROM question q
			 JOIN content_progress cp ON cp.subtopic_id = q.syllabus_id AND cp.user_id = $1
			 JOIN syllabus sub ON sub.id = q.syllabus_id
			 JOIN syllabus top ON top.id = sub.parent_id
			 JOIN syllabus crs ON crs.id = top.parent_id
			 WHERE cp.syllabus_id = $2 AND cp.completed = true AND q.active = true
			 ORDER BY RANDOM()
			 LIMIT $3`,
			[userId, courseId, limit * 3]   // over-fetch to cover inQueue hits
		);

		let added = 0;
		for (const q of qRes.rows) {
			if (added >= limit) break;
			if (inQueue.has(`question:${q.id}`)) continue;
			const bc = `${q.course_name}  ›  ${q.topic_name}  ›  ${q.subtopic_name}`;
			merged.push({
				user_id: userId,
				course_id: courseId,
				subtopic_id: q.syllabus_id,
				item_type: "question",
				item_id: q.id,
				item_data: buildItemData("question", q, bc),
				priority: 0,   // re-numbered below
				is_review: true,
			});
			added++;
		}
	}

	// Re-assign priorities as sequential integers so ORDER BY priority respects
	// both the per-course scoring and the round-robin interleave.
	// Maintenance items are appended last, so they naturally get higher priority
	// numbers and appear at the end of the queue behind active-subtopic items.
	merged.forEach((item, i) => { item.priority = i; });

	await queueModel.insertItems(merged);
	if (merged.length) {
		console.log(`  [scheduler] queued ${merged.length} items for ${userId.slice(0, 8)}`);
	}
}

// ── Public API ────────────────────────────────────────────────────────────────

async function refillIfNeeded(userId, weights = {}, minTarget = 0, questionOnly = false) {
	const effectiveWatermark = Math.max(QUEUE_LOW_WATERMARK, minTarget);
	const size = await queueModel.queueSize(userId, questionOnly ? "question" : null);
	if (size >= effectiveWatermark) return { filled: false, added: 0 };
	const before = size;
	await buildQueue(userId, weights, minTarget, questionOnly);
	const after = await queueModel.queueSize(userId, questionOnly ? "question" : null);
	return { filled: true, added: after - before };
}

module.exports = { refillIfNeeded, buildQueue };
