# ADR-0013: Design-token build: in-repo generator instead of Style Dictionary

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

docs/06 §3 says tokens are transformed with Style Dictionary. During M1 the token pipeline was implemented as a small, fully tested TypeScript generator in `packages/design-tokens`.

## Decision

Keep `tokens.json` (W3C Design Tokens format) as the single source, and generate CSS variables, the Tailwind/NativeWind preset and the React Native theme with the in-repo generator. Its tests enforce the brand palette, measured WCAG contrast, the 4-point spacing scale, the radii and the rule that `#C2185B` is used for likes only.

## Consequences

- No Style Dictionary configuration to maintain; outputs are typed and tested.
- If more platforms or formats are needed later, switching to Style Dictionary stays straightforward because the source format is the W3C standard.
- Founder to confirm; docs/06 §3 should then be updated.

## Alternatives considered

- Style Dictionary as written in docs/06: more configuration for the same three outputs.
