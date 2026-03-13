---
description: Generate a structured language course (syllabus, content, questions) with CEFR-aware scoping and bilingual content
---

# Skill: generate-language-course

## Instructions

You are generating a language course for the adaptive learning platform. The user has provided: $ARGUMENTS

**This skill extends `generate-course`.** Read `.claude/commands/generate-course.md` for base behavior (mode detection, steps, subagent dispatch). Follow all base behavior unless overridden below.

**Parse input to extract:**
- **language** – target language
- **level** – CEFR or equivalent (A2, HSK 3, N3). Infer from subject if present.
- **native_language** – learner's L1. Default: English.
- **prerequisites** – default: level below (CEFR) or "none" (A1/beginner).
- **exam** – specific language exam (DELE, DELF, JLPT, HSK, Goethe) if applicable.
- **focus** – optional skill emphasis (conversation, reading, business). Default: balanced.
- **media** – optional: specific titles (`book: "Le Petit Prince"`, `show: "La Casa de Papel"`) or `general`/omitted for organic enrichment.

---

### Override: Scope Validation

Language courses must be scoped to a single CEFR/equivalent level. If no level given, offer: **Split** (per-level sub-courses), **Reduce** (pick one level), or **Proceed anyway**. Known exam scope (e.g. JLPT N3) counts as a level boundary.

### Override: Course ID

Slug from language + level: `spanish-a2`, `japanese-n3`, `mandarin-hsk3`.

---

### Override: Syllabus Design

Organize around communicative competency areas:

1. **Vocabulary** – thematic sets (daily routines, work, travel)
2. **Grammar** – structures introduced/consolidated at this level
3. **Reading** – comprehension strategies and level-appropriate texts
4. **Listening** – text-based scenario descriptions (no audio)
5. **Speaking / Oral Production** – prompts, spoken grammar patterns
6. **Writing** – tasks, discourse structure, written grammar
7. **Pronunciation** – phonology, stress, intonation
8. **Culture & Pragmatics** – norms, register, idioms

Not all required for every level (e.g. A1 may fold Culture into Vocabulary). End with an **Integration** topic.

**Subtopic design:** Vocabulary = thematic clusters; Grammar = one structure per subtopic; Reading/Listening/Writing/Speaking = one task type per subtopic; Pronunciation = one phonological feature. Exam-focused: add **Exam Strategies** topic matching actual exam item types.

---

### Media Augmentation

**General enrichment** (`media: general` or omitted): When a well-known authentic example naturally uses the target word/structure, use it as one example sentence. Format: `*From [Title] ([year]): "[L2 example]" — "[English]"*`. Don't force it.

**Targeted media** (specific titles): Extract level-appropriate vocabulary/phrases and weave into existing thematic subtopics with tags `source:media`, `media-title:[slug]`. For songs: use themes/vocabulary, not full lyrics. Note register differences.

---

### Override: Tags

All base tags (`phase:*`) apply. Add these language-specific tags:

- **Skill:** `skill:vocabulary`, `skill:grammar`, `skill:reading`, `skill:listening`, `skill:speaking`, `skill:writing`, `skill:pronunciation`, `skill:culture`
- **Content type:** `type:vocabulary-item`, `type:grammar-rule`, `type:conjugation-table`, `type:example-dialogue`, `type:reading-passage`, `type:cultural-note`, `type:pronunciation-guide`, `type:exam-strategy`
- **Question focus:** `focus:recall`, `focus:production`, `focus:comprehension`, `focus:error-correction`, `focus:translation`, `focus:form-selection`, `focus:register`
- **Register:** `register:formal`, `register:informal`, `register:neutral`
- **Frequency:** `freq:high`, `freq:mid`, `freq:low`
- **Media:** `source:media`, `media-type:{tv|film|music|literature|manga|anime|podcast}`, `media-title:[slug]`

---

### Override: Content Generation

Follow the base skill's review loop and subagent dispatch. Append these language-specific rules directly into subagent prompts (do not tell subagents to read this file):

**Vocabulary (`type:vocabulary-item`):** One lexical item per record. Header: `meta.word:`, `meta.pos:`, `meta.gender:` (if applicable), `meta.register:`, `meta.ipa:` (or `meta.pinyin:`/`meta.romaji:`), `meta.cefrLevel:`. Body: bolded target word, pronunciation, English translation, grammatical info, 2–3 example sentences with translations, usage/register note if relevant.

**Grammar (`type:grammar-rule`):** Header: `meta.structureName:`, `meta.cefrLevel:`. Body: rule statement, formation table, positive/negative/question forms, contrastive note, 3–5 examples with translations, common errors.

**Reading/Listening:** Inline passage (150–400 words reading; scenario description for listening). Header: `meta.wordCount:`, `meta.textType:`. Follow with comprehension focus notes.

**Pronunciation:** Plain-language description, minimal pairs, production drill (sound → syllable → word → sentence).

**Culture/Pragmatics:** Real scenario, L1 comparison, short example dialogue.

**Bilingual rule:** Every target-language text must include inline English translation.

---

### Override: Question Generation

| Phase | Types | Focus |
|---|---|---|
| atomic | singleChoice (translation, definition, form ID), freeText (produce form/word) | recall, translation, form-selection |
| complex | singleChoice (grammar application, error correction, register), freeText (sentence production), ordering (sentence reconstruction) | production, error-correction, comprehension |
| integration | singleChoice with passage, freeText (paragraph/dialogue), multiChoice (correct uses) | comprehension, production, register |

**Per subtopic minimums:** Vocabulary: L2→L1, L1→L2, fill-in-blank, register question. Grammar: form ID, correct-form selection, error correction, sentence-production freeText. Integration: passage-based comprehension.

**Distractors:** Use related vocabulary, common conjugation errors, near-synonyms. Never obviously wrong.

---

### Distribution Targets

- **Vocabulary subtopics:** 8–15 vocab items in `phase:atomic`, plus complex/integration usage records. 10–20 questions.
- **Grammar subtopics:** 1–2 rule records (atomic), 3–5 application records (complex), 2–3 cross-structure records (integration). 8–15 questions.

---

### Constraints

All base constraints plus: all example sentences must be grammatically correct in L2; exam courses must match target exam item formats; never fabricate attributed quotes.
