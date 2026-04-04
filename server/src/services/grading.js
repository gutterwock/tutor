/**
 * Deterministic grading for singleChoice, multiChoice, ordering, and exactMatch questions.
 * freeText AI grading via gradeFreeText (calls the AI service).
 *
 * Used by the response controller, the cron, and the grade-ai endpoint.
 */

const { callAI } = require("./ai");

/**
 * Grade an exactMatch response via AI when deterministic matching failed.
 * Checks whether the student's answer is equivalent in meaning to any accepted answer.
 * Returns 0 or 4 only.
 */
async function gradeExactMatchAI(questionText, acceptedAnswers, userAnswer) {
	const answers = Array.isArray(acceptedAnswers) ? acceptedAnswers : [acceptedAnswers];
	const prompt =
		`In the context of the following question, is the student's answer equivalent in meaning to any of the accepted answers?\n` +
		`Return ONLY a JSON object with a single key "correctness" set to 0 or 4:\n` +
		`  4 = equivalent to one of the accepted answers\n` +
		`  0 = not equivalent to any accepted answer\n\n` +
		`Question: ${questionText}\n` +
		`Accepted answers: ${JSON.stringify(answers)}\n` +
		`Student answer: ${JSON.stringify(userAnswer)}\n\n` +
		`Respond with JSON only. Example: {"correctness": 4}`;

	const raw = await callAI(prompt);
	const match = raw.match(/"correctness"\s*:\s*([04])/);
	if (!match) {
		console.warn(`[grading] unparseable AI response: ${raw.slice(0, 120)}`);
		return 0;
	}
	return parseInt(match[1], 10);
}

/**
 * Grade a freeText response via AI. Returns 0–4.
 */
async function gradeFreeText(questionText, expectedAnswer, userAnswer) {
	const prompt =
		`You are grading a student's free-text response to a quiz question.\n` +
		`Return ONLY a JSON object with a single key "correctness" set to an integer 0–4:\n` +
		`  0 = completely wrong or blank\n` +
		`  1 = mostly wrong with minor correct elements\n` +
		`  2 = partially correct\n` +
		`  3 = mostly correct with minor issues\n` +
		`  4 = fully correct\n\n` +
		`Question: ${questionText}\n` +
		`Grading rubric (the answer should look something like this, OR cover these key points): ${JSON.stringify(expectedAnswer)}\n` +
		`Student response: ${JSON.stringify(userAnswer)}\n\n` +
		`Respond with JSON only. Example: {"correctness": 3}`;

	const raw = await callAI(prompt);
	const match = raw.match(/"correctness"\s*:\s*([0-4])/);
	if (!match) {
		console.warn(`[grading] unparseable AI response: ${raw.slice(0, 120)}`);
		return 0;
	}
	return Math.max(0, Math.min(4, parseInt(match[1], 10)));
}

function gradeSingleChoice(userAnswer, correctAnswer) {
	const u = String(userAnswer ?? "").trim().toLowerCase();
	const c = String(correctAnswer ?? "").trim().toLowerCase();
	return u === c ? 4 : 0;
}

function gradeMultiChoice(userAnswer, correctAnswer) {
	const user    = toStringSet(userAnswer);
	const correct = toStringSet(correctAnswer);
	if (correct.size === 0) return 0;
	if (user.size !== correct.size) return 0;
	for (const v of correct) {
		if (!user.has(v)) return 0;
	}
	return 4;
}

function gradeOrdering(userAnswer, expectedAnswer) {
	const user     = toStringArray(userAnswer);
	const expected = toStringArray(expectedAnswer);

	if (user.length === 0) return 0;
	return JSON.stringify(user.map(v => v.toLowerCase())) === JSON.stringify(expected.map(v => v.toLowerCase())) ? 4 : 0;
}

function stripAccents(str) {
	return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Grade an exactMatch response. Returns 4 if the user's answer matches any
 * accepted string, 0 otherwise. Respects caseSensitive flag.
 * Accent-stripped comparison is always tried as a fallback so users who omit
 * diacritics on answers that contain them are still marked correct.
 */
function gradeExactMatch(userAnswer, correctAnswers, caseSensitive = false) {
	const u = String(userAnswer ?? "").trim();
	const answers = Array.isArray(correctAnswers) ? correctAnswers : [correctAnswers];
	const matched = answers.some((a) => {
		const expected = String(a ?? "").trim();
		if (caseSensitive) {
			return u === expected || stripAccents(u) === stripAccents(expected);
		}
		return u.toLowerCase() === expected.toLowerCase() ||
			stripAccents(u).toLowerCase() === stripAccents(expected).toLowerCase();
	});
	return matched ? 4 : 0;
}

/**
 * Grade a response deterministically.
 * Returns null for freeText (needs AI/human assessment).
 * opts.caseSensitive is only used for exactMatch.
 */
function gradeResponse(questionType, userAnswer, correctAnswer, { caseSensitive = false } = {}) {
	if (questionType === "singleChoice") return gradeSingleChoice(userAnswer, correctAnswer);
	if (questionType === "multiChoice")  return gradeMultiChoice(userAnswer, correctAnswer);
	if (questionType === "ordering")     return gradeOrdering(userAnswer, correctAnswer);
	if (questionType === "exactMatch")   return gradeExactMatch(userAnswer, correctAnswer, caseSensitive);
	return null; // freeText
}

function toStringSet(val) {
	return new Set(
		(Array.isArray(val) ? val : [val]).map((v) => String(v ?? "").trim().toLowerCase())
	);
}

function toStringArray(val) {
	return (Array.isArray(val) ? val : [val]).map((v) => String(v ?? "").trim());
}

module.exports = { gradeSingleChoice, gradeMultiChoice, gradeOrdering, gradeExactMatch, gradeResponse, gradeFreeText, gradeExactMatchAI };
