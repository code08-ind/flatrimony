# ADR-0007: Custom domains for Cloud Run

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Cloud Run domain mapping options differ by region (docs/03 §4.3). The `flatrimony.in` domain is pending name clearance (T0.3).

## Decision

**Not decided.** Options: (1) Cloudflare proxy in front of Cloud Run with a supported mapping method; (2) Firebase Hosting rewrites to Cloud Run (free tier); (3) a global external Application Load Balancer with serverless NEGs (fixed monthly cost, adds Cloud Armor and IAP). Until decided, staging uses default `run.app` URLs.

## Consequences

Decision needed from the founder after name clearance; cost of option 3 must be checked against the ₹5,000/month budget.

## Alternatives considered

See options above.
