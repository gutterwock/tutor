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

Before generating anything, assess whether the subject is appropriately scoped for a single course.

**Size limit guidelines (guidelines only, not hard limits):**
- ~10 topics
- ~60 subtopics
- ~1000 content blocks
- ~1000 questions
- ~100 hours of study time

If the subject is too broad, prompt the user with three options:
1. **Split** – provide suggested sub-courses and let them pick which to generate
2. **Reduce** – proceed with a reduced scope (explain what will be excluded)
3. **Proceed anyway** – generate the full course despite the size

---

### Output File Structure

Determine the course ID as a lowercase hyphenated slug from the subject (e.g. `aws-security-specialty`, `spanish-a2`, `econ-101`).

Write all files under `courseData/{course-id}/`:

```
courseData/{course-id}/
  syllabus.md                  # course/topic/subtopic hierarchy
  {subtopic-id}.md             # one file per subtopic — content blocks and questions interleaved
```

Content and questions are **colocated** in the subtopic file — there are no separate `content/` or `questions/` directories. Each subtopic is generated in a single pass.

---

### Schema Reference

- **Step 1 (syllabus):** Read `docs/syllabus-file-format.md`
- **Review loop (first sample subtopic):** Read `docs/subagent-format-reference.md`

---

### Core Principles

**Learning phases** – all content blocks and questions must carry a phase tag. Every subtopic must have content and questions in all three phases.

| Phase | Content covers | Question types | Typical difficulty |
|---|---|---|---|
| atomic | Terms, definitions, vocab, facts, formulas, basic rules | Recall, true/false, exactMatch, fill-in-blank | 0–1 |
| complex | Relationships, processes, scenarios, comparisons | Application, scenario-based, multi-step | 2–3 |
| integration | Synthesis, cross-topic analysis, trade-offs, case studies | freeText, assertion/reason, case studies | 3–4 |

**Microlearning** – each content block must be self-contained and consumable in isolation.

- **Atomic blocks must be maximally granular** — one concept, one fact, one definition, or one rule per block. If a block covers a topic with multiple distinct parts (e.g. a table of 5+ fields, a list of 4+ configuration options, a comparison of 3+ items), split it into separate blocks, one per part or logical group of 2–3 closely related parts. The test: if you could write a separate quiz question for each part, they should be separate content blocks.
- Complex and integration blocks may be longer since they cover scenarios and relationships that require context, but still prefer splitting when sections are independently teachable.
- Aim for **12–20 atomic content blocks per subtopic**. Fewer than 10 suggests blocks are too coarse.

**Ordering** – group by phase (atomic → complex → integration). Within each phase, content precedes its questions. Optional ungated diagnostics may appear before any content block.

**Question variety** – mix `singleChoice` variants (true/false, assertion/reason, best-answer, exception-based), `multiChoice`, `ordering`, `freeText`, and `exactMatch` as appropriate. No fixed percentages — let the content drive the type.

**Syllabus design:**
- Topic ordering in the file specifies the logical learning sequence
- Subtopic `prerequisites:` lists subtopic IDs that must be completed first
- Include a cross-topic integration topic at the end where possible
- If exam-focused, include exam-specific question patterns (timing, format, trick options)

---

### Step 1 — Syllabus (Generate or Review)

**If no syllabus exists:**
1. Generate `courseData/{course-id}/syllabus.md` per `docs/syllabus-file-format.md`
2. Pause and show the user:
   - The course ID and name
   - A tree view of topics and subtopics
   - Approximate content block and question counts per topic
   - Any scope concerns
   - Key learning objectives per topic
3. Ask: "Does this syllabus look good? Reply yes to continue to subtopic generation, or provide feedback to revise."
4. Do not proceed to Step 2 until the user approves

**If syllabus exists:**
1. Load and parse `courseData/{course-id}/syllabus.md`
2. Show the user the existing structure
3. Ask if they want to keep and continue, modify, or regenerate (backup old if regenerating)

---

### Step 2 — Subtopic Files (Generate or Resume)

Each subtopic file contains both content blocks and questions — generate together in a single pass.

**Review loop (before bulk generation):**

Generate the first pending subtopic inline (in this conversation) and show it to the user. Then ask:

> "Show another sample, or proceed? Options: **proceed** (all remaining), **proceed till topic N**, **proceed for N more topics**. Add **batch N** to change parallelism (default: 3)."

- **"another"** → generate the next pending subtopic inline and repeat
- **"proceed [qualifier]"** → parse boundary, dispatch subagents (below)

**Boundary parsing:**
- `proceed` / no qualifier → all remaining subtopics
- `proceed till topic N` / `proceed to topic N` → up to and including topic N
- `proceed for N more topics` → the next N topics from current position

**Subagent dispatch:**

Default batch size is **3 subtopics in parallel**. The user may override this at any time by saying e.g. "batch 5" or "batch 1". Parse any `batch N` instruction and use that batch size for the current and future dispatches in the session.

Collect all remaining subtopic IDs within the boundary (excluding already-written files and those generated in the review loop). Dispatch in batches of the current batch size: fire one Agent tool call per subtopic in a single message (parallel), wait for all to complete, then fire the next batch.

Each subagent should use `model: "sonnet"`. Each subagent receives this prompt (fill in `{}` placeholders — the orchestrator extracts these from the already-loaded syllabus, no file read needed by the subagent):

> Generate one subtopic file for the adaptive learning platform.
>
> **Format specs:** Read `docs/subagent-format-reference.md`.
>
> **Subtopic context:**
> Course: {course-id} — {course name}
> Topic: {topic name}
> Subtopic: {subtopic-id} — {subtopic name}
> Prerequisites: {prerequisite subtopic IDs, or "none"}
> Objectives:
> {- objective 1}
> {- objective 2}
>
> **Content rules:**
> - Atomic blocks: maximally granular — one concept/fact/definition per block. Target 12–20 per subtopic.
> - Every subtopic must have content and questions in all three phases (atomic/complex/integration).
> - Mix question types (singleChoice, multiChoice, ordering, freeText, exactMatch).
> - Use `explanation:` sparingly — only for counterintuitive answers.
> - Do not generate `id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, or `question_ids`.
>
> Write to `courseData/{course-id}/{subtopic-id}.md`.
> Return only: `✅ {subtopic-id} written` or `❌ {subtopic-id} failed: {reason}`

**After each batch completes:**
- Show a per-batch summary: files written, any failures
- Continue with the next batch automatically until the boundary is reached
- If topics beyond the boundary remain, ask what to do next

**Progress tracking:**
- On resumption, show progress (e.g. "Topics 1–2 done, starting Topic 3")
- Never overwrite existing files unless the user explicitly requested regeneration

---

### Constraints

- Do not modify files outside `courseData/`
- Multimodal disabled — omit the `type:` line in content block headers (text only)
- Before overwriting existing files, offer to back them up
- If regenerating a specific topic, do not touch other topics' files

---

## Examples

### Creating a new course

```
/generate-course Spanish A2 proficiency, prerequisites: Spanish A1
/generate-course AWS Security Specialty cert, exam: AWS Security Specialty, only care about passing
/generate-course Econ 101, no prerequisites
/generate-course "French B2" prerequisites="French B1" exam="DELF B2"
```

### Resuming a partially generated course

```
/generate-course spanish-a2 resume
/generate-course aws-security-specialty from topic 3
/generate-course french-b2 regenerate topic 2
/generate-course french-b2 regenerate subtopic french-b2.3.1
```
