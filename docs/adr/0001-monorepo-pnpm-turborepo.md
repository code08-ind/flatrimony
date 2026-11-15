# ADR-0001: Monorepo with pnpm workspaces and Turborepo

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

One developer builds an Android app, a public web app, an admin app, an API, a worker and shared packages, all in TypeScript (docs/03 §2). Contracts, design tokens and translations must be shared without publishing packages.

## Decision

Use a single repository with **pnpm workspaces** and **Turborepo** (layout in docs/03 §3). Apps live in `apps/*`, shared code in `packages/*`; packages never import apps (enforced by ESLint `no-restricted-imports`). pnpm uses the hoisted node linker because React Native/Metro resolves modules most reliably from a flat `node_modules`. pnpm's supply-chain settings are on: `minimumReleaseAge` 7 days, `trustPolicy: no-downgrade`, `blockExoticSubdeps`.

## Consequences

- One lockfile, one CI pipeline, affected-only task runs and caching via Turborepo.
- Dependency updates must respect the 7-day release age; Dependabot uses a matching 7-day cooldown.
- The hoisted linker gives up some of pnpm's strictness; boundary rules in ESLint compensate.

## Alternatives considered

- Separate repositories per app: duplicated contracts and tooling; rejected for a solo team.
- Nx: more capable, heavier than needed now.
- npm/yarn workspaces: slower installs, no equivalent release-age and trust policies.
