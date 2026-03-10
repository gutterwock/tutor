const pool = require("../config/db");
const queueModel = require("../models/queueModel");
const contentModel = require("../models/contentModel");
const scheduler = require("../services/scheduler");

/**
 * GET /queue?user_id=&limit=
 * Returns the next `limit` ready items for the user.
 * Eagerly triggers a refill if the queue is low before responding.
 */
async function getQueue(req, res) {
	try {
		const { user_id } = req.query;
		if (!user_id) {
			return res.status(400).json({ error: "Missing required query param: user_id" });
		}
		const limit = Math.min(parseInt(req.query.limit ?? "10", 10), 100);

		// Parse weights: "course-id:2,other-id:3" → { 'course-id': 2, 'other-id': 3 }
		const weights = {};
		if (req.query.weights) {
			for (const pair of req.query.weights.split(",")) {
				const colon = pair.lastIndexOf(":");
				if (colon > 0) {
					const id = pair.slice(0, colon).trim();
					const w  = parseInt(pair.slice(colon + 1), 10);
					if (id && !isNaN(w) && w >= 1) weights[id] = Math.min(w, 10);
				}
			}
		}

		const sessionLength = req.query.session_length ? parseInt(req.query.session_length, 10) : 0;
		const questionOnly = req.query.question_only === "true";

		// Refill before responding so the caller always gets fresh items
		await scheduler.refillIfNeeded(user_id, weights, sessionLength, questionOnly).catch((err) =>
			console.warn("  [queue] refill error:", err.message)
		);

		const items = await queueModel.peekQueue(user_id, limit, questionOnly ? "question" : null);

		// Bulk-enrich with full body (2 queries max regardless of queue size)
		const contentIds  = items.filter((i) => i.item_type === "content").map((i) => i.item_id);
		const questionIds = items.filter((i) => i.item_type === "question").map((i) => i.item_id);

		const [cRows, qRows] = await Promise.all([
			contentIds.length
				? pool.query(`SELECT id, body, links, metadata FROM content WHERE id = ANY($1)`, [contentIds])
				: { rows: [] },
			questionIds.length
				? pool.query(`SELECT id, question_text, options, answer, explanation, case_sensitive, passage FROM question WHERE id = ANY($1)`, [questionIds])
				: { rows: [] },
		]);

		const contentMap  = Object.fromEntries(cRows.rows.map((r) => [r.id, r]));
		const questionMap = Object.fromEntries(qRows.rows.map((r) => [r.id, r]));

		const enriched = items.map((item) => ({
			...item,
			item_data: {
				...item.item_data,
				...(item.item_type === "content" ? contentMap[item.item_id] : questionMap[item.item_id]),
			},
		}));

		return res.json(enriched);
	} catch (err) {
		console.error("getQueue error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * DELETE /queue/:id
 * Removes one item from the queue and, for content items, records a content view.
 * The app calls this after successfully showing the item to the user.
 */
async function deleteQueueItem(req, res) {
	try {
		const { id } = req.params;
		const item = await queueModel.deleteItem(id);
		if (!item) {
			return res.status(404).json({ error: "Queue item not found" });
		}

		// Track content views server-side so the app needs only one call per item
		if (item.item_type === "content") {
			await contentModel.upsertContentView(item.item_id, item.user_id).catch((err) =>
				console.warn("  [queue] content view upsert failed:", err.message)
			);
		}

		return res.json({ deleted: true });
	} catch (err) {
		console.error("deleteQueueItem error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * DELETE /queue?user_id=&course_id=
 * Removes all queue items for a user/course pair (called when a course is paused).
 */
async function clearCourseQueue(req, res) {
	try {
		const { user_id, course_id } = req.query;
		if (!user_id || !course_id) {
			return res.status(400).json({ error: "Missing required query params: user_id, course_id" });
		}
		await queueModel.clearCourseItems(user_id, course_id);
		return res.json({ cleared: true, course_id });
	} catch (err) {
		console.error("clearCourseQueue error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = { getQueue, deleteQueueItem, clearCourseQueue };
