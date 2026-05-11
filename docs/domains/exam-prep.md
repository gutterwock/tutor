# Domain: Exam Prep

Courses designed to prepare learners for a specific examination — standardised tests, professional certifications, academic qualifications, or entrance exams.

## Detection Signals

exam, test, certification, GCSE, A-level, AP, SAT, ACT, IELTS, TOEFL, GMAT, GRE, LSAT, CPA, CompTIA, AWS, PMP, bar exam, board exam, entrance exam, revision, mark scheme, past paper, grade, score, pass, cert

---

## Syllabus Guidelines

- Structure topics to match the exam's own syllabus or mark scheme — use the same terminology the exam uses
- Note the exam name and relevant sitting/version in the course description
- Prioritise topics by their weight in the actual exam (high-mark topics first)
- Include a topic on exam technique and timing, not just content knowledge

---

## Content Guidelines

- Be precise and concise — learners need to recall quickly under time pressure
- Flag common exam pitfalls and traps explicitly ("Examiners often penalise...", "A common mistake is...")
- Where the exam uses specific terminology or phrasing, use exactly that phrasing
- Include mark scheme logic where relevant: explain what earns marks, not just what is correct
- Worked examples should be structured like model exam answers, not textbook explanations
- Use **LaTeX** for mathematical, statistical, or scientific notation (`$inline$`, `$$display$$`) — Greek letters, subscripts/superscripts, chemical notation. Match the exam's notation exactly.
- Use **Mermaid** diagrams for process steps, decision trees, and flowcharts that mirror how exam questions present structured problems

---

## Question Guidelines

- Mirror the format of the actual exam as closely as possible
- `singleChoice` when the real exam uses MCQ
- `freeText` for essay or extended-response exams; explanation should include a model answer with annotated mark scheme points
- `exactMatch` for definitions, formulas, or facts the exam requires verbatim recall of
- Difficulty calibrated to the actual exam — do not make questions easier to be encouraging
- Every question must have an explanation regardless of difficulty — understanding why a wrong answer is wrong is critical for exam prep

---

## Subagent Instructions

Append the following to every subagent prompt when this domain is active:

- Mirror exam format and terminology exactly
- Flag pitfalls explicitly ("Examiners often penalise...", "A common mistake...")
- Worked examples: model exam answers, not textbook; include mark scheme logic
- Every question needs `explanation:` — for freeText, annotate mark scheme points
- Difficulty: calibrated to real exam, do not simplify
- LaTeX for math/science notation; Mermaid for process diagrams
