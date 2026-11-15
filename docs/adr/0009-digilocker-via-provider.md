# ADR-0009: DigiLocker through a licensed provider; store the result only

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Identity verification is required before the first message (FR-VER-01) and gates women-only spaces (FR-VER-06). Direct DigiLocker access needs a registered company; the founder has not registered one yet (OQ-06).

## Decision

Verify identity with **DigiLocker only**, through a licensed provider (provider selection is founder task T0.7 / OQ-02). Store only the **result**: verified name (encrypted), date of birth, gender, an HMAC of the DigiLocker identifier, provider reference and timestamp. Never store documents or Aadhaar numbers. Gender for women-only spaces comes only from this result, never from self-declaration.

## Consequences

- Per-check cost, paid by the platform at launch.
- Women-only visibility and verification-before-chat are enforced on the server.
- Development and CI use a mocked provider until sandbox access exists.

## Alternatives considered

- Aadhaar-based verification: not used, by founder decision.
- Self-declared identity or gender: does not meet the safety requirements.
