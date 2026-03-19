/**
 * Tests for services/pipeline.js
 *
 * Mocks the pg pool and queueModel so no database is required.
 */

jest.mock("../src/config/db", () => ({ query: jest.fn() }));
jest.mock("../src/models/queueModel", () => ({
	promoteSubtopicItems: jest.fn().mockResolvedValue(undefined),
}));

const pool = require("../src/config/db");
const queueModel = require("../src/models/queueModel");
const {
	isSubtopicComplete,
	unlockNextForCourse,
} = require("../src/services/pipeline");

const USER_ID    = "user-uuid-1";
const SUBTOPIC   = "course.1.1";
const COURSE_ID  = "course";

afterEach(() => jest.clearAllMocks());

// ── isSubtopicComplete ────────────────────────────────────────────────────────

describe("isSubtopicComplete", () => {
	test("returns false when subtopic has no active content", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ total: "0", viewed: "0" }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when some content has not been viewed", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ total: "2", viewed: "1" }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
		// Should not query responses — short-circuits
		expect(pool.query).toHaveBeenCalledTimes(1);
	});

	test("returns false when all content viewed but no responses", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ total: "1", viewed: "1" }] }) // content
			.mockResolvedValueOnce({ rows: [{ response_count: "0", avg_correctness: null }] }); // scores
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when avg correctness below threshold (2.5)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ total: "1", viewed: "1" }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "5", avg_correctness: 2.0 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns true when all content viewed and avg correctness >= 2.5", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ total: "2", viewed: "2" }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "8", avg_correctness: 3.2 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(true);
	});

	test("returns true at exact threshold (2.5)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ total: "1", viewed: "1" }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "3", avg_correctness: 2.5 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(true);
	});

	test("returns false just below threshold (2.49)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ total: "1", viewed: "1" }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "3", avg_correctness: 2.49 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});
});

// ── unlockNextForCourse ───────────────────────────────────────────────────────

describe("unlockNextForCourse", () => {
	// ── linear (no prerequisites) ─────────────────────────────────────────────

	test("returns [] when no subtopics exist", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("returns [] when all subtopics are completed", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("returns [] when next subtopic is already active", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: false, has_tier3: true,  prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("unlocks next inactive subtopic after the last completed one", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: false, completed: false, has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.3", active: false, completed: false, has_tier3: false, prerequisites: [] },
				],
			})
			.mockResolvedValueOnce({ rows: [] }); // UPDATE content_progress

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);

		expect(result).toEqual(["c.1.2"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.2");
		// Should NOT unlock c.1.3 in same call (c.1.2 not yet active)
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledTimes(1);
	});

	test("returns [] when active subtopic still has tier 3 items", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: false, has_tier3: true,  prerequisites: [] },
				{ subtopic_id: "c.1.2", active: false, completed: false, has_tier3: false, prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("unlocks next subtopic when active subtopic has no tier 3 items (drain fallback)", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: false, has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: false, completed: false, has_tier3: false, prerequisites: [] },
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual(["c.1.2"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.2");
	});

	test("unlocks when two consecutive subtopics are completed", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.3", active: false, completed: false, has_tier3: false, prerequisites: [] },
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual(["c.1.3"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.3");
	});

	// ── explicit prerequisites ────────────────────────────────────────────────

	test("unlocks subtopic when all explicit prerequisites are completed", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_tier3: false, prerequisites: ["c.1.1", "c.1.2"] },
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual(["c.2.1"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.2.1");
	});

	test("does not unlock subtopic when an explicit prerequisite is not passed", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: false, has_tier3: true,  prerequisites: [] },
				{ subtopic_id: "c.2.1", active: false, completed: false, has_tier3: false, prerequisites: ["c.1.1", "c.1.2"] },
			],
		});

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
		expect(queueModel.promoteSubtopicItems).not.toHaveBeenCalled();
	});

	test("unlocks subtopic when explicit prerequisite is drained (not completed but no tier 3)", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: false, has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_tier3: false, prerequisites: ["c.1.1"] },
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual(["c.2.1"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.2.1");
	});

	test("unlocks multiple subtopics in parallel when their prerequisites are independently met", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_tier3: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_tier3: false, prerequisites: ["c.1.1"] },
					{ subtopic_id: "c.2.2", active: false, completed: false, has_tier3: false, prerequisites: ["c.1.2"] },
				],
			})
			.mockResolvedValueOnce({ rows: [] }) // UPDATE c.2.1
			.mockResolvedValueOnce({ rows: [] }); // UPDATE c.2.2

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual(["c.2.1", "c.2.2"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.2.1");
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.2.2");
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledTimes(2);
	});
});
