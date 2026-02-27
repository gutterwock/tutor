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

		// Refill before responding so the caller always gets fresh items
		await scheduler.refillIfNeeded(user_id).catch((err) =>
			console.warn("  [queue] refill error:", err.message)
		);

		const items = await queueModel.peekQueue(user_id, limit);
		return res.json(items);
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

module.exports = { getQueue, deleteQueueItem };
