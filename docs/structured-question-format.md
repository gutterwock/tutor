# Structured Question Format

Questions are embedded in subtopic `.md` files alongside content blocks. Each question opens with a `### question` heading and ends at the next `##` or `###` heading.

## Header

```
### question <type> [caseSensitive] difficulty:<n>
```

- `type` — one of `singleChoice`, `multiChoice`, `ordering`, `freeText`, `exactMatch`
- `caseSensitive` — optional flag, `exactMatch` only; omit for case-insensitive matching (default)
- `difficulty` — integer 0–4

## Tags

```
tags: phase:atomic, focus:translation
```

- Comma-separated
- Must include exactly one `phase:*` tag (`phase:atomic`, `phase:complex`, `phase:integration`)
- Topic/subject tags are inherited from the enclosing subtopic — omit them here
- Additional skill/focus tags are optional

## Question text

Follows `tags:` and supports full markdown including fenced blocks (e.g. Mermaid diagrams). The parser only matches option lines and `answer:` lines when **not** inside a fenced block.

## Options

Bare `key: text` lines immediately before the `answer:` line(s). 2–5 options, conventionally keyed `a`–`e`. Omitted for `freeText` and `exactMatch`.

## Answer

- `singleChoice` — single `answer:` line with one key
- `multiChoice` — single `answer:` line with concatenated keys, no separator (`answer: abc`)
- `ordering` — single `answer:` line with keys in correct sequence, no separator (`answer: bcad`)
- `freeText` — single `answer:` line with a plain-prose sample correct response (used as AI grading reference)
- `exactMatch` — one `answer:` line per accepted string; all lines are checked; no delimiter or escaping needed

## Explanation (optional)

```
explanation: <text>
```

A brief explanation shown to the user after answering. Supports inline markdown but not block elements (no fenced blocks, no headings).

**Use sparingly** — only for questions where the correct answer is genuinely counterintuitive, where a common misconception makes a wrong option plausible, or where the reasoning is not obvious from the question alone. The vast majority of questions should not have an explanation; if the question is well-written it should be self-evident why the answer is correct.

## show_with_content (optional)

```
show_with_content: true
```

Placed after the `tags:` line. When set to `true`, the body of the nearest preceding content block is copied into a `passage` field on the question and displayed above the question text at study time.

**When to use:** Only for genuine data-interpretation or reading-comprehension questions where the question is literally unanswerable without reading a specific table, chart, or text excerpt. Examples: "Based on the table above, which region had the highest growth?" or "According to the passage, what is the author's main claim?"

**Do not use** for ordinary recall or application questions that happen to follow a content block. If the question tests long-term knowledge (not immediate passage comprehension), it should be self-contained.

**Only valid** when the question is gated on a content block (i.e., it follows a `##` block, not placed ungated before the first `##`).

### Example

```markdown
## [phase:complex] Regional Sales Summary

tags: focus:data-analysis

| Region | Q1 | Q2 | Q3 | Q4 |
|--------|----|----|----|----|
| North  | 120 | 135 | 128 | 142 |
| South  | 98  | 102 | 115 | 109 |
| East   | 145 | 139 | 160 | 171 |

### question singleChoice difficulty:2
tags: phase:complex, focus:data-analysis
show_with_content: true
Based on the table, which region had the highest Q4 sales?
a: North
b: South
c: East
answer: c
```

---

## Examples

### singleChoice

```markdown
### question singleChoice difficulty:1
tags: phase:atomic
What is an IAM user?
a: An AWS account
b: An entity representing a person or application
c: A group of permissions
d: A temporary credential
answer: b
explanation: Only use explanation when the answer is counterintuitive.
```

singleChoice variants: true/false (2 options `a: True` / `b: False`), assertion/reason (5 options a–e), best-answer, exception-based ("which is NOT…").

### multiChoice

```markdown
### question multiChoice difficulty:2
tags: phase:complex
Which are valid IAM principal types? (select all that apply)
a: IAM Users
b: IAM Groups
c: IAM Roles
d: IAM Policies
answer: abc
```

### ordering

```markdown
### question ordering difficulty:2
tags: phase:complex
Order the steps to grant cross-account access using IAM roles:
a: Attach permission policies to the role
b: Create an IAM role in the target account
c: Define a trust policy specifying the source account
d: The user assumes the role via STS
answer: bcad
```

### freeText

```markdown
### question freeText difficulty:3
tags: phase:integration
Explain the difference between IAM roles and IAM users.
answer: IAM users are long-term identities with static credentials. IAM roles are temporary identities assumed via STS — used for cross-account access, instance profiles, Lambda, and federation.
```

### exactMatch

```markdown
### question exactMatch difficulty:1
tags: phase:atomic, focus:production
Type the Chinese character for "to see".
answer: 看
answer: 看见
answer: kàn
```

Add `caseSensitive` after `exactMatch` when case matters: `### question exactMatch caseSensitive difficulty:1`

---

## Grading

| Type | Method |
|------|--------|
| `singleChoice` | Exact key match |
| `multiChoice` | Set equality of selected keys vs answer keys |
| `ordering` | Exact sequence match |
| `freeText` | AI-graded; `answer:` is a sample correct response used as reference |
| `exactMatch` | Whitespace-trimmed string match against accepted list; case-insensitive unless `caseSensitive` flag present |
