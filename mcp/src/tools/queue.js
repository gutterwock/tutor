/**
 * Tools: get_queue, consume_item
 *
 * get_queue calls GET /queue, which triggers scheduler.refillIfNeeded on the
 * server before returning items so the queue is always fresh.
 *
 * consume_item calls DELETE /queue/:id, which records content views server-side.
 */

const api = require("../api");

async function handleGetQueue({ user_id, limit = 5 }) {
	const cap = Math.min(parseInt(limit, 10) || 1, 1);
	return api.get(`/queue?user_id=${encodeURIComponent(user_id)}&limit=${cap}`);
}

async function handleConsumeItem({ queue_item_id }) {
	await api.delete(`/queue/${encodeURIComponent(queue_item_id)}`);
	return { ok: true };
}

async function handleGetItemBody({ item_type, item_id }) {
	if (item_type === "content") {
		return api.get(`/content/${encodeURIComponent(item_id)}`);
	}
	if (item_type === "question") {
		return api.get(`/questions/${encodeURIComponent(item_id)}`);
	}
	throw new Error(`Unknown item_type: ${item_type}`);
}

module.exports = { handleGetQueue, handleConsumeItem, handleGetItemBody };
