/**
 * Tests for models/queueModel.js
 *
 * Pure utility functions (bandOf, nextPriority) are tested without mocking.
 * DB-dependent functions mock the pg pool.
 */

jest.mock("../src/config/db", () => ({ query: jest.fn() }));

const pool = require("../src/config/db");
const {
	bandOf,
	nextPriority,
	transitionQuestionTier,
	consumeContent,
	insertLocked,
} = require("../src/models/queueModel");

afterEach(() => jest.clearAllMocks());

// ── bandOf ────────────────────────────────────────────────────────────────────

describe("bandOf", () => {
	test("0 → locked", () => { expect(bandOf(0)).toBe("locked"); });
	test("1 → jail", () => { expect(bandOf(1)).toBe("jail"); });

	test("mastered boundaries", () => {
		expect(bandOf(2)).toBe("mastered");
		expect(bandOf(4)).toBe("mastered");
	});
	test("revision bottom boundaries", () => {
		expect(bandOf(5)).toBe("rev_bot");
		expect(bandOf(53)).toBe("rev_bot");
	});
	test("revision middle boundaries", () => {
		expect(bandOf(54)).toBe("rev_mid");
		expect(bandOf(103)).toBe("rev_mid");
	});
	test("revision top boundaries", () => {
		expect(bandOf(104)).toBe("rev_top");
		expect(bandOf(153)).toBe("rev_top");
	});
	test("new band boundaries", () => {
		expect(bandOf(154)).toBe("new");
		expect(bandOf(253)).toBe("new");
	});
	test("254 → failed_q", () => { expect(bandOf(254)).toBe("failed_q"); });
	test("255 → failed_c", () => { expect(bandOf(255)).toBe("failed_c"); });
});

// ── nextPriority ──────────────────────────────────────────────────────────────

describe("nextPriority", () => {
	function runMany(fn) {
		return Array.from({ length: 30 }, fn);
	}

	test("fail from any band → 254", () => {
		for (const p of [2, 3, 4, 20, 80, 130, 200, 253]) {
			runMany(() => nextPriority(p, false)).forEach((r) => expect(r).toBe(254));
		}
	});

	test("254 fail → stays 254", () => {
		runMany(() => nextPriority(254, false)).forEach((r) => expect(r).toBe(254));
	});

	test("254 success → rev top (104–153)", () => {
		runMany(() => nextPriority(254, true)).forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(104);
			expect(p).toBeLessThanOrEqual(153);
		});
	});

	test("255 success → rev top (104–153)", () => {
		runMany(() => nextPriority(255, true)).forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(104);
			expect(p).toBeLessThanOrEqual(153);
		});
	});

	test("new (154–253) success → rev top (104–153)", () => {
		runMany(() => nextPriority(200, true)).forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(104);
			expect(p).toBeLessThanOrEqual(153);
		});
	});

	test("rev top (104–153) success → rev mid (54–103)", () => {
		runMany(() => nextPriority(130, true)).forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(54);
			expect(p).toBeLessThanOrEqual(103);
		});
	});

	test("rev mid (54–103) success → rev bot (4–53)", () => {
		runMany(() => nextPriority(80, true)).forEach((p) => {
			expect(p).toBeGreaterThanOrEqual(4);
			expect(p).toBeLessThanOrEqual(53);
		});
	});

	test("rev bot (5–53) success → 4 (mastered entry)", () => {
		runMany(() => nextPriority(20, true)).forEach((p) => expect(p).toBe(4));
	});

	test("mastered circulates: 4→3, 3→2, 2→4", () => {
		expect(nextPriority(4, true)).toBe(3);
		expect(nextPriority(3, true)).toBe(2);
		expect(nextPriority(2, true)).toBe(4);
	});
});

// ── transitionQuestionTier ────────────────────────────────────────────────────

describe("transitionQuestionTier", () => {
	const userId = "user-1";
	const questionId = "q-1";
	const queueId = "sq-1";

	test("success moves item to rev top (104–153)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: queueId, priority: 200 }] })
			.mockResolvedValueOnce({ rows: [] });

		await transitionQuestionTier(userId, questionId, 3);

		const newPriority = pool.query.mock.calls[1][1][0];
		expect(newPriority).toBeGreaterThanOrEqual(104);
		expect(newPriority).toBeLessThanOrEqual(153);
	});

	test("fail sends question to 254 and fires content update to 255", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: queueId, priority: 200 }] })
			.mockResolvedValueOnce({ rows: [] })  // UPDATE question → 254
			.mockResolvedValueOnce({ rows: [] }); // UPDATE prereq content → 255

		await transitionQuestionTier(userId, questionId, 1);

		const newPriority = pool.query.mock.calls[1][1][0];
		expect(newPriority).toBe(254);
		expect(pool.query).toHaveBeenCalledTimes(3);
	});

	test("does nothing if item not found in queue", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		await transitionQuestionTier(userId, questionId, 4);
		expect(pool.query).toHaveBeenCalledTimes(1);
	});
});

// ── consumeContent ────────────────────────────────────────────────────────────

describe("consumeContent", () => {
	test("moves content from new to rev top (104–153)", async () => {
		const item = { id: "sq-1", user_id: "u-1", item_id: "c-1", subtopic_id: "sub-1", priority: 200 };
		pool.query
			.mockResolvedValueOnce({ rows: [item] })
			.mockResolvedValueOnce({ rows: [] });

		const result = await consumeContent("sq-1");

		const newPriority = pool.query.mock.calls[1][1][0];
		expect(newPriority).toBeGreaterThanOrEqual(104);
		expect(newPriority).toBeLessThanOrEqual(153);
		expect(result.id).toBe("sq-1");
	});

	test("moves content from 255 to rev top (104–153)", async () => {
		const item = { id: "sq-1", user_id: "u-1", item_id: "c-1", subtopic_id: "sub-1", priority: 255 };
		pool.query
			.mockResolvedValueOnce({ rows: [item] })
			.mockResolvedValueOnce({ rows: [] });

		const result = await consumeContent("sq-1");

		const newPriority = pool.query.mock.calls[1][1][0];
		expect(newPriority).toBeGreaterThanOrEqual(104);
		expect(newPriority).toBeLessThanOrEqual(153);
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

	test("inserts items with priority 0", async () => {
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
		expect(sql).toContain(",0)");
		expect(sql).not.toContain("-1");
	});
});
