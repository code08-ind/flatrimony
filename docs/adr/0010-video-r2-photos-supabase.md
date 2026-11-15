# ADR-0010: Walkthrough videos in Cloudflare R2; photos in Supabase Storage

| Field | Value |
| --- | --- |
| Status | Accepted |
| Date | 15 Nov 2026 |
| Deciders | Founder (Aryan Garg) |
| Related | `docs/03-technical-stack.md` §18 |

## Context

Listings need a 30–90 s in-app video walkthrough (FR-LST-05); video is the largest storage and egress cost. Photos need resizing.

## Decision

Store **videos in Cloudflare R2** (no egress fees) with presigned uploads valid 10 minutes, and **photos in Supabase Storage** (image transformations). Buckets are private; clients get short-lived signed URLs.

## Consequences

- Two storage systems to secure and back up.
- Video cost stays low as listings grow.

## Alternatives considered

- Everything in Supabase Storage: higher egress cost for video.
- Everything in R2: no built-in image transformations.
