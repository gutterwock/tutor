const pool = require("../config/db");

/**
 * Delete all base_content=true questions for a subtopic and insert fresh rows.
 * Adaptive questions (base_content=false) are never touched.
 */
async function replaceBaseQuestions(syllabusId, rows) {
	const client = await pool.connect();
	try {
		await client.query("BEGIN");
		await client.query(
			`DELETE FROM question WHERE syllabus_id = $1 AND base_content = true`,
			[syllabusId]
		);
		const ids = [];
		for (const row of rows) {
			const result = await client.query(
				`INSERT INTO question (syllabus_id, active, base_content, difficulty, question_type, question_text, options, answer, tags, embedding)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
				 RETURNING id`,
				[
					row.syllabus_id,
					row.active ?? true,
					true,
					row.difficulty,
					row.question_type,
					row.question_text,
					JSON.stringify(row.options ?? null),
					JSON.stringify(row.answer),
					row.tags ?? [],
					row.embedding ?? null,
				]
			);
			ids.push(result.rows[0].id);
		}
		await client.query("COMMIT");
		return ids;
	} catch (err) {
		await client.query("ROLLBACK");
		throw err;
	} finally {
		client.release();
	}
}

/**
 * Query questions with optional filters.
 */
async function getQuestions(filters = {}) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (filters.syllabus_id) {
		conditions.push(`syllabus_id = $${idx++}`);
		params.push(filters.syllabus_id);
	}
	if (filters.difficulty !== undefined) {
		conditions.push(`difficulty = $${idx++}`);
		params.push(filters.difficulty);
	}
	if (filters.active !== undefined) {
		conditions.push(`active = $${idx++}`);
		params.push(filters.active);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const result = await pool.query(`SELECT * FROM question ${where} ORDER BY id`, params);
	return result.rows;
}

async function getQuestionById(id) {
	const result = await pool.query(`SELECT * FROM question WHERE id = $1`, [id]);
	return result.rows[0] ?? null;
}

module.exports = { replaceBaseQuestions, getQuestions, getQuestionById };
