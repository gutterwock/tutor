# server

Express.js API server + cron adaptive engine.

## Running

```bash
npm install
npm start        # port 3000 (or $PORT)
npm run dev      # nodemon auto-restart
npm test         # jest
```

Requires a running PostgreSQL instance — see `database/README.md`. Default credentials: host `localhost`, port `5432`, db/user/password all `rag`.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | API server port |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `rag` | Database name |
| `DB_USER` | `rag` | Database user |
| `DB_PASSWORD` | `rag` | Database password |
| `ENABLE_EMBEDDINGS` | _(unset)_ | Set to `true` to generate vector embeddings on ingest. Requires the optional dependency: `npm install --include=optional` (~90 MB model downloaded on first use) |
| `AI_MODE` | `local` | `local` = claude subprocess; `cloud` = TODO |
| `AI_MODEL` | `claude-haiku-4-5-20251001` | Model used for grading and adaptive generation |
| `AI_TIMEOUT_MS` | `60000` | Timeout for AI subprocess (ms) |
| `CRON_INTERVAL_MS` | `60000` | Cron tick interval (ms) |
| `COMPLETION_THRESHOLD` | `2.5` | Avg correctness (0–4) to mark a subtopic complete |
| `STRUGGLING_THRESHOLD` | `1.5` | Avg correctness below this = struggling |
| `MIN_RESPONSES_STRUGGLE` | `3` | Min responses before struggling detection fires |
| `RESPONSE_WINDOW` | `10` | Last N responses used for completion / struggling checks |
| `REGRESSION_THRESHOLD` | `1.5` | Avg correctness below this on a completed subtopic = regressed |
| `MIN_RESPONSES_REGRESS` | `5` | Min responses before regression detection fires |

## API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check |
| GET | `/syllabus` | List courses (or `?id=` for a single node) |
| POST | `/syllabus/upload` | Upload/upsert a full course syllabus |
| POST | `/syllabus/enroll` | Enroll a user in a course |
| GET | `/progress` | Active subtopics for a user (`?user_id=`) |
| GET | `/enrollments` | All enrolled courses for a user (`?user_id=`) |
| GET | `/struggling` | Struggling subtopics for a user (`?user_id=`) |
| POST | `/generate-adaptive` | Trigger background adaptive content generation (`{ user_id, subtopic_id }`) |
| GET | `/queue` | Fetch items from the tier queue (`?user_id=&course_ids=id1,id2&limit=10&question_only=true`) |
| DELETE | `/queue/:id` | Consume an item; records content view server-side |
| GET | `/content/:id` | Fetch a single content item by UUID |
| GET | `/content` | Fetch content (`?syllabus_id=`, `?active=`, `?tags=`) |
| POST | `/content` | Upload content for a subtopic (replaces existing base content) |
| POST | `/content/adaptive` | Persist AI-generated content (`base_content=false`) |
| GET | `/content-views` | Content view history for a user |
| PUT | `/content-views` | Record/increment a content view |
| GET | `/questions/:id` | Fetch a single question by UUID |
| GET | `/questions` | Fetch questions (`?syllabus_id=`, `?difficulty=`, `?active=`) |
| POST | `/questions` | Upload questions for a subtopic (replaces existing base questions) |
| POST | `/questions/adaptive` | Persist AI-generated question (`base_content=false`) |
| GET | `/responses` | Fetch user responses |
| POST | `/responses` | Submit a response (auto-grades all types except freeText) |
| PATCH | `/responses/:id/grade` | Set grade for a freeText response; runs pipeline |
| POST | `/responses/:id/grade-ai` | Grade a freeText response via AI synchronously; runs pipeline |

## Tests

```bash
npx jest              # all tests
npx jest grading      # single file
```

Test files are in `__tests__/`. Current coverage: `grading.test.js`, `queueModel.test.js`, `pipeline.test.js` — 75 tests.
