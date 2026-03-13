# Syllabus File Format

One `syllabus.md` per course, defining the full course/topic/subtopic hierarchy.

```
courseData/{course-id}/syllabus.md
```

## Heading levels

- `#` — course root
- `##` — topic
- `###` — subtopic

Sort order is determined by position in the file — no explicit field needed.

## Metadata lines

Follow the heading, one key per line. List values (`prerequisites:`, `objectives:`) use `- item` lines immediately below the key.

### Course fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | Course slug, e.g. `aws-security-specialty` |
| `description:` | yes | Single line |
| `prerequisites:` | no | List of free-text knowledge/skill requirements |
| `exam:` | no | Exam name if this is exam prep |

### Topic fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | e.g. `aws-security-specialty.1` |
| `description:` | no | Single line |

### Subtopic fields

| Key | Required | Notes |
|-----|----------|-------|
| `id:` | yes | e.g. `aws-security-specialty.1.1` |
| `objectives:` | no | List of learning objectives |
| `prerequisites:` | no | List of subtopic IDs that must be completed first |

## Example

```markdown
# AWS Security Specialty (SCS-C02)
id: aws-security-specialty
description: Preparation for the AWS Certified Security - Specialty (SCS-C02) exam.
prerequisites:
- AWS Cloud Practitioner or Associate-level certification
- 2+ years hands-on experience securing AWS workloads
exam: AWS Certified Security - Specialty (SCS-C02)

## Threat Detection and Incident Response
id: aws-security-specialty.1
description: Threat detection, incident response, and automated remediation. (Exam Domain 1 — 14%)

### Amazon GuardDuty
id: aws-security-specialty.1.1
objectives:
- Explain how GuardDuty uses VPC Flow Logs, DNS logs, and CloudTrail events
- Configure GuardDuty across multiple accounts using AWS Organizations

### AWS Security Hub and Amazon Detective
id: aws-security-specialty.1.2
prerequisites:
- aws-security-specialty.1.1
objectives:
- Enable and configure Security Hub with compliance standards
- Use Amazon Detective to investigate security findings
```
