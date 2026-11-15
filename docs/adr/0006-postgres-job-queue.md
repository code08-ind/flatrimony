# ADR-0006: Postgres job queue processed by a scheduled Cloud Run Job (no Redis)

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Background work (media processing, commute zones, listing expiry, reminders, retention purges) must be reliable and idempotent (NFR-REL-03) without another paid component.

## Decision

Use a **`private.jobs` table** claimed with `SELECT … FOR UPDATE SKIP LOCKED`, processed by the **`worker` Cloud Run Job**, triggered by Cloud Scheduler every 5 minutes (`worker-tick`) and daily at 02:30 IST (`worker-daily`). Retries use exponential backoff; stale locks are released after 15 minutes (docs/04 §11).

## Consequences

- No Redis or queue service to pay for or operate.
- Up to ~5 minutes of latency for queued work; acceptable for v1 (push and chat do not depend on the queue).

## Alternatives considered

- Redis + BullMQ: extra paid component.
- Cloud Tasks / Pub/Sub: more moving parts and IAM for the same outcome at launch volume.
