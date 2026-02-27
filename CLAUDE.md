# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**tutor.ai** is an adaptive learning platform using RAG (Retrieval-Augmented Generation) with PostgreSQL pgvector to personalize content and question delivery based on user performance. The platform generates and serves course content, tracks user responses, and uses 384-dim vector embeddings for semantic search.

## Commands

### Database

Commands use `podman`; substitute `docker` if preferred — they are drop-in compatible.

On Windows, bind-mounting a host path (`./pgdata`) causes a `chmod` permission error when PostgreSQL initialises. Use a **named volume** instead — Podman manages it inside the VM where permissions work correctly.

```bash
# Build the image (once, or after schema changes)
podman build -t tutor-db ./database

# Start PostgreSQL + pgvector (data persists in named volume tutor-db-data)
podman run --name tutor-db -p 5432:5432 -v tutor-db-data:/var/lib/postgresql/data tutor-db

# Stop
podman stop tutor-db && podman rm tutor-db

# Reset (wipe data and reinitialize schema)
podman stop tutor-db && podman rm tutor-db && podman volume rm tutor-db-data && podman run --name tutor-db -p 5432:5432 -v tutor-db-data:/var/lib/postgresql/data tutor-db

# Connect via psql
podman exec -it tutor-db psql -U rag -d rag
```

Database credentials: host `localhost`, port `5432`, db/user/password all `rag`.

### API Server

```bash
cd server
npm install
npm start               # start server (port 3000, or $PORT)
npm run dev             # start with nodemon (auto-restart)
```

### MCP Plugin

```bash
cd mcp
npm install
```

Register in `.claude/settings.json` (or `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "tutor-ai": {
      "command": "node",
      "args": ["/absolute/path/to/project/mcp/src/index.js"],
      "env": {
        "DB_HOST": "localhost",
        "DB_PORT": "5432",
        "DB_NAME": "rag",
        "DB_USER": "rag",
        "DB_PASSWORD": "rag"
      }
    }
  }
}
```

The MCP plugin connects directly to the database — the API server does **not** need to be running. The cron (in the API server) is still useful for bulk grading of any existing ungraded freeText responses and for non-MCP clients, but all grading within a Claude session is immediate.

### Ingest course data

```bash
node scripts/ingest.js                        # all courses
node scripts/ingest.js aws-security-specialty # one course
node scripts/ingest.js --dry-run              # preview without hitting server
node scripts/ingest.js --base-url http://host:3000 <course-id>
```

Uploads `courseData/` JSON files to the running API server: syllabus first, then content and questions per subtopic. Embeddings are generated server-side if `ENABLE_EMBEDDINGS=true` is set on the server; otherwise the `embedding` column is stored as NULL.

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
mcp/            MCP plugin — exposes study tools to Claude via Model Context Protocol
app/            CLI study client (Node.js, no dependencies)
courseData/     Static course JSON files (syllabus, content, questions per subtopic)
scripts/        Utilities: ingest.js loads courseData/ into the API server
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
- **`services/adaptiveGenerator.js`** — Background adaptive content/question generation for struggling subtopics. Fetches context + recent wrong answers, calls `callAI`, parses JSON response, persists items as `base_content=false`.
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

### MCP plugin environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `API_URL` | `http://localhost:3000` | Base URL of the tutor.ai REST API server |

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

Static JSON files that serve as the source for database ingestion:

```
courseData/{course-id}/
  syllabus.json              # nested hierarchy: course → topics → sub_topics
  content/{subtopic-id}.json # array of content records per subtopic
  questions/{subtopic-id}.json # array of question records per subtopic
```

Current courses: `aws-security-specialty`, `japanese-phonetics`, `mandarin-hanzi-hsk1-2`.

Fields populated by the upload pipeline (`id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, `question_ids`) must be **omitted** from generated JSON files.

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
- Claude Code skills (`/generate-course`, `/generate-language-course`) generate `courseData/` JSON files
- Database schema models all entities including adaptive content (`base_content: false`), performance tracking, and content unlocking (`active` flag)

**API server (data layer)** — fully implemented:
- All controllers and models implemented (`syllabus`, `content`, `question`, `response`, `progress`)
- Upload pipeline: syllabus upsert with SHA-256 checksum diffing; content/question delete-and-replace per subtopic
- Embedding generation via `@huggingface/transformers` (lazy-loaded, opt-in via `ENABLE_EMBEDDINGS=true`)
- `GET /progress` returns active subtopics for a user

**MCP plugin** (`mcp/`) — Claude-native study interface:
- 10 tools: `get_queue`, `get_item_body`, `consume_item`, `submit_response`, `record_grade`, `create_content`, `create_question`, `list_courses`, `enroll`, `get_progress`
- `get_queue` returns exactly 1 item (slim metadata only — no body/question_text). Claude calls it before each item.
- `get_item_body` fetches the full body of a single item on-demand (`item_type` + `item_id`). Call after `get_queue`, before displaying.
- `submit_response` auto-grades singleChoice/multiChoice/ordering deterministically; for freeText returns context for Claude to grade inline
- `record_grade` persists Claude's score and immediately runs the post-response pipeline (completion check + subtopic unlock + struggling detection)
- Pipeline returns `{ completed, unlocked, struggling }` — `struggling` lists subtopics with avg correctness < 1.5 after ≥3 responses, with name and course context
- `create_content` / `create_question` persist adaptive items Claude generates inline for struggling subtopics (`base_content=false`, never overwritten by ingest); picked up on next `get_queue`
- Queue refill (via scheduler) triggered on every `get_queue` call — no cron tick needed for active sessions
- Standalone: connects directly to the database, no dependency on the API server process

> **Context accumulation warning (MCP vs CLI):**
> The MCP plugin runs inside a single Claude conversation. Every `get_item_body` result — including the raw `embedding vector(384)` column (~1,500 tokens of floats) and full content body — stays in Claude's context window for the lifetime of the session. After ~50 items a session accumulates 80,000–150,000 tokens of tool-result history. Claude Code handles this via automatic compression, but plain Claude Desktop / claude.ai sessions will degrade noticeably past ~30–40 items.
>
> The CLI client (`app/index.js`) is stateless HTTP — no context accumulation. Prefer the CLI for all-day or high-volume sessions.
>
> **Mitigation (not yet implemented):** Filter the `embedding` field in `handleGetItemBody` (`mcp/src/tools/queue.js`) before returning to Claude, and project only the fields Claude needs from content/question rows. This alone saves ~1,500 tokens per item.

**Ingest script** (`scripts/ingest.js`) — loads `courseData/` into the API server:
- Uploads syllabus, then content and questions per subtopic
- Supports single course, multiple courses, or all courses
- `--dry-run` flag for preview; `--base-url` for non-local servers

**App layer (CLI)** — working client (`app/index.js`):
- Main menu: Study / Manage courses / Settings / Quit
- Enroll in courses, read content, answer questions, submit responses
- Handles `singleChoice`, `multiChoice`, `freeText`, `ordering` question types
- Full item body fetched on-demand from `/content/:id` or `/questions/:id` before each item is shown
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

- **Adaptive content/question generation (cron path)** — TODO stub in `scheduler.js`; CLI uses `POST /generate-adaptive` triggered by user prompt; MCP uses inline `create_content` / `create_question`
- **Cloud AI dispatch** — `services/ai.js` has a TODO stub; only local `claude` subprocess works
- **Tests** — Jest is installed; `server/__tests__/` is empty

---

### Target architecture

```
┌─────────────────────────────────────────────────┐   ┌──────────────────────────────┐
│  App layer  (CLI / web / mobile)                │   │  Claude (MCP host)           │
│  Thin client: display content queue, capture    │   │  Runs study sessions via MCP │
│  responses. No business logic.                  │   │  tools; grades freeText      │
└────────────────────┬────────────────────────────┘   │  inline (no cron roundtrip). │
                     │ REST                            └──────────────┬───────────────┘
                     │                                                │ MCP (stdio)
┌────────────────────▼────────────────────────────┐   ┌──────────────▼───────────────┐
│  API server  (data layer)                       │   │  MCP plugin  (mcp/)          │
│  REST API. No AI, no scheduling.                │   │  Direct DB access.           │
│  Owns: syllabus, content, content_progress,     │   │  Reuses scheduler for queue  │
│  content_view, questions, responses, embeddings.│   │  refill. Runs pipeline after │
└────────────────────┬────────────────────────────┘   │  every graded response.      │
                     │                                 └──────────────┬───────────────┘
                     │ reads/writes                                   │ reads/writes
┌────────────────────▼─────────────────────────────────────────────────────────────────┐
                     │ reads/writes
┌────────────────────▼────────────────────────────┐
│  PostgreSQL + pgvector                          │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                        ▲
                                        │ reads performance / writes new content
                         ┌──────────────┴──────────────────────────┐
                         │  Cron  (adaptive engine, in API server)  │
                         │  Spaced repetition, subtopic unlock,     │
                         │  freeText grading for non-MCP clients.   │
                         └──────────────────────────────────────────┘
```

Each layer is independently deployable. The MCP plugin and API server share the same database; the cron runs inside the API server process and acts as a fallback grader for non-MCP clients.

---

### Layer details

**API server** — ✅ done. CRUD + vector search + AI grading/generation endpoints. Embedding generation (`services/embedding.js`) runs at upload time. `services/grading.js` owns all grading logic (deterministic + AI). `services/adaptiveGenerator.js` handles background content generation.

**App layer** — ✅ CLI done (`app/index.js`). Fetches one item at a time, shows full body on-demand, grades freeText in real-time, prompts user to generate adaptive content when struggling detected. `app/watch.js` is an optional companion watcher that polls for new grades and prints them in a second terminal.

**Cron + Scheduler** — ✅ fully implemented. Runs on a configurable interval per user:
1. Grade any ungraded `freeText` responses (fallback for responses missed by real-time grading); grade `ordering` deterministically
2. Check subtopic completion (all content viewed + avg correctness ≥ threshold)
3. Refill `study_queue` via scheduler if below watermark
4. Unlock next subtopic in linear sort order; retried every tick for recovery
5. Scheduler handles SR intervals, struggling boost, regression reactivation, round-robin interleave
6. Graduated-course maintenance: when all subtopics in a course are completed, the scheduler injects semi-random questions from that course (`MAINTENANCE_QUESTIONS_PER_COURSE` per refill) so retention is tested. If accuracy degrades, `reactivateRegressions` fires and the course re-enters the normal active queue automatically.
7. 🔲 Adaptive content/question generation (cron path) not yet implemented
8. 🔲 Cloud AI dispatch not yet implemented (local subprocess only)

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

Resume syntax examples:
```
/generate-course spanish-a2 resume
/generate-course spanish-a2 from topic 3 content
/generate-course spanish-a2 regenerate topic 2
```
