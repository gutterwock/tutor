# Syllabus File Format

One `syllabus.md` per course, defining the full course/topic/subtopic hierarchy.

```
courseData/{course-id}/syllabus.md
```

## Heading levels

- `#` — course root
- `##` — topic
- `###` — subtopic

Sort order is determined by position in the file — no explicit field needed.

## Metadata lines

Follow the heading, one key per line. List values (`prerequisites:`, `objectives:`) use `- item` lines immediately below the key.

### Course fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | Course slug, e.g. `intro-to-python` |
| `description:` | yes | Single line |
| `prerequisites:` | no | List of free-text knowledge/skill requirements |
| `exam:` | no | Exam name if this is exam prep |

### Topic fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | e.g. `intro-to-python.1` |
| `description:` | no | Single line |

### Subtopic fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | e.g. `intro-to-python.1.1` |
| `objectives:` | no | List of learning objectives |
| `prerequisites:` | no | List of subtopic IDs that must be completed first |

## Example

```markdown
# Introduction to Python
id: intro-to-python
description: Foundational Python programming for beginners with no prior experience.
prerequisites:
- Basic computer literacy

## Core Language Basics
id: intro-to-python.1
description: Variables, data types, operators, and control flow.

### Variables and Data Types
id: intro-to-python.1.1
objectives:
- Declare variables and assign values
- Identify and use Python's built-in data types

### Control Flow
id: intro-to-python.1.2
prerequisites:
- intro-to-python.1.1
objectives:
- Write if/elif/else statements
- Use for and while loops to iterate
```
