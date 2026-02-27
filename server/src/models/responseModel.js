const pool = require("../config/db");

/**
 * Insert a graded response (graded_at = responded_at so cron skips it).
 */
async function submitResponse(questionId, userId, userAnswer, correctness) {
	const now = Date.now();
	const result = await pool.query(
		`INSERT INTO response (question_id, user_id, user_answer, correctness, responded_at, graded_at)
		 VALUES ($1, $2, $3, $4, $5, $5)
		 RETURNING *`,
		[questionId, userId, JSON.stringify(userAnswer), correctness, now]
	);
	return result.rows[0];
}

/**
 * Insert an ungraded freeText/ordering response (graded_at = NULL).
 * The cron or MCP plugin will grade it later.
 */
async function submitUngraded(questionId, userId, userAnswer) {
	const now = Date.now();
	const result = await pool.query(
		`INSERT INTO response (question_id, user_id, user_answer, correctness, responded_at)
		 VALUES ($1, $2, $3, 0, $4)
		 RETURNING *`,
		[questionId, userId, JSON.stringify(userAnswer), now]
	);
	return result.rows[0];
}

/**
 * Set correctness and graded_at on an existing response.
 */
async function setGrade(responseId, correctness) {
	const result = await pool.query(
		`UPDATE response SET correctness = $1, graded_at = $2 WHERE id = $3 RETURNING *`,
		[correctness, Date.now(), responseId]
	);
	return result.rows[0] ?? null;
}

/**
 * Query responses with optional filters.
 */
async function getResponses(filters = {}) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (filters.user_id) {
		conditions.push(`user_id = $${idx++}`);
		params.push(filters.user_id);
	}
	if (filters.question_id) {
		conditions.push(`question_id = $${idx++}`);
		params.push(filters.question_id);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const result = await pool.query(
		`SELECT * FROM response ${where} ORDER BY responded_at DESC`,
		params
	);
	return result.rows;
}

module.exports = { submitResponse, submitUngraded, setGrade, getResponses };
