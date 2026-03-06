# Test Plan

Legend: **U** = unit · **I** = integration · **M** = manual

---

## 1. Grading (`server/src/services/grading.js`)

| Test | Type |
|------|------|
| `gradeSingleChoice` — correct answer | U |
| `gradeSingleChoice` — wrong answer | U |
| `gradeSingleChoice` — case-insensitive comparison | U |
| `gradeMultiChoice` — all correct → 4 | U |
| `gradeMultiChoice` — 75 %+ correct → 3 | U |
| `gradeMultiChoice` — 50 %+ correct → 2 | U |
| `gradeMultiChoice` — any correct → 1 | U |
| `gradeMultiChoice` — none correct → 0 | U |
| `gradeMultiChoice` — extra selections penalise | U |
| `gradeOrdering` — exact sequence → 4 | U |
| `gradeOrdering` — partial in-position → proportional | U |
| `gradeOrdering` — empty answer → 0 | U |
| `gradeExactMatch` — matches one of multiple accepted strings | U |
| `gradeExactMatch` — case-insensitive by default | U |
| `gradeExactMatch` — case-sensitive flag respected | U |
| `gradeExactMatch` — no match → 0 | U |
| `gradeExactMatch` — trims whitespace before comparing | U |
| `gradeResponse` — dispatches to correct function per type | U |
| `gradeResponse` — returns null for freeText | U |
| `gradeFreeText` — AI returns valid JSON with correctness 0–4 | I |
| `gradeFreeText` — unparseable AI response returns 0 | I |

---

## 2. Scheduler (`server/src/services/scheduler.js`)

| Test | Type |
|------|------|
| `computePriority` — phase bits dominate type bits | U |
| `computePriority` — type bits dominate difficulty bits | U |
| `computePriority` — STRUGGLE_BOOST makes priority negative | U |
| `computePriority` — sr_score capped at MAX_SR_SCORE | U |
| `phaseScore` — atomic=0, complex=1, integration=2, untagged=3 | U |
| `contentNextDue` — interval grows with view_count | U |
| `contentNextDue` — caps at last interval band | U |
| `questionNextDue` — interval grows with avg correctness | U |
| `srScore` — item due today → MAX_SR_SCORE | U |
| `srScore` — item 1 day overdue → MAX_SR_SCORE − 1000 | U |
| `srScore` — far overdue clamped to 0 | U |
| `buildQueue` — content not yet viewed → included (new item) | I |
| `buildQueue` — content viewed but not due → excluded | I |
| `buildQueue` — content overdue → included as review | I |
| `buildQueue` — question gated on unviewed content → excluded | I |
| `buildQueue` — question gated on viewed content → included | I |
| `buildQueue` — struggling subtopic clears and re-prioritises queue | I |
| `buildQueue` — struggling boost applied to easy questions | I |
| `buildQueue` — regression reactivates completed subtopic | I |
| `buildQueue` — unweighted round-robin alternates courses evenly | I |
| `buildQueue` — weight=2 course gets twice the slots | I |
| `buildQueue` — maintenance questions injected for graduated courses | I |
| `buildQueue` — maintenance questions excluded if already in queue | I |
| `buildQueue` — breadcrumb included in item_data | I |
| `refillIfNeeded` — skips when queue ≥ watermark | I |
| `refillIfNeeded` — triggers buildQueue when below watermark | I |

---

## 3. Ingest script (`scripts/ingest.js`)

| Test | Type |
|------|------|
| `parseSyllabusMarkdown` — course/topic/subtopic hierarchy | U |
| `parseSyllabusMarkdown` — prerequisites and objectives parsed | U |
| `parseSyllabusMarkdown` — sort order follows file position | U |
| `parseSubtopicMarkdown` — content blocks separated from questions | U |
| `parseSubtopicMarkdown` — phase tag extracted from heading | U |
| `parseSubtopicMarkdown` — `tags:` metadata line parsed | U |
| `parseSubtopicMarkdown` — `meta.*:` fields go into metadata | U |
| `parseSubtopicMarkdown` — fenced block inside content body not treated as heading | U |
| `parseSubtopicMarkdown` — fenced block inside question text not treated as option | U |
| `parseSubtopicMarkdown` — question before first `##` is ungated (contentBlockIdx = -1) | U |
| `parseSubtopicMarkdown` — question after `##` gated on that block | U |
| `parseSubtopicMarkdown` — multiple questions gate on same preceding block | U |
| `parseSubtopicMarkdown` — non-phase tags inherited from gating content block | U |
| `parseSubtopicMarkdown` — phase tags not inherited | U |
| `buildQuestionRecord` — singleChoice answer encoded as string | U |
| `buildQuestionRecord` — multiChoice answer encoded as char array | U |
| `buildQuestionRecord` — ordering answer encoded as char array | U |
| `buildQuestionRecord` — exactMatch answer encoded as string array (multiple lines) | U |
| `buildQuestionRecord` — freeText answer encoded as string | U |
| `buildQuestionRecord` — caseSensitive flag captured | U |
| `buildQuestionRecord` — explanation captured | U |
| `buildQuestionRecord` — inherited tags merged and deduplicated | U |
| `uploadContent` — returns ordered UUID array matching insert order | I |
| `uploadQuestions` — `_contentBlockIdx` resolved to content UUID | I |
| `uploadQuestions` — ungated question gets `content_ids: []` | I |
| Full ingest of markdown course — syllabus, content, questions reach DB | I |
| `--dry-run` — no DB writes, gated question count logged | M |
| `--convert-only` — writes JSON to `converted/` directory | M |
| Re-ingest — base questions replaced, adaptive questions untouched | I |

---

## 4. API Endpoints

### Syllabus
| Test | Type |
|------|------|
| `POST /syllabus/upload` — inserts new course tree | I |
| `POST /syllabus/upload` — skips unchanged nodes (checksum match) | I |
| `POST /syllabus/upload` — updates changed nodes (name/description) | I |
| `POST /syllabus/enroll` — creates content_progress rows | I |
| `POST /syllabus/enroll` — first subtopic active=true, rest false | I |
| `POST /syllabus/enroll` — idempotent (re-enroll no-ops) | I |

### Queue
| Test | Type |
|------|------|
| `GET /queue` — triggers refill when queue low | I |
| `GET /queue` — returns enriched items with full body | I |
| `GET /queue` — content items include `body`, `links` | I |
| `GET /queue` — question items include `question_text`, `options`, `answer`, `explanation`, `case_sensitive` | I |
| `GET /queue` — `weights` param parsed correctly | I |
| `GET /queue` — malformed weights param ignored gracefully | I |
| `DELETE /queue/:id` — removes item from queue | I |
| `DELETE /queue/:id` — upserts content_view for content items | I |
| `DELETE /queue/:id` — does not upsert content_view for question items | I |

### Responses
| Test | Type |
|------|------|
| `POST /responses` — singleChoice graded immediately | I |
| `POST /responses` — multiChoice graded immediately | I |
| `POST /responses` — ordering stored ungraded (graded_at NULL) | I |
| `POST /responses` — exactMatch graded immediately with case_sensitive | I |
| `POST /responses` — freeText stored with needs_grading: true | I |
| `POST /responses` — explicit correctness stored as-is | I |
| `POST /responses/:id/grade-ai` — grades freeText via AI, runs pipeline | I |
| `PATCH /responses/:id/grade` — sets grade, runs pipeline | I |
| Pipeline — completion check fires after grade | I |
| Pipeline — subtopic unlocks on completion | I |

### Progress
| Test | Type |
|------|------|
| `GET /course-progress` — returns full topic/subtopic tree | I |
| `GET /course-progress` — subtopic status: completed / active / locked | I |
| `GET /course-progress` — completed and total counts correct | I |
| `GET /course-progress` — unenrolled subtopics show as locked | I |
| `GET /struggling` — returns subtopics below threshold with ≥ min responses | I |
| `GET /struggling` — excludes subtopics with too few responses | I |

### Adaptive generation
| Test | Type |
|------|------|
| `POST /generate-adaptive` — fires background task, returns immediately | I |
| `POST /generate-adaptive` — skips if adaptive items already exist | I |
| `generateForSubtopic` — persists content with base_content=false | I |
| `generateForSubtopic` — persists questions with base_content=false | I |
| `generateForSubtopic` — once-per-subtopic gate blocks second call | I |

---

## 5. CLI (`app/index.js`)

| Test | Type |
|------|------|
| `singleChoice` — correct answer accepted, score 4 | M |
| `singleChoice` — wrong answer, correct answer shown | M |
| `multiChoice` — comma-separated input parsed correctly | M |
| `ordering` — comma-separated input submitted ungraded | M |
| `exactMatch` — case-insensitive match accepted | M |
| `exactMatch` — case-sensitive match respects flag | M |
| `exactMatch` — no match shows accepted answers | M |
| `freeText` — "Grading…" shown, grade displayed after AI response | M |
| Explanation displayed after answer where present | M |
| Breadcrumb shown above each item in correct format | M |
| Content body displayed with Mermaid as raw fenced block | M |
| Session score shown for deterministic question types | M |
| Struggling prompt shown at session end | M |
| Adaptive generation triggered when user confirms | M |
| Manage Courses — progress bars reflect actual completion | M |
| Manage Courses — course detail shows tree with ✓ / → / blank | M |
| Manage Courses — pause / resume toggles correctly | M |
| Manage Courses — weight 1–5 saved and applied to queue | M |
| Settings — interleave_courses toggles course mixing | M |
| Settings — interleave_subtopics limits to first subtopic per course | M |
| Enroll flow — new course appears in Manage Courses | M |

---

## 6. Cron (`server/src/services/cron.js`)

| Test | Type |
|------|------|
| `getUngradedResponses` — returns only freeText and ordering with graded_at NULL | I |
| `runForUser` — grades ungraded ordering responses | I |
| `runForUser` — grades ungraded freeText responses via AI | I |
| `runForUser` — marks subtopic complete when threshold met | I |
| `runForUser` — unlocks next subtopic after completion | I |
| `runForUser` — concurrency guard skips overlapping tick | I |

---

## 7. End-to-end flows (manual)

| Test | Type |
|------|------|
| Ingest a course → enroll → study session shows correct items in order | M |
| Complete a subtopic → next subtopic unlocks in next session | M |
| Answer poorly → struggling detected → adaptive content offered → new items appear | M |
| Complete all subtopics → maintenance questions appear in queue | M |
| Complete all subtopics → regress → subtopic reactivated automatically | M |
| Set course weight → heavier course appears proportionally more in session | M |
| Pause a course → items excluded from queue | M |
| `app/watch.js` — new grades printed after freeText answered | M |
