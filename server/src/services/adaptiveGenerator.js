/**
 * Adaptive content/question generation for struggling subtopics.
 *
 * Called as a fire-and-forget background task from POST /generate-adaptive.
 * Builds a prompt from the user's recent wrong answers, calls the AI,
 * parses the JSON response, and persists the items.
 */

const pool = require("../config/db");
const { callAI } = require("./ai");
const { generateEmbedding, pgVector } = require("./embedding");

async function generateForSubtopic(userId, subtopicId) {
	// 1. Subtopic context
	const ctxRes = await pool.query(
		`SELECT s.name AS subtopic_name, t.name AS topic_name, c.name AS course_name
		 FROM syllabus s
		 JOIN syllabus t ON t.id = s.parent_id
		 JOIN syllabus c ON c.id = t.parent_id
		 WHERE s.id = $1`,
		[subtopicId]
	);
	if (!ctxRes.rows.length) throw new Error(`Subtopic not found: ${subtopicId}`);
	const { subtopic_name, topic_name, course_name } = ctxRes.rows[0];

	// 2. Recent wrong answers
	const wrongRes = await pool.query(
		`SELECT q.question_text, q.answer, r.user_answer, r.correctness
		 FROM response r
		 JOIN question q ON q.id = r.question_id
		 WHERE r.user_id = $1
		   AND q.syllabus_id = $2
		   AND r.correctness < 2
		   AND (r.graded_at IS NOT NULL OR q.question_type NOT IN ('freeText', 'ordering'))
		 ORDER BY r.responded_at DESC
		 LIMIT 5`,
		[userId, subtopicId]
	);

	// 3. Existing titles to avoid duplication
	const titlesRes = await pool.query(
		`SELECT title FROM content WHERE syllabus_id = $1`,
		[subtopicId]
	);
	const existingTitles = titlesRes.rows.map((r) => r.title);

	// 4. Build prompt
	const wrongSummary = wrongRes.rows.length
		? wrongRes.rows
			.map((r) =>
				`Q: ${r.question_text}\n` +
				`User: ${JSON.stringify(r.user_answer)} (score ${r.correctness}/4)\n` +
				`Correct: ${JSON.stringify(r.answer)}`
			)
			.join("\n\n")
		: "No wrong answers recorded yet.";

	const prompt =
		`You are generating targeted study material for a student struggling with ` +
		`"${subtopic_name}" (${topic_name}, ${course_name}).\n\n` +
		`Recent wrong answers:\n${wrongSummary}\n\n` +
		`Existing content titles (do not duplicate): ${existingTitles.join(", ") || "none"}\n\n` +
		`Generate exactly 1 short content item and 2 practice questions targeting the gaps above. ` +
		`Keep question difficulty 0–1.\n\n` +
		`Respond with ONLY valid JSON (no markdown, no explanation):\n` +
		`{\n` +
		`  "content": [{\n` +
		`    "content_type": "text",\n` +
		`    "title": "string",\n` +
		`    "body": "string",\n` +
		`    "tags": ["phase:atomic"]\n` +
		`  }],\n` +
		`  "questions": [{\n` +
		`    "difficulty": 0,\n` +
		`    "question_type": "singleChoice",\n` +
		`    "question_text": "string",\n` +
		`    "options": {"a": "...", "b": "...", "c": "...", "d": "..."},\n` +
		`    "answer": "a",\n` +
		`    "tags": ["phase:atomic"]\n` +
		`  }]\n` +
		`}\n\n` +
		`Rules:\n` +
		`- question_type: singleChoice | multiChoice | freeText | ordering\n` +
		`- For freeText omit options; answer is a string\n` +
		`- tags must include exactly one of: phase:atomic | phase:complex | phase:integration`;

	// 5. Call AI
	const raw = await callAI(prompt);

	// 6. Parse — strip markdown fences if present
	let parsed;
	try {
		const cleaned = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
		parsed = JSON.parse(cleaned);
	} catch (err) {
		throw new Error(`Failed to parse AI response: ${err.message}\nRaw: ${raw.slice(0, 300)}`);
	}

	// 7. Persist content
	const contentIds = [];
	for (const c of parsed.content ?? []) {
		if (!c.title || !c.body) continue;
		const embedding = pgVector(await generateEmbedding(`${c.title} ${c.body}`));
		const r = await pool.query(
			`INSERT INTO content (syllabus_id, active, base_content, content_type, title, body, tags, embedding)
			 VALUES ($1, true, false, $2, $3, $4, $5, $6)
			 RETURNING id`,
			[subtopicId, c.content_type ?? "text", c.title, c.body, c.tags ?? [], embedding]
		);
		contentIds.push(r.rows[0].id);
	}

	// 8. Persist questions
	const questionIds = [];
	for (const q of parsed.questions ?? []) {
		if (!q.question_text || q.answer === undefined) continue;
		if (!["singleChoice", "multiChoice", "ordering", "freeText"].includes(q.question_type)) continue;
		const diff = Math.max(0, Math.min(4, parseInt(q.difficulty ?? 0, 10)));
		const embedding = pgVector(await generateEmbedding(q.question_text));
		const r = await pool.query(
			`INSERT INTO question
			   (syllabus_id, active, base_content, difficulty, question_type, question_text, options, answer, tags, embedding)
			 VALUES ($1, true, false, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id`,
			[
				subtopicId, diff, q.question_type, q.question_text,
				JSON.stringify(q.options ?? null), JSON.stringify(q.answer),
				q.tags ?? [], embedding,
			]
		);
		questionIds.push(r.rows[0].id);
	}

	console.log(`  [adaptive] ${subtopicId}: +${contentIds.length} content, +${questionIds.length} questions`);
	return { contentIds, questionIds };
}

module.exports = { generateForSubtopic };
