---
description: Generate a multi-course learning program outline
---

# Skill: generate-program

## Purpose

Generate a **learning program document** — an ordered plan of courses, projects, and review stages that guides a user through a structured learning journey. The document is the deliverable; the user then uses the stage descriptions to generate each course via the appropriate skill (e.g. `/generate-course`, `/generate-language-course`).

## Instructions

You are generating a learning program document. The user has provided: $ARGUMENTS

### Input Parsing

Extract the following from $ARGUMENTS:

- **goal** – what the learner wants to achieve (e.g. "become a backend engineer", "pass the AWS Security Specialty exam", "reach B2 French proficiency")
- **prior knowledge** – what the learner already knows; default to "none assumed" if not specified
- **constraints** – any constraints on scope, time, or focus (e.g. "exam-focused only", "skip theory", "include practical projects")

If the goal is ambiguous or too vague to plan meaningfully, ask one clarifying question before proceeding.

---

### Output File

Write the program document to:

```
programs/{program-id}.md
```

where `program-id` is a lowercase hyphenated slug derived from the goal (e.g. `aws-security-engineer`, `french-b2-proficiency`, `backend-engineering-foundations`).

If `programs/{program-id}.md` already exists, show the user the existing file's header and ask whether to overwrite, modify, or choose a different name.

Do not create any other files. Do not generate course content.

---

### Program Document Structure

The document must contain the following sections in order:

#### 1. Header

```markdown
# {Program Title}

**Goal:** {one-sentence statement of what the learner will achieve}
**Prerequisites:** {prior knowledge required, or "None"}
**Estimated scope:** {rough total — e.g. "6 courses, ~400 study hours, 2 projects"}
```

#### 2. Learning Outcomes

A bullet list of 4–8 concrete, measurable outcomes the learner will have on completion. Be specific — not "understand X" but "explain X", "configure Y", "diagnose Z".

#### 3. Notes (optional)

Include a `## Notes` section when there are cross-cutting concerns that apply to multiple stages. Examples:

- A category of stages has a shared philosophy (e.g. "media courses teach vocabulary, not plot")
- The format has known limitations for part of the goal (e.g. "C1+ fluency requires immersion beyond what structured courses can provide")
- Specific authoring guidance that should carry through to course generation

Omit this section entirely if there is nothing to note.

#### 4. Stages

An ordered list of stages. Each stage is one of:

**Course stage:**
```markdown
## Stage N: {Course Name}

Type: Course
Course ID: {suggested-course-id}
Scope: {1–3 sentence description of what the course covers and why it appears here}
Prerequisites: Stage M (or "Stages M, K" for multiple, or "None")
Estimated subtopics: ~N
Notes: {optional — flag if math/precision content is likely to require generator scripts per v2 plan item 5; flag if exam-specific question patterns are needed}
```

Prerequisites are advisory. The user manages course enrollment manually and may choose to ignore prerequisites or study stages concurrently when no dependency exists between them.

**Project stage:**
```markdown
## Stage N: {Project Title}

Type: Project
Scope: {what the learner builds or does — enough detail to execute without further guidance}
Prerequisites: Stage M
Estimated duration: {rough time estimate}
Outcomes: {bullet list of what the learner will have produced or demonstrated}
Notes: {optional}
```

**Review stage:**
```markdown
## Stage N: Review — {topic area}

Type: Review
Scope: Spaced repetition pass over Stages X–Y. No new material. Focus on weak areas identified during study.
Prerequisites: Stage M
```

#### 5. Course Generation Guide

A short section listing each course stage with enough description for the user to invoke the appropriate course generation skill. Do not hardcode skill names — the user will choose the right skill based on the domain.

```markdown
## Generating Courses

Generate each course stage using the description below. The user decides which skill to use (e.g. `/generate-course`, `/generate-language-course`) and whether to follow the suggested order.

1. `{course-id-1}` — {brief scope description with prerequisites}
2. `{course-id-2}` — {brief scope description with prerequisites}
...

Projects are executed independently — no course generation needed.
Review stages require no generation — use the tutor.ai study queue.
```

---

### Stage Design Principles

- **Order matters** — stages must build on each other; earlier courses provide prerequisites for later ones
- **Projects are optional** — include project stages where hands-on application would meaningfully reinforce learning; omit them for purely theoretical or exam-focused programs
- **Review stages are optional** — include review stages where consolidation of a large cluster of courses is warranted; omit for short programs or when the user has indicated exam-only focus
- **Scope per course** — each course stage should be appropriate for `/generate-course` (~10 topics, ~60 subtopics); if a subject is too broad, split it into multiple course stages
- **Flag math-heavy courses** — if a course stage is likely to involve arithmetic, algebra, statistics, or other exact numeric computation, note this in the stage's Notes field so the user knows to expect generator scripts (see v2 plan item 5)
- **Avoid redundancy** — do not repeat material across courses; be explicit in scope descriptions about what each course covers vs. excludes
- **Flag format limitations** — if part of the program's goal is unlikely to be fully achievable through structured courses alone (e.g. spoken fluency, hands-on lab skills, creative writing), say so honestly in the Notes section. State what the courses cover and what requires supplementary practice outside the platform.

---

### Interaction Flow

1. Parse input; ask one clarifying question if the goal is ambiguous
2. Check if `programs/{program-id}.md` already exists; if so, ask what to do
3. Generate the program document and write it to `programs/{program-id}.md`
4. Display a summary to the user:
   - Program ID and file path
   - Total stages (N courses, M projects, K reviews)
   - Ordered stage list with types and course IDs
   - Any flags (math-heavy stages, format limitations)
5. Ask: "Does this program look good? Reply yes to finish, or provide feedback to revise."
6. Apply revisions and re-show summary until approved
7. On approval, remind the user of the course generation guide at the end of the document

Do not proceed past step 3 without showing the user the summary.

---

### Constraints

- Write only `programs/{program-id}.md` — do not create course files, syllabus files, or any other files
- Do not run `/generate-course` or any other skill — the program document is the output
- `programs/` directory may not exist; create it if needed
- Keep stage descriptions concise — this is a planning document, not course content
- Suggested course IDs must be valid slugs (lowercase, hyphens only)

---

## Examples

```
/generate-program become a backend engineer, starting from scratch
/generate-program AWS Security Specialty exam, I already have 2 years AWS experience
/generate-program French B2 proficiency, I have A2 level currently, exam-focused
/generate-program machine learning engineer, prerequisites: Python and linear algebra
```
