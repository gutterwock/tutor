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
//
// Complete = no items with priority = 0 or priority >= 154, AND at least one item exists.

describe("isSubtopicComplete", () => {
	test("returns false when subtopic has no items", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ is_passed: false }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when items are still in new/failed band (priority >= 154)", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ is_passed: false }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when items are still locked (priority = 0)", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ is_passed: false }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns true when all items have moved to revision/mastered (priority 1–153)", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ is_passed: true }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(true);
	});

	test("issues exactly one query", async () => {
		pool.query.mockResolvedValueOnce({ rows: [{ is_passed: false }] });
		await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(pool.query).toHaveBeenCalledTimes(1);
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
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: true,  has_new: false, prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("returns [] when next subtopic is already active", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: false, has_new: true,  prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("unlocks next inactive subtopic after the last completed one", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: false, completed: false, has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.3", active: false, completed: false, has_new: false, prerequisites: [] },
				],
			})
			.mockResolvedValueOnce({ rows: [] }); // UPDATE content_progress

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);

		expect(result).toEqual(["c.1.2"]);
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.2");
		// Should NOT unlock c.1.3 in same call (c.1.2 not yet active)
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledTimes(1);
	});

	test("returns [] when active subtopic still has items in new/failed band", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: false, has_new: true,  prerequisites: [] },
				{ subtopic_id: "c.1.2", active: false, completed: false, has_new: false, prerequisites: [] },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
	});

	test("unlocks next subtopic when active subtopic has no items in new/failed band (drain fallback)", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: false, has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: false, completed: false, has_new: false, prerequisites: [] },
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
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.3", active: false, completed: false, has_new: false, prerequisites: [] },
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
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_new: false, prerequisites: ["c.1.1", "c.1.2"] },
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
				{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
				{ subtopic_id: "c.1.2", active: true,  completed: false, has_new: true,  prerequisites: [] },
				{ subtopic_id: "c.2.1", active: false, completed: false, has_new: false, prerequisites: ["c.1.1", "c.1.2"] },
			],
		});

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toEqual([]);
		expect(queueModel.promoteSubtopicItems).not.toHaveBeenCalled();
	});

	test("unlocks subtopic when explicit prerequisite is drained (not completed but no new items)", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: false, has_new: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_new: false, prerequisites: ["c.1.1"] },
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
					{ subtopic_id: "c.1.1", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.1.2", active: true,  completed: true,  has_new: false, prerequisites: [] },
					{ subtopic_id: "c.2.1", active: false, completed: false, has_new: false, prerequisites: ["c.1.1"] },
					{ subtopic_id: "c.2.2", active: false, completed: false, has_new: false, prerequisites: ["c.1.2"] },
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
