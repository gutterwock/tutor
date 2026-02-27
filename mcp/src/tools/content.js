/**
 * Tools: create_content, create_question
 *
 * Both call adaptive endpoints on the REST API server, which inserts items
 * with base_content=false so they are never overwritten by the ingest script.
 * Items appear in the user's queue on the next get_queue call.
 */

const api = require("../api");

async function handleCreateContent({ syllabus_id, content_type, title, body, tags }) {
	return api.post("/content/adaptive", { syllabus_id, content_type, title, body, tags });
}

async function handleCreateQuestion({
	syllabus_id,
	difficulty,
	question_type,
	question_text,
	options,
	answer,
	tags,
}) {
	return api.post("/questions/adaptive", {
		syllabus_id,
		difficulty,
		question_type,
		question_text,
		options,
		answer,
		tags,
	});
}

module.exports = { handleCreateContent, handleCreateQuestion };
