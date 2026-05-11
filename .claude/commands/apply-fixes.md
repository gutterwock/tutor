# /apply-fixes

Apply review findings to course subtopic files using Haiku. Reads `review-findings.json` and fixes each subtopic with issues.

**Usage:**

```
/apply-fixes french/french-b1-core
/apply-fixes french/french-b1-core.10.3     # single subtopic
/apply-fixes french/french-b1-core --all    # include already-reviewed subtopics
```

---

## Step 1 — Load Findings

Read `courseData/{course-ref}/review-findings.json`.

If the file does not exist, fail with: "No review-findings.json found for {course-ref}. Run `/review-course` or `/aws-review` first."

Filter to subtopics where `status === "issues"`. If a specific subtopic ID was given, scope to that one only.

Report to the user:
> {N} subtopics with issues found — applying fixes with Haiku

---

## Step 2 — Apply Fixes (parallel, batch 5)

For each subtopic with issues, launch one Haiku agent. Default batch size **5** — fire all agents in a batch in a single message, wait for completion, continue.

**Agent prompt:**
```
You are applying specific review findings to a course subtopic file. Make minimal, targeted edits — only change what the findings describe.

File: {file_path}

Findings to apply:
{findings_list}

Instructions:
- Read the file
- Apply each fix exactly as described
- Do not change anything not mentioned in the findings
- After applying fixes, add `reviewed: {today}` as the very first line of the file (before `syllabus_id:`)
- Write the corrected file back to the same path
- Report which fixes were applied and show the changed lines
```

Where `{findings_list}` is the array of finding objects formatted as a numbered list:
```
1. Block "{blockTitle}" (line ~{line}): {issue}
```

---

## Step 3 — Validate

After all batches complete, run:

```bash
node scripts/review-courses.js {course-ref}
```

Report the validation result. If errors remain, note them for the user — do not automatically re-fix.

---

## Step 4 — Summary

Report:
- How many subtopics were fixed
- Whether validation passed
- Any subtopics where validation still shows errors after fixing

Each subtopic is stamped `reviewed: YYYY-MM-DD` (today's date) immediately after its fixes are applied — one stamp per subtopic as part of the same agent write.
