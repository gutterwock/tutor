# database

PostgreSQL 17 + pgvector image. Schema initialises automatically on first start via `schema.sql`.

## Connecting

Credentials: host `localhost`, port `5432`, db/user/password all `rag`.

```bash
podman exec -it tutor-db-1 psql -U rag -d rag   # compose
podman exec -it tutor-db psql -U rag -d rag      # standalone
```

## Schema

Seven tables with optional 384-dim pgvector embeddings (all-MiniLM-L6-v2, HNSW cosine indexes):

| Table | Purpose |
|-------|---------|
| `syllabus` | Hierarchical course structure (course → topic → subtopic) |
| `content` | Learning material linked to syllabus nodes |
| `content_progress` | Subtopic unlock/completion state per user |
| `content_view` | Per-user content consumption tracking |
| `question` | Quiz questions — difficulty, type, options, answer, passage, tags |
| `response` | User answers with correctness scores and `graded_at` timestamp |
| `study_queue` | Per-user tier-based item queue |

### ID conventions

- **Syllabus IDs** — slug hierarchy: `aws-security-specialty` → `aws-security-specialty.1` → `aws-security-specialty.1.1`
- **All other IDs** — UUIDs
- **Timestamps** — 13-digit epoch milliseconds (BIGINT)

### study_queue priority tiers

Priority is a plain integer; items are fetched `ORDER BY priority DESC`.

| Range | Tier | Meaning |
|-------|------|---------|
| `-1` | locked | Not yet unlocked |
| `0–99` | 0 | Mastered |
| `100–199` | 1 | In progress |
| `200–299` | 2 | In progress |
| `300–399` | 3 | New / just unlocked |
| `400–499` | 4 | Needs work (shown first) |
