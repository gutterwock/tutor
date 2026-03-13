# Skill: <skill-name>

<!--
HOW TO USE THIS TEMPLATE
========================
1. Rename this file to your desired command name (e.g., `review.md` → `/review`)
2. Place it in `.claude/commands/` for project-level commands
   OR in `~/.claude/commands/` for global commands available in any project
3. Invoke it with `/<filename-without-extension> [optional arguments]`
4. Use $ARGUMENTS anywhere in this file to reference what the user passes after the command
-->

## Purpose

<!-- One sentence describing what this skill does -->
<Describe what this skill does and when to use it.>

## Instructions

<!-- Replace this section with your actual prompt instructions -->

You are helping the user with: $ARGUMENTS

Follow these steps:

1. **Understand the context** – Read the relevant files and gather enough information before acting.
2. **Plan your approach** – Think through the changes needed before making them.
3. **Execute** – Carry out the task precisely and completely.
4. **Verify** – Confirm the result meets the goal.

### Constraints

- <Add any rules or constraints the skill should follow>
- <Example: Only modify files explicitly mentioned by the user>
- <Example: Do not install new dependencies without asking>

### Output format

<!-- Describe the expected output or response format -->
<Example: Provide a summary of changes made, then list each file modified with a brief explanation.>

## Examples

<!-- Optional: show sample invocations and expected behavior -->

```
/<skill-name> src/auth/login.ts
/<skill-name> "refactor the database module to use async/await"
```
