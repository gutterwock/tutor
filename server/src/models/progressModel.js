const pool = require("../config/db");

/**
 * Return all active, incomplete subtopics for a user, joined with syllabus names.
 */
async function getActiveSubtopics(userId) {
	const result = await pool.query(
		`SELECT cp.*, s.name AS subtopic_name, s.description AS subtopic_description
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.subtopic_id
		 WHERE cp.user_id = $1
		   AND cp.active = true
		   AND cp.completed = false
		 ORDER BY cp.syllabus_id, s.sort_order`,
		[userId]
	);
	return result.rows;
}

/**
 * Return all courses a user is enrolled in (has any content_progress rows for).
 */
async function getEnrolledCourses(userId) {
	const result = await pool.query(
		`SELECT DISTINCT cp.syllabus_id AS id, s.name
		 FROM content_progress cp
		 JOIN syllabus s ON s.id = cp.syllabus_id
		 WHERE cp.user_id = $1
		 ORDER BY s.name`,
		[userId]
	);
	return result.rows;
}

/**
 * Remove all content_progress rows for a user/course (unenroll).
 */
async function unenroll(userId, courseId) {
	await pool.query(
		`DELETE FROM content_progress WHERE user_id = $1 AND syllabus_id = $2`,
		[userId, courseId]
	);
}

module.exports = { getActiveSubtopics, getEnrolledCourses, unenroll };
