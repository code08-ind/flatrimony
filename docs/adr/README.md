# Architecture Decision Records

Format: context, decision, consequences, alternatives. Status `Accepted` or `Proposed` (needs a founder decision). Initial set from `docs/03-technical-stack.md` §18.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo with pnpm workspaces and Turborepo | Accepted |
| [0002](0002-typescript-zod-contracts.md) | TypeScript everywhere; Zod schemas are the contract source | Accepted |
| [0003](0003-supabase-mumbai.md) | Supabase in Mumbai for Postgres, Auth, Realtime and Storage | Accepted |
| [0004](0004-writes-through-api.md) | All writes go through the Fastify API; clients read realtime via RLS | Accepted |
| [0005](0005-cloud-run-mumbai.md) | Google Cloud Run in Mumbai for compute; scale to zero | Accepted |
| [0006](0006-postgres-job-queue.md) | Postgres job queue processed by a scheduled Cloud Run Job (no Redis) | Accepted |
| [0007](0007-custom-domains.md) | Custom domains for Cloud Run | Proposed |
| [0008](0008-commute-zones-valhalla.md) | Commute zones with Valhalla isochrones; approach for metro/transit | Proposed |
| [0009](0009-digilocker-via-provider.md) | DigiLocker through a licensed provider; store the result only | Accepted |
| [0010](0010-video-r2-photos-supabase.md) | Walkthrough videos in Cloudflare R2; photos in Supabase Storage | Accepted |
| [0011](0011-trunk-based-development.md) | Trunk-based development, Conventional Commits, squash merges | Accepted |
| [0012](0012-android-billing.md) | Android billing for Move Pass: Play Billing vs Razorpay | Proposed |
| [0013](0013-design-token-generator.md) | Design-token build: in-repo generator instead of Style Dictionary | Proposed |
