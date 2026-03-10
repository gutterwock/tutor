const crypto = require("crypto");
const syllabusModel = require("../models/syllabusModel");
const progressModel = require("../models/progressModel");
const queueModel = require("../models/queueModel");
const { generateEmbedding, pgVector } = require("../services/embedding");

/**
 * Compute a stable SHA-256 checksum over the mutable fields of a syllabus node.
 */
function computeChecksum(name, description, prerequisites, exam) {
	const payload = JSON.stringify({
		description: description ?? null,
		exam: exam ?? null,
		name,
		prerequisites: prerequisites ?? [],
	});
	return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * POST /syllabus/upload
 * Body: syllabus.json format (nested course object with topics → sub_topics)
 */
async function uploadSyllabus(req, res) {
	try {
		const course = req.body;

		if (!course.id || !course.name) {
			return res.status(400).json({ error: "Missing required fields: id, name" });
		}

		let inserted = 0;
		let skipped = 0;

		// Helper to upsert one row
		async function upsertOne(row) {
			const changed = await syllabusModel.upsertRow(row);
			if (changed) inserted++;
			else skipped++;
		}

		// Course row
		const courseChecksum = computeChecksum(
			course.name,
			course.description,
			course.prerequisites,
			course.exam
		);
		const courseEmbedding = pgVector(
			await generateEmbedding(`${course.name} ${course.description ?? ""}`)
		);
		await upsertOne({
			id: course.id,
			parent_id: null,
			level: "course",
			name: course.name,
			description: course.description ?? null,
			prerequisites: course.prerequisites ?? [],
			exam: course.exam ?? null,
			sort_order: 0,
			checksum: courseChecksum,
			embedding: courseEmbedding,
		});

		// Topic and subtopic rows
		const topics = course.topics ?? [];
		for (let ti = 0; ti < topics.length; ti++) {
			const topic = topics[ti];
			const topicChecksum = computeChecksum(
				topic.name,
				topic.description,
				topic.prerequisites,
				topic.exam
			);
			const topicEmbedding = pgVector(
				await generateEmbedding(`${topic.name} ${topic.description ?? ""}`)
			);
			await upsertOne({
				id: topic.id,
				parent_id: course.id,
				level: "topic",
				name: topic.name,
				description: topic.description ?? null,
				prerequisites: topic.prerequisites ?? [],
				exam: topic.exam ?? null,
				sort_order: ti,
				checksum: topicChecksum,
				embedding: topicEmbedding,
			});

			const subTopics = topic.sub_topics ?? [];
			for (let si = 0; si < subTopics.length; si++) {
				const sub = subTopics[si];
				const subChecksum = computeChecksum(
					sub.name,
					sub.description,
					sub.prerequisites,
					sub.exam
				);
				const subEmbedding = pgVector(
					await generateEmbedding(`${sub.name} ${sub.description ?? ""}`)
				);
				await upsertOne({
					id: sub.id,
					parent_id: topic.id,
					level: "subtopic",
					name: sub.name,
					description: sub.description ?? null,
					prerequisites: sub.prerequisites ?? [],
					exam: sub.exam ?? null,
					sort_order: si,
					checksum: subChecksum,
					embedding: subEmbedding,
				});
			}
		}

		const total = inserted + skipped;
		return res.status(200).json({ inserted, skipped, total });
	} catch (err) {
		console.error("uploadSyllabus error:", err.message, err.detail ?? "");
		return res.status(500).json({ error: err.message });
	}
}

/**
 * GET /syllabus?id=<id>
 * Returns a single node if ?id= provided, otherwise all courses.
 */
async function getSyllabus(req, res) {
	try {
		if (req.query.id) {
			const row = await syllabusModel.getById(req.query.id);
			if (!row) return res.status(404).json({ error: "Not found" });
			return res.json(row);
		}
		const courses = await syllabusModel.getAll();
		return res.json(courses);
	} catch (err) {
		console.error("getSyllabus error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * POST /syllabus/enroll
 * Body: { user_id, course_id }
 * Creates content_progress rows for all subtopics under the course.
 * The first subtopic is active=true; the rest are false (to be unlocked by cron).
 */
async function enrollInSyllabus(req, res) {
	try {
		const { user_id, course_id } = req.body;
		if (!user_id || !course_id) {
			return res.status(400).json({ error: "Missing required fields: user_id, course_id" });
		}

		const course = await syllabusModel.getById(course_id);
		if (!course || course.level !== "course") {
			return res.status(404).json({ error: "Course not found" });
		}

		const subtopics = await syllabusModel.getSubtopics(course_id);
		if (subtopics.length === 0) {
			return res.status(200).json({ enrolled: 0, message: "No subtopics found" });
		}

		const pool = require("../config/db");
		let enrolled = 0;
		for (let i = 0; i < subtopics.length; i++) {
			const sub = subtopics[i];
			const active = i === 0;
			const result = await pool.query(
				`INSERT INTO content_progress (user_id, syllabus_id, subtopic_id, active, completed)
				 VALUES ($1, $2, $3, $4, false)
				 ON CONFLICT (user_id, subtopic_id) DO NOTHING`,
				[user_id, course_id, sub.id, active]
			);
			if (result.rowCount > 0) enrolled++;
		}

		return res.status(200).json({ enrolled, total_subtopics: subtopics.length });
	} catch (err) {
		console.error("enrollInSyllabus error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

/**
 * DELETE /syllabus/enroll
 * Body: { user_id, course_id }
 * Removes all content_progress rows and queue items for the user/course.
 */
async function unenrollFromSyllabus(req, res) {
	try {
		const { user_id, course_id } = req.body;
		if (!user_id || !course_id) {
			return res.status(400).json({ error: "Missing required fields: user_id, course_id" });
		}
		await queueModel.clearCourseItems(user_id, course_id);
		await progressModel.unenroll(user_id, course_id);
		return res.status(200).json({ unenrolled: true, course_id });
	} catch (err) {
		console.error("unenrollFromSyllabus error:", err);
		return res.status(500).json({ error: "Internal server error" });
	}
}

module.exports = { uploadSyllabus, getSyllabus, enrollInSyllabus, unenrollFromSyllabus };
