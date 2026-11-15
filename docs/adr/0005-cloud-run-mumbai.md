# ADR-0005: Google Cloud Run in Mumbai for compute; scale to zero

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

API, web, admin, routing and background jobs need hosting in India at near-zero idle cost.

## Decision

Run `api`, `web`, `admin` and `routing` as **Cloud Run services** and the worker as a **Cloud Run Job**, all in **`asia-south1`**, every one with min instances 0 at launch. Images go to Artifact Registry; secrets come from Secret Manager; GitHub Actions deploys through Workload Identity Federation (no JSON keys). Resources are defined in Terraform (`infra/terraform`).

## Consequences

- Pay per use; the database is the only always-on paid component.
- Cold starts on the first request; revisit `min-instances=1` for the API in production if p95 suffers (NFR-PERF-01).

## Alternatives considered

- Vercel for web: commercial use needs a paid plan.
- A VM: always-on cost and patching.
