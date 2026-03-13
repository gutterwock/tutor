---
description: Interactively teach a subtopic from a courseData .md file within the Claude session
---

# Skill: teach

## Instructions

The user has provided: $ARGUMENTS

**Locate the file.** Parse $ARGUMENTS:
- Subtopic ID (e.g. `japanese-writing-systems.1.1`) → `courseData/{course-id}/{subtopic-id}.md` where course-id is the part before the first dot
- Full path → use as-is
- Missing/ambiguous → list `courseData/` courses and ask

**Distill (silent).** Read the file once. Extract a compact internal outline: per phase (atomic/complex/integration), one-line concept summaries + question topics from the question bank. Teach from this outline only — do not re-read or quote the file.

**Teach.** Work phase by phase, one concept at a time:
1. Explain concisely in your own words
2. Ask one check question — wait for the answer
3. Brief feedback; re-explain only if missed
4. Next concept

If the user is clearly ahead, compress and skip checks. Skip a phase if it has no content.

**Close.** Only flag concepts the user struggled with. Skip recap unless they ask. Then look up the next subtopic in the syllabus and ask: "Ready for {next-subtopic-name}, or done for now?" If they continue, suggest starting a new conversation with `/teach {next-subtopic-id}` to keep context clean.

## Examples

```
/teach japanese-writing-systems.1.1
/teach aws-security-specialty.2.3
/teach courseData/mandarin-hsk1-reading/mandarin-hsk1-reading.1.2.md
```
