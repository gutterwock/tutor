#!/usr/bin/env node

/**
 * app/watch.js — live response watcher
 *
 * Run in a second terminal alongside the main study client:
 *   node app/watch.js
 *
 * Polls GET /responses for the current user and prints grades as they arrive.
 * freeText responses are held as pending until graded_at is set by /grade-ai,
 * then printed. All other question types are graded on submission and appear
 * within one poll cycle.
 *
 * Env vars:
 *   API_URL            API base URL (default: http://localhost:3000)
 *   WATCH_INTERVAL_MS  Poll interval in ms (default: 3000)
 */

const fs   = require("fs");
const path = require("path");

const API     = (process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");
const POLL_MS = parseInt(process.env.WATCH_INTERVAL_MS || "3000", 10);
const ID_FILE = path.join(__dirname, ".user_id");

const LABELS = ["Wrong", "Mostly wrong", "Partial", "Mostly correct", "Correct"];

// ── formatting ────────────────────────────────────────────────────────────────

function bar(n) {
	const v = Math.max(0, Math.min(4, Math.round(n)));
	return "●".repeat(v) + "○".repeat(4 - v);
}

function ts(epochMs) {
	return new Date(Number(epochMs)).toLocaleTimeString([], {
		hour: "2-digit", minute: "2-digit", second: "2-digit",
	});
}

function trunc(s, len) {
	return s && s.length > len ? s.slice(0, len - 1) + "…" : (s || "");
}

// ── API ───────────────────────────────────────────────────────────────────────

async function apiFetch(urlPath) {
	const res = await fetch(`${API}${urlPath}`);
	if (!res.ok) throw new Error(`${res.status} ${urlPath}`);
	return res.json();
}

// Cache question metadata to avoid re-fetching the same question
const qCache = new Map(); // question_id → { type, text }

async function questionMeta(id) {
	if (qCache.has(id)) return qCache.get(id);
	try {
		const q    = await apiFetch(`/questions/${encodeURIComponent(id)}`);
		const meta = { type: q.question_type ?? "?", text: trunc(q.question_text ?? "", 56) };
		qCache.set(id, meta);
		return meta;
	} catch {
		const meta = { type: "?", text: "(could not fetch question)" };
		qCache.set(id, meta);
		return meta;
	}
}

// ── display ───────────────────────────────────────────────────────────────────

//  Row layout (80-col friendly):
//    HH:MM:SS  singleChoice  ●●●●  4/4  Correct
//              Question text truncated to 56 chars…

function printResult(r, meta) {
	const time  = ts(r.graded_at ?? r.responded_at);
	const type  = (meta.type ?? "?").padEnd(12);
	const score = `${bar(r.correctness)}  ${r.correctness}/4`;
	const label = LABELS[r.correctness] ?? "?";
	console.log(`\n  ${time}  ${type}  ${score}  ${label}`);
	console.log(`            ${meta.text}`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
	if (!fs.existsSync(ID_FILE)) {
		console.error("No .user_id found. Run the main tutor client first (node app/index.js).");
		process.exit(1);
	}

	const userId = fs.readFileSync(ID_FILE, "utf8").trim();

	console.log(`\ntutor response watcher  (user: ${userId.slice(0, 8)}…)`);
	console.log(`Polling every ${POLL_MS / 1000}s — Ctrl+C to stop\n`);
	console.log("─".repeat(60));

	const seen    = new Map();  // response id → snapshot
	const pending = new Set();  // ids of ungraded freeText responses awaiting grade

	// ── baseline: mark all existing responses as seen without printing ─────────
	try {
		const initial = await apiFetch(`/responses?user_id=${encodeURIComponent(userId)}`);
		for (const r of initial) {
			seen.set(r.id, r);
			if (r.graded_at === null || r.graded_at === undefined) pending.add(r.id);
		}
		console.log(
			`\n  ${initial.length} existing response${initial.length !== 1 ? "s" : ""} skipped` +
			` — watching for new ones\n`
		);
	} catch (err) {
		console.log(`\n  Could not reach server (${err.message}) — will retry\n`);
	}

	// ── poll ──────────────────────────────────────────────────────────────────
	async function poll() {
		let responses;
		try {
			responses = await apiFetch(`/responses?user_id=${encodeURIComponent(userId)}`);
		} catch (err) {
			process.stderr.write(`[watch] poll failed: ${err.message}\n`);
			return;
		}

		const toShow = [];

		for (const r of responses) {
			const isGraded = r.graded_at !== null && r.graded_at !== undefined;

			if (!seen.has(r.id)) {
				// Brand-new response
				seen.set(r.id, r);
				if (isGraded) {
					toShow.push(r);
				} else {
					pending.add(r.id); // freeText mid-grading — wait for next poll
				}
			} else if (pending.has(r.id) && isGraded) {
				// Pending freeText that just got graded
				pending.delete(r.id);
				seen.set(r.id, r);
				toShow.push(r);
			}
		}

		// Print in chronological order (API returns newest-first)
		toShow.sort((a, b) =>
			Number(a.graded_at ?? a.responded_at) - Number(b.graded_at ?? b.responded_at)
		);

		for (const r of toShow) {
			const meta = await questionMeta(r.question_id);
			printResult(r, meta);
		}
	}

	setInterval(poll, POLL_MS);
}

main().catch((err) => {
	console.error("Fatal:", err.message);
	process.exit(1);
});
