/**
 * Tools: list_courses, enroll, get_progress
 */

const api = require("../api");

async function handleListCourses() {
	return api.get("/syllabus");
}

async function handleEnroll({ user_id, course_id }) {
	return api.post("/syllabus/enroll", { user_id, course_id });
}

async function handleGetProgress({ user_id }) {
	return api.get(`/progress?user_id=${encodeURIComponent(user_id)}`);
}

module.exports = { handleListCourses, handleEnroll, handleGetProgress };
