-- Adaptive Learning RAG Schema
-- PostgreSQL + pgvector
-- Timestamps are 13-digit epoch milliseconds (BIGINT).
-- Syllabus IDs: course root is a slug (e.g. spanish-b2), children use numeric hierarchy (e.g. spanish-b2.1, spanish-b2.1.1). Other IDs are UUIDs.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enums
CREATE TYPE syllabus_level AS ENUM ('course', 'topic', 'subtopic');
CREATE TYPE content_type   AS ENUM ('text', 'image', 'markup', 'audio', 'video');
CREATE TYPE question_type  AS ENUM ('singleChoice', 'multiChoice', 'freeText', 'ordering', 'exactMatch');

-- =============================================================================
-- Tables
-- =============================================================================

-- Syllabus: hierarchical course structure
CREATE TABLE syllabus (
    id            TEXT PRIMARY KEY,
    parent_id     TEXT REFERENCES syllabus(id) ON DELETE CASCADE,
    level         syllabus_level NOT NULL,
    name          VARCHAR(500) NOT NULL,
    description   TEXT,
    prerequisites TEXT[] DEFAULT '{}',
    exam          JSONB,
    sort_order    INTEGER,
    checksum      VARCHAR(64),
    embedding     vector(384)
);

-- Content: learning material tied to syllabus nodes
CREATE TABLE content (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    syllabus_id  TEXT NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    active       BOOLEAN NOT NULL DEFAULT true,
    base_content BOOLEAN NOT NULL DEFAULT true,
    content_type content_type NOT NULL DEFAULT 'text',
    title        VARCHAR(500) NOT NULL,
    body         TEXT NOT NULL,
    tags         TEXT[] DEFAULT '{}',
    links        JSONB DEFAULT '[]',
    embedding    vector(384),
    metadata     JSONB DEFAULT '{}'
);

-- Content Progress: tracks subtopic unlock/completion state per user
CREATE TABLE content_progress (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL,
    syllabus_id TEXT NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    subtopic_id TEXT NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    active      BOOLEAN NOT NULL DEFAULT false,
    completed   BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (user_id, subtopic_id)
);

-- Content View: tracks what content a user has seen
CREATE TABLE content_view (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    last_shown BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    view_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE (content_id, user_id)
);

-- Question: quiz questions tied to syllabus nodes
CREATE TABLE question (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    syllabus_id   TEXT NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    active        BOOLEAN NOT NULL DEFAULT true,
    base_content  BOOLEAN NOT NULL DEFAULT true,
    difficulty    SMALLINT NOT NULL CHECK (difficulty BETWEEN 0 AND 4),
    question_type question_type NOT NULL,
    question_text TEXT NOT NULL,
    options        JSONB,
    answer         JSONB NOT NULL,
    explanation    TEXT,                -- optional: shown after answering; for counterintuitive answers only
    tags           TEXT[] DEFAULT '{}',
    content_ids    UUID[] DEFAULT '{}', -- content blocks that must be viewed before this question is shown; [] = ungated
    case_sensitive BOOLEAN NOT NULL DEFAULT false,  -- exactMatch only
    embedding      vector(384)
);

-- Response: user answers to questions
-- Retention policy: keep only the N most recent responses per (user_id, question_id).
-- This bounds table size for fast aggregation and ensures performance reflects recent ability.
CREATE TABLE response (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id  UUID NOT NULL REFERENCES question(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    user_answer  JSONB NOT NULL,
    correctness  SMALLINT NOT NULL CHECK (correctness BETWEEN 0 AND 4),
    responded_at BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT,
    graded_at    BIGINT          -- NULL until cron grades it (freeText/ordering only)
);

-- =============================================================================
-- Indexes
-- =============================================================================

-- HNSW indexes on embedding columns for fast approximate nearest-neighbor search
CREATE INDEX idx_syllabus_embedding  ON syllabus  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_content_embedding   ON content   USING hnsw (embedding vector_cosine_ops);
CREATE INDEX idx_question_embedding  ON question  USING hnsw (embedding vector_cosine_ops);

-- B-tree indexes on foreign keys and common query columns
CREATE INDEX idx_syllabus_parent       ON syllabus(parent_id);
CREATE INDEX idx_content_syllabus      ON content(syllabus_id);
CREATE INDEX idx_content_active        ON content(active);
CREATE INDEX idx_content_view_user     ON content_view(user_id);
CREATE INDEX idx_content_view_content  ON content_view(content_id);
CREATE INDEX idx_question_syllabus     ON question(syllabus_id);
CREATE INDEX idx_question_active       ON question(active);
CREATE INDEX idx_question_difficulty   ON question(difficulty);
CREATE INDEX idx_response_user         ON response(user_id);
CREATE INDEX idx_response_question     ON response(question_id);
CREATE INDEX idx_response_correctness  ON response(user_id, correctness);

CREATE INDEX idx_content_progress_user     ON content_progress(user_id);
CREATE INDEX idx_content_progress_syllabus ON content_progress(syllabus_id);
CREATE INDEX idx_content_progress_subtopic ON content_progress(subtopic_id);
CREATE INDEX idx_content_progress_active   ON content_progress(active);

-- GIN indexes for array columns
CREATE INDEX idx_syllabus_prerequisites ON syllabus  USING gin (prerequisites);
CREATE INDEX idx_content_tags           ON content   USING gin (tags);
CREATE INDEX idx_question_tags          ON question  USING gin (tags);
CREATE INDEX idx_question_content_ids   ON question  USING gin (content_ids);

-- =============================================================================
-- Study Queue
-- =============================================================================
-- Priority-ordered work items maintained by the cron and consumed by the app.
-- item_data stores a denormalized snapshot so the app needs no secondary fetch.
-- priority: signed integer, lower = show sooner (ORDER BY priority ASC).
-- is_review: true when the item has been seen before (spaced repetition pass).
-- The unique index on (user_id, item_type, item_id) makes inserts idempotent
-- (ON CONFLICT DO NOTHING) so the cron can refill safely at any frequency.
CREATE TABLE study_queue (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID    NOT NULL,
    course_id   TEXT    NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    subtopic_id TEXT    NOT NULL REFERENCES syllabus(id) ON DELETE CASCADE,
    item_type   TEXT    NOT NULL CHECK (item_type IN ('content', 'question')),
    item_id     UUID    NOT NULL,
    item_data   JSONB   NOT NULL,
    priority    INTEGER NOT NULL,
    is_review   BOOLEAN NOT NULL DEFAULT false,
    created_at  BIGINT  NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT
);

CREATE UNIQUE INDEX idx_study_queue_dedup    ON study_queue (user_id, item_type, item_id);
CREATE        INDEX idx_study_queue_priority ON study_queue (user_id, priority);
