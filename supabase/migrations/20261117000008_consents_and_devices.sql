-- 0008 — Consents and devices (docs/04 §6.10; pulled forward from 0011 for T2.5).
--
-- POST /v1/me/bootstrap records the user's consents (FR-AUTH-09, DPDP: versioned and stored) and
-- registers the device, whose hash lets the API refuse banned devices (FR-AUTH-08). Only the API
-- writes these tables; clients read their own consents through RLS.

-- ---------------------------------------------------------------------------
-- Consents: append-only evidence (DPDP). Each grant is a row; withdrawing sets withdrawn_at on the
-- active row; granting again inserts a NEW row, so every grant and withdrawal stays on record.
-- At most one active (not withdrawn) row per user, purpose and version.
-- (Deviation from docs/04 §6.10, whose primary key (user_id, purpose, version) would overwrite
-- history on re-grant; see docs/04 §15.3.)
-- ---------------------------------------------------------------------------
create table public.consents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  purpose      public.consent_purpose not null,
  version      text not null,                      -- policy version, e.g. '2026-11-01'
  granted_at   timestamptz not null default now(),
  withdrawn_at timestamptz,
  constraint consents_version_chk check (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  constraint consents_withdrawn_chk check (withdrawn_at is null or withdrawn_at >= granted_at)
);
create unique index consents_active_key on public.consents (user_id, purpose, version) where withdrawn_at is null;
create index consents_user_idx on public.consents (user_id, granted_at desc);
comment on table public.consents is 'Versioned, append-only consents (FR-AUTH-09, DPDP). Written only by the API.';

-- Only withdrawn_at may change, once: grants are evidence and are never edited or re-dated.
create or replace function public.consents_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id or new.user_id <> old.user_id or new.purpose <> old.purpose
     or new.version <> old.version or new.granted_at <> old.granted_at
     or old.withdrawn_at is not null then
    raise exception 'consents are append-only' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger consents_append_only before update on public.consents
  for each row execute function public.consents_append_only();

-- ---------------------------------------------------------------------------
-- Devices: one row per (user, installation). device_hash = HMAC-SHA-256(HASH_PEPPER, install id).
-- The integrity token itself is never stored, only the verdict.
-- ---------------------------------------------------------------------------
create table public.devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  device_hash       bytea not null,
  platform          public.platform not null,
  app_version       text,
  push_token        text,                          -- Expo push token
  integrity_verdict text,
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint devices_user_device_key unique (user_id, device_hash),
  constraint devices_hash_len_chk check (octet_length(device_hash) = 32),
  constraint devices_app_version_chk check (app_version is null or app_version ~ '^\d{1,3}\.\d{1,3}\.\d{1,4}$'),
  constraint devices_push_token_chk check (push_token is null or (char_length(push_token) between 1 and 255 and push_token !~ '\s')),
  constraint devices_integrity_verdict_chk check (integrity_verdict is null or integrity_verdict in ('unverified', 'meets_device_integrity', 'meets_basic_integrity', 'failed'))
);
create index devices_hash_idx on public.devices (device_hash);
comment on table public.devices is 'Registered app installations (push, bans by device hash). Written only by the API.';

-- ---------------------------------------------------------------------------
-- Access: RLS on; consents readable by their owner; devices not readable by clients at all.
-- ---------------------------------------------------------------------------
alter table public.consents enable row level security;
alter table public.devices  enable row level security;

revoke all on public.consents, public.devices from anon, authenticated;
grant select on public.consents to authenticated;

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select public.uid()));

-- ---------------------------------------------------------------------------
-- 18+ on the date in India. 0004 compared with current_date (UTC on Supabase), which refused
-- people turning 18 between 00:00 and 05:30 IST on their birthday although the API, which counts
-- in India, accepted them (code review T2.5).
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_adult_chk;
alter table public.profiles add constraint profiles_adult_chk check (
  date_of_birth is null
  or (date_of_birth >= date '1900-01-01'
      and date_of_birth <= ((now() at time zone 'Asia/Kolkata')::date - interval '18 years'))
);

-- Same for the DigiLocker record (QA T2.5 D5): verified 18+ on the date in India.
alter table private.identity_records drop constraint identity_records_adult_chk;
alter table private.identity_records add constraint identity_records_adult_chk check (
  verified_dob >= date '1900-01-01'
  and verified_dob <= ((now() at time zone 'Asia/Kolkata')::date - interval '18 years')
);

-- ---------------------------------------------------------------------------
-- Human-visible text, tightened (QA T2.5 D2): characters that render as blank (Hangul fillers,
-- Braille blank, Mongolian vowel separator, combining grapheme joiner, Khmer invisible vowels)
-- made names that look empty. Written with \u escapes so the list is readable in review.
-- Mirrored by `humanText` in packages/shared/src/primitives.ts.
-- ---------------------------------------------------------------------------
create or replace function public.is_human_text(t text) returns boolean
language sql immutable
set search_path = ''
as $$
  select t = btrim(t, E' \t\n\r')
     and t ~ '[^[:space:]]'
     and t !~ '[\u0001-\u001F\u007F-\u009F­͏ᅟᅠ឴឵᠎​-‏ -‮⁠-⁤⠀ㅤ﻿ﾠ]'
$$;
