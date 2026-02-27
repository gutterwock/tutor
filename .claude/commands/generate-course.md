# Skill: generate-course

## Purpose

Generate a structured base course (syllabus, content, and questions) for the adaptive tutor platform. Supports creating a new course from scratch, resuming a partially generated course, or refining an existing syllabus.

## Instructions

You are generating a base course for the adaptive learning platform. The user has provided: $ARGUMENTS

### Mode Detection

**Parse $ARGUMENTS to determine the mode:**

1. **Existing course patterns** (case-insensitive):
   - `{course-id} resume` → Resume from last checkpoint
   - `{course-id} from topic N {content|questions}` → Continue from specific topic/phase
   - `{course-id} regenerate topic N` or `regenerate topics N, M, K` → Overwrite specific topic(s)
   - `{course-id} regenerate all {content|questions}` → Regenerate entire phase
   - `{course-id} revise syllabus` → Modify existing syllabus

2. **New course** (no matching `courseData/{course-id}/` directory):
   - Parse the input to extract subject, prerequisites, and exam (as below)

**For new courses, extract:**
- **subject** – what the course covers (e.g. "AWS Security Specialty cert", "Spanish A2 proficiency", "Econ 101")
- **prerequisites** – prior knowledge required (e.g. "AWS user 2 years", "Spanish A1 proficiency"). Default to none if not specified.
- **exam** – whether this is for a specific exam/cert, and whether the user only cares about passing the exam vs. deep learning. Default to null if not specified.

**For existing courses, check the state:**
1. Check if `courseData/{course-id}/` exists
2. Determine the mode:
   - **Syllabus-only**: `syllabus.json` exists but no content/question files → ask if user wants to approve syllabus or modify it, then proceed to content generation
   - **Partially generated**: some content or question files exist → show progress, ask which topics to continue, skip, or regenerate
   - **Complete**: all content and questions exist → ask if user wants to regenerate specific topics or refine

If any required input is ambiguous or missing, ask the user before proceeding.

---

### Scope Validation

Before generating anything, assess whether the subject is appropriately scoped for a single course.

**Size limit guidelines (guidelines only, not hard limits):**
- ~10 topics
- ~60 subtopics
- ~1000 content records
- ~1000 questions
- ~100 hours of study time

If the subject is too broad (e.g. "Computer Science", "French"), prompt the user with three options:
1. **Split** – provide suggested sub-courses (e.g. CS → DSA, Systems, Networks, Compilers…) and let them pick which to generate
2. **Reduce** – proceed with a reduced scope (explain what will be excluded)
3. **Proceed anyway** – generate the full course despite the size

Examples of subjects that need splitting:
- "Computer Science" → DSA, Systems, Networks, Compilers, OS, etc.
- "French" → A1, A2, B1, B2, Literature/Other Media, etc.
- "Biology" → Cell Biology, Genetics, Ecology, Physiology, etc.

---

### Output File Structure

Determine the course ID as a lowercase hyphenated slug from the subject (e.g. `aws-security-specialty`, `spanish-a2`, `econ-101`).

Write all files under `courseData/{course-id}/`:
```
courseData/{course-id}/
  syllabus.json              # single nested object with topics → sub_topics hierarchy
  content/
    {subtopic-id}.json       # one file per subtopic, array of content records
  questions/
    {subtopic-id}.json       # one file per subtopic, array of question records
```

Only generate fields that you can fill with real content. Fields populated by the upload pipeline (`id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, `question_ids`) must be omitted entirely.

---

### Schema Reference

All records must conform to `prompt/schema.yaml` (source of truth) and `database/schema.json`. Only include fields the skill can populate — omit anything that is set by the upload pipeline. Key points:

**Syllabus structure** (`syllabus.json` — nested hierarchy):
```json
{
  "id": "spanish-a2",
  "name": "Spanish A2",
  "description": "...",
  "prerequisites": ["Spanish A1 proficiency"],
  "exam": { "exam": "DELE A2" },
  "topics": [
    {
      "id": "spanish-a2.1",
      "name": "Topic 1",
      "description": "...",
      "sub_topics": [
        {
          "id": "spanish-a2.1.1",
          "name": "Subtopic 1.1",
          "objectives": ["Objective 1", "Objective 2"],
          "prerequisites": []
        }
      ]
    }
  ]
}
```

**Content record** (in `content/{subtopic-id}.json` — array of records):
```json
[
  {
    "syllabus_id": "spanish-a2.1.1",
    "content_type": "text",
    "title": "...",
    "body": "...",
    "tags": ["phase:atomic", "some topic"],
    "links": []
  }
]
```

**Question record** (in `questions/{subtopic-id}.json` — array of records):
```json
[
  {
    "syllabus_id": "spanish-a2.1.1",
    "difficulty": 1,
    "question_type": "singleChoice",
    "question_text": "...",
    "options": { "a": "...", "b": "...", "c": "...", "d": "..." },
    "answer": "a",
    "tags": ["phase:atomic"],
  }
]
```

---

### Core Principles

**Learning phases** – all content and questions must be tagged with `phase:atomic`, `phase:complex`, or `phase:integration`. There must be records in each phase for every subtopic.

| Phase | Content covers | Question types |
|---|---|---|
| atomic | Terms, definitions, vocab, facts, properties, formulas, basic rules/syntax | Recall, true/false, fill-in-blank |
| complex | Relationships, processes and flows, scenarios, comparisons | Application, scenario-based, multi-step |
| integration | Multi-step problem solving, synthesis, cross-topic scenarios, trade-off analysis | Analysis, case studies, cross-topic |

**Microlearning** – each content record must be self-contained and consumable in isolation. The most atomic content should just be a single piece of useful information like flashcards. Include enough context that a record makes sense without reading surrounding records.

**Multimodal** – currently disabled. Only generate `content_type: "text"` records.

**Syllabus design:**
- Use topic ordering in the `topics` array to specify the logical learning sequence
- Use `prerequisites` arrays on subtopics to specify prerequisite subtopic IDs (handle circular dependencies with first-come-first-serve)
- Include `objectives` arrays on each subtopic with specific, measurable learning objectives
- Include a dedicated cross-topic integration topic at the end if possible
- If exam-focused, include exam-specific question patterns (timing, format, trick options)

**Distribution targets (approximate):**
- Mix question types across singleChoice, multiChoice, freeText, and ordering — distribution varies based on phase, topic, and exam format; no fixed percentages required
- `singleChoice` questions can take many variants: true/false, assertion/reason, best-answer, exception-based, etc.
- Difficulty usually correlates with phase: atomic→0-1, complex→2-3, integration→3-4, but is flexible

---

### Progress Detection

**When resuming an existing course, assess completion:**

1. **Check syllabus.json:**
   - If missing → start from Step 1 (Syllabus)
   - If present → parse it to understand topics and subtopics

2. **Check content directory:**
   - List all `content/{subtopic-id}.json` files that exist
   - Calculate how many topics have complete or partial content
   - Identify missing topics

3. **Check questions directory:**
   - List all `questions/{subtopic-id}.json` files that exist
   - Calculate completion status

4. **Report to user:**
   ```
   Existing course: spanish-a2
   - Syllabus: ✅ Complete (4 topics, 12 subtopics)
   - Content: ⚠️  Partial (Topic 1 done, Topics 2-4 pending)
   - Questions: ❌ Not started

   What would you like to do?
   - [A] Continue with Topic 2 content
   - [B] Regenerate Topic 1 content
   - [C] Start generating questions for Topic 1
   - [D] Other
   ```

---

### Step 1 — Syllabus (Generate or Review)

**If no syllabus exists:**
1. Generate `courseData/{course-id}/syllabus.json` as a nested JSON object with the course root and its topics/sub_topics hierarchy
2. Include `objectives` and `prerequisites` arrays on each subtopic
3. Pause and show the user:
   - The course ID and name
   - A tree view of topics and subtopics
   - Approximate content/question counts per topic
   - Any scope concerns
   - Key learning objectives per topic
4. Ask: "Does this syllabus look good? Reply yes to continue to content generation, or provide feedback to revise."
5. Do not proceed to Step 2 until the user approves

**If syllabus exists:**
1. Load `courseData/{course-id}/syllabus.json`
2. Show the user the existing structure
3. Ask if they want to:
   - **Keep and continue**: Use this syllabus for content/question generation
   - **Modify**: Revise the syllabus before proceeding
   - **Regenerate**: Create a new syllabus (backup the old one)
4. If modifying, apply edits and re-approve before proceeding

---

### Step 2 — Content Generation (Generate or Resume)

Generate content depth-first, one topic at a time.

**Before starting:**
1. Check which content files already exist
2. If any exist, show the user:
   - Which topics have content already
   - Which topics need content
3. Ask if they want to:
   - **Continue**: Skip existing files, generate remaining topics
   - **Regenerate topic N**: Overwrite specific topic(s)
   - **Regenerate all**: Start fresh (backup existing files)

**For each topic (starting with the first unapproved or requested):**
1. Create `courseData/{course-id}/content/{subtopic-id}.json` for each subtopic
2. Show a summary (record count, phases covered, sample titles)
3. Ask: "Content for topic X looks good? Reply yes to continue with remaining topics, or provide feedback."
4. Once approved, continue to next topic without interruption

**Progress tracking:**
- After each topic is generated and approved, note which topics are done
- If interrupted, the user can resume later with the same command + `from topic N content` or similar
- Upon resumption, display a progress summary (e.g., "Topics 1–2 content done; starting Topic 3")

---

### Step 3 — Questions (Generate or Resume)

Generate questions depth-first, one topic at a time. Follow the same pattern as Step 2.

**Before starting:**
1. Check which question files already exist
2. If any exist, ask if user wants to continue, regenerate specific topics, or regenerate all

**For each topic (starting with the first unapproved or requested):**
1. Create `courseData/{course-id}/questions/{subtopic-id}.json` for each subtopic
2. Show a summary (question count, types, difficulty distribution, phases covered)
3. Ask: "Questions for topic X look good? Reply yes to continue with remaining topics."
4. Once approved, continue to next topic

**Progress tracking:**
- After each topic is generated and approved, note completion
- Allow resumption with `from topic N content` or `from topic N questions`

---

### Specialization Note

This skill generates a **generic course**. For specialized domains (e.g. language learning, certification exams with specific item formats), a separate skill should inherit from this one and override the relevant behavior.

---

### Constraints

**Core generation:**
- Do not generate `id`, `embedding`, `active`, `base_content`, `checksum`, `content_ids`, or `question_ids` — these are populated by the upload pipeline
- Do not install dependencies or modify any files outside `courseData/`
- Only generate `content_type: "text"` (multimodal is disabled)
- `syllabus_id` on content/question records must be a subtopic ID (e.g. `spanish-a2.1.1`)
- Include `objectives` (array of learning objectives) and `prerequisites` (array of prerequisite subtopic IDs) on each subtopic

**Resume and partial generation:**
- Before overwriting existing files (content or questions), offer to back them up by creating a timestamped copy (e.g. `{subtopic-id}.json.backup.20240115`)
- When resuming, check the existing syllabus and verify it matches the course ID — if mismatch, alert the user
- If regenerating a specific topic, do not touch other topics' files
- Track which topics/phases have been generated and approved; display progress on resumption

### Resume Syntax

Users can resume or modify course generation with these patterns:

```
# Resume from where it left off
/generate-course spanish-a2 resume

# Resume from a specific topic (content generation)
/generate-course spanish-a2 from topic 2 content

# Resume from a specific topic (questions)
/generate-course spanish-a2 from topic 3 questions

# Regenerate a specific topic (overwrite existing)
/generate-course spanish-a2 regenerate topic 1

# Regenerate specific topics
/generate-course spanish-a2 regenerate topics 2, 4, 5

# Regenerate all content/questions
/generate-course spanish-a2 regenerate all content
/generate-course spanish-a2 regenerate all questions

# Modify existing syllabus
/generate-course spanish-a2 revise syllabus
```

---

## Examples

### Creating a new course from scratch

```
/generate-course Spanish A2 proficiency, prerequisites: Spanish A1
/generate-course AWS Security Specialty cert, exam: AWS Security Specialty, only care about passing
/generate-course Econ 101, no prerequisites
/generate-course "French B2" prerequisites="French B1" exam="DELF B2"
```

### Resuming a partially generated course

```
/generate-course spanish-a2 resume
/generate-course aws-security-specialty from topic 3 content
/generate-course french-b2 regenerate topic 2
```
