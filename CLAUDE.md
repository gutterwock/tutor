# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tutor.ai** is an adaptive learning platform using RAG (Retrieval-Augmented Generation) with PostgreSQL pgvector to personalize content and question delivery based on user performance. The platform generates and serves course content, tracks user responses, and uses 384-dim vector embeddings for semantic search.

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
node scripts/ingest.js                        # all courses
node scripts/ingest.js aws-security-specialty # one course
node scripts/ingest.js --dry-run              # preview without hitting server
node scripts/ingest.js --base-url http://host:3000 <course-id>
node scripts/ingest.js --convert-only         # parse markdown → JSON files in courseData/{id}/converted/
```

Parses and uploads `courseData/` files (markdown or legacy JSON) to the running API server: syllabus first, then content and questions per subtopic. Embeddings are generated server-side if `ENABLE_EMBEDDINGS=true` is set on the server; otherwise the `embedding` column is stored as NULL.

### Tests

```bash
cd server
npx jest                # run all tests
npx jest <file>         # run a single test file
```

No tests are currently written. Jest is installed; test files go in `server/__tests__/`.

## Architecture

### Components

```
database/       PostgreSQL 17 + pgvector image; schema.sql auto-runs on first start
server/         Express.js API server (Node.js) + cron adaptive engine
app/            CLI study client (Node.js, no dependencies)
courseData/     Course source files (markdown primary; legacy JSON also supported)
programs/       Multi-course learning programs (markdown). Each file defines a sequence of stages (courses, projects, reviews) with scope, prerequisites, and course IDs. Used as input when generating courses with /generate-course.
docs/           Format specs for course authoring (syllabus, subtopic, content, question formats)
scripts/        ingest.js loads courseData/ into the API server; course-status.js checks generation progress
prompt/         Schema reference and API endpoint definitions for AI context
.claude/        Claude Code settings and custom slash commands (skills)
```

### API Server (`server/src/`)

- **`index.js`** — Express app with Helmet, CORS, HPP, Morgan, and rate limiting (100 req/15 min). Mounts all routes and starts the cron. JSON body limit 10 MB.
- **`routes/index.js`** — All API endpoints wired to controllers.
- **`config/db.js`** — `pg.Pool`. Env vars: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (all default to `rag`).
- **`services/embedding.js`** — `@huggingface/transformers`, `Xenova/all-MiniLM-L6-v2` (384-dim). Lazy-loaded. Disabled by default; set `ENABLE_EMBEDDINGS=true` to activate (downloads ~90 MB model on first call). Exports `generateEmbedding`, `generateEmbeddings`, `pgVector`.
- **`services/ai.js`** — AI dispatch abstraction. `callAI(prompt)` spawns `claude --model $AI_MODEL -p` as a subprocess (local mode). Cloud mode is a TODO stub. Controlled by `AI_MODE` env var (default: `local`); model by `AI_MODEL` (default: `claude-haiku-4-5-20251001`).
- **`services/grading.js`** — All grading logic: deterministic (`gradeSingleChoice`, `gradeMultiChoice`, `gradeOrdering`) and AI-based (`gradeFreeText` — calls `callAI`). Used by the response controller, cron, and `grade-ai` endpoint.
- **`services/adaptiveGenerator.js`** — Adaptive content/question generation for struggling subtopics. Fetches context + recent wrong answers, calls `callAI`, parses JSON response, persists items as `base_content=false`. Runs once per subtopic (guards against re-triggering). Called via `POST /generate-adaptive` at the user's prompt at session end.
- **`services/cron.js`** — Adaptive engine. Runs on `setInterval` (default 60s). Per-user pipeline: grade ungraded responses → check subtopic completion → refill study queue → unlock next subtopics. Concurrency-safe: skips a tick if the previous one is still running. Acts as fallback grader for any responses missed by real-time grading.
- **`services/scheduler.js`** — Builds and maintains the per-user `study_queue`. Priority-scored with bit-packed integers (phase → type → difficulty → review → SR score). Handles spaced repetition intervals, struggling detection, regression reactivation, and round-robin course interleaving. Called by `getQueue` (eager) and cron (background).
- **`controllers/`** — `syllabusController`, `contentController`, `questionController`, `responseController`, `progressController`, `queueController` — all implemented.
- **`models/`** — `syllabusModel`, `contentModel`, `questionModel`, `responseModel`, `progressModel`, `queueModel` — all implemented.

### Cron / scheduler environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `CRON_INTERVAL_MS` | `60000` | How often the cron ticks (ms) |
| `COMPLETION_THRESHOLD` | `2.5` | Avg correctness (0–4) required to mark a subtopic complete |
| `AI_MODE` | `local` | `local` = claude subprocess; `cloud` = TODO |
| `AI_MODEL` | `claude-haiku-4-5-20251001` | Model passed to `claude --model` for grading and generation |
| `AI_TIMEOUT_MS` | `60000` | Timeout for the claude subprocess (ms) |
| `QUEUE_LOW_WATERMARK` | `10` | Remaining items that trigger a queue refill |
| `QUEUE_FILL_TARGET` | `30` | Items to add per refill pass |
| `RESPONSE_WINDOW` | `10` | Last N responses used for SR / struggling detection |
| `STRUGGLING_THRESHOLD` | `1.5` | Avg correctness below this = struggling |
| `MIN_RESPONSES_STRUGGLE` | `3` | Min responses before struggling fires |
| `REGRESSION_THRESHOLD` | `1.5` | Avg correctness below this = regressed (reactivates completed subtopic) |
| `MIN_RESPONSES_REGRESS` | `5` | Min responses before regression fires |
| `MAINTENANCE_QUESTIONS_PER_COURSE` | `5` | Questions per graduated course added to each queue refill (maintenance mode) |

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
| GET | `/queue` | Next study items for a user (`?user_id=&limit=`); triggers refill if low |
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
| `study_queue` | `user_id`, `course_id`, `subtopic_id`, `item_type` (content/question), `item_id`, `item_data` JSONB (snapshot), `priority` INT, `is_review` BOOL; unique on `(user_id, item_type, item_id)` |

Timestamps are 13-digit epoch milliseconds (BIGINT). Syllabus IDs use slug hierarchy: `spanish-b2` (course) → `spanish-b2.1` (topic) → `spanish-b2.1.1` (subtopic). Other IDs are UUIDs.

`graded_at` is set by the cron or the `grade-ai` endpoint, on `freeText` responses. It is NULL on insert and used to detect ungraded responses (as opposed to responses correctly scored 0). The cron acts as a fallback for any responses not graded in real-time.

`study_queue` stores a **slim** denormalized snapshot in `item_data` — metadata only, no large fields. Content items include `type`, `id`, `syllabus_id`, `content_type`, `title`, `tags`. Question items include `type`, `id`, `syllabus_id`, `difficulty`, `question_type`, `tags`. Full body/question_text/options/answer are fetched on-demand via `GET /content/:id` or `GET /questions/:id`. Rows are inserted by the scheduler with `ON CONFLICT DO NOTHING` (idempotent). Priority is a bit-packed integer: `phase_weight (2^27) + type_weight (2^23) + difficulty_weight (2^20) + review_weight (2^16) + sr_score − STRUGGLE_BOOST (2^30 when struggling)`. After round-robin interleave across courses, priorities are re-numbered 0, 1, 2, … to preserve order.

### Course Data (`courseData/`)

Markdown files (primary format) that serve as the source for database ingestion. See `docs/` for format specs.

```
courseData/{course-id}/
  syllabus.md                # course hierarchy: course → topics → subtopics
  {subtopic-id}.md           # content + questions for one subtopic
```

Legacy JSON format is still supported (see `docs/` for schema). The ingest script prefers `.md` when both exist.

Current courses: `aws-security-specialty`, `japanese-phonetics`, `mandarin-hanzi-hsk1-2`.

Check generation progress:

```bash
node scripts/course-status.js                    # all courses
node scripts/course-status.js aws-security-specialty
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
- Claude Code skills (`/generate-course`, `/generate-language-course`, `/generate-program`) generate `courseData/` markdown files and `programs/` documents
- Database schema models all entities including adaptive content (`base_content: false`), performance tracking, and content unlocking (`active` flag)

**API server (data layer)** — fully implemented:
- All controllers and models implemented (`syllabus`, `content`, `question`, `response`, `progress`)
- Upload pipeline: syllabus upsert with SHA-256 checksum diffing; content/question delete-and-replace per subtopic
- Embedding generation via `@huggingface/transformers` (lazy-loaded, opt-in via `ENABLE_EMBEDDINGS=true`)
- `GET /progress` returns active subtopics for a user

**Ingest script** (`scripts/ingest.js`) — loads `courseData/` into the API server:
- Supports both markdown (`.md`) and legacy JSON course formats; prefers `.md`
- Uploads syllabus, then content and questions per subtopic
- Supports single course, multiple courses, or all courses
- `--dry-run` flag for preview; `--base-url` for non-local servers
- `--convert-only` parses markdown and writes JSON to `courseData/{id}/converted/` for debugging

**App layer (CLI)** — working client (`app/index.js`):
- Main menu: Study / Manage courses / Settings / Quit
- Enroll in courses, read content, answer questions, submit responses
- Handles `singleChoice`, `multiChoice`, `freeText`, `ordering`, `exactMatch` question types
- Full item body included in `GET /queue` response — no secondary fetch per item
- Shows breadcrumb (`Course › Topic › Subtopic`) above each item; shows `explanation` after answers where present
- `freeText` responses graded in real-time via `POST /responses/:id/grade-ai` — grade shown immediately after answering
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
| `interleave_courses` | `true` | Mix subtopics from all enrolled courses in one session. When `false`, the user picks one course at session start. |
| `interleave_subtopics` | `true` | Study all active subtopics in one session. When `false`, only the first active subtopic per course is studied. |
| `disabled_courses` | `[]` | Course IDs temporarily paused. Paused courses are excluded from study sessions but remain enrolled. Toggle via Manage courses menu. |

**Cron / adaptive engine** (`services/cron.js` + `services/scheduler.js`) — runs inside the API server process:
- `freeText` grading via `gradeFreeText` (`services/grading.js`); `ordering` graded deterministically. Cron acts as fallback for any responses not graded in real-time by the CLI.
- Subtopic completion: all content viewed + avg correctness ≥ threshold (default 2.5/4)
- Linear subtopic unlock: completes subtopic N → activates N+1 by sort order
- Concurrency guard: skips tick if previous run is still in progress
- Unlock is idempotent and retried every tick (recovers from partial failures)
- Queue refill via `scheduler.refillIfNeeded` on every tick and on every `GET /queue` call

**Scheduler / study queue** (`services/scheduler.js` + `models/queueModel.js`):
- Spaced repetition: content intervals `[1, 3, 7, 14, 30, 60]` days by view count; question intervals by avg correctness bands
- Struggling detection: avg correctness < 1.5 after ≥3 responses → STRUGGLE_BOOST applied, queue cleared and rebuilt for that subtopic
- Regression detection: completed subtopics reactivated if last 5 graded responses avg < 1.5
- Round-robin course interleaving: each course sorted by priority, then merged alternating
- Idempotent inserts: `ON CONFLICT (user_id, item_type, item_id) DO NOTHING`
- Content view tracking consolidated server-side: `DELETE /queue/:id` upserts `content_view`

### What is not built

- **Cloud AI dispatch** — `services/ai.js` has a TODO stub; only local `claude` subprocess works
- **Tests** — Jest is installed; `server/__tests__/` is empty

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

**App layer** — ✅ CLI done (`app/index.js`). `GET /queue` returns full item bodies — no secondary fetch per item. Shows breadcrumb and explanation. Grades freeText in real-time. Prompts user to generate adaptive content when struggling detected. `app/watch.js` is an optional companion watcher that polls for new grades and prints them in a second terminal.

**Cron + Scheduler** — ✅ fully implemented. Runs on a configurable interval per user:
1. Grade any ungraded `freeText` responses (fallback for responses missed by real-time grading); grade `ordering` deterministically
2. Check subtopic completion (all content viewed + avg correctness ≥ threshold)
3. Refill `study_queue` via scheduler if below watermark
4. Unlock next subtopic in linear sort order; retried every tick for recovery
5. Scheduler handles SR intervals, struggling boost, regression reactivation, round-robin interleave
6. Graduated-course maintenance: when all subtopics in a course are completed, the scheduler injects semi-random questions from that course (`MAINTENANCE_QUESTIONS_PER_COURSE` per refill) so retention is tested. If accuracy degrades, `reactivateRegressions` fires and the course re-enters the normal active queue automatically.
7. 🔲 Cloud AI dispatch not yet implemented (local subprocess only)

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

- **`/generate-course`** — Generate a structured course (syllabus → content → questions). Supports new courses, resume, regenerate specific topics, and revise syllabus. Subject scope limit: ~10 topics, ~60 subtopics, ~1000 content/question records.
- **`/generate-language-course`** — Language-learning specialization of `/generate-course`.
- **`/generate-program`** — Generate a multi-course learning program document (`programs/{id}.md`). Produces an ordered plan of stages (courses, projects, reviews) for a learning goal; does not generate course content itself.

Resume syntax examples:
```
/generate-course spanish-a2 resume
/generate-course spanish-a2 from topic 3 content
/generate-course spanish-a2 regenerate topic 2
```
