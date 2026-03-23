# /review-course

Review course files in two passes: automated validation then AI content review.

**Usage:**

```
/review-course japanese-writing-systems          # whole course
/review-course japanese-writing-systems.1.1      # one subtopic
/review-course japanese-writing-systems --all    # include already-reviewed files
```

Argument: course ID or subtopic ID (with or without .md extension). If omitted, reviews all courses.

---

## Reviewed flag

Each subtopic file may have a `reviewed:` line at the very top (line 1):

```
reviewed: 2026-03-10
```

**By default, Pass 2 skips files that have this flag.** Pass 1 (script) always runs on all files regardless.

- To force re-review of already-reviewed files, the user must pass `--all`.
- After fixing all issues in a file and confirming it is clean, add or update the `reviewed:` line at the top of the file using today's date. Use the Edit tool to prepend it if absent, or update the date if already present.

---

## Pass 1 — Script validation (fast)

Run `node scripts/review-courses.js <course-id>` via Bash (add `--data-dir <path>` if courseData is not at the default location). This catches structural issues instantly:
- Answer keys not matching options
- Invalid characters in answer keys
- Missing answer keys or options
- Ordering answer length mismatches
- Duplicate questions
- Missing phase tags

Report the script output to the user. If there are errors, fix them before proceeding to Pass 2.

---

## Pass 2 — AI content review (parallel)

After Pass 1 is clean (0 errors), review file content for accuracy. This catches things the script cannot: wrong facts, bad translations, incorrect pronunciations, misleading explanations, wrong difficulty ratings.

**Skip any file whose first line starts with `reviewed:` unless `--all` was passed.**

**Launch one Agent per subtopic file** using `subagent_type: "general-purpose"` and `model: "sonnet"`. Each agent should:

1. Read its assigned subtopic file
2. Check factual accuracy of all content sections (pronunciations, translations, definitions, examples)
3. Check that each question's correct answer is actually correct
4. Check that wrong answer options are actually wrong (no ambiguous correct answers)
5. Check that difficulty ratings make sense (0 = trivial recall, 4 = synthesis/analysis)
6. Check that explanations are accurate and helpful
7. Return a short report: list of issues found (with line numbers), or "No issues found"

**Do NOT have agents check structural issues** — that's what the script does.

**Batching:** Default batch size is **3 files in parallel**. The user may override by saying e.g. "batch 5". Dispatch in batches: fire one Agent tool call per file in a single message (parallel), wait for all in the batch to complete, show a per-batch summary, then fire the next batch.

**Agent prompt template:**

```
You are reviewing a course subtopic file for factual and pedagogical accuracy. Do NOT check formatting or structural issues — only content correctness.

Read the file: {file_path}

Check:
1. Are all facts, definitions, translations, and examples correct?
2. Is each question's marked answer actually correct?
3. Are the wrong options actually wrong (no trick questions with multiple valid answers)?
4. Do difficulty ratings match the question complexity (0=recall, 1=recognition, 2=application, 3=analysis, 4=synthesis)?
5. Are explanations accurate?
6. If any question has `show_with_content: true`: verify it genuinely requires the passage to answer (data-interpretation or passage-dependent), not just a recall question that happens to follow a content block.
7. If a question is passage-dependent (cannot be answered without reading a specific table, diagram, or text excerpt), verify it has `show_with_content: true` set.

Return ONLY a list of issues with line numbers, or "No issues found" if the file is clean. Be concise.
```

After all batches complete, compile their reports and present a unified summary to the user. Offer to fix any issues found.

If all issues in a file are resolved (either "No issues found" or fixed), add or update the `reviewed: YYYY-MM-DD` line at the top of that file.

---

## Efficiency notes

- The script runs in <1s across all files — always run it first
- Agents review files in batches of 3 (default) — parallelism within each batch, controlled load overall
- Agents only read their one file — minimal token cost per agent
- If reviewing a single subtopic file, skip the agent and do the AI review directly (no need to spawn an agent for one file)
- Skipping already-reviewed files avoids redundant AI calls on clean content
