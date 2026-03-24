const pool = require("../config/db");
const responseModel = require("../models/responseModel");
const queueModel = require("../models/queueModel");
const { gradeResponse, gradeFreeText, gradeExactMatchAI } = require("../services/grading");
const { runPipeline } = require("../services/pipeline");

/**
 * GET /responses?user_id=&question_id=
 */
async function getResponses(req, res) {
	try {
		const filters = {};
		if (req.query.user_id) filters.user_id = req.query.user_id;
		if (req.query.question_id) filters.question_id = req.query.question_id;

		const rows = await responseModel.getResponses(filters);
		return res.json(rows);
	} catch (err) {
		console.error("getResponses error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * POST /responses
 * Body: { question_id, user_id, user_answer, correctness? }
 *
 * If correctness is omitted the server grades automatically:
 *   - singleChoice / multiChoice / ordering → graded immediately (graded_at = now)
 *   - freeText → stored ungraded (graded_at = NULL); response includes
 *     needs_grading: true so the caller can submit a grade via PATCH /responses/:id/grade
 *
 * If correctness is provided it is stored as-is (graded_at = now).
 *
 * For auto-graded and explicitly-graded responses the post-response pipeline
 * (completion check → subtopic unlock → struggling detection) runs immediately
 * and its results are included in the response body.
 */
async function submitResponse(req, res) {
	try {
		const { question_id, user_id, user_answer } = req.body;
		let { correctness } = req.body;

		if (!question_id || !user_id || user_answer === undefined) {
			return res.status(400).json({
				error: "Missing required fields: question_id, user_id, user_answer",
			});
		}

		// If correctness is explicitly provided, validate and use it
		if (correctness !== undefined && correctness !== null) {
			correctness = Number(correctness);
			if (!Number.isInteger(correctness) || correctness < 0 || correctness > 4) {
				return res.status(400).json({ error: "correctness must be an integer 0–4" });
			}
			const row = await responseModel.submitResponse(question_id, user_id, user_answer, correctness);
			await queueModel.transitionQuestionTier(user_id, question_id, correctness).catch(() => {});
			const pipeline = await runPipeline(user_id);
			return res.status(201).json({ ...row, needs_grading: false, pipeline });
		}

		// Auto-grade: look up question type and answer
		const qRes = await pool.query(
			`SELECT question_type, question_text, answer, case_sensitive FROM question WHERE id = $1`,
			[question_id]
		);
		if (!qRes.rows.length) {
			return res.status(404).json({ error: `Question ${question_id} not found` });
		}
		const q = qRes.rows[0];

		if (q.question_type === "freeText" || q.question_type === "exactMatch") {
			// Store ungraded — caller must follow up with POST .../grade-ai or PATCH .../grade
			const row = await responseModel.submitUngraded(question_id, user_id, user_answer);
			return res.status(201).json({
				...row,
				needs_grading:   true,
				question_text:   q.question_text,
				expected_answer: q.answer,
			});
		}

		// Deterministic grading for singleChoice / multiChoice / ordering
		correctness = gradeResponse(q.question_type, user_answer, q.answer, { caseSensitive: q.case_sensitive }) ?? 0;
		const row = await responseModel.submitResponse(question_id, user_id, user_answer, correctness);
		await queueModel.transitionQuestionTier(user_id, question_id, correctness).catch(() => {});
		const pipeline = await runPipeline(user_id);
		return res.status(201).json({ ...row, needs_grading: false, pipeline });
	} catch (err) {
		console.error("submitResponse error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * PATCH /responses/:id/grade
 * Body: { user_id, correctness }
 *
 * Persists a grade for an ungraded freeText response and runs the pipeline.
 * Returns the updated response row plus pipeline results.
 */
async function gradeResponseHandler(req, res) {
	try {
		const { id } = req.params;
		const { user_id, correctness } = req.body;

		if (!user_id || correctness === undefined) {
			return res.status(400).json({ error: "Missing required fields: user_id, correctness" });
		}

		const score = Math.max(0, Math.min(4, parseInt(correctness, 10)));
		if (!Number.isFinite(score)) {
			return res.status(400).json({ error: "correctness must be an integer 0–4" });
		}

		const row = await responseModel.setGrade(id, score);
		if (!row) {
			return res.status(404).json({ error: `Response ${id} not found` });
		}

		await queueModel.transitionQuestionTier(user_id, row.question_id, score).catch(() => {});
		const pipeline = await runPipeline(user_id);
		return res.json({ ...row, pipeline });
	} catch (err) {
		console.error("gradeResponse error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * POST /responses/:id/grade-ai
 * Body: { user_id }
 *
 * Grades a freeText response synchronously via AI and runs the pipeline.
 * Intended for CLI clients that want real-time feedback.
 */
async function gradeResponseAI(req, res) {
	try {
		const { id } = req.params;
		const { user_id } = req.body;
		if (!user_id) {
			return res.status(400).json({ error: "Missing required field: user_id" });
		}

		const qRes = await pool.query(
			`SELECT r.id, r.question_id, r.user_answer,
			        q.question_text, q.answer, q.question_type
			 FROM response r
			 JOIN question q ON q.id = r.question_id
			 WHERE r.id = $1 AND r.user_id = $2`,
			[id, user_id]
		);
		if (!qRes.rows.length) {
			return res.status(404).json({ error: `Response ${id} not found` });
		}
		const r = qRes.rows[0];
		if (r.question_type !== "freeText" && r.question_type !== "exactMatch") {
			return res.status(400).json({ error: "Only freeText and exactMatch responses can be AI-graded" });
		}

		const score = r.question_type === "exactMatch"
			? await gradeExactMatchAI(r.question_text, r.answer, r.user_answer)
			: await gradeFreeText(r.question_text, r.answer, r.user_answer);
		const row = await responseModel.setGrade(id, score);
		await queueModel.transitionQuestionTier(user_id, r.question_id, score).catch(() => {});
		const pipeline = await runPipeline(user_id);
		return res.json({ ...row, pipeline });
	} catch (err) {
		console.error("gradeResponseAI error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = { getResponses, submitResponse, gradeResponseHandler, gradeResponseAI };
