const pool = require("../config/db");
const progressModel = require("../models/progressModel");
const { generateForSubtopic } = require("../services/adaptiveGenerator");

const RESPONSE_WINDOW        = parseInt(process.env.RESPONSE_WINDOW        || "10", 10);
const STRUGGLING_THRESHOLD   = parseFloat(process.env.STRUGGLING_THRESHOLD  || "1.5");
const MIN_RESPONSES_STRUGGLE = parseInt(process.env.MIN_RESPONSES_STRUGGLE || "3",  10);

/**
 * GET /progress?user_id=
 */
async function getProgress(req, res) {
	try {
		const { user_id } = req.query;
		if (!user_id) {
			return res.status(400).json({ error: "Missing required query param: user_id" });
		}
		const rows = await progressModel.getActiveSubtopics(user_id);
		return res.json(rows);
	} catch (err) {
		console.error("getProgress error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * GET /enrollments?user_id=
 */
async function getEnrollments(req, res) {
	try {
		const { user_id } = req.query;
		if (!user_id) {
			return res.status(400).json({ error: "Missing required query param: user_id" });
		}
		const rows = await progressModel.getEnrolledCourses(user_id);
		return res.json(rows);
	} catch (err) {
		console.error("getEnrollments error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * GET /struggling?user_id=
 * Returns active subtopics where the user meets the struggling threshold.
 */
async function getStruggling(req, res) {
	try {
		const { user_id } = req.query;
		if (!user_id) return res.status(400).json({ error: "Missing required query param: user_id" });

		const result = await pool.query(
			`SELECT s.id AS subtopic_id,
			        s.name AS subtopic_name,
			        t.name AS topic_name,
			        c.id AS course_id,
			        c.name AS course_name,
			        stats.response_count,
			        stats.avg_correctness
			 FROM content_progress cp
			 JOIN syllabus s ON s.id = cp.subtopic_id
			 JOIN syllabus t ON t.id = s.parent_id
			 JOIN syllabus c ON c.id = t.parent_id
			 JOIN LATERAL (
			   SELECT COUNT(*)::int AS response_count,
			          AVG(r.correctness)::float AS avg_correctness
			   FROM (
			     SELECT r.correctness
			     FROM response r
			     JOIN question q ON q.id = r.question_id
			     WHERE r.user_id = $1
			       AND q.syllabus_id = cp.subtopic_id
			       AND (r.graded_at IS NOT NULL OR q.question_type NOT IN ('freeText', 'ordering'))
			     ORDER BY r.responded_at DESC
			     LIMIT $2
			   ) recent
			 ) stats ON true
			 WHERE cp.user_id = $1
			   AND cp.active = true
			   AND cp.completed = false
			   AND stats.response_count >= $3
			   AND stats.avg_correctness < $4`,
			[user_id, RESPONSE_WINDOW, MIN_RESPONSES_STRUGGLE, STRUGGLING_THRESHOLD]
		);

		return res.json(result.rows);
	} catch (err) {
		console.error("getStruggling error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * POST /generate-adaptive
 * Body: { user_id, subtopic_id }
 * Fires background adaptive content generation; returns immediately.
 */
async function generateAdaptive(req, res) {
	try {
		const { user_id, subtopic_id } = req.body;
		if (!user_id || !subtopic_id) {
			return res.status(400).json({ error: "Missing required fields: user_id, subtopic_id" });
		}

		generateForSubtopic(user_id, subtopic_id).catch((err) =>
			console.error(`[adaptive] generation failed for ${subtopic_id}:`, err.message)
		);

		return res.json({ queued: true });
	} catch (err) {
		console.error("generateAdaptive error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = { getProgress, getEnrollments, getStruggling, generateAdaptive };
