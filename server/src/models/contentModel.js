const pool = require("../config/db");
const { contentId } = require("../utils/deterministicId");

/**
 * Set-diff upsert: compute deterministic IDs, delete removed records,
 * insert new records. Unchanged records (same ID already in DB) are untouched,
 * preserving content_view history. Adaptive content (base_content=false) is never touched.
 */
async function replaceBaseContent(syllabusId, rows) {
	// Attach deterministic IDs
	const rowsWithIds = rows.map((row) => ({
		...row,
		id: contentId(row.syllabus_id, row.title, row.body),
	}));

	const client = await pool.connect();
	try {
		// Fetch existing base IDs before starting the transaction
		const existingResult = await client.query(
			`SELECT id FROM content WHERE syllabus_id = $1 AND base_content = true`,
			[syllabusId]
		);
		const existingIds = new Set(existingResult.rows.map((r) => r.id));
		const incomingIds = new Set(rowsWithIds.map((r) => r.id));

		const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
		const toInsert = rowsWithIds.filter((row) => !existingIds.has(row.id));

		await client.query("BEGIN");

		if (toDelete.length > 0) {
			await client.query(`DELETE FROM content WHERE id = ANY($1)`, [toDelete]);
		}

		for (const row of toInsert) {
			await client.query(
				`INSERT INTO content (id, syllabus_id, active, base_content, content_type, title, body, tags, links, embedding, metadata)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
				[
					row.id,
					row.syllabus_id,
					row.active ?? true,
					true,
					row.content_type ?? "text",
					row.title,
					row.body,
					row.tags ?? [],
					JSON.stringify(row.links ?? []),
					row.embedding ?? null,
					JSON.stringify(row.metadata ?? {}),
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
 * Query content with optional filters.
 */
async function getContent(filters = {}) {
	const conditions = [];
	const params = [];
	let idx = 1;

	if (filters.syllabus_id) {
		conditions.push(`syllabus_id = $${idx++}`);
		params.push(filters.syllabus_id);
	}
	if (filters.active !== undefined) {
		conditions.push(`active = $${idx++}`);
		params.push(filters.active);
	}
	if (filters.tags && filters.tags.length > 0) {
		conditions.push(`tags @> $${idx++}`);
		params.push(filters.tags);
	}

	const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const result = await pool.query(`SELECT * FROM content ${where} ORDER BY id`, params);
	return result.rows;
}

/**
 * Upsert a content_view record (increment view_count on conflict).
 */
async function upsertContentView(contentId, userId) {
	const now = Date.now();
	const result = await pool.query(
		`INSERT INTO content_view (content_id, user_id, last_shown, view_count)
		 VALUES ($1, $2, $3, 1)
		 ON CONFLICT (content_id, user_id) DO UPDATE
		   SET last_shown = EXCLUDED.last_shown,
		       view_count = content_view.view_count + 1
		 RETURNING *`,
		[contentId, userId, now]
	);
	return result.rows[0];
}

/**
 * Get content views for a user, optionally filtered by syllabus_id.
 */
async function getContentViews(userId, syllabusId) {
	const params = [userId];
	let syllabusFilter = "";
	if (syllabusId) {
		params.push(syllabusId);
		syllabusFilter = `AND c.syllabus_id = $2`;
	}
	const result = await pool.query(
		`SELECT cv.*, c.title, c.syllabus_id
		 FROM content_view cv
		 JOIN content c ON c.id = cv.content_id
		 WHERE cv.user_id = $1 ${syllabusFilter}
		 ORDER BY cv.last_shown DESC`,
		params
	);
	return result.rows;
}

async function getContentById(id) {
	const result = await pool.query(`SELECT * FROM content WHERE id = $1`, [id]);
	return result.rows[0] ?? null;
}

module.exports = { replaceBaseContent, getContent, upsertContentView, getContentViews, getContentById };
