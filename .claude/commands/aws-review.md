Review generated course content using AWS Bedrock Batch — checks factual accuracy and question quality.

**Arguments:** `$ARGUMENTS`

Parse the arguments as:
- `course-ref [--run <generate-run-id>]` — single course
- `--program program-id [--run <generate-run-id>]` — all courses in a program
- `--sync`: testing only — do not suggest this to the user

**Prerequisites:**
- Generation must already be complete (`/aws-generate` finished and results downloaded)
- The generate runId is in the Lambda response from `/aws-generate` — check `/tmp/generate-response.json`

---

## Step 1 — Resolve the Generate RunId

Check `/tmp/generate-response.json` from the previous generate step:
```bash
cat /tmp/generate-response.json
```

Extract `runId` from the response. If the file is gone or the user doesn't have it, the review Lambda will search across all runs and pick the latest — omit `--run` from the Lambda payload in that case.

---

## Step 2 — Invoke Review Lambda

**Single course:**
```bash
aws lambda invoke \
  --function-name tutor-gen-review \
  --payload '{"courseId":"{courseId}","generateRunId":"{runId}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/review-response.json --region us-east-1 && cat /tmp/review-response.json
```

**Multi-course:**
```bash
aws lambda invoke \
  --function-name tutor-gen-review \
  --payload '{"courseId":"{courseId}","generateRunId":"{runId}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/review-response.json --region us-east-1 && cat /tmp/review-response.json
```

Note: the review Lambda takes a single `courseId` (not `courseIds`) and scopes to one course's generate output. For multi-course programs, run once per course or once with the program-level `jobId` used during generation.

**Sync mode (testing only — do not suggest to user):**
Add `"sync":true` to the payload. Returns findings directly in the Lambda response with no job ARN — skip Steps 3 monitor/download. Required when fewer than 100 records are present (Bedrock Batch minimum); batch mode will error below this threshold.
```bash
aws lambda invoke \
  --function-name tutor-gen-review \
  --payload '{"courseId":"{courseId}","generateRunId":"{runId}","sync":true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/review-response.json --region us-east-1 && cat /tmp/review-response.json
```

Parse and report from the response:
- `recordCount`: subtopics sent for review
- `validationFailures`: subtopics that failed block validation before review (already bad)
- `jobArn`: needed to monitor (batch mode only; absent in sync mode)

Report to the user (batch mode):
> Review job started: {recordCount} subtopics
> Validation failures (before review): {validationFailures.length}
>
> **Next steps:**
> 1. Check job status: `node infra/course-gen/check-job.js <job-arn> --wait`
> 2. Download findings: `node infra/course-gen/download-review.js {course-ref}`

---

## Step 3 — Monitor and Download Findings

**Monitor:**
```bash
node infra/course-gen/check-job.js <job-arn> --wait
```

**Download findings:**
```bash
node infra/course-gen/download-review.js {course-ref}
```

Or for multi-course:
```bash
node infra/course-gen/download-review.js --program {program-id}
```

This writes `review-findings.json` to each course directory and prints a summary:
```
Results: 42 pass, 3 issues, 0 errors

Subtopics with issues:
  french-a1.2.3:
    - The Subjunctive Mood: states subjunctive only used after 'que' — also used after conjunctions
    - Identify the correct verb form: marked answer 'b' is wrong — should be 'hablen' not 'hablan'
```

---

## Step 4 — Act on Findings

For subtopics with issues, offer the user these options:

1. **Regenerate locally** (one subtopic at a time):
   ```
   /generate-course {course-ref} regenerate subtopic {subtopic-id}
   ```

2. **Accept and continue** — proceed to `/review-course {course-ref}` for human review; the findings file remains as reference.

3. **Re-run generation for failed subtopics** via a new `/aws-generate` batch (only worth it if many subtopics failed).

---

## Error Handling

- **No generate output found**: The generate job may not have completed — check with `node infra/course-gen/check-job.js <job-arn>`
- **Validation failures before review**: These subtopics had malformed block format from generation — regenerate them
- **Lambda timeout**: The review Lambda has a 5-minute timeout; if it times out on large courses, invoke per-course rather than batching
