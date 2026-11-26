-- 0013 — Automatic listing checks (T3.8; FR-LST-08; docs/04 §15.8).
--
-- Before a listing goes live, and when a live listing's content or photos change, the API runs
-- automatic checks: broker words in the text, contact details in the text (phone numbers, links),
-- a photo that matches another listing's (perceptual hash), and a rent far from the area's usual.
-- A listing with a finding goes to `pending_review` (the moderation queue, T6) instead of `active`,
-- and each finding is recorded here for the moderator. Findings never hold the matched text itself
-- (a phone number is personal data): only what kind of thing was found and where.

create table private.listing_flags (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.listings(id) on delete cascade,
  kind        text not null,
  -- Where it was found and why (field names, the other listing's id, the area median); no PII.
  details     jsonb not null default '{}',
  weight      smallint not null check (weight between 1 and 100),
  created_at  timestamptz not null default now(),
  -- Set by a moderator (T6) when they clear or act on it.
  resolved_at timestamptz,
  constraint listing_flags_kind_chk check (
    kind in ('broker_words', 'contact_details', 'duplicate_photo', 'price_anomaly')),
  constraint listing_flags_details_chk check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 2000)
);
create index listing_flags_open_idx on private.listing_flags (listing_id, created_at desc)
  where resolved_at is null;

-- Duplicate photos are found by Hamming distance between 64-bit perceptual hashes; the B-tree index
-- on phash (0011) does not help with that, so photos are compared within a bounded candidate set
-- (non-removed listings, owners other than the uploader), which is small at launch scale.

-- API only (docs/04 §5).
alter table private.listing_flags enable row level security;
revoke all on private.listing_flags from anon, authenticated;

comment on table private.listing_flags is 'Automatic listing check findings (FR-LST-08). Never the matched text: kinds, fields and ids only.';
