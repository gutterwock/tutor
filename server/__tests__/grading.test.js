/**
 * Tests for services/grading.js
 *
 * Pure functions (gradeSingleChoice, gradeMultiChoice, gradeOrdering,
 * gradeExactMatch, gradeResponse) are tested without any mocking.
 * gradeFreeText mocks callAI.
 */

jest.mock("../src/services/ai", () => ({ callAI: jest.fn() }));

const { callAI } = require("../src/services/ai");
const {
	gradeSingleChoice,
	gradeMultiChoice,
	gradeOrdering,
	gradeExactMatch,
	gradeResponse,
	gradeFreeText,
} = require("../src/services/grading");

// ── gradeSingleChoice ─────────────────────────────────────────────────────────

describe("gradeSingleChoice", () => {
	test("correct answer returns 4", () => {
		expect(gradeSingleChoice("a", "a")).toBe(4);
	});
	test("wrong answer returns 0", () => {
		expect(gradeSingleChoice("b", "a")).toBe(0);
	});
	test("case-insensitive", () => {
		expect(gradeSingleChoice("A", "a")).toBe(4);
		expect(gradeSingleChoice("a", "A")).toBe(4);
	});
	test("trims whitespace", () => {
		expect(gradeSingleChoice(" a ", "a")).toBe(4);
	});
	test("null user answer returns 0", () => {
		expect(gradeSingleChoice(null, "a")).toBe(0);
	});
});

// ── gradeMultiChoice ──────────────────────────────────────────────────────────

describe("gradeMultiChoice", () => {
	test("exact match returns 4", () => {
		expect(gradeMultiChoice(["a", "c"], ["a", "c"])).toBe(4);
	});
	test("order does not matter", () => {
		expect(gradeMultiChoice(["c", "a"], ["a", "c"])).toBe(4);
	});
	test("missing answer returns 0", () => {
		expect(gradeMultiChoice(["a"], ["a", "c"])).toBe(0);
	});
	test("extra answer returns 0", () => {
		expect(gradeMultiChoice(["a", "b", "c"], ["a", "c"])).toBe(0);
	});
	test("completely wrong returns 0", () => {
		expect(gradeMultiChoice(["b", "d"], ["a", "c"])).toBe(0);
	});
	test("case-insensitive", () => {
		expect(gradeMultiChoice(["A", "C"], ["a", "c"])).toBe(4);
	});
	test("empty correct answer set returns 0", () => {
		expect(gradeMultiChoice([], [])).toBe(0);
	});
});

// ── gradeOrdering ─────────────────────────────────────────────────────────────

describe("gradeOrdering", () => {
	test("correct order returns 4", () => {
		expect(gradeOrdering(["a", "b", "c"], ["a", "b", "c"])).toBe(4);
	});
	test("wrong order returns 0", () => {
		expect(gradeOrdering(["b", "a", "c"], ["a", "b", "c"])).toBe(0);
	});
	test("case-insensitive", () => {
		expect(gradeOrdering(["A", "B", "C"], ["a", "b", "c"])).toBe(4);
	});
	test("empty user answer returns 0", () => {
		expect(gradeOrdering([], ["a", "b"])).toBe(0);
	});
	test("partial match returns 0", () => {
		expect(gradeOrdering(["a", "b"], ["a", "b", "c"])).toBe(0);
	});
});

// ── gradeExactMatch ───────────────────────────────────────────────────────────

describe("gradeExactMatch", () => {
	test("exact match returns 4", () => {
		expect(gradeExactMatch("hello", ["hello"])).toBe(4);
	});
	test("case-insensitive by default", () => {
		expect(gradeExactMatch("Hello", ["hello"])).toBe(4);
		expect(gradeExactMatch("HELLO", ["hello"])).toBe(4);
	});
	test("wrong answer returns 0", () => {
		expect(gradeExactMatch("world", ["hello"])).toBe(0);
	});
	test("accepts any of multiple correct answers", () => {
		expect(gradeExactMatch("hi", ["hello", "hi", "hey"])).toBe(4);
	});
	test("accent-stripped comparison (case-insensitive)", () => {
		expect(gradeExactMatch("cafe", ["café"])).toBe(4);
		expect(gradeExactMatch("cafe", ["CAFÉ"])).toBe(4);
	});
	test("case-sensitive mode: exact match", () => {
		expect(gradeExactMatch("Hello", ["Hello"], true)).toBe(4);
	});
	test("case-sensitive mode: wrong case returns 0", () => {
		expect(gradeExactMatch("hello", ["Hello"], true)).toBe(0);
	});
	test("case-sensitive mode: accent-stripped match still works", () => {
		expect(gradeExactMatch("cafe", ["cafe"], true)).toBe(4);
		expect(gradeExactMatch("cafe", ["café"], true)).toBe(4);
	});
	test("trims whitespace", () => {
		expect(gradeExactMatch("  hello  ", ["hello"])).toBe(4);
	});
	test("non-array correct answer", () => {
		expect(gradeExactMatch("hello", "hello")).toBe(4);
		expect(gradeExactMatch("world", "hello")).toBe(0);
	});
});

// ── gradeResponse ─────────────────────────────────────────────────────────────

describe("gradeResponse", () => {
	test("dispatches singleChoice", () => {
		expect(gradeResponse("singleChoice", "a", "a")).toBe(4);
		expect(gradeResponse("singleChoice", "b", "a")).toBe(0);
	});
	test("dispatches multiChoice", () => {
		expect(gradeResponse("multiChoice", ["a", "b"], ["a", "b"])).toBe(4);
	});
	test("dispatches ordering", () => {
		expect(gradeResponse("ordering", ["a", "b"], ["a", "b"])).toBe(4);
	});
	test("dispatches exactMatch with caseSensitive option", () => {
		expect(gradeResponse("exactMatch", "Hello", ["Hello"], { caseSensitive: true })).toBe(4);
		expect(gradeResponse("exactMatch", "hello", ["Hello"], { caseSensitive: true })).toBe(0);
	});
	test("returns null for freeText", () => {
		expect(gradeResponse("freeText", "anything", "anything")).toBeNull();
	});
});

// ── gradeFreeText ─────────────────────────────────────────────────────────────

describe("gradeFreeText", () => {
	afterEach(() => jest.clearAllMocks());

	test("parses correctness from AI JSON response", async () => {
		callAI.mockResolvedValue('{"correctness": 3}');
		const score = await gradeFreeText("What is X?", "X is Y", "X is Y mostly");
		expect(score).toBe(3);
	});

	test("returns 0 if AI response is unparseable", async () => {
		callAI.mockResolvedValue("I cannot grade this.");
		const score = await gradeFreeText("What is X?", "X is Y", "???");
		expect(score).toBe(0);
	});

	test("returns 0 for out-of-range value (regex only matches 0–4)", async () => {
		callAI.mockResolvedValue('{"correctness": 5}');
		const score = await gradeFreeText("Q", "A", "A");
		expect(score).toBe(0);
	});

	test("handles correctness embedded in surrounding text", async () => {
		callAI.mockResolvedValue('Here is my assessment: {"correctness": 2}');
		const score = await gradeFreeText("Q", "A", "partial answer");
		expect(score).toBe(2);
	});

	test("throws if callAI throws", async () => {
		callAI.mockRejectedValue(new Error("subprocess failed"));
		await expect(gradeFreeText("Q", "A", "A")).rejects.toThrow("subprocess failed");
	});
});
