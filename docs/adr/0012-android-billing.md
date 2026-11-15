# ADR-0012: Android billing for Move Pass: Play Billing vs Razorpay

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Move Pass and listing boosts are digital goods (v1.1). Google Play policy may require Play Billing for digital goods sold inside the Android app (OQ-04).

## Decision

**Not decided.** Pending the founder's policy check (T0.8): if Play Billing is required, sell on Android via Play Billing and keep Razorpay for web; otherwise use Razorpay on both. Entitlements are granted only after server-verified payment events either way (FR-PAY-02).

## Consequences

Founder decision needed before v1.1 payments work starts.

## Alternatives considered

See options above.
