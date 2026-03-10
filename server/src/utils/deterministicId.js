const crypto = require("crypto");

/**
 * UUID v5 (SHA-1 namespaced) implementation using Node built-in crypto.
 * Project namespace: a fixed UUID constant unique to tutor.ai.
 */
const NAMESPACE = "1f79ae9d-4b8c-5e3f-9a1d-7b2c4e6f8a0b";

const NS_BYTES = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");

function uuidv5(name) {
	const hash = crypto
		.createHash("sha1")
		.update(NS_BYTES)
		.update(name)
		.digest();

	// Set version 5
	hash[6] = (hash[6] & 0x0f) | 0x50;
	// Set RFC 4122 variant
	hash[8] = (hash[8] & 0x3f) | 0x80;

	const h = hash.slice(0, 16).toString("hex");
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function contentId(syllabusId, title, body) {
	return uuidv5(`content:${syllabusId}:${title}:${body}`);
}

function questionId(syllabusId, questionText, answer, contentIds, passage) {
	const sortedIds = [...contentIds].sort();
	const base = `question:${syllabusId}:${questionText}:${JSON.stringify(answer)}:${JSON.stringify(sortedIds)}`;
	return uuidv5(passage ? `${base}:${passage}` : base);
}

module.exports = { uuidv5, contentId, questionId };
