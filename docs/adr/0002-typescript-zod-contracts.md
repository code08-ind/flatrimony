# ADR-0002: TypeScript everywhere; Zod schemas are the contract source

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Mobile, web, admin, API and worker must agree on request/response shapes, enums and error codes. Drift between client and server is a common source of bugs (NFR-MAINT-01).

## Decision

Use **TypeScript in strict mode** everywhere. `packages/shared` holds Zod schemas, enums (mirroring Postgres enums), error codes and constants. The API validates with the same schemas (`fastify-type-provider-zod`) and generates OpenAPI from them; clients use them for forms. A contract test parses `supabase/migrations` and fails when shared enums drift from SQL.

## Consequences

- Contract-first: schemas and migrations change before UI (docs/00).
- Breaking API changes are visible in one PR and caught by the OpenAPI diff in CI (once added).
- Schemas run on Node, browsers and Hermes, so `packages/shared` avoids Node-only APIs.

## Alternatives considered

- Separate OpenAPI YAML as the source: second language to maintain.
- tRPC: couples clients to the server's TypeScript build; harder for the mobile release cycle and versioned `/v1` paths.
