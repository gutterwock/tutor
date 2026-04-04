const pool = require("../config/db");
const queueModel = require("../models/queueModel");

/**
 * GET /queue?user_id=&course_ids=id1,id2&limit=10&question_only=true
 *
 * Returns up to `limit` items per tier (tiers 0–4) for the selected courses.
 * Items at priority -1 (locked) are never returned.
 * The client applies review_pct logic to compose the session from the tiers.
 *
 * Each item is enriched with the full content/question body.
 * Questions with content_ids have their required content fetched in a separate pass.
 */
async function getQueue(req, res) {
	try {
		const { user_id } = req.query;
		if (!user_id) {
			return res.status(400).json({ error: "Missing required query param: user_id" });
		}

		// course_ids: comma-separated list of course IDs to filter by
		const courseIds = req.query.course_ids
			? req.query.course_ids.split(",").map((s) => s.trim()).filter(Boolean)
			: null;

		if (!courseIds || courseIds.length === 0) {
			return res.status(400).json({ error: "Missing required query param: course_ids" });
		}

		const limitPerTier = Math.min(parseInt(req.query.limit ?? "10", 10), 200);
		const questionOnly = req.query.question_only === "true";

		const items = await queueModel.tieredFetch(user_id, courseIds, limitPerTier, questionOnly);

		if (!items.length) return res.json([]);

		// ── Enrich with full bodies ───────────────────────────────────────────
		const contentIds  = items.filter((i) => i.item_type === "content").map((i) => i.item_id);
		const questionIds = items.filter((i) => i.item_type === "question").map((i) => i.item_id);

		const [cRows, qRows] = await Promise.all([
			contentIds.length
				? pool.query(
					`SELECT id, syllabus_id, content_type, title, body, tags, links, metadata
					 FROM content WHERE id = ANY($1)`,
					[contentIds]
				)
				: { rows: [] },
			questionIds.length
				? pool.query(
					`SELECT id, syllabus_id, difficulty, question_type, question_text,
					        options, answer, explanation, case_sensitive, passage,
					        tags, content_ids
					 FROM question WHERE id = ANY($1)`,
					[questionIds]
				)
				: { rows: [] },
		]);

		const contentMap  = Object.fromEntries(cRows.rows.map((r) => [r.id, r]));
		const questionMap = Object.fromEntries(qRows.rows.map((r) => [r.id, r]));

		// ── Fetch gated content bodies (separate pass) ────────────────────────
		// Collect all content_ids referenced by questions in this batch
		const gatedContentIds = new Set();
		for (const q of qRows.rows) {
			if (q.content_ids && q.content_ids.length > 0) {
				q.content_ids.forEach((id) => gatedContentIds.add(id));
			}
		}
		const gatedContentMap = {};
		if (gatedContentIds.size > 0) {
			const gcRows = await pool.query(
				`SELECT id, title, body FROM content WHERE id = ANY($1)`,
				[Array.from(gatedContentIds)]
			);
			for (const r of gcRows.rows) gatedContentMap[r.id] = r;
		}

		// ── Build breadcrumbs ────────────────────────────────────────────────
		const subtopicIds = [...new Set(items.map((i) => i.subtopic_id))];
		const bcRows = await pool.query(
			`SELECT s.id AS subtopic_id, s.name AS subtopic_name,
			        t.name AS topic_name, c.name AS course_name
			 FROM syllabus s
			 JOIN syllabus t ON t.id = s.parent_id
			 JOIN syllabus c ON c.id = t.parent_id
			 WHERE s.id = ANY($1)`,
			[subtopicIds]
		);
		const breadcrumbMap = Object.fromEntries(
			bcRows.rows.map((r) => [
				r.subtopic_id,
				`${r.course_name}  ›  ${r.topic_name}  ›  ${r.subtopic_name}`,
			])
		);

		// ── Assemble enriched items ───────────────────────────────────────────
		const enriched = items.map((item) => {
			const body = item.item_type === "content"
				? contentMap[item.item_id]
				: questionMap[item.item_id];

			const extra = {};
			if (item.item_type === "question" && body?.content_ids?.length > 0) {
				extra.required_content = body.content_ids.map((id) => gatedContentMap[id]).filter(Boolean);
			}

			return {
				...item,
				item_data: {
					...body,
					breadcrumb: breadcrumbMap[item.subtopic_id] ?? "",
					...extra,
				},
			};
		});

		return res.json(enriched);
	} catch (err) {
		console.error("getQueue error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * DELETE /queue/:id
 * For content items: moves the item down one priority tier.
 * For question items: no-op (tier already updated by response submission).
 */
async function deleteQueueItem(req, res) {
	try {
		const { id } = req.params;

		// Fetch item to check type
		const row = await pool.query(
			`SELECT id, user_id, item_type, item_id, subtopic_id FROM study_queue WHERE id = $1`,
			[id]
		);
		if (!row.rows.length) {
			return res.status(404).json({ error: "Queue item not found" });
		}
		const item = row.rows[0];

		if (item.item_type === "content") {
			await queueModel.consumeContent(id);
		}
		// question items: tier already updated by response submission path — nothing to do

		return res.json({ ok: true });
	} catch (err) {
		console.error("deleteQueueItem error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * DELETE /queue?user_id=&course_id=
 * No-op in the new system (queue items persist; course picker handles exclusion).
 * Kept for backward compatibility.
 */
async function clearCourseQueue(req, res) {
	return res.json({ ok: true });
}

/**
 * PATCH /queue/:id
 * Body: { priority: number }
 * Directly set the priority of a queue item. Used by admin scripts.
 */
async function patchQueueItem(req, res) {
	try {
		const { id } = req.params;
		const { priority } = req.body;
		if (priority === undefined || typeof priority !== "number" || !Number.isInteger(priority)) {
			return res.status(400).json({ error: "Body must include priority as an integer" });
		}
		await queueModel.setItemPriority(id, priority);
		return res.json({ ok: true });
	} catch (err) {
		console.error("patchQueueItem error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * GET /queue/tier-counts?user_id=&course_id=
 * Returns item counts per tier for a user+course.
 */
async function getQueueTierCounts(req, res) {
	try {
		const { user_id, course_id } = req.query;
		if (!user_id || !course_id) {
			return res.status(400).json({ error: "Missing required query params: user_id, course_id" });
		}
		const counts = await queueModel.getTierCounts(user_id, course_id);
		return res.json(counts);
	} catch (err) {
		console.error("getQueueTierCounts error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * POST /queue/set-tier
 * Body: {
 *   user_id: string,
 *   subtopic_id: string (OR topic_id: string),
 *   target_tier: number (0–4, or -1 for locked),
 *   item_type: string? ('content', 'question', or omitted for both)
 * }
 * Sets all items in the given subtopic/topic to the target tier.
 * Returns { affected: number }.
 */
async function setItemsTier(req, res) {
	try {
		const { user_id, subtopic_id, topic_id, target_tier, item_type } = req.body;

		if (!user_id) {
			return res.status(400).json({ error: "Missing required field: user_id" });
		}
		if (!subtopic_id && !topic_id) {
			return res.status(400).json({ error: "Missing required field: subtopic_id or topic_id" });
		}
		if (target_tier === undefined || typeof target_tier !== "number" || !Number.isInteger(target_tier)) {
			return res.status(400).json({ error: "Missing or invalid field: target_tier (must be integer)" });
		}
		if (target_tier < -1 || target_tier > 4) {
			return res.status(400).json({ error: "target_tier must be in range -1 to 4" });
		}
		if (item_type && !["content", "question"].includes(item_type)) {
			return res.status(400).json({ error: "item_type must be 'content', 'question', or omitted" });
		}

		let affected;
		if (subtopic_id) {
			affected = await queueModel.setSubtopicItemsTier(user_id, subtopic_id, target_tier, item_type);
		} else {
			affected = await queueModel.setTopicItemsTier(user_id, topic_id, target_tier, item_type);
		}

		return res.json({ affected });
	} catch (err) {
		console.error("setItemsTier error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = { getQueue, deleteQueueItem, clearCourseQueue, getQueueTierCounts, patchQueueItem, setItemsTier };
