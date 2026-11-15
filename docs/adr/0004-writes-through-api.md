# ADR-0004: All writes go through the Fastify API; clients read realtime via RLS

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Business rules (daily like limits, verification before chat, women-only visibility, moderation checks, audit logging) must not be bypassable by a modified client.

## Decision

Clients **never write** to Postgres directly: the `authenticated` role has no INSERT/UPDATE/DELETE grants. All writes go through the **Fastify API** (`apps/api`) after its own authorisation checks. Clients may read selected tables in real time (matches, messages, meet-ups, notifications, own profile) through Supabase Realtime, filtered by RLS.

## Consequences

- One place to enforce rules, rate limits, idempotency and audit.
- RLS remains a safety net for reads and is tested with pgTAP.
- Slightly more API surface than letting clients write via the Data API.

## Alternatives considered

- Client writes with RLS only: rules spread across SQL policies; hard to rate-limit and audit.
