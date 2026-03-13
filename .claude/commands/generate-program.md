---
description: Generate a multi-course learning program outline
---

# Skill: generate-program

## Instructions

You are generating a learning program document. The user has provided: $ARGUMENTS

Extract: **goal** (what to achieve), **prior knowledge** (default: "none assumed"), **constraints** (scope/time/focus limits). Ask one clarifying question if the goal is too vague.

---

### Output

Write to `programs/{program-id}.md` (lowercase hyphenated slug). If file exists, ask: overwrite, modify, or rename. Create `programs/` if needed. Do not generate course content.

---

### Document Structure

**1. Header:**
```markdown
# {Program Title}
**Goal:** {one sentence}
**Prerequisites:** {or "None"}
**Estimated scope:** {e.g. "6 courses, ~400 study hours, 2 projects"}
```

**2. Learning Outcomes:** 4–8 concrete, measurable outcomes (use "explain", "configure", "diagnose" — not "understand").

**3. Notes (optional):** Cross-cutting concerns: shared philosophy across stages, format limitations (e.g. "spoken fluency requires immersion beyond structured courses"), authoring guidance. Omit if nothing to note.

**4. Stages:** Ordered list. Each stage is one of:

- **Course:** `Type: Course`, `Course ID:`, `Scope:` (1–3 sentences), `Prerequisites: Stage N` (advisory), `Estimated subtopics: ~N`, `Notes:` (optional)
- **Project:** `Type: Project`, `Scope:` (enough detail to execute), `Prerequisites:`, `Estimated duration:`, `Outcomes:` (bullet list)
- **Review:** `Type: Review`, `Scope: Spaced repetition over Stages X–Y`, `Prerequisites:`

**5. Course Generation Guide:** List each course stage with ID, scope, and prerequisites. User picks the skill (`/generate-course`, `/generate-language-course`). Projects/reviews need no generation.

---

### Design Principles

- Stages build on each other; earlier courses are prerequisites for later ones
- Projects/reviews are optional — include when they add value
- Each course ≤ ~10 topics, ~60 subtopics; split broader subjects into multiple courses
- No redundancy across courses; be explicit about scope boundaries
- Flag limitations honestly in Notes

---

### Interaction Flow

1. Parse input; clarify if ambiguous
2. Check for existing file; ask if found
3. Generate and write the document
4. Show summary: program ID, stage counts, ordered list, any flags
5. Ask for approval; revise until approved
6. On approval, remind user of the generation guide
