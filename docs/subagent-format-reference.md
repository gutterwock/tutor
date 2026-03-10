# Subtopic File Format — Compact Reference

## File header

```
syllabus_id: {course-id}.N.N
# Optional Title
```

## Content block

```
## [phase:atomic|complex|integration] Title
tags: comma-separated-tags
meta.key: value        ← optional; any number of meta lines
                       ← blank line separates metadata from body
Body text. Full markdown supported. Omit `type:` line (text only).
```

## Question block

```
### question <type> [caseSensitive] difficulty:0-4
tags: phase:atomic, optional-tags
Question text. Full markdown supported.
a: option text         ← options: 2–5 keys a–e; omit for freeText/exactMatch
b: option text
answer: b              ← see answer formats below
explanation: text      ← optional; use sparingly
```

**Answer formats:**
- `singleChoice` — `answer: b`
- `multiChoice` — `answer: abc` (concatenated keys, no separator)
- `ordering` — `answer: bcad` (correct sequence, no separator)
- `freeText` — `answer: sample correct response` (AI grading reference)
- `exactMatch` — one `answer:` line per accepted string

## content→question linking

A `###` question belongs to the nearest preceding `##` block. A `###` before any `##` is ungated.

**Authoring rule — questions must be self-contained:**
- Every question must be answerable without having just read its linked content block. It tests long-term recall, not immediate reading comprehension.
- Content blocks must teach the concept broadly. They must **not** give instructions on how to answer questions or directly scaffold a linked question (e.g., avoid "note that the answer is X" or "consider the following scenario and answer below").
- If a question requires a specific passage or table to be readable (e.g., a reading-comprehension or data-interpretation question), include that passage **inside the question text itself** and place the question **before any `##` block** (ungated), not after a content block.

## Phase ordering

```
[optional ungated diagnostic questions]
phase:atomic content and questions
phase:complex content and questions
phase:integration content and questions
```

Every subtopic must have content and questions in all three phases.
