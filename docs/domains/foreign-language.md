# Domain: Foreign Language

Courses teaching a natural language to non-native speakers. CEFR-aware, bilingual, organised around communicative competency areas.

## Detection Signals

language, French, Spanish, German, Italian, Japanese, Mandarin, Arabic, Portuguese, Korean, Russian, grammar, vocabulary, conjugation, pronunciation, speaking, listening, reading comprehension, translation, fluency, beginner, intermediate, advanced, A1, A2, B1, B2, C1, C2, CEFR, DELE, DELF, JLPT, HSK, Goethe, N3, N4, N5

---

## Scope Validation

Scope to a single CEFR (or equivalent) level. If no level given, offer: **Split** (one sub-course per level), **Reduce** (pick one level), or **Proceed anyway**. A known exam scope (e.g. JLPT N3) counts as a level boundary.

**Course ID format:** `{language}-{level}` — e.g. `french-a1`, `spanish-b2`, `mandarin-hsk3`.

Parse from the subject: **language**, **level** (CEFR or equivalent), **native_language** (default English), **exam** (DELE/DELF/JLPT/HSK/Goethe if applicable), **focus** (default balanced), **media** (specific titles or `general`).

---

## Media Companion Course

After confirming language and level, offer a media companion course: a separate course teaching vocabulary, idioms, and register specific to one piece of media, designed to be studied alongside consuming it.

Suggest 3–4 level-appropriate titles. Level guidance: A1 — simple animated series, picture books; A2 — graded readers, visual sitcoms, children's films; B1 — mainstream films, popular novels, general podcasts; B2+ — literary novels, prestige TV, news media, dense or accented dialogue. Include print alongside audiovisual where appropriate.

If the user names their own title, assess its linguistic complexity vs the course level. Flag mismatches (too hard or too easy) with a brief reason and ask whether to proceed anyway.

**Media course structure — language only, not media analysis:**
- **Course ID:** `{language}-media-{title-slug}`
- **Prerequisites:** companion proficiency course
- **Size:** 4–6 topics, 2–4 subtopics each
- **Content:** vocabulary, idioms, fixed expressions, cultural references, register features that appear in the media — no general proficiency content, no plot summary, no thematic analysis
- **Integration topic:** language recurring across the whole piece

**Organise syllabus by media type:**

| Media type | Organise by |
|------------|-------------|
| Film | Acts or major scene clusters |
| TV series | Episode groups or story arcs |
| Novel / graded reader | Chapters or thematic sections |
| Short story collection | Stories or thematic clusters |
| Newspaper / magazine | Issues, columns, or thematic clusters |
| Podcast | Episode themes or recurring topic areas |
| Music (album/artist) | Songs or thematic clusters |
| Music (single track) | Verse/chorus sections |
| Video game | Acts, areas, or storyline arcs |

---

## Syllabus Guidelines

Organise around communicative competency areas — not all required at every level:

1. **Vocabulary** — thematic sets; one cluster per subtopic
2. **Grammar** — one structure per subtopic
3. **Reading** — comprehension strategies and level-appropriate texts
4. **Listening** — scenario descriptions (no audio); one task type per subtopic
5. **Speaking** — prompts and spoken grammar patterns
6. **Writing** — tasks, discourse structure, written grammar
7. **Pronunciation** — one phonological feature per subtopic
8. **Culture & Pragmatics** — norms, register, idioms

At A1, Culture may be folded into Vocabulary. End with an **Integration** topic. If exam-focused, add an **Exam Strategies** topic matching actual exam item types.

### Topic ordering — lead with accessibility

**Beginner courses (A1, HSK 1, JLPT N5, or equivalent) only:** Always open with something immediately usable (greetings, social phrases, numbers, high-frequency vocabulary). Never open with theory.

**Intermediate and advanced courses (A2+):** Opening with grammar or theory is fine — learners already have communicative grounding and benefit from explicit structure up front.

For beginner courses, how long to delay formal theory depends on language distance from the learner's L1:

- **Close** (shared alphabet, vocabulary overlap, familiar grammar — e.g. Spanish/French/Italian for English speakers): delay phonology and abstract grammar until mid-course. The learner can approximate pronunciation and read the script from day one.
- **Moderate** (some shared script or cognates but significant phonological/structural differences — e.g. German, Portuguese): one early pronunciation topic is reasonable; still lead with greetings first.
- **Distant** (different script, very different sound system or grammar — e.g. Japanese, Mandarin, Arabic, Korean): script and phonology must come early — the learner cannot function without them. 1–2 script/sound topics before communicative content.

---

## Content Guidelines

**Vocabulary (`type:vocabulary-item`)** — one item per block. Meta: `word`, `pos`, `gender` (if applicable), `register`, `ipa`/`pinyin`/`romaji`, `cefrLevel`. Body: bolded word, pronunciation, English gloss, grammatical info, 2–3 bilingual examples, usage note if relevant.

**Grammar (`type:grammar-rule`)** — one structure per block. Meta: `structureName`, `cefrLevel`. Body: rule, formation table, positive/negative/question forms, L1 contrast, 3–5 bilingual examples, common errors.

**Reading/Listening** — inline passage (150–400 words for reading; scenario description for listening). Meta: `wordCount`, `textType`.

**Pronunciation** — plain-language sound description, minimal pairs, production drill (sound → syllable → word → sentence).

**Culture/Pragmatics** — real scenario, L1 comparison, short example dialogue showing register.

**Bilingual rule:** Every L2 string must have an inline English gloss. No exceptions.

**Media augmentation:**
- Default: cite authentic examples organically — `*From [Title] ([year]): "[L2]" — "[English]"*`. Do not force.
- If `media` specifies titles: weave vocabulary and phrases from those titles into relevant subtopics. For songs use themes/vocabulary, not lyrics.

---

## Question Guidelines

| Phase | Types | Focus |
|-------|-------|-------|
| atomic | singleChoice (translation, definition, form ID), freeText (single word/form) | recall, translation, form-selection |
| complex | singleChoice (grammar application, error correction, register), freeText (sentence), ordering (reconstruction) | production, error-correction, comprehension |
| integration | singleChoice (passage context), freeText (paragraph/dialogue), multiChoice (correct uses) | comprehension, production, register |

**Per-subtopic minimums:**
- Vocabulary: L2→L1 translation, L1→L2 recall, fill-in-blank, register question
- Grammar: form ID, correct-form selection, error correction, sentence-production freeText
- Integration: at least one passage-based comprehension question

**freeText scaling (critical at A1–A2):** First ~3 topics → single word or short fixed phrase only. Mid-course → one simple clause. Later/integration → full sentence or short paragraph. The `answer` field must match this scale. At B1+ start with full sentences.

**Distractors:** related vocabulary, plausible conjugation errors, near-synonyms — never obviously wrong.

---

## Tags

- **Skill:** `skill:vocabulary`, `skill:grammar`, `skill:reading`, `skill:listening`, `skill:speaking`, `skill:writing`, `skill:pronunciation`, `skill:culture`
- **Content type:** `type:vocabulary-item`, `type:grammar-rule`, `type:conjugation-table`, `type:example-dialogue`, `type:reading-passage`, `type:cultural-note`, `type:pronunciation-guide`, `type:exam-strategy`
- **Question focus:** `focus:recall`, `focus:production`, `focus:comprehension`, `focus:error-correction`, `focus:translation`, `focus:form-selection`, `focus:register`
- **Register:** `register:formal`, `register:informal`, `register:neutral`
- **Frequency:** `freq:high`, `freq:mid`, `freq:low`
- **Media:** `source:media`, `media-type:{tv|film|music|literature|graded-reader|manga|anime|podcast|newspaper|magazine|short-story}`, `media-title:[slug]`

---

## Distribution Targets

- **Vocabulary subtopics:** 8–15 vocab items in `phase:atomic`, plus complex/integration usage records. 10–20 questions.
- **Grammar subtopics:** 1–2 rule records (atomic), 3–5 application records (complex), 2–3 cross-structure records (integration). 8–15 questions.

---

## Subagent Instructions

Append the following to every subagent prompt when this domain is active:

- `type:vocabulary-item`: one item/block; meta: word, pos, gender?, register, ipa/pinyin/romaji, cefrLevel
- `type:grammar-rule`: one structure/block; meta: structureName, cefrLevel
- Reading/Listening blocks: meta: wordCount, textType
- **Bilingual:** every L2 string needs inline English gloss — no exceptions
- freeText: early (~3 topics) → word/phrase only; mid-course → one clause; later/integration → full sentence+
- Distractors: related vocab, plausible conjugation errors, near-synonyms — never obviously wrong
