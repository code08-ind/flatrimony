# ADR-0008: Commute zones with Valhalla isochrones; approach for metro/transit

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Matching uses commute time across NCR (FR-BIO-03, FR-DISC-02). Car, two-wheeler and walking isochrones come from Valhalla on an NCR OpenStreetMap extract; metro/transit needs schedule data.

## Decision

**Partly decided.** Valhalla isochrones, computed by the worker and cached per user, are accepted for road modes. For `metro_transit`, evaluate the licence and accuracy of Delhi Metro GTFS data; fall back to a radius around stations if it is unsuitable.

## Consequences

Founder decision needed on transit data source and licence (risk R7). Commute accuracy for metro users may be lower at launch.

## Alternatives considered

- Google Routes API per request: per-call cost exceeds the budget at scale.
- Straight-line radius only: poor fit for NCR distances.
