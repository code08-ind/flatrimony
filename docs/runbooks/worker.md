# Worker: background jobs and scheduled tasks (T1.14)

The worker (`apps/worker`) is a Cloud Run Job. Cloud Scheduler starts it every 5 minutes with
`tick` and daily at 02:30 IST with `daily` (`infra/terraform/envs/staging`). Each run:

1. releases job locks older than 15 minutes (a run that crashed or timed out);
2. runs the scheduled tasks of its mode;
3. claims ready jobs from `private.jobs` (`FOR UPDATE SKIP LOCKED`, docs/04 §11), 5 at a time, and
   runs them one by one until the queue is empty or 8 minutes have passed (the task timeout is 10
   minutes); a job may run 5 minutes. On SIGTERM, or when the time is used, the current job finishes
   and the rest of the batch goes back unstarted;
4. logs an alert line for every job kind with jobs out of attempts, and the backlog
   (`backlogReady`, `backlogOldestMinutes` on the `worker run done` line).

| Mode | Tasks |
| --- | --- |
| `tick` | (none yet: listing expiry, reminders and purges come with their tasks) |
| `daily` | `photos.sweep-uploads`: removes staged photo uploads older than 2 hours (T2.10 launch gate) |
| `drain` | none; jobs only (manual runs) |

## Run it locally

```bash
pnpm dev:secrets            # writes apps/worker/.env.local (needs Supabase running for the Storage key)
pnpm --filter @flatrimony/worker build
pnpm --filter @flatrimony/worker daily   # or: tick
```

## Configuration

| Variable | Notes |
| --- | --- |
| `DATABASE_URL_DIRECT` | Direct connection (Secret Manager); `DATABASE_URL` is used if it is missing |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage tasks (the upload sweep). Required outside local: the worker refuses to start without them (exit 2); locally the sweep is skipped with a warning |
| `WORKER_BUDGET_SECONDS` | Stop claiming jobs after this long (default 480, at most 540: a run must end before a lock counts as stale) |
| `LOG_LEVEL` | `debug`, `info` (default), `warn`, `error` |

Logs are JSON lines with `severity` and `message`; they never contain personal data.

## Alerts and failures

- **Jobs out of attempts:** every run logs `"message":"jobs out of attempts"` with
  `"alert":"jobs.dead"`, the kind and the count. Create a log-based alert on `jsonPayload.alert="jobs.dead"`
  (Cloud Monitoring) once staging exists. Look at the jobs:
  `select id, kind, attempts, last_error, created_at from private.jobs where done_at is null and locked_at is null and attempts >= max_attempts;`
  Fix the cause, then retry with
  `update private.jobs set attempts = 0, run_after = now() where id = <id>;`
  or close it with `update private.jobs set done_at = now(), dedupe_key = null where id = <id>;`.
- **A failed task** makes the run exit with code 1, so the Cloud Run execution shows as failed; the
  next run tries again (tasks are idempotent).
- **Invalid configuration** exits with code 2 and one JSON line naming the settings (never their
  values).
- **Unknown job kind** (for example after a rollback): retried with backoff like any failure, so a
  newer image picks it up; it is dead only after its attempts.
- **Backlog:** alert when `backlogOldestMinutes` stays above 30 (docs/03 §13; set up with staging
  monitoring, T6.9).
- **Rollback:** `gcloud run jobs update worker --region asia-south1 --image <previous digest>`
  (docs/03 §11).
