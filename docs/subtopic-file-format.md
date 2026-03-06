# Subtopic File Format

Each subtopic is a single `.md` file containing interleaved content blocks and questions.

See [structured-content-format.md](structured-content-format.md) and [structured-question-format.md](structured-question-format.md) for full block-level specs.

## File naming

```
courseData/{course-id}/{subtopic-id}.md
```

Filenames are for organisation only. `syllabus_id` is declared inside the file.

## File header

The file must open with a `syllabus_id:` line. An optional `# Title` follows for human readability.

```markdown
syllabus_id: aws-security-specialty.1.1
# GuardDuty — Fundamentals
```

## Block types

- `##` — content block (see [structured-content-format.md](structured-content-format.md))
- `###` — question block (see [structured-question-format.md](structured-question-format.md))

## content→question linking

A question's `content_ids` is determined by its position relative to content blocks:

- A `###` question belongs to the nearest preceding `##` content block
- Multiple questions after the same `##` all gate on that block
- A `###` before any `##` has no preceding content block → `content_ids: []` → ungated

```
### Q0                ← ungated (content_ids: [])

## Content A
### Q1                ← gated on A
### Q2                ← gated on A

## Content B
### Q3                ← gated on B
### Q4                ← gated on B
```

## Questions-only subtopics

A subtopic with no `##` content blocks is valid — all questions will be ungated (`content_ids: []`). This pattern suits pure practice sets, diagnostic assessments, or vocab drills where content is delivered elsewhere.

However, if a user struggles in a questions-only subtopic, adaptive content generation has no existing body text to use as context. It will rely entirely on the tags of the failed questions plus the subtopic's syllabus objectives. Thorough tagging is therefore more important in questions-only files than in content+question files.

## Recommended ordering

Group blocks by phase, atomic through integration. Within each phase, content precedes its questions:

```
[optional ungated diagnostic questions]

phase:atomic content and questions
phase:complex content and questions
phase:integration content and questions
```

## Full example

````markdown
syllabus_id: aws-security-specialty.1.1
# IAM — Users and Roles

### question singleChoice difficulty:1
tags: phase:atomic
Which of the following best describes an IAM identity?
a: A VPC subnet
b: An entity that can make requests to AWS
c: An S3 bucket policy
d: A CloudFormation stack
answer: b

## [phase:atomic] IAM Users Overview
tags: iam, users

IAM users are long-term identities representing a person or application. They have
static credentials (password and/or access keys) and belong to a single AWS account.

### question singleChoice difficulty:1
tags: phase:atomic
What credential type does an IAM user have?
a: Temporary tokens issued by STS
b: Static password and/or access keys
c: X.509 certificates
d: No credentials — permissions only
answer: b

### question singleChoice difficulty:1
tags: phase:atomic
IAM roles use long-term static credentials.
a: True
b: False
answer: b

## [phase:atomic] IAM Roles Overview
tags: iam, roles

IAM roles are temporary identities assumed by trusted entities. They have no static
credentials — a caller requests short-lived tokens via STS. Roles are used by EC2
instances, Lambda functions, cross-account access, and identity federation.

### question multiChoice difficulty:1
tags: phase:atomic
Which of the following use IAM roles rather than IAM users? (select all that apply)
a: EC2 instance profiles
b: Cross-account access
c: Human operators with console access
d: Lambda execution
answer: abd

## [phase:complex] Choosing Between Users and Roles
tags: iam, users, roles

Prefer roles over users whenever possible. Roles eliminate the need to manage and
rotate static credentials, reduce the blast radius of a compromise, and can be scoped
tightly to a resource or action via the trust policy.

### question singleChoice difficulty:2
tags: phase:complex
A company wants EC2 instances to read from S3 without hardcoding credentials. What
is the correct approach?
a: Create an IAM user, generate access keys, store them in the instance
b: Attach an IAM role to the EC2 instance with an S3 read policy
c: Use the root account credentials
d: Store credentials in Parameter Store and retrieve at boot
answer: b

## [phase:integration] Cross-Topic: IAM in a Multi-Account Architecture
tags: iam, organizations, architecture

In an enterprise with many AWS accounts, cross-account roles replace all direct IAM
user access to member accounts. A central identity account holds all IAM users; those
users assume roles in target accounts via STS.

### question singleChoice difficulty:3
tags: phase:integration
**Assertion:** IAM roles are preferred over IAM users for EC2 instances.
**Reason:** IAM roles provide temporary credentials that are automatically rotated.
a: Both assertion and reason are true, and the reason correctly explains the assertion
b: Both assertion and reason are true, but the reason does not explain the assertion
c: The assertion is true but the reason is false
d: The assertion is false but the reason is true
e: Both assertion and reason are false
answer: a

### question freeText difficulty:4
tags: phase:integration
Explain how cross-account role assumption works in an AWS Organizations setup, and
what SCPs add to the model.
answer: Users in a central identity account assume roles in member accounts via STS. The trust policy on each role specifies which principals may assume it. SCPs applied at the OU or account level act as a permission ceiling — they restrict what the assumed role can do even if the role's permission policy allows it.
````
