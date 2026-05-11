# /review-course

Review and stamp course files. Runs in three passes: script validation, AI content review, and learner-sim context check.

**Usage:**

```
/review-course french-b1-core                     # whole course (all three passes + stamp)
/review-course french-b1-core phase2               # phase 2 only (review+fix+stamp subtopics)
/review-course french-b1-core phase3               # phase 3 only (learner-sim+stamp syllabus)
/review-course french-b1-core.1.1                  # one subtopic (pass 1 + 2 only; skip pass 3)
/review-course french-b1-core --all                # include already-reviewed files
/review-course french-b1-core --freetext           # freeText questions only (see below)
```

Argument: course ID or subtopic ID (with or without .md extension). If omitted, reviews all courses. Append `phase2` or `phase3` to run only that phase.

---

## Review phases

**Phase 2** (Review + Fix + Stamp subtopics):
- Pass 1: Script validation — **must reach 0 errors before proceeding**; fix all structural errors first (invalid answer keys, missing options, ordering mismatches, etc.)
- Pass 2: AI content review + fixes
- Concludes with stamping each subtopic: `reviewed: YYYY-MM-DD` (gates ingest)

**Phase 3** (Learner-sim + Stamp syllabus):
- Pass 1: Script validation — **must reach 0 errors before proceeding**; structural errors not resolved in Phase 2 must be fixed here before the learner-sim runs
- Pass 3: Sequential learner simulation (checks forward references, ordering, cross-topic context)
- Concludes with stamping the syllabus: `reviewed: YYYY-MM-DD` (gates course as complete)

Run Phase 2 first, fix all issues (Pass 1 must be clean), then run Phase 3.

---

## Reviewed flag

Each subtopic file and the syllabus may have a `reviewed:` line at the very top (line 1):

```
reviewed: 2026-03-10
```

**By default, Phase 2 skips files that have this flag.** Pass 1 (script) always runs on all files regardless.

- To force re-review of already-reviewed files, the user must pass `--all`.
- After Phase 2 fixes are applied and all issues resolved, the skill stamps each subtopic with the `reviewed:` date.
- After Phase 3 is clean (or all issues fixed), the skill stamps the syllabus file with the `reviewed:` date.

---

## Pass 1 — Script validation (fast)

Run `node scripts/review-courses.js <course-id>` via Bash (add `--data-dir <path>` if courseData is not at the default location). This catches structural issues instantly:
- Answer keys not matching options
- Invalid characters in answer keys
- Missing answer keys or options
- Ordering answer length mismatches
- Duplicate questions
- Missing phase tags

Report the script output to the user. If there are errors, fix them before proceeding.

**Phase 2:** Run Pass 1. Fix all structural errors (these come from generation bugs and are not in AWS review findings — fix manually or via `/apply-fixes`). Only proceed to Pass 2 when error count is 0.
**Phase 3:** Run Pass 1 again. Any errors here were missed in Phase 2 and must be fixed before the learner-sim runs. Do not proceed to Pass 3 with a non-zero error count.

---

## Pass 2 — AI content review (parallel, Phase 2)

After Pass 1 is clean (0 errors), review file content for accuracy. This catches things the script cannot: wrong facts, bad translations, incorrect pronunciations, misleading explanations, wrong difficulty ratings, bad distractors.

**Skip any file whose first line starts with `reviewed:` unless `--all` was passed.**

For each unreviewed subtopic file, launch **two agents in parallel** — one factual (Sonnet), one question (Haiku). They review separate concerns and must not duplicate each other's work.

**Batching:** Default **3 subtopics at a time** (= 6 agents per batch). User may override with "batch N". Fire all agents for a batch in a single message, wait for completion, show per-batch summary, continue.

---

### Factual agent (`model: "sonnet"`)

**Prompt:**
```
You are doing a factual review of a course subtopic. Check content blocks ONLY — not questions.

Read the file: {file_path}

Check each content block for:
- Factual accuracy (definitions, examples, statements all true?)
- Code correctness (sample code works as described?)
- Completeness (block covers what it claims?)
- Misleading framing (anything that could create a misconception?)

Do NOT flag: style/wording preferences, question blocks, topics outside this subtopic's scope.

Return a list of issues with line numbers, or "No issues found". Be concise.
```

---

### Question agent (`model: "haiku"`)

**Prompt:**
```
You are doing a question review of a course subtopic. Check question blocks ONLY — not content.

Read the file: {file_path}

Check each question block for:
- Answer correctness — is the marked answer actually correct?
- Distractor plausibility — are wrong options believable, not trivially wrong?
- Difficulty alignment — does the difficulty rating (0=recall, 1=comprehension, 2=application, 3=analysis, 4=synthesis) match the actual cognitive demand?
- Explanation quality — if present, is it accurate and helpful?
- freeText/exactMatch — are accepted answers complete and unambiguous?
- Meta-option wording — options referring to other options (e.g. "all of the above", "both X and Y") must use exact standard phrasings: "All of the above", "None of the above", "Both A and B", "Neither A nor B", "A, B, and C". Flag any variant.
- show_with_content — flag if missing but the question cannot be answered without the associated content block; also flag if set on a question fully answerable from knowledge alone.

Do NOT flag: content blocks, questions that are hard but fair.

Return a list of issues with line numbers, or "No issues found". Be concise.
```

---

After all batches complete, compile reports and present a unified summary. Offer to fix any issues found.

After all Pass 2 issues are fixed, stamp each subtopic with `reviewed: YYYY-MM-DD` date. Then proceed to Phase 3 (Pass 3).

---

## Pass 3 — Learner-sim review (sequential per topic, Phase 3)

Run after Phase 2 (Pass 2 fixes) is complete. Catches forward references and ordering issues that per-file review cannot see. Concludes by stamping the syllabus with `reviewed:` date.

Read `courseData/{course-id}/syllabus.md` to get the canonical topic and subtopic order. Then, for each topic, launch one agent (`model: "haiku"`) that reads all subtopic files for that topic in subtopic order. Topics run **sequentially** — each topic's output feeds the next as `priorKnowledge`.

**Skip this pass if reviewing a single subtopic** (no sequential context to evaluate).

**Agent prompt:**
```
You are simulating a learner working through a course topic. Your job is to catch forward references and ordering problems.

Prior knowledge (accumulated from all preceding topics):
{priorKnowledge}

Read these subtopic files in order:
{file_list}

As you read:
1. Maintain running notes in the form "can do X", "understands Y" — update after each content block
2. For each question block, evaluate: is this question answerable using only the notes accumulated so far?

Flag when:
- A question assumes knowledge not yet introduced (forward reference)
- A content block references a concept not yet defined
- Difficulty increases too steeply between consecutive questions
- A question is trivially easy given accumulated notes (signals redundancy)
- A question depends on its associated content block but lacks show_with_content: true
- show_with_content: true is set on a question fully answerable without the content block

Return:
1. A list of issues (file, approximate line, description) — or "No issues found"
2. A learnedSummary: bullet list of "can do X" / "understands Y" items from this topic (passed as priorKnowledge to the next topic)
```

After all topics complete, present a unified summary. The `learnedSummary` from the final topic can be discarded.

---

After Pass 3 is clean (or all issues fixed), add or update the `reviewed: YYYY-MM-DD` line at the top of the syllabus file (`courseData/{course-id}/syllabus.md`). All subtopic files should already have been stamped at the end of Phase 2.

---

## --freetext mode

When `--freetext` is passed, skip Pass 1 and the standard Pass 2 checks. Instead, do a focused review of all freeText questions across the course (or the specified subtopic).

**Collect all freeText questions** by reading each subtopic file (skip Pass 1 script). For each freeText question found, evaluate:

1. **Rubric quality** — is the `answer:` field a useful grading rubric? Flag if it is a verbose full-prose paragraph that could be reduced to key points, or if it is so vague it would produce inconsistent grading.
2. **Scope appropriateness** — does the expected response match what a learner can realistically produce at this point in the course? Consider both the course level and the topic position (early topics should not demand long production in beginner courses).
3. **Question clarity** — is it clear what the student is being asked to produce? Flag ambiguous prompts.
4. **Difficulty rating** — does the difficulty (0–4) match the cognitive load of the question?

Do this review directly (no subagents) — read all files yourself and produce a single unified report grouped by subtopic. For each issue, include the file path, line number, the question text, the current `answer:` value, and a suggested fix.

For each question flagged as too demanding for its position in the course, suggest applicable remediations — these are not mutually exclusive and all three may be appropriate together:
- **Replace** — add a simpler question covering the same concept in the current subtopic (e.g. a singleChoice or exactMatch asking for a word/form rather than free production)
- **Move** — relocate the original freeText question to a later subtopic where the learner will have enough exposure to answer it; identify the most appropriate target subtopic by name
- **Simplify** — if the question is moved, also narrow its scope at the destination (e.g. reduce expected answer to a single sentence or phrase, update the rubric accordingly)

After presenting the report, offer to apply any or all suggested remediations per question. When moving a question, remove it from its current file and append it to the target subtopic file in the appropriate phase section.

---

## Efficiency notes

**Phase 2 (Passes 1–2):**
- Pass 1 runs in <1s — always run it first; fix all structural errors before Pass 2
- Pass 2: 2 agents per subtopic × batch of 3 = 6 agents per batch; Haiku for questions keeps cost low
- Concludes with stamping subtopics (gates ingest)
- For a single subtopic: skip agents in Pass 2, review directly in this session

**Phase 3 (Passes 1 + 3):**
- Pass 1 runs in <1s — validates fixes from Phase 2; stop if errors found
- One Haiku agent per topic, sequential — cheap but must run after Phase 2 is complete
- Skip entirely if reviewing a single subtopic (no cross-topic context)
- Concludes with stamping the syllabus (gates course as complete)

**Both phases:**
- Skipping already-reviewed files avoids redundant AI calls on clean content (use `--all` to force re-review)
- Run phases sequentially: Phase 2 fully (Pass 1 → Pass 2 → stamp subtopics), then Phase 3 (Pass 1 → Pass 3 → stamp syllabus)
