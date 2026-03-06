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
description: Comprehensive preparation for the AWS Certified Security - Specialty (SCS-C02) exam, covering all six exam domains.
prerequisites:
- AWS Cloud Practitioner or Associate-level certification
- 2+ years hands-on experience securing AWS workloads
- Familiarity with AWS core services (EC2, S3, VPC, IAM)
exam: AWS Certified Security - Specialty (SCS-C02)

## Threat Detection and Incident Response
id: aws-security-specialty.1
description: Design and implement threat detection strategies, respond to security incidents, and automate remediation. (Exam Domain 1 — 14%)

### Amazon GuardDuty
id: aws-security-specialty.1.1
objectives:
- Explain how GuardDuty uses VPC Flow Logs, DNS logs, and CloudTrail events to detect threats
- Configure GuardDuty across multiple accounts using AWS Organizations
- Interpret GuardDuty finding types and severity levels
- Suppress or archive findings and create custom threat lists

### AWS Security Hub and Amazon Detective
id: aws-security-specialty.1.2
prerequisites:
- aws-security-specialty.1.1
objectives:
- Enable and configure Security Hub with compliance standards (CIS, PCI DSS, AWS Foundational)
- Aggregate findings from multiple AWS security services
- Use Amazon Detective to investigate and visualize security findings

### Incident Response Strategies
id: aws-security-specialty.1.3
prerequisites:
- aws-security-specialty.1.1
objectives:
- Design an incident response plan aligned with the AWS Cloud Adoption Framework
- Isolate compromised EC2 instances using security groups and network ACLs
- Perform forensic analysis on EBS snapshots and memory dumps
- Implement automated incident response using Lambda and Step Functions

### Automated Remediation and EventBridge
id: aws-security-specialty.1.4
prerequisites:
- aws-security-specialty.1.2
- aws-security-specialty.1.3
objectives:
- Create EventBridge rules to route security events to remediation targets
- Build automated remediation workflows with Lambda and Systems Manager
- Design event-driven security architectures

## Security Logging and Monitoring
id: aws-security-specialty.2
description: Implement and manage logging across AWS services, analyse logs, and build monitoring solutions. (Exam Domain 2 — 18%)

### CloudTrail and CloudWatch
id: aws-security-specialty.2.1
objectives:
- Configure CloudTrail for multi-region and organisation-wide logging
- Create CloudWatch metric filters and alarms for security events
- Build dashboards for security visibility
```
