# tutor

Learn stuff.

## How it works

- Generate or download structured course content
- Ingest and enroll in courses
- Learn via CLI or interactively

## Project structure

```
database/     PostgreSQL 17 + pgvector — schema auto-initialises on first start
server/       Express API server + cron adaptive engine
app/          CLI study client (Node.js, no dependencies)
docs/         Format specs for course authoring
scripts/      ingest.js, course-status.js
.claude/commands/  Custom slash commands (course generation skills)
```

## Quick start

Uses `podman`; substitute `docker` if preferred.

### 1. Start database + server

```bash
# First run: create the named volume
podman volume create tutor-db-data

# Start all services
podman compose up

# Rebuild after code or schema changes
podman compose up --build

# Stop (volume preserved)
podman compose down

# Reset DB (wipe and reinitialise)
podman compose down && podman volume rm tutor-db-data && podman volume create tutor-db-data && podman compose up
```

**For hot-reload dev** — run just the DB in a container and the server directly:

```bash
podman run --name tutor-db -p 5432:5432 -v tutor-db-data:/var/lib/postgresql/data tutor-db
cd server && npm install && npm run dev
```

### 2. Load course data

```bash
node scripts/ingest.js                              # all courses
node scripts/ingest.js some-course                  # one course (direct)
node scripts/ingest.js folder/some-course           # nested course
node scripts/ingest.js folder                       # all courses in a group
node scripts/ingest.js --dry-run                    # preview without uploading
node scripts/ingest.js --convert-only               # parse markdown → JSON (no upload)
node scripts/ingest.js --data-dir /path/to/data     # use a different courseData location
```

### 3. Study

**CLI** —

```bash
node app/index.js
```

Main menu: Study / Manage courses / Settings. Your user ID is saved in `app/.user_id`.

## Study session

- **Course picker** — multi-select at session start; defaults to last selection; paused courses excluded
- **Session composition** — `review_pct` (default 30%) of items drawn from review tiers (4/2/1/0), the rest from tier 3 (new material); gaps filled if one bucket runs short
- **Grading** — `singleChoice` / `multiChoice` / `exactMatch` graded immediately; `freeText` graded in real-time by AI (grading failure = tier 4); `ordering` graded deterministically
- **End of session** — if any subtopics are struggling, you're prompted to generate extra practice content (runs in background, appears next session)

CLI settings (`app/.settings.json`):

| Setting | Default | Behaviour |
|---------|---------|-----------|
| `session_size` | `10` | Items per session |
| `review_pct` | `30` | % of session from review tiers; remainder from tier 3 (new) |
| `last_selected_courses` | `[]` | Courses pre-selected in the course picker next session |
| `disabled_courses` | `[]` | Paused courses excluded from the picker |

## Reviewing courses

Use `/review-course` in Claude Code to validate and fact-check course files:

```
/review-course intro-to-python          # whole course
/review-course intro-to-python.1.1      # one subtopic
/review-course --all                    # all courses, including already-reviewed
```

Runs in two passes: a fast script checks structural issues (missing answers, bad option keys, duplicate questions), then AI agents review factual accuracy in parallel. Files that pass get a `reviewed: YYYY-MM-DD` stamp at the top.

## Teaching a subtopic

Use `/teach` in Claude Code to study a subtopic interactively — no server needed, works directly from the course files:

```
/teach intro-to-python.1.1
/teach languages/french-a1.2.3
```

Claude reads the subtopic file and runs a Socratic session: questions first, explanations after you've tried, Feynman checks at natural breakpoints. Works on any generated subtopic file in `courseData/`.

## Generating courses

Course source files are markdown. Use Claude Code skills to generate them, then ingest:

```
/generate-course intro-to-python
/generate-language-course french-a1
/generate-course languages/french-a1    # nested under a group folder
```

```bash
node scripts/ingest.js intro-to-python
node scripts/ingest.js languages/french-a1
```

Resume or partial regeneration:

```
/generate-course intro-to-python resume
/generate-course intro-to-python from topic 3 content
/generate-course intro-to-python regenerate topic 2
```

Check generation progress:

```bash
node scripts/course-status.js                      # all courses
node scripts/course-status.js intro-to-python
node scripts/course-status.js languages            # all in a group
```

## Generating programs

A program is a planned sequence of related courses:

```
/generate-program become a full-stack developer
```

Creates `courseData/my-program/program.md`. Then generate each course under it:

```
/generate-course my-program/course-one
/generate-course my-program/course-two
```

---

See `server/README.md` for API endpoints and environment variables, and `database/README.md` for the schema.
