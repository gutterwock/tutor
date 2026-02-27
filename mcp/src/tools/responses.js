/**
 * Tools: submit_response, record_grade
 *
 * submit_response calls POST /responses.
 *   - singleChoice / multiChoice / ordering → server grades automatically and
 *     runs the pipeline; response includes needs_grading: false + pipeline.
 *   - freeText → server stores ungraded (needs_grading: true); Claude must
 *     assess the answer and immediately call record_grade.
 *
 * record_grade calls PATCH /responses/:id/grade, which persists Claude's score
 * and runs the post-response pipeline.
 */

const api = require("../api");

async function handleSubmitResponse({ user_id, question_id, user_answer }) {
	return api.post("/responses", { user_id, question_id, user_answer });
}

async function handleRecordGrade({ response_id, user_id, correctness }) {
	const score = Math.max(0, Math.min(4, parseInt(correctness, 10)));
	return api.patch(`/responses/${encodeURIComponent(response_id)}/grade`, {
		user_id,
		correctness: score,
	});
}

module.exports = { handleSubmitResponse, handleRecordGrade };
