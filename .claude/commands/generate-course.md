---
description: Generate a structured course (syllabus, content, questions) for the adaptive tutor platform
---

# Skill: generate-course

## Instructions

You are generating a base course for the adaptive learning platform. The user has provided: $ARGUMENTS

### Mode Detection

**Parse $ARGUMENTS to determine the mode:**

1. **Existing course patterns** (case-insensitive):
   - `{course-id} resume` → Resume from last checkpoint
   - `{course-id} from topic N` → Continue from a specific topic
   - `{course-id} regenerate topic N` or `regenerate topics N, M, K` → Overwrite specific topic(s)
   - `{course-id} regenerate subtopic {subtopic-id}` → Overwrite a single subtopic file
   - `{course-id} revise syllabus` → Modify existing syllabus

2. **New course** (no matching `courseData/{course-id}/` directory):
   - Parse the input to extract subject, prerequisites, and exam (as below)

**For new courses, extract:**
- **subject** – what the course covers (e.g. "AWS Security Specialty cert", "Spanish A2 proficiency", "Econ 101")
- **prerequisites** – prior knowledge required. Default to none if not specified.
- **exam** – whether this is for a specific exam/cert, and whether the user only cares about passing vs. deep learning. Default to null if not specified.

**For existing courses, check the state:**
1. Check if `courseData/{course-id}/syllabus.md` exists
2. Determine the mode:
   - **Syllabus-only**: `syllabus.md` exists but no subtopic files → ask if user wants to approve syllabus or modify it, then proceed to subtopic generation
   - **Partially generated**: some `{subtopic-id}.md` files exist → show progress, ask which topics to continue, skip, or regenerate
   - **Complete**: all subtopic files exist → ask if user wants to regenerate specific topics or refine

If any required input is ambiguous or missing, ask the user before proceeding.

---

### Scope Validation

Guideline limits per course: ~10 topics, ~60 subtopics, ~1000 content+question blocks. If too broad, offer: **Split** (suggest sub-courses), **Reduce** (explain exclusions), or **Proceed anyway**.

---

### Output File Structure

Course ID = lowercase hyphenated slug (e.g. `aws-security-specialty`, `spanish-a2`). Write to `courseData/{course-id}/`: `syllabus.md` + one `{subtopic-id}.md` per subtopic (content and questions colocated).

---

### Schema Reference

- **Step 1 (syllabus):** Read `docs/syllabus-file-format.md`
- **Review loop (first sample subtopic):** Read `docs/subagent-format-reference.md`

---

### Core Principles

Every subtopic must have content and questions in all three learning phases (see CLAUDE.md for definitions).

- **Atomic blocks: maximally granular** — one concept/fact/definition per block. Split multi-part blocks (5+ fields, 4+ options) into one block per part. Target **12–20 atomic blocks per subtopic**.
- Complex/integration blocks may be longer but split when independently teachable.
- **Ordering** – phase:atomic → complex → integration; content before questions within each phase.
- **Question variety** – mix singleChoice variants (true/false, assertion/reason, best-answer, exception-based), multiChoice, ordering, freeText, exactMatch.
- **Syllabus** – topic order = learning sequence; `prerequisites:` for dependencies; cross-topic integration topic at the end; exam patterns if exam-focused.

---

### Step 1 — Syllabus (Generate or Review)

**New:** Generate `courseData/{course-id}/syllabus.md` per `docs/syllabus-file-format.md`. Show tree view with topic/subtopic counts and objectives. Wait for user approval before Step 2.

**Existing:** Load and show the syllabus. Ask: keep and continue, modify, or regenerate (backup old).

---

### Step 2 — Subtopic Files (Generate or Resume)

Each subtopic file contains both content blocks and questions — generate together in a single pass.

**Review loop:** Generate the first pending subtopic inline and show the user. Ask: "Show another sample, or proceed? Options: **proceed** (all remaining), **proceed till topic N**, **proceed for N more topics**. Add **batch N** to change parallelism (default: 3)."

**Boundary parsing:** `proceed` = all remaining; `proceed till topic N` = up to topic N; `proceed for N more topics` = next N topics.

**Subagent dispatch:** Batch size default **3** (user can say "batch N"). Fire one Agent per subtopic in parallel (`model: "sonnet"`), wait for batch, show summary, continue. Never overwrite existing files unless explicitly requested.

**Subagent prompt** (fill `{}` from loaded syllabus):

> Generate one subtopic file for the adaptive learning platform.
>
> **Format specs:** Read `docs/subagent-format-reference.md`.
>
> **Subtopic:** Course: {course-id} — {course name} | Topic: {topic name} | Subtopic: {subtopic-id} — {subtopic name} | Prerequisites: {or "none"} | Objectives: {list}
>
> **Rules:** Atomic blocks: one concept per block, target 12–20. All three phases required. Mix question types. `explanation:` only for counterintuitive answers. Do not generate `id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, or `question_ids`.
>
> Write to `courseData/{course-id}/{subtopic-id}.md`. Return: `✅ {subtopic-id} written` or `❌ {subtopic-id} failed: {reason}`

---

### Constraints

- Only modify files in `courseData/`; omit `type:` line (text only); back up before overwriting; regeneration scoped to requested topics only.
