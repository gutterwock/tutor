const pool = require("../config/db");
const { questionId } = require("../utils/deterministicId");

/**
 * Set-diff upsert: compute deterministic IDs, delete removed records,
 * insert new records. Unchanged records (same ID already in DB) are untouched.
 * Adaptive questions (base_content=false) are never touched.
 */
async function replaceBaseQuestions(syllabusId, rows) {
	// Attach deterministic IDs (content_ids already resolved to real UUIDs by the controller)
	const rowsWithIds = rows.map((row) => ({
		...row,
		id: questionId(row.syllabus_id, row.question_text, row.answer, row.content_ids ?? [], row.passage ?? null),
	}));

	const client = await pool.connect();
	try {
		// Fetch existing base IDs before starting the transaction
		const existingResult = await client.query(
			`SELECT id FROM question WHERE syllabus_id = $1 AND base_content = true`,
			[syllabusId]
		);
		const existingIds = new Set(existingResult.rows.map((r) => r.id));
		const incomingIds = new Set(rowsWithIds.map((r) => r.id));

		const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
		const toInsert = rowsWithIds.filter((row) => !existingIds.has(row.id));

		await client.query("BEGIN");

		if (toDelete.length > 0) {
			await client.query(`DELETE FROM question WHERE id = ANY($1)`, [toDelete]);
		}

		for (const row of toInsert) {
			await client.query(
				`INSERT INTO question (id, syllabus_id, active, base_content, difficulty, question_type, question_text, options, answer, explanation, passage, tags, content_ids, case_sensitive, embedding)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
				[
					row.id,
					row.syllabus_id,
					row.active ?? true,
					true,
					row.difficulty,
					row.question_type,
					row.question_text,
					JSON.stringify(row.options ?? null),
					JSON.stringify(row.answer),
					row.explanation ?? null,
					row.passage ?? null,
					row.tags ?? [],
					row.content_ids ?? [],
					row.caseSensitive ?? false,
					row.embedding ?? null,
				]
			);
		}

		await client.query("COMMIT");
		return {
			ids: rowsWithIds.map((r) => r.id),
			inserted: toInsert.length,
			skipped: rowsWithIds.length - toInsert.length,
		};
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
