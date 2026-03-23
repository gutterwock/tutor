# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tutor** is an adaptive learning platform using RAG (Retrieval-Augmented Generation) with PostgreSQL pgvector to personalize content and question delivery based on user performance. The platform generates and serves course content, tracks user responses, and uses 384-dim vector embeddings for semantic search.

## Commands

### Running locally

Commands use `podman`; substitute `docker` if preferred — they are drop-in compatible.

#### Compose (recommended — runs DB + server together)

```bash
# First run: create the named volume
podman volume create tutor-db-data

# Start both services (builds images if needed)
podman compose up

# Rebuild after code or schema changes
podman compose up --build

# Stop and remove containers (volume is preserved)
podman compose down

# Reset DB (wipe data and reinitialise schema)
podman compose down && podman volume rm tutor-db-data && podman volume create tutor-db-data && podman compose up

# Connect via psql
podman exec -it tutor-db-1 psql -U rag -d rag
```

#### DB only (for local server dev with hot-reload)

Run just the database in a container and the server directly with `npm run dev` for faster iteration:

```bash
# Start DB
podman run --name tutor-db -p 5432:5432 -v tutor-db-data:/var/lib/postgresql/data tutor-db

# Stop
podman stop tutor-db && podman rm tutor-db

# Connect via psql
podman exec -it tutor-db psql -U rag -d rag
```

Database credentials: host `localhost`, port `5432`, db/user/password all `rag`.

#### API Server (standalone)

```bash
cd server
npm install
npm start               # start server (port 3000, or $PORT)
npm run dev             # start with nodemon (auto-restart)
```

### Ingest course data

```bash
node scripts/ingest.js                              # all courses
node scripts/ingest.js intro-to-python              # one direct course
node scripts/ingest.js languages/french-a1          # nested course (group/course-id)
node scripts/ingest.js languages                    # all courses in a group
node scripts/ingest.js --dry-run                    # preview without hitting server
node scripts/ingest.js --base-url http://host:3000 <ref>
node scripts/ingest.js --convert-only               # parse markdown → JSON files in courseData/{ref}/converted/
node scripts/ingest.js --data-dir /path/to/data     # override courseData/ location (default: ./courseData)
```

Parses and uploads `courseData/` files (markdown or legacy JSON) to the running API server: syllabus first, then content and questions per subtopic. Supports both direct (`courseData/{course-id}/`) and nested (`courseData/{group}/{course-id}/`) layouts. Embeddings are generated server-side if `ENABLE_EMBEDDINGS=true` is set on the server; otherwise the `embedding` column is stored as NULL.

### Tests

```bash
cd server
npx jest                # run all tests
npx jest <file>         # run a single test file
```

Test files are in `server/__tests__/`. Current coverage: `grading.test.js` (28 tests), `queueModel.test.js` (24 tests), `pipeline.test.js` (23 tests) — 75 tests total, all passing.

## Architecture

### Components

```
database/       PostgreSQL 17 + pgvector image; schema.sql auto-runs on first start
server/         Express.js API server (Node.js) + cron adaptive engine
  __tests__/    Jest unit tests: grading.test.js, queueModel.test.js, pipeline.test.js
app/            CLI study client (Node.js, no dependencies)
courseData/     Course source files (markdown primary; legacy JSON also supported)
  {course-id}/           direct course layout
  {group}/{course-id}/   grouped layout (for program-organised courses)
docs/           Format specs for course authoring (syllabus, subtopic, content, question formats)
scripts/        ingest.js loads courseData/ into the API server; course-status.js checks generation progress
prompt/         Schema reference and API endpoint definitions for AI context
.claude/        Claude Code settings and custom slash commands (skills)
```

### API Server (`server/src/`)

- **`index.js`** — Express app with Helmet, CORS, HPP, Morgan, and rate limiting (100 req/15 min). Mounts all routes and starts the cron. JSON body limit 10 MB.
- **`routes/index.js`** — All API endpoints wired to controllers.
- **`config/db.js`** — `pg.Pool`. Env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (all default to `rag`).
- **`services/embedding.js`** — `@huggingface/transformers`, `Xenova/all-MiniLM-L6-v2` (384-dim). Lazy-loaded. Disabled by default; set `ENABLE_EMBEDDINGS=true` to activate (downloads ~90 MB model on first call). The package is an **optional dependency** — not installed by default. To use embeddings: `npm install --include=optional` in `server/`, or build the Docker image with `--build-arg ENABLE_EMBEDDINGS=true`. Exports `generateEmbedding`, `generateEmbeddings`, `pgVector`.
- **`services/ai.js`** — AI dispatch abstraction. `callAI(prompt)` spawns `claude --model $AI_MODEL -p` as a subprocess (local mode). Cloud mode is a TODO stub. Controlled by `AI_MODE` env var (default: `local`); model by `AI_MODEL` (default: `claude-haiku-4-5-20251001`).
- **`services/grading.js`** — All grading logic: deterministic (`gradeSingleChoice`, `gradeMultiChoice`, `gradeOrdering`) and AI-based (`gradeFreeText` — calls `callAI`). Used by the response controller, cron, and `grade-ai` endpoint.
- **`services/adaptiveGenerator.js`** — Adaptive content/question generation for struggling subtopics. Fetches context + recent wrong answers, calls `callAI`, parses JSON response, persists items as `base_content=false`. Runs once per subtopic (guards against re-triggering). Called via `POST /generate-adaptive` at the user's prompt at session end.
- **`services/cron.js`** — Adaptive engine. Runs on `setInterval` (default 60s). Per-user pipeline: grade ungraded responses → check subtopic completion → unlock next subtopics → detect regression on completed subtopics. Concurrency-safe: skips a tick if the previous one is still running. Acts as fallback grader for any responses missed by real-time grading.
- **`services/pipeline.js`** — `isSubtopicComplete` (all content viewed + avg correctness ≥ threshold) and `unlockNextForCourse` (linear subtopic unlock). Called by the cron and by `DELETE /queue/:id` (content consumption path).
- **`controllers/`** — `syllabusController`, `contentController`, `questionController`, `responseController`, `progressController`, `queueController` — all implemented.
- **`models/`** — `syllabusModel`, `contentModel`, `questionModel`, `responseModel`, `progressModel`, `queueModel` — all implemented.

### Cron / pipeline environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `CRON_INTERVAL_MS` | `60000` | How often the cron ticks (ms) |
| `COMPLETION_THRESHOLD` | `2.5` | Avg correctness (0–4) required to mark a subtopic complete |
| `AI_MODE` | `local` | `local` = claude subprocess; `cloud` = TODO |
| `AI_MODEL` | `claude-haiku-4-5-20251001` | Model passed to `claude --model` for grading and generation |
| `AI_TIMEOUT_MS` | `60000` | Timeout for the claude subprocess (ms) |
| `RESPONSE_WINDOW` | `10` | Last N responses used for completion / struggling checks |
| `STRUGGLING_THRESHOLD` | `1.5` | Avg correctness below this = struggling |
| `MIN_RESPONSES_STRUGGLE` | `3` | Min responses before struggling fires |
| `REGRESSION_THRESHOLD` | `1.5` | Avg correctness below this = regressed (reactivates completed subtopic) |
| `MIN_RESPONSES_REGRESS` | `5` | Min responses before regression fires |

### API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/syllabus` | Fetch courses (or `?id=` for a single node) |
| POST | `/syllabus/upload` | Upload/upsert a full course syllabus |
| POST | `/syllabus/enroll` | Enroll user in a course |
| GET | `/progress` | Active subtopics for a user (`?user_id=`) |
| GET | `/enrollments` | All courses a user is enrolled in (`?user_id=`) |
| GET | `/struggling` | Struggling subtopics for a user (`?user_id=`); returns name, course, avg correctness |
| POST | `/generate-adaptive` | Trigger background adaptive content+question generation for a subtopic (`{ user_id, subtopic_id }`) |
| GET | `/queue` | Fetch items from the tier queue (`?user_id=&course_ids=id1,id2&limit=10&question_only=true`) |
| DELETE | `/queue/:id` | Consume one queue item; records content view server-side for content items |
| GET | `/content/:id` | Fetch a single content item by UUID |
| GET/POST | `/content` | Fetch / upload learning material |
| POST | `/content/adaptive` | Persist Claude-generated adaptive content (`base_content=false`) |
| GET/PUT | `/content-views` | Track user content consumption |
| GET | `/questions/:id` | Fetch a single question by UUID |
| GET/POST | `/questions` | Fetch / upload quiz questions |
| POST | `/questions/adaptive` | Persist Claude-generated adaptive question (`base_content=false`) |
| GET/POST | `/responses` | Fetch / submit user answers (auto-grades if `correctness` omitted) |
| PATCH | `/responses/:id/grade` | Set grade for a freeText response; runs pipeline |
| POST | `/responses/:id/grade-ai` | Grade a freeText response synchronously via AI; runs pipeline. Used by CLI for real-time feedback. |

### Database Schema

Seven tables in PostgreSQL with pgvector HNSW indexes (cosine similarity) on all `embedding vector(384)` columns:

| Table | Key fields |
|-------|-----------|
| `syllabus` | `id` (slug), `parent_id`, `level` (course/topic/subtopic), `prerequisites[]`, `exam` JSONB |
| `content` | `syllabus_id`, `active`, `base_content`, `content_type`, `title`, `body`, `tags[]` |
| `content_progress` | `user_id`, `syllabus_id`, `subtopic_id`, `active`, `completed`; unique per (user, subtopic) |
| `content_view` | `content_id`, `user_id`, `last_shown` (epoch ms), `view_count`; unique per (content, user) |
| `question` | `syllabus_id`, `difficulty` (0–4), `question_type`, `options` JSONB, `answer` JSONB, `tags[]` |
| `response` | `question_id`, `user_id`, `user_answer` JSONB, `correctness` (0–4), `responded_at` (epoch ms), `graded_at` (epoch ms, NULL until cron grades it) |
| `study_queue` | `user_id`, `course_id`, `subtopic_id`, `item_type` (content/question), `item_id`, `priority` INT; unique on `(user_id, item_type, item_id)` |

Timestamps are 13-digit epoch milliseconds (BIGINT). Syllabus IDs use slug hierarchy: `my-course` (course) → `my-course.1` (topic) → `my-course.1.1` (subtopic). Other IDs are UUIDs.

`graded_at` is set by the cron or the `grade-ai` endpoint, on `freeText` responses. It is NULL on insert and used to detect ungraded responses (as opposed to responses correctly scored 0). The cron acts as a fallback for any responses not graded in real-time.

`study_queue` is a **persistent tier-based queue** — all items for a user's enrolled courses live here permanently (never deleted except on unenroll). Priority is a plain integer encoding five tiers: -1=locked, 0–99=tier0 (mastered), 100–199=tier1, 200–299=tier2, 300–399=tier3 (new/just-unlocked), 400–499=tier4 (failed/needs work). Items are fetched with `ORDER BY priority DESC` — higher priority = shown sooner. On enroll, all items are inserted at -1 (locked); the first subtopic's items are promoted to tier 3 immediately. Subsequent subtopics are unlocked by the pipeline after the previous one is completed. Full item bodies (body/question_text/options/answer) are fetched in bulk by `GET /queue` via JOIN — no secondary per-item fetch needed.

### Course Data (`courseData/`)

Markdown files (primary format) that serve as the source for database ingestion. See `docs/` for format specs.

Two supported layouts:

```
courseData/{course-id}/              # direct (standalone course)
  syllabus.md
  {subtopic-id}.md

courseData/{group}/{course-id}/      # grouped (courses belonging to a program)
  syllabus.md
  {subtopic-id}.md
```

A directory is recognised as a **course** if it contains `syllabus.md` or `syllabus.json`. A directory without a syllabus file is treated as a **group** and its subdirectories are scanned for courses (one level only).

The syllabus `id:` field always uses the leaf course slug (e.g. `french-a1`), not the group prefix.

Legacy JSON format is still supported (see `docs/` for schema). The ingest script prefers `.md` when both exist.

Check generation progress:

```bash
node scripts/course-status.js                    # all courses (both layouts)
node scripts/course-status.js intro-to-python
node scripts/course-status.js languages         # all courses in a group
node scripts/course-status.js languages/french-a1
node scripts/course-status.js --data-dir /path  # override courseData/ location
```

### Learning Phases

All content and questions are tagged with a learning phase:

| Tag | Covers |
|-----|--------|
| `phase:atomic` | Terms, definitions, vocab, facts (recall questions; difficulty 0–1) |
| `phase:complex` | Relationships, processes, scenarios (application questions; difficulty 2–3) |
| `phase:integration` | Multi-step synthesis, cross-topic analysis (case studies; difficulty 3–4) |

Every subtopic must have records in all three phases.

## Roadmap

### What is built

**Course authoring** — fully working end-to-end:
- Claude Code skills (`/generate-course`, `/generate-language-course`, `/generate-program`) generate `courseData/` markdown files
- Both direct (`courseData/{course-id}/`) and grouped (`courseData/{group}/{course-id}/`) layouts supported
- Database schema models all entities including adaptive content (`base_content: false`), performance tracking, and content unlocking (`active` flag)

**API server (data layer)** — fully implemented:
- All controllers and models implemented (`syllabus`, `content`, `question`, `response`, `progress`)
- Upload pipeline: syllabus upsert with SHA-256 checksum diffing; content/question delete-and-replace per subtopic
- Embedding generation via `@huggingface/transformers` (lazy-loaded, opt-in via `ENABLE_EMBEDDINGS=true`)
- `GET /progress` returns active subtopics for a user

**Ingest script** (`scripts/ingest.js`) — loads `courseData/` into the API server:
- Supports both markdown (`.md`) and legacy JSON course formats; prefers `.md`
- Uploads syllabus, then content and questions per subtopic
- Discovers both direct and grouped course layouts automatically
- CLI refs: `course-id`, `group/course-id`, or `group` (all courses in group)
- `--dry-run` flag for preview; `--base-url` for non-local servers
- `--convert-only` parses markdown and writes JSON to `courseData/{ref}/converted/` for debugging

**App layer (CLI)** — working client (`app/index.js`):
- Main menu: Study / Manage courses / Settings / Quit
- Enroll in courses, read content, answer questions, submit responses
- Handles `singleChoice`, `multiChoice`, `freeText`, `ordering`, `exactMatch` question types
- Session start: multi-select course picker (defaults to `last_selected_courses`; excludes `disabled_courses`); selection saved back to settings
- Session composition via `composeSession(items, sessionSize, reviewPct)`: splits tier-queue items into "new" (tier 3) and "review" (tiers 4/2/1/0), applies `review_pct`, gap-fills if one bucket is short, sorts by priority DESC
- Full item body included in `GET /queue` response — no secondary fetch per item
- Shows breadcrumb (`Course › Topic › Subtopic`) above each item; shows `explanation` after answers where present
- `freeText` responses graded in real-time via `POST /responses/:id/grade-ai` — grade shown immediately after answering; grading failure treated as fail (correctness=0, item moves to tier 4)
- End of session: checks `GET /struggling` and prompts user to generate adaptive practice content; fires `POST /generate-adaptive` as background task if confirmed — new items appear in next session
- User ID persisted locally in `app/.user_id`; settings persisted in `app/.settings.json`

**Response watcher** (`app/watch.js`) — optional companion process for a live grade feed:

```bash
node app/watch.js          # default: poll every 3s
WATCH_INTERVAL_MS=5000 node app/watch.js
```

Run in a second terminal alongside `app/index.js`. On startup it snapshots all existing responses (skips them), then polls `GET /responses` every 3 s and prints each new graded result:

```
  14:32:01  singleChoice  ●●●●  4/4  Correct
            What is the purpose of an IAM role?

  14:33:18  freeText      ●○○○  1/4  Mostly wrong
            Explain the difference between STS and IAM
```

`freeText` responses are held silently until `graded_at` is set by `/grade-ai`, then printed — no intermediate noise. Question metadata is fetched once per unique question and cached. Reads the same `app/.user_id` file as the main client; no extra configuration needed.

App settings (stored in `app/.settings.json`):

| Setting | Default | Behaviour |
|---------|---------|-----------|
| `session_size` | `10` | Number of items per study session |
| `review_pct` | `30` | % of session drawn from review tiers (4/2/1/0); remainder from tier 3 (new material) |
| `last_selected_courses` | `[]` | Pre-selected courses in the course picker for the next session |
| `disabled_courses` | `[]` | Course IDs temporarily paused. Excluded from the course picker but remain enrolled. |

**Cron / adaptive engine** (`services/cron.js` + `services/pipeline.js`) — runs inside the API server process:
- `freeText` grading via `gradeFreeText` (`services/grading.js`); `ordering` graded deterministically. Cron acts as fallback for any responses not graded in real-time by the CLI.
- Subtopic completion (`pipeline.isSubtopicComplete`): all content viewed + avg correctness ≥ threshold (default 2.5/4)
- Linear subtopic unlock (`pipeline.unlockNextForCourse`): completes subtopic N → promotes N+1's items to tier 3
- Regression detection: completed subtopics reactivated if last 5 graded responses avg < `REGRESSION_THRESHOLD`; items pushed back to tier 3
- Concurrency guard: skips tick if previous run is still in progress
- Unlock is idempotent and retried every tick (recovers from partial failures)

**Study queue** (`models/queueModel.js`):
- Persistent tier-based queue; all enrolled items live in `study_queue` permanently (deleted only on unenroll)
- Tier transitions: fail (correctness<3) → tier 4; tier-4 success → tier 2; tier-0 success → stays tier 0; other success → down one tier
- Enroll: all items inserted at -1 (locked); first subtopic promoted to tier 3 (top 5 items biased toward 374–399)
- Gated questions (have `content_ids`) stay at -1 until their required content items are viewed; promoted by `promoteGatedQuestions` after `DELETE /queue/:id` on a content item
- Struggling detection: avg correctness < `STRUGGLING_THRESHOLD` after ≥`MIN_RESPONSES_STRUGGLE` responses → items pushed back to tier 4 for that subtopic
- Content view tracking server-side: `DELETE /queue/:id` upserts `content_view` + calls `promoteGatedQuestions`
- Idempotent inserts: `ON CONFLICT (user_id, item_type, item_id) DO NOTHING`

### What is not built

- **Cloud AI dispatch** — `services/ai.js` has a TODO stub; only local `claude` subprocess works

---

### Target architecture

```
┌─────────────────────────────────────────────────┐
│  App layer  (CLI)                               │
│  Thin client: display queue, capture responses. │
│  No business logic.                             │
└────────────────────┬────────────────────────────┘
                     │ REST
┌────────────────────▼────────────────────────────┐
│  API server  (data layer)                       │
│  REST API. Owns: syllabus, content, questions,  │
│  responses, content_progress, study_queue.      │
│  GET /queue returns full item bodies.           │
└────────────────────┬────────────────────────────┘
                     │ reads/writes
┌────────────────────▼────────────────────────────┐
│  PostgreSQL + pgvector                          │
└─────────────────────────────────────────────────┘
                          ▲
                          │ reads performance / writes adaptive content
          ┌───────────────┴─────────────────────────┐
          │  Cron  (adaptive engine, in API server)  │
          │  Spaced repetition, subtopic unlock,     │
          │  freeText grading fallback.              │
          └──────────────────────────────────────────┘
```

Each layer is independently deployable. The cron runs inside the API server process.

---

### Layer details

**API server** — ✅ done. CRUD + vector search + AI grading/generation endpoints. Embedding generation (`services/embedding.js`) runs at upload time. `services/grading.js` owns all grading logic (deterministic + AI). `services/adaptiveGenerator.js` handles background content generation.

**App layer** — ✅ CLI done (`app/index.js`). Multi-select course picker at session start. `GET /queue?course_ids=...` returns full item bodies. `composeSession` applies `review_pct` to split tier-queue items. Shows breadcrumb and explanation. Grades freeText in real-time (grading failure = fail). Prompts user to generate adaptive content when struggling detected. `app/watch.js` is an optional companion watcher that polls for new grades and prints them in a second terminal.

**Cron + Queue** — ✅ fully implemented. Cron runs on a configurable interval per user:
1. Grade any ungraded `freeText` responses (fallback for responses missed by real-time grading); grade `ordering` deterministically
2. Check subtopic completion (all content viewed + avg correctness ≥ threshold)
3. Unlock next subtopic in linear sort order (promotes items from -1 to tier 3); retried every tick for recovery
4. Detect regression on completed subtopics; push items back to tier 3
5. 🔲 Cloud AI dispatch not yet implemented (local subprocess only)

---

### Portability

Each axis is independent:

| Component | Local | Cloud |
|-----------|-------|-------|
| AI calls | `claude` subprocess | Claude API (TODO in `services/ai.js`) |
| API server | Docker | Any Node host |
| Database | Docker (`database/Dockerfile`) | Managed Postgres |
| App | CLI | Web / mobile |

---

## Custom Slash Commands (Skills)

Located in `.claude/commands/`:

- **`/generate-course`** — Generate a structured course (syllabus → content → questions). Supports new courses, resume, regenerate specific topics, and revise syllabus. Subject scope limit: ~10 topics, ~60 subtopics, ~1000 content/question records. Course ref may be `course-id` or `group/course-id`.
- **`/generate-language-course`** — Language-learning specialization of `/generate-course`.
- **`/generate-program`** — Plan a multi-course learning program. Writes `courseData/{program-id}/program.md` — the program-id becomes the group folder. Produces an ordered sequence of courses for a learning goal; does not generate course content itself. Use the output as input for `/generate-course {program-id}/{course-id}`.

Resume syntax examples:
```
/generate-course intro-to-python resume
/generate-course intro-to-python from topic 3 content
/generate-course intro-to-python regenerate topic 2
/generate-course languages/french-a1 resume
```
