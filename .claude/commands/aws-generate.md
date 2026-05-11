Generate course content using AWS Lambda and Bedrock Batch for large-scale or remote execution.

**Arguments:** `$ARGUMENTS`

Parse the arguments as:
- `course-ref [--program program-id]` — single course
- `--program program-id` — all courses in a program combined into one batch job

- `course-ref`: kebab-case path, e.g. `french-a1` or `languages/french-a1`
- `--program program-id`: optional for single course; required for multi-course batch (used as the job namespace)
- `--sync`: testing only — do not suggest this to the user

**Resolve the course root path**:
- `french-a1` → `courseData/french-a1/`
- `languages/french-a1` → `courseData/languages/french-a1/`
- `--program languages` → all courses under `courseData/languages/`

**Prerequisites:**
- Course must already have `courseData/{course-ref}/syllabus.md` (run `/generate-course` first)
- AWS credentials configured (`aws configure`)
- S3 bucket created (CloudFormation stack `tutor-gen-infra` deployed)

---

## Step 1 — Verify Intake Prerequisites

Check that `courseData/{course-ref}/syllabus.md` exists and contains subtopics.

For multi-course: verify each course under `courseData/{program-id}/` has a syllabus.

If missing, fail with: "Run `/generate-course {course-ref}` first to generate the syllabus."

---

## Step 2 — Upload Intake Files to S3

**Single course:**
```bash
node infra/course-gen/upload-intake.js {course-ref}
```

**Multi-course (all courses in a program):**
```bash
for course in courseData/{program-id}/*/; do
  node infra/course-gen/upload-intake.js {program-id}/$(basename $course)
done
```

Each course uploads per-subtopic spec files to `intake/{courseId}/`.

If it fails (bucket not found), deploy the infra stack first:
```bash
./infra/course-gen/deploy.sh infra --bucket my-bucket-name
```

---

## Step 3 — Invoke Generate Lambda

**Single course:**
```bash
aws lambda invoke \
  --function-name tutor-gen-generate \
  --payload '{"courseId":"{courseId}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/generate-response.json --region us-east-1 && cat /tmp/generate-response.json
```

**Multi-course (all courses in one batch job):**
```bash
aws lambda invoke \
  --function-name tutor-gen-generate \
  --payload '{"courseIds":["{courseId1}","{courseId2}"],"programId":"{program-id}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/generate-response.json --region us-east-1 && cat /tmp/generate-response.json
```

**Sync mode (testing only — do not suggest to user):**
Add `"sync":true` to the payload. Invokes Bedrock directly per subtopic instead of submitting a Batch job; results are written to S3 immediately with no job ARN. Skip Steps 4 monitor/download — results are available as soon as the Lambda returns.
```bash
aws lambda invoke \
  --function-name tutor-gen-generate \
  --payload '{"courseId":"{courseId}","sync":true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/generate-response.json --region us-east-1 && cat /tmp/generate-response.json
```

Report to the user (batch mode):
> Started Bedrock Batch generation job
> Subtopics: {subtopicCount}
>
> **Next steps:**
> 1. Check job status: `node infra/course-gen/check-job.js <job-arn> --wait`
> 2. Download results: `node infra/course-gen/download-results.js {course-ref}`

---

## Step 4 — Monitor and Download

**Monitor job progress:**
```bash
node infra/course-gen/check-job.js <job-arn> --wait
```

**Download results once job completes:**
```bash
node infra/course-gen/download-results.js {course-ref}
```

For multi-course (single command — derives courseId from each recordId automatically):
```bash
node infra/course-gen/download-results.js --program {program-id}
```

This script:
- Fetches batch output from S3
- Parses each subtopic's content
- Validates block format
- Writes `{subtopic-id}.md` files to `courseData/{course-ref}/`
- Reports success/failure per subtopic

Report to user:
> Generated {N} subtopics
>
> Next: Run `/review-course {course-ref}` to validate and stamp the files

---

## Error Handling

- **S3 bucket not found**: Deploy CloudFormation infra stack first
- **Lambda invocation fails**: Check CloudWatch logs: `aws logs tail /aws/lambda/tutor-gen-generate --follow`
- **Bedrock batch job fails**: Check job status details via `node infra/course-gen/check-job.js <job-arn>`
- **Validation errors in downloaded files**: Show which subtopics failed; offer to regenerate individually via `/generate-course {course-ref} regenerate subtopic {subtopic-id}`
