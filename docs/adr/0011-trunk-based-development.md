# ADR-0011: Trunk-based development, Conventional Commits, squash merges

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

A solo developer (and review agents) need a simple, safe flow from change to staging (docs/03 §6–7).

## Decision

`main` is always deployable and protected (required checks, linear history). Short-lived branches (`feat/`, `fix/`, `chore/`, `docs/`, `ci/` …) merge by **squash** with a **Conventional Commit** title enforced by commitlint; unfinished features hide behind remote-config flags. Merging to `main` deploys to staging; tags `v*` deploy to production after manual approval.

## Consequences

- Small PRs (< 400 changed lines where possible) and a clean history.
- Feature flags are needed for anything that spans several PRs.

## Alternatives considered

- GitFlow with long-lived release branches: overhead without a team.
