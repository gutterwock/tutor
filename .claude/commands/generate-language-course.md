---
description: Generate a structured language course (syllabus, content, questions) with CEFR-aware scoping and bilingual content
---

# Skill: generate-language-course

## Instructions

You are generating a language course for the adaptive learning platform. The user has provided: $ARGUMENTS

This skill **extends** `generate-course`. Follow all base skill behavior unless explicitly overridden below. When a section below says **Override**, it replaces the corresponding base behavior. When it says **Extend**, it adds to it.

Parse the input to extract:
- **language** – the target language (e.g. "Spanish", "Japanese", "French")
- **level** – CEFR level or equivalent (e.g. "A2", "B1", "HSK 3"). Infer from subject if present.
- **native_language** – the learner's L1. Default to English if not specified.
- **prerequisites** – prior level or knowledge required. Default to the level below if CEFR, or "none" if A1/beginner.
- **exam** – whether this is for a specific language exam (DELE, DELF, JLPT, HSK, Goethe, etc.) and whether exam-only or deep learning.
- **focus** – optional skill emphasis (e.g. "conversation", "reading", "business"). Default to balanced if not specified.
- **media** – optional. One of:
  - A list of specific titles the learner wants to engage with (e.g. `book: "Le Petit Prince"`, `show: "La Casa de Papel"`, `song: "Despacito"`, `film: "Spirited Away"`, `manga: "Yotsuba&!"`)
  - `general` or omitted — organically enrich content with well-known cultural examples where the vocabulary or grammar naturally supports it

If any required input is ambiguous or missing, ask the user before proceeding.

---

### Override: Scope Validation

Before generating anything, assess whether the subject is appropriately scoped.

Language courses **must** be scoped to a single CEFR level (or equivalent standard: HSK level, JLPT level, etc.). A full language without a level is always too broad.

**CEFR reference for splitting suggestions:**
| Scale | Levels |
|---|---|
| CEFR (European) | A1, A2, B1, B2, C1, C2 |
| HSK (Chinese) | HSK 1–6 (or HSK 1–3, 4–6 for broader splits) |
| JLPT (Japanese) | N5, N4, N3, N2, N1 |
| Goethe (German) | A1, A2, B1, B2, C1, C2 |

If the subject is too broad (language only, no level), prompt the user with:
1. **Split** – suggest sub-courses per level (e.g. "Spanish" → Spanish A1, A2, B1, B2, C1, C2)
2. **Reduce** – generate a single level they specify right now
3. **Proceed anyway** – generate a multi-level overview course (not recommended for deep learning)

If the subject includes an exam with known scope (e.g. JLPT N3), treat that as the level boundary — do not require a separate CEFR level.

---

### Override: Course ID

Determine the course ID as a lowercase hyphenated slug from the language and level (e.g. `spanish-a2`, `japanese-n3`, `french-b1`, `mandarin-hsk3`).

---

### Override: Syllabus Design

Language syllabi must be organized around **communicative competency areas** and **linguistic systems**, not generic topic/subtopic hierarchies.

**Required top-level topic structure (adapt to the language and level):**

1. **Vocabulary** – thematic vocabulary sets appropriate to the level (e.g. daily routines, work, travel)
2. **Grammar** – grammatical structures introduced or consolidated at this level
3. **Reading** – reading comprehension strategies and level-appropriate texts
4. **Listening** – listening comprehension (note: content will be text-based descriptions, not audio, as multimodal is disabled)
5. **Speaking / Oral Production** – speaking tasks, prompts, and spoken grammar patterns
6. **Writing** – written tasks, discourse structure, written grammar patterns
7. **Pronunciation** – phonology, stress, intonation patterns relevant to the level
8. **Culture & Pragmatics** – cultural norms, register, politeness, idiomatic usage

> Not all topics are required for every level — e.g. A1 may omit Culture & Pragmatics as a separate topic and fold it into Vocabulary. Use judgment based on the level and language.

**Subtopic design rules for language:**
- Vocabulary subtopics = thematic clusters (e.g. "Food and Drink", "Transportation", "Workplace Vocabulary")
- Grammar subtopics = one grammatical structure per subtopic (e.g. "Present Perfect vs. Simple Past", "Subjunctive Mood — Wishes and Emotions")
- Reading/Listening/Writing/Speaking subtopics = one task type or strategy per subtopic (e.g. "Identifying Main Idea", "Formal Email Writing")
- Pronunciation subtopics = one phonological feature per subtopic (e.g. "Nasal Vowels", "Pitch Accent")
- End the syllabus with an **Integration** topic containing mixed-skill and cross-topic subtopics

**Exam-specific additions:**
- If exam-focused, include a dedicated **Exam Strategies** topic at the end with subtopics for each exam section (reading, listening, writing, speaking components as applicable)
- Model question formats on the actual exam item types (e.g. JLPT uses no free production; DELE includes oral interaction sections)

---

### Extend: Media Augmentation

The goal is not to teach the media — it is to use familiar or interesting media as a source of authentic, memorable examples that motivate learning. The syllabus structure does not change. No dedicated media topics or subtopics are added.

Media enrichment has two modes — both can apply simultaneously.

**General enrichment (no specific titles, or `media: general`)**

When generating vocabulary items, grammar explanations, or cultural notes, if a well-known authentic example from popular media naturally uses that word or structure, use it as one of the example sentences. This is an organic enhancement applied selectively — not a required component of every record.

Criteria:
- The word or phrase appears in a way that is natural and memorable in that context
- The work is culturally significant and widely known in the target-language community
- The example genuinely reinforces the learning objective
- Do not force it — if no strong example exists, use a generic sentence

Format for inline media examples (within the record's standard `body`, as one of the 2–3 example sentences):
```
*From [Title] ([year]): "[target-language example]" — "[English translation]"*
```

**Targeted media (specific titles provided)**

Identify vocabulary and phrases from the specified work that fall within or just above the course level, then weave those items into the relevant existing vocabulary subtopics. The learner studies the word through the normal course flow; the media connection makes the example stick.

- Add tagged vocabulary items (`source:media`, `media-title:[slug]`) to existing thematic subtopics where they fit naturally — e.g. a cooking vocabulary subtopic in a Spanish A2 course gets enriched with words from *Chef's Table España* if that was specified
- If a word from the media doesn't fit any existing subtopic, include it in the closest thematic subtopic with a note that it appears in that work
- For songs: use the themes and vocabulary in the lyrics as example sentences; do not reproduce full lyrics verbatim
- For books: draw example sentences from the work's themes, settings, and character dialogue — not necessarily exact quotes
- Note the register of the work where it differs from standard course register (e.g. a crime drama uses informal/slang register; a classic novel uses elevated register)

---

### Extend: Tags

All base tags (`phase:*`) apply. In addition, apply the following language-specific tags:

**Skill tags** (apply to all records — every record touches at least one skill):
- `skill:vocabulary`, `skill:grammar`, `skill:reading`, `skill:listening`, `skill:speaking`, `skill:writing`, `skill:pronunciation`, `skill:culture`

**Content type tags** (apply to content records):
- `type:vocabulary-item` – a single lexical item with definition/translation/example
- `type:grammar-rule` – a grammatical rule or paradigm
- `type:conjugation-table` – a verb/adjective/noun paradigm table
- `type:example-dialogue` – a short scripted dialogue
- `type:reading-passage` – a short reading text (inline in the body)
- `type:cultural-note` – pragmatic or cultural context
- `type:pronunciation-guide` – phonetic/phonological explanation
- `type:exam-strategy` – test-taking tip or strategy

**Question focus tags** (apply to question records):
- `focus:recall` – recall a form or meaning
- `focus:production` – produce a form or sentence
- `focus:comprehension` – understand a text or sentence
- `focus:error-correction` – identify or fix an error
- `focus:translation` – translate from L1↔L2
- `focus:form-selection` – choose the correct grammatical form
- `focus:register` – identify or match appropriate register

**Register tags** (apply where relevant):
- `register:formal`, `register:informal`, `register:neutral`

**Frequency tags** (apply to vocabulary content):
- `freq:high` – among the most common words at this level (top ~30%)
- `freq:mid` – moderately common
- `freq:low` – less common, level-appropriate but less frequent

**Media tags** (apply to all records derived from or enriched with media):
- `source:media` – record originates from or features an authentic media example
- `media-type:tv`, `media-type:film`, `media-type:music`, `media-type:literature`, `media-type:manga`, `media-type:anime`, `media-type:podcast`
- `media-title:[slug]` – e.g. `media-title:la-casa-de-papel`, `media-title:le-petit-prince` (lowercase hyphenated slug of the title)

---

### Override: Content Generation

Follow the base skill's step-by-step approach including the review loop and subagent dispatch. When firing subagents, append the language-specific content rules and tags below directly into the subagent prompt (do not tell subagents to read this skill file). Apply these language-specific content rules:

**Vocabulary content records:**
- Each `type:vocabulary-item` record covers **one lexical item** (word, phrase, or fixed expression)
- Content block header uses `meta.*:` lines for vocabulary metadata:
  - `meta.word:` — the headword
  - `meta.pos:` — part of speech (e.g. `verb`, `noun`, `adjective`)
  - `meta.gender:` — grammatical gender if applicable (e.g. `masculine`, `feminine`); omit if not relevant
  - `meta.register:` — `neutral`, `formal`, or `informal`
  - `meta.ipa:` — IPA transcription (or omit for languages where a simpler system is standard — use `meta.pinyin:` for Chinese, `meta.romaji:` for Japanese)
  - `meta.cefrLevel:` — CEFR or equivalent level string (e.g. `A2`, `HSK3`)
- Body must include:
  - The target-language item (bolded)
  - Pronunciation hint where helpful (IPA or phonetic approximation in parentheses)
  - English translation / definition
  - Grammatical category and any key inflectional info (gender for nouns, verb class, irregular forms)
  - 2–3 example sentences in the target language with English translations
  - Usage note or register note if relevant

**Grammar content records:**
- Block header: `meta.structureName:`, `meta.cefrLevel:`
- Body must include:
  - Clear statement of the rule
  - Formation/conjugation paradigm in a Markdown table where applicable
  - Positive, negative, and question forms where applicable
  - Contrastive note (how this differs from a similar or related structure)
  - 3–5 example sentences with translations
  - Common learner errors / pitfalls

**Reading/Listening content records:**
- Include an inline passage (150–400 words for reading; describe a spoken scenario/transcript for listening)
- Follow with comprehension focus notes (what the learner should notice)
- Block header: `meta.wordCount:` (for reading), `meta.textType:` (e.g. `email`, `news`, `conversation`)

**Pronunciation content records:**
- Describe the sound or pattern in plain language
- Provide minimal pairs or contrastive examples
- Include a simple production drill sequence (e.g. isolated sound → syllable → word → sentence)

**Cultural/Pragmatics content records:**
- Situate the cultural point in a real scenario
- Compare with English/L1 norms where helpful
- Include a short example dialogue showing the cultural point in action

**Bilingual consistency rule:** Every content record body that contains target-language text must also include the English translation inline, not in a separate record. The learner should never be left guessing meaning.

---

### Override: Question Generation

**Language question type mapping by phase:**

| Phase | Preferred Question Types | Focus |
|---|---|---|
| atomic | singleChoice (translation, definition, form identification), freeText (produce the form/word) | `focus:recall`, `focus:translation`, `focus:form-selection` |
| complex | singleChoice (grammar application, error correction, register matching), freeText (sentence-level production), ordering (reconstruct a sentence) | `focus:production`, `focus:error-correction`, `focus:comprehension` |
| integration | singleChoice with a reading passage (comprehension), freeText (paragraph production, dialogue completion), multiChoice (identify all correct uses) | `focus:comprehension`, `focus:production`, `focus:register` |

**Mandatory question variety per subtopic:**
- Every vocabulary subtopic must include at least: L2→L1 translation, L1→L2 translation, fill-in-blank in a sentence, and a register/usage question
- Every grammar subtopic must include at least: form identification, correct-form selection, error correction, and a sentence-production freeText
- Integration subtopics must include at least one passage-based comprehension question

**Language-specific question patterns** (use the base schema format from `docs/structured-question-format.md`):
- *Translation* — singleChoice: L2→L1 or L1→L2 meaning selection
- *Fill-in-the-blank* — exactMatch: complete a sentence with the correct form
- *Error correction* — singleChoice: identify the sentence with a grammatical error
- *Sentence reconstruction* — ordering: arrange words into correct sentence order
- *Passage comprehension* — singleChoice with inline L2 passage in the question text

**Distractor quality rule:** singleChoice distractors must be plausible — use related vocabulary, common conjugation errors, or near-synonyms. Never use obviously wrong distractors.

---

### Extend: Distribution Targets

In addition to base distribution targets (3–5 content records per phase per subtopic), apply:

- **Vocabulary subtopics**: target 8–15 vocabulary items in `phase:atomic` (each `type:vocabulary-item` is one record), plus complex and integration records for usage in context
- **Grammar subtopics**: target 1–2 rule/paradigm records in `phase:atomic`, 3–5 example/application records in `phase:complex`, 2–3 cross-structure comparison records in `phase:integration`
- **Questions**: aim for 10–20 questions per vocabulary subtopic; 8–15 per grammar subtopic — language retention requires higher question volume than most subjects

---

### Constraints

All base constraints apply, plus:

- All example sentences must be grammatically correct in the target language
- For exam-focused courses, integration questions must match the target exam's item format (e.g. JLPT = singleChoice only; DELE writing = freeText with rubric hints)
- Never fabricate quotes attributed to a specific work — write original sentences inspired by the work's themes if the exact wording is uncertain

---

## Examples

```
/generate-language-course Spanish A2, prerequisites: Spanish A1, native language: English
/generate-language-course Japanese N3, exam: JLPT N3, focus: reading and grammar
/generate-language-course French B1, prerequisites: French A2, exam: DELF B1
/generate-language-course Mandarin HSK 2, native language: English, focus: conversation
/generate-language-course German A1, no prerequisites, native language: English

# General media enrichment (weave in well-known cultural examples organically)
/generate-language-course Spanish A2, media: general

# Targeted media (enrich existing vocabulary subtopics with words/phrases from these works)
/generate-language-course Spanish B1, media: show "La Casa de Papel", film "Pan's Labyrinth"
/generate-language-course French A2, media: book "Le Petit Prince"
/generate-language-course Japanese N4, media: anime "My Neighbor Totoro", manga "Yotsuba&!"
/generate-language-course Italian A2, media: song "Volare", film "Cinema Paradiso"
```
