/**
 * Tests for models/queueModel.js
 *
 * Pure utility functions (tierOf, randInTier, nextPriority) are tested
 * without mocking. DB-dependent functions mock the pg pool.
 */

jest.mock("../src/config/db", () => ({ query: jest.fn() }));

const pool = require("../src/config/db");
const {
	tierOf,
	randInTier,
	nextPriority,
	transitionQuestionTier,
	consumeContent,
	insertLocked,
} = require("../src/models/queueModel");

afterEach(() => jest.clearAllMocks());

// ── tierOf ────────────────────────────────────────────────────────────────────

describe("tierOf", () => {
	test("locked returns -1", () => {
		expect(tierOf(-1)).toBe(-1);
	});
	test("tier 0 boundaries", () => {
		expect(tierOf(0)).toBe(0);
		expect(tierOf(99)).toBe(0);
	});
	test("tier 1 boundaries", () => {
		expect(tierOf(100)).toBe(1);
		expect(tierOf(199)).toBe(1);
	});
	test("tier 2 boundaries", () => {
		expect(tierOf(200)).toBe(2);
		expect(tierOf(299)).toBe(2);
	});
	test("tier 3 boundaries", () => {
		expect(tierOf(300)).toBe(3);
		expect(tierOf(399)).toBe(3);
	});
	test("tier 4 boundaries", () => {
		expect(tierOf(400)).toBe(4);
		expect(tierOf(499)).toBe(4);
	});
});

// ── randInTier ────────────────────────────────────────────────────────────────

describe("randInTier", () => {
	test.each([0, 1, 2, 3, 4])("tier %i returns value in correct range", (tier) => {
		for (let i = 0; i < 20; i++) {
			const p = randInTier(tier);
			expect(p).toBeGreaterThanOrEqual(tier * 100);
			expect(p).toBeLessThan(tier * 100 + 100);
		}
	});
});

// ── nextPriority ──────────────────────────────────────────────────────────────

describe("nextPriority", () => {
	function runMany(fn) {
		return Array.from({ length: 30 }, fn);
	}

	test("fail from any tier → tier 4 (400–499)", () => {
		for (const tier of [0, 1, 2, 3]) {
			const results = runMany(() => nextPriority(tier * 100 + 50, false));
			results.forEach((p) => {
				expect(p).toBeGreaterThanOrEqual(400);
				expect(p).toBeLessThan(500);
			});
		}
	});

	test("tier 4 success → tier 2 (200–299)", () => {
		const results = runMany(() => nextPriority(450, true));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(200);
			expect(p).toBeLessThan(300);
		});
	});

	test("tier 3 success → tier 2 (200–299)", () => {
		const results = runMany(() => nextPriority(350, true));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(200);
			expect(p).toBeLessThan(300);
		});
	});

	test("tier 2 success → tier 1 (100–199)", () => {
		const results = runMany(() => nextPriority(250, true));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(100);
			expect(p).toBeLessThan(200);
		});
	});

	test("tier 1 success → tier 0 (0–99)", () => {
		const results = runMany(() => nextPriority(150, true));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThan(100);
		});
	});

	test("tier 0 success → stays in tier 0 (0–99)", () => {
		const results = runMany(() => nextPriority(50, true));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(0);
			expect(p).toBeLessThan(100);
		});
	});

	test("tier 4 fail → tier 4 (400–499)", () => {
		const results = runMany(() => nextPriority(450, false));
		results.forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(400);
			expect(p).toBeLessThan(500);
		});
	});
});

// ── transitionQuestionTier ────────────────────────────────────────────────────

describe("transitionQuestionTier", () => {
	const userId = "user-1";
	const questionId = "q-1";
	const queueId = "sq-1";

	test("success (correctness >= 3) moves item down a tier", async () => {
		// Item is in tier 3 (priority 350)
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: queueId, priority: 350 }] }) // SELECT
			.mockResolvedValueOnce({ rows: [] });                                // UPDATE

		await transitionQuestionTier(userId, questionId, 3);

		const updateCall = pool.query.mock.calls[1];
		const newPriority = updateCall[1][0];
		expect(newPriority).toBeGreaterThanOrEqual(200);
		expect(newPriority).toBeLessThan(300);
	});

	test("fail (correctness < 3) sends item to tier 4", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: queueId, priority: 350 }] }) // SELECT
			.mockResolvedValueOnce({ rows: [] })                                // UPDATE question
			.mockResolvedValueOnce({ rows: [] });                               // UPDATE prereq content

		await transitionQuestionTier(userId, questionId, 1);

		const updateCall = pool.query.mock.calls[1];
		const newPriority = updateCall[1][0];
		expect(newPriority).toBeGreaterThanOrEqual(400);
		expect(newPriority).toBeLessThan(500);
	});

	test("does nothing if item not found in queue", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		await transitionQuestionTier(userId, questionId, 4);
		expect(pool.query).toHaveBeenCalledTimes(1); // only SELECT, no UPDATE
	});
});

// ── consumeContent ────────────────────────────────────────────────────────────

describe("consumeContent", () => {
	test("moves content item down one tier", async () => {
		const item = { id: "sq-1", user_id: "u-1", item_id: "c-1", subtopic_id: "sub-1", priority: 350 };
		pool.query
			.mockResolvedValueOnce({ rows: [item] })  // SELECT
			.mockResolvedValueOnce({ rows: [] });       // UPDATE

		const result = await consumeContent("sq-1");

		const updateCall = pool.query.mock.calls[1];
		const newPriority = updateCall[1][0];
		expect(newPriority).toBeGreaterThanOrEqual(200);
		expect(newPriority).toBeLessThan(300);
		expect(result.id).toBe("sq-1");
	});

	test("returns null if item not found", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		const result = await consumeContent("nonexistent");
		expect(result).toBeNull();
	});
});

// ── insertLocked ──────────────────────────────────────────────────────────────

describe("insertLocked", () => {
	test("does nothing for empty array", async () => {
		await insertLocked([]);
		expect(pool.query).not.toHaveBeenCalled();
	});

	test("inserts items with priority -1", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		const items = [
			{ user_id: "u1", course_id: "c1", subtopic_id: "s1", item_type: "content", item_id: "i1" },
			{ user_id: "u1", course_id: "c1", subtopic_id: "s1", item_type: "question", item_id: "i2" },
		];
		await insertLocked(items);
		expect(pool.query).toHaveBeenCalledTimes(1);
		const sql = pool.query.mock.calls[0][0];
		expect(sql).toContain("INSERT INTO study_queue");
		expect(sql).toContain("ON CONFLICT");
		expect(sql).toContain("-1");
	});
});
