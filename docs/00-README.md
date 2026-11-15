# Flatrimony — Documentation Pack

**Flatrimony** ("Rishta pakka, rent split.") is a verified flatmate-matching app for Delhi NCR: Android and web first, iOS later. This folder contains everything needed to start implementation.

| # | File | What it answers | Read it when |
| --- | --- | --- | --- |
| 01 | `01-product-spec.md` | *Why* and *what*, at a high level: the reel, the problem, the competitors, the decisions taken with the founder, features, brand and security principles | First, for context |
| 02 | `02-prd.md` | *What exactly* to build: goals, personas, releases, functional requirements with IDs (`FR-…`), non-functional requirements (`NFR-…`), acceptance criteria, release criteria | Before writing any ticket |
| 03 | `03-technical-stack.md` | *How* to build and ship it: architecture, stack, monorepo layout, environments, SDLC from idea to production, CI/CD on GitHub Actions + Google Cloud Run + Supabase + EAS, observability, security, costs | Before setting up the repository |
| 04 | `04-database-design.md` | *Where data lives*: schemas, roles, full DDL, RLS, indexes, discovery query, job queue, retention, encryption, migration order | Before writing migrations |
| 05 | `05-api-design.md` | *How clients talk to the server*: conventions, auth, errors, every endpoint with FR mapping, realtime, push, webhooks, error codes | Before writing endpoints or client data code |
| 06 | `06-ui-ux-design-standards.md` | *How it looks and feels*: tokens (with measured contrast), typography (Latin + Devanagari), components, modern interaction patterns, screen specs with wireframes, states, accessibility, localisation | Before building any screen |
| 07 | `07-project-progress.md` | *Where we are*: milestones, task breakdown, Definition of Ready/Done, risks, decisions, weekly status | Every week; every PR that changes task status |
| 08 | `08-stitch-prompts.md` | *How to generate the designs*: base style block + one Google Stitch prompt per v1.0 screen | Before designing screens in Stitch |
| 09 | `09-stitch-design-review.md` | *Where the designs are*: Stitch project links, screen coverage, open design issues | Before reviewing or exporting designs |
| — | `designs/` | *The final screens*: every Android and web screen in English and Hindi as HTML + PNG, with images | Before building any screen |
| — | `assets/reel_key_frames.jpg` | Key frames from the original reel (referenced by the spec) | Visual reference |

## Precedence when documents disagree

1. The founder's decisions table (spec section 2.1) and decision log (`07` section 6)
2. `02-prd.md`
3. `04-database-design.md` and `05-api-design.md` (contracts)
4. `03-technical-stack.md` and `06-ui-ux-design-standards.md`
5. `01-product-spec.md` (earlier sections may predate later decisions, e.g., section 3.4 lists references as P2; the PRD moves them to v1.1)

If a conflict is found, do not guess: record it as an open question in `02-prd.md` section 17 and ask the founder.

## Instructions for an implementing agent

1. Read 01 → 02 → 03 fully; skim 04–06; open 07.
2. Start with milestone **M1 — Foundations** in `07-project-progress.md` (repository, CI, staging pipeline, design tokens, shared schemas).
3. Work ticket by ticket. For each ticket: confirm Definition of Ready → implement with tests → open a PR using the template in `03` section 7.3 → keep CI green → update `07`.
4. Contracts first: Zod schemas in `packages/shared` and SQL migrations in `supabase/migrations` before UI.
5. Never weaken a security, privacy or safety rule to make a feature easier. Women-only visibility, verification-before-chat, and hidden phone/address are non-negotiable.
6. Mark anything that needs a human decision, a paid account, legal review, or vendor credentials as **Blocked** in `07` with a clear note; mock the dependency and continue with other tasks.
7. Do not invent business numbers (targets, prices). Use remote config placeholders and leave them for the founder.

## Items that need the founder (not the agent)

- Name clearance for "Flatrimony" (trademark, domains, handles).
- Vendor accounts: SMS provider with DLT registration, DigiLocker provider, Razorpay, Google Play developer account, Google Cloud billing, Supabase paid plan, Cloudflare, Expo.
- Legal review: Terms, Privacy Policy (DPDP), community guidelines, refund policy, CERT-In obligations.
- Business targets, prices and milestone dates.
- Pending ADRs: 0007 (custom domains), 0008 (transit commute), 0012 (Android billing).

## Glossary (short)

Flat Biodata = profile · Rishta = match · Rishta report = match breakdown · Pehli Mulaqat = first meet-up · Rishta pakka = both confirmed moving in · Flatmate Passport = verified reputation · Ghar = stay tools · Move Pass = paid 30-day upgrade.
