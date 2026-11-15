# ADR-0003: Supabase in Mumbai for Postgres, Auth, Realtime and Storage

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

The product needs relational data with geo queries, row-level security, phone OTP, realtime chat and photo storage, within a launch budget under ₹5,000/month, with data kept in India (NFR-PRIV-01).

## Decision

Use **Supabase** projects in **`ap-south-1` (Mumbai)**: Postgres with PostGIS, pgcrypto and pg_trgm; Supabase Auth phone OTP with the Send SMS hook to a DLT-registered provider; Realtime for chat and status; Storage for photos. `flatrimony-staging` may use the free tier; production uses a paid plan (free projects pause). Migrations in `supabase/migrations` are the schema's source of truth; pgTAP tests in `supabase/tests`.

## Consequences

- One managed component covers database, auth, realtime and storage.
- Sensitive tables live in a `private` schema that the Data API never exposes; `ref` is read-only to clients.
- Vendor dependency on Supabase; mitigated by plain Postgres SQL and standard JWTs.

## Alternatives considered

- Firebase/Firestore: weaker fit for relational and geo queries and RLS.
- Self-hosted Postgres: backups, upgrades and patching fall on the founder.
