const pool = require("../config/db");

/**
 * Upsert a single syllabus row. Skips update if checksum matches.
 */
async function upsertRow(row) {
	const { id, parent_id, level, name, description, prerequisites, exam, sort_order, checksum, embedding } = row;
	// Ensure exam is serialized as JSON string so pg doesn't pass a bare string to JSONB
	const examJson = exam == null ? null : (typeof exam === "string" ? JSON.stringify(exam) : exam);
	const result = await pool.query(
		`INSERT INTO syllabus (id, parent_id, level, name, description, prerequisites, exam, sort_order, checksum, embedding)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		 ON CONFLICT (id) DO UPDATE
		   SET parent_id     = EXCLUDED.parent_id,
		       level         = EXCLUDED.level,
		       name          = EXCLUDED.name,
		       description   = EXCLUDED.description,
		       prerequisites = EXCLUDED.prerequisites,
		       exam          = EXCLUDED.exam,
		       sort_order    = EXCLUDED.sort_order,
		       checksum      = EXCLUDED.checksum,
		       embedding     = EXCLUDED.embedding
		   WHERE syllabus.checksum IS DISTINCT FROM EXCLUDED.checksum
		 RETURNING id`,
		[id, parent_id ?? null, level, name, description ?? null,
			prerequisites ?? [], examJson, sort_order ?? 0, checksum ?? null,
			embedding ?? null]
	);
	return result.rowCount > 0;
}

/**
 * Get all top-level courses.
 */
async function getAll() {
	const result = await pool.query(
		`SELECT * FROM syllabus WHERE level = 'course' ORDER BY id`
	);
	return result.rows;
}

/**
 * Get a single syllabus node by id.
 */
async function getById(id) {
	const result = await pool.query(`SELECT * FROM syllabus WHERE id = $1`, [id]);
	return result.rows[0] ?? null;
}

/**
 * Get all direct children of a node.
 */
async function getChildren(parentId) {
	const result = await pool.query(
		`SELECT * FROM syllabus WHERE parent_id = $1 ORDER BY sort_order`,
		[parentId]
	);
	return result.rows;
}

/**
 * Get all subtopic descendants of a course id.
 */
async function getSubtopics(courseId) {
	const result = await pool.query(
		`SELECT s.*
		 FROM syllabus s
		 WHERE s.level = 'subtopic'
		   AND (
		     s.parent_id = $1
		     OR s.parent_id IN (
		       SELECT id FROM syllabus WHERE parent_id = $1 AND level = 'topic'
		     )
		   )
		 ORDER BY s.parent_id, s.sort_order`,
		[courseId]
	);
	return result.rows;
}

module.exports = { upsertRow, getAll, getById, getChildren, getSubtopics };
