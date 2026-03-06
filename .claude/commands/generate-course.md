---
description: Generate a structured course (syllabus, content, questions) for the adaptive tutor platform
---

# Skill: generate-course

## Purpose

Generate a structured base course (syllabus and subtopic files) for the adaptive tutor platform. Supports creating a new course from scratch, resuming a partially generated course, or refining an existing syllabus.

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

Do not generate fields set by the upload pipeline (`id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, `question_ids`).

---

### Schema Reference

#### `syllabus.md`

Heading levels encode hierarchy. Metadata lines follow each heading. Sort order is determined by position in the file.

```markdown
# Course Name
id: {course-id}
description: Single-line description.
prerequisites:
- Prior knowledge requirement 1
- Prior knowledge requirement 2
exam: Exam name if exam-focused

## Topic Name
id: {course-id}.1
description: Optional single-line description.

### Subtopic Name
id: {course-id}.1.1
objectives:
- Specific measurable learning objective 1
- Specific measurable learning objective 2
prerequisites:
- {course-id}.1.0
```

Rules:
- `#` = course root, `##` = topic, `###` = subtopic
- `prerequisites:` on a subtopic is a list of subtopic IDs
- `objectives:` on a subtopic is a list of measurable learning objectives

#### `{subtopic-id}.md`

Each subtopic file opens with a `syllabus_id:` line, then interleaves content blocks (`##`) and question blocks (`###`).

```markdown
syllabus_id: {course-id}.1.1
# Optional Human-Readable Title

### question singleChoice difficulty:1
tags: phase:atomic
[optional ungated diagnostic question before any ## block]
a: ...
b: ...
answer: a

## [phase:atomic] Content Block Title
tags: topic-tag, another-tag

Body text. Supports full markdown including fenced blocks (Mermaid etc.).

### question singleChoice difficulty:1
tags: phase:atomic
Question text gated on the preceding ## block.
a: ...
b: ...
answer: a

### question multiChoice difficulty:2
tags: phase:atomic
...
answer: ab

## [phase:complex] Content Block Title
tags: topic-tag

Body text.

### question singleChoice difficulty:2
tags: phase:complex
...
answer: b

## [phase:integration] Content Block Title
tags: topic-tag

Body text.

### question freeText difficulty:3
tags: phase:integration
Question requiring synthesis.
answer: Sample correct response used as AI grading reference.
```

**Content block header:**
```
## [phase:atomic|complex|integration] Title
```
Optional metadata lines before the blank line that separates them from the body:
- `tags:` — comma-separated topic/skill tags (phase is in heading, omit here)
- `type:` — omit for text (default); `image`/`audio`/`video` for media (currently disabled — use text only)
- `meta.<key>:` — arbitrary metadata (e.g. `meta.word:`, `meta.pinyin:` for vocabulary cards)

**Question block header:**
```
### question <type> [caseSensitive] difficulty:<n>
```
- `type` — `singleChoice`, `multiChoice`, `ordering`, `freeText`, `exactMatch`
- `caseSensitive` — optional flag for `exactMatch` only
- `difficulty` — integer 0–4

Tags line (required): `tags: phase:atomic, optional-tag`

Options: bare `key: text` lines before `answer:`. 2–5 options keyed `a`–`e`. Omit for `freeText` and `exactMatch`.

Answer:
- `singleChoice` — `answer: b`
- `multiChoice` — `answer: abc` (concatenated, no separator)
- `ordering` — `answer: bcad` (correct sequence)
- `freeText` — `answer: Sample correct response`
- `exactMatch` — one `answer:` line per accepted string

Explanation (optional, use sparingly):
- `explanation: Brief explanation shown after answering.` — only for genuinely counterintuitive answers or common-misconception traps. Most questions should not have one.

**content→question linking:**
- A `###` question gates on the nearest preceding `##` content block
- A `###` before any `##` is ungated (`content_ids: []`) — used for diagnostics

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

**Ordering** – group by phase, atomic through integration. Within each phase, content precedes its questions:

```
[optional ungated diagnostic questions]
phase:atomic content and questions
phase:complex content and questions
phase:integration content and questions
```

**Question variety** – mix `singleChoice` variants (true/false, assertion/reason, best-answer, exception-based), `multiChoice`, `ordering`, `freeText`, and `exactMatch` as appropriate. No fixed percentages — let the content drive the type.

**Syllabus design:**
- Topic ordering in the file specifies the logical learning sequence
- Subtopic `prerequisites:` lists subtopic IDs that must be completed first
- Include a cross-topic integration topic at the end where possible
- If exam-focused, include exam-specific question patterns (timing, format, trick options)

---

### Progress Detection

**When resuming an existing course:**

1. **Check `syllabus.md`:**
   - Missing → start from Step 1
   - Present → parse to get the full list of subtopic IDs

2. **Check for subtopic files:**
   - List all `{subtopic-id}.md` files that exist under `courseData/{course-id}/`
   - Identify which subtopics are done vs missing

3. **Report to user:**
   ```
   Existing course: spanish-a2
   - Syllabus: ✅ Complete (4 topics, 12 subtopics)
   - Subtopics: ⚠️  Partial — 5/12 done (Topic 1 complete, Topics 2-4 pending)

   What would you like to do?
   - [A] Continue from Topic 2
   - [B] Regenerate Topic 1
   - [C] Regenerate a specific subtopic
   - [D] Other
   ```

---

### Step 1 — Syllabus (Generate or Review)

**If no syllabus exists:**
1. Generate `courseData/{course-id}/syllabus.md` in the format above
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

**Before starting:**
1. Check which `{subtopic-id}.md` files already exist
2. Show the user which topics are done and which are pending
3. Identify the first pending subtopic

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

Each subagent receives this prompt (fill in `{}` placeholders):

> Generate one subtopic file for the adaptive learning platform.
>
> 1. Read `.claude/commands/generate-course.md` — your schema and content principles reference.
> 2. Read `courseData/{course-id}/syllabus.md` — course context.
> 3. Generate the subtopic file for **{subtopic-id}** ({subtopic name}). Objectives: {list objectives from syllabus}
> 4. Write to `courseData/{course-id}/{subtopic-id}.md`.
>
> Return only: `✅ {subtopic-id} written` or `❌ {subtopic-id} failed: {reason}`

**After each batch completes:**
- Show a per-batch summary: files written, any failures
- Continue with the next batch automatically until the boundary is reached
- If topics beyond the boundary remain, ask what to do next

**Progress tracking:**
- On resumption, show progress (e.g. "Topics 1–2 done, starting Topic 3")
- Never overwrite existing files unless the user explicitly requested regeneration

---

### Specialization Note

This skill generates a **generic course**. For specialized domains (e.g. language learning, certification exams), a separate skill should inherit from this one and override relevant behaviour.

---

### Constraints

- Do not generate `id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, or `question_ids` — set by the upload pipeline
- Do not modify files outside `courseData/`
- Only generate `type: text` content (multimodal disabled — omit the `type:` line entirely)
- `syllabus_id` in each subtopic file must be the subtopic's ID (e.g. `spanish-a2.1.1`)
- Every subtopic must have content and questions in all three phases
- Before overwriting existing files, offer to back them up with a timestamped copy (e.g. `{subtopic-id}.md.backup.20240115`)
- If regenerating a specific topic, do not touch other topics' files

---

### Resume Syntax

```
# Resume from where it left off
/generate-course spanish-a2 resume

# Resume from a specific topic
/generate-course spanish-a2 from topic 2

# Regenerate a specific topic (overwrite existing subtopic files for that topic)
/generate-course spanish-a2 regenerate topic 1

# Regenerate specific topics
/generate-course spanish-a2 regenerate topics 2, 4, 5

# Regenerate a single subtopic file
/generate-course spanish-a2 regenerate subtopic spanish-a2.2.3

# Modify existing syllabus
/generate-course spanish-a2 revise syllabus
```

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
