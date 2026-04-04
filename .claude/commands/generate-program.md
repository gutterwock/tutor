---
description: Generate a multi-course learning program outline
---

# Skill: generate-program

## Instructions

You are generating a learning program document. The user has provided: $ARGUMENTS

1. **Ask for program name:** Prompt the user for the program name (will become `program-NAME` folder). If not provided in $ARGUMENTS, ask directly. Convert to lowercase hyphenated slug for the program-id.

2. **Extract program details:** Get **goal** (what to achieve), **prior knowledge** (default: "none assumed"), **constraints** (scope/time/focus limits). Ask one clarifying question if the goal is too vague.

---

### Output

Write to `courseData/{program-id}/program.md` (lowercase hyphenated slug). The program-id becomes the **group folder** under `courseData/` — courses generated for this program will be written to `courseData/{program-id}/{course-id}/`. If the file exists, ask: overwrite, modify, or rename. Create the directory if needed. Do not generate course content.

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

- **Course:** `Type: Course`, `Course ID: {program-id}/{course-id}`, `Scope:` (1–3 sentences), `Prerequisites: Stage N` (advisory), `Estimated subtopics: ~N`, `Notes:` (optional)
- **Project:** `Type: Project`, `Scope:` (enough detail to execute), `Prerequisites:`, `Estimated duration:`, `Outcomes:` (bullet list)
- **Review:** `Type: Review`, `Scope: Spaced repetition over Stages X–Y`, `Prerequisites:`

**5. Course Generation Guide:** List each course stage with the full nested path (`{program-id}/{course-id}`), scope, and prerequisites. User picks the skill (`/generate-course {program-id}/{course-id}`, `/generate-language-course {program-id}/{course-id}`). Projects/reviews need no generation.

---

### Design Principles

- Stages build on each other; earlier courses are prerequisites for later ones
- Projects/reviews are optional — include when they add value
- Each course ≤ ~10 topics, ~60 subtopics; split broader subjects into multiple courses
- No redundancy across courses; be explicit about scope boundaries
- Flag limitations honestly in Notes

---

### Interaction Flow

1. **Ask for program name** if not provided in arguments; convert to lowercase hyphenated slug for program-id
2. Check if `courseData/{program-id}/program.md` exists; ask if found (overwrite/rename/modify)
3. Gather program details: goal, prior knowledge, constraints; ask clarifying question if ambiguous
4. Generate and write the document to `courseData/{program-id}/program.md`
5. Show summary: program ID, stage counts, ordered list, any flags
6. Ask for approval; revise until approved
7. On approval, remind user to generate courses with `/generate-course {program-id}/{course-id}`
