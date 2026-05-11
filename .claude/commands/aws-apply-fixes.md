# /aws-apply-fixes

Apply review findings to course subtopics using the tutor-gen-fix Lambda (Bedrock).

**Arguments:** `$ARGUMENTS`

Parse the arguments as:
- `course-ref --generate-run <id> --review-run <id>` — single course
- `--program program-id --generate-run <id> --review-run <id>` — multi-course
- `--sync`: testing only — do not suggest this to the user

**Prerequisites:**
- `/aws-generate` completed and results downloaded
- `/aws-review` completed and findings downloaded
- Both `generateRunId` and `reviewRunId` are required

---

## Step 1 — Invoke Fix Lambda

**Single course:**
```bash
aws lambda invoke \
  --function-name tutor-gen-fix \
  --payload '{"courseId":"{courseId}","generateRunId":"{generateRunId}","reviewRunId":"{reviewRunId}"}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/fix-response.json --region us-east-1 && cat /tmp/fix-response.json
```

**Sync mode (testing only — do not suggest to user):**
```bash
aws lambda invoke \
  --function-name tutor-gen-fix \
  --payload '{"courseId":"{courseId}","generateRunId":"{generateRunId}","reviewRunId":"{reviewRunId}","sync":true}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/fix-response.json --region us-east-1 && cat /tmp/fix-response.json
```

Parse and report from the response:
- `recordCount`: subtopics sent for fixing
- `skipped`: subtopics with issues but no original content found
- `jobArn`: needed to monitor (batch mode only)

Report to the user:
> Fix job started: {recordCount} subtopics
> Skipped (no content): {skipped}
>
> **Next steps:**
> 1. Check job status: `node infra/course-gen/check-job.js <job-arn> --wait`
> 2. Download fixes: `node infra/course-gen/download-fixes.js {course-ref} --run {runId}`

---

## Step 2 — Monitor and Download

**Monitor:**
```bash
node infra/course-gen/check-job.js <job-arn> --wait
```

**Download fixed files:**
```bash
node infra/course-gen/download-fixes.js {course-ref} --run {runId}
```

Or for multi-course:
```bash
node infra/course-gen/download-fixes.js --program {program-id} --run {runId}
```

This writes corrected `{subtopic-id}.md` files to `courseData/{course-ref}/`.

---

## Step 3 — Validate

After downloading, run Pass 1 to confirm no structural errors were introduced:

```bash
node scripts/review-courses.js {course-ref}
```

Report errors to the user. If any remain, offer to fix them with `/apply-fixes`.

---

## Error Handling

- **Below batch minimum (<100 records)**: Use `sync:true`
- **No original content found for a subtopic**: Skipped — regenerate with `/aws-generate`
- **Lambda timeout**: Fix Lambda has 5-minute timeout; if it times out, process per-course rather than batching
