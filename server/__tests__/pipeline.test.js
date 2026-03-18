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
		pool.query.mockResolvedValueOnce({ rows: [] }); // no content rows
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when some content has not been viewed", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ id: "c1", viewed: true },
				{ id: "c2", viewed: false },
			],
		});
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
		// Should not query responses — short-circuits
		expect(pool.query).toHaveBeenCalledTimes(1);
	});

	test("returns false when all content viewed but no responses", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: "c1", viewed: true }] }) // content
			.mockResolvedValueOnce({ rows: [{ response_count: "0", avg_correctness: null }] }); // scores
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns false when avg correctness below threshold (2.5)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: "c1", viewed: true }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "5", avg_correctness: 2.0 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});

	test("returns true when all content viewed and avg correctness >= 2.5", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: "c1", viewed: true }, { id: "c2", viewed: true }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "8", avg_correctness: 3.2 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(true);
	});

	test("returns true at exact threshold (2.5)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: "c1", viewed: true }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "3", avg_correctness: 2.5 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(true);
	});

	test("returns false just below threshold (2.49)", async () => {
		pool.query
			.mockResolvedValueOnce({ rows: [{ id: "c1", viewed: true }] })
			.mockResolvedValueOnce({ rows: [{ response_count: "3", avg_correctness: 2.49 }] });
		const result = await isSubtopicComplete(USER_ID, SUBTOPIC);
		expect(result).toBe(false);
	});
});

// ── unlockNextForCourse ───────────────────────────────────────────────────────

describe("unlockNextForCourse", () => {
	test("returns null when no subtopics exist", async () => {
		pool.query.mockResolvedValueOnce({ rows: [] });
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toBeNull();
	});

	test("returns null when all subtopics are completed", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true },
				{ subtopic_id: "c.1.2", active: true,  completed: true },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toBeNull();
	});

	test("returns null when next subtopic is already active", async () => {
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: true },
				{ subtopic_id: "c.1.2", active: true,  completed: false },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toBeNull();
	});

	test("unlocks next inactive subtopic after the last completed one", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true },
					{ subtopic_id: "c.1.2", active: false, completed: false },
					{ subtopic_id: "c.1.3", active: false, completed: false },
				],
			})
			.mockResolvedValueOnce({ rows: [] }); // UPDATE content_progress

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);

		expect(result).toBe("c.1.2");
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.2");
		// Should NOT unlock c.1.3 in same call
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledTimes(1);
	});

	test("unlocks correctly when first subtopic is not completed", async () => {
		// Nothing completed yet — next after index -1 is index 0, which is already active
		pool.query.mockResolvedValueOnce({
			rows: [
				{ subtopic_id: "c.1.1", active: true,  completed: false },
				{ subtopic_id: "c.1.2", active: false, completed: false },
			],
		});
		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		// next after lastCompleted=-1 is index 0 = c.1.1, which is already active → null
		expect(result).toBeNull();
	});

	test("skips already-completed subtopics correctly when last completed is not last in list", async () => {
		pool.query
			.mockResolvedValueOnce({
				rows: [
					{ subtopic_id: "c.1.1", active: true,  completed: true },
					{ subtopic_id: "c.1.2", active: true,  completed: true },
					{ subtopic_id: "c.1.3", active: false, completed: false },
				],
			})
			.mockResolvedValueOnce({ rows: [] });

		const result = await unlockNextForCourse(USER_ID, COURSE_ID);
		expect(result).toBe("c.1.3");
		expect(queueModel.promoteSubtopicItems).toHaveBeenCalledWith(USER_ID, "c.1.3");
	});
});
