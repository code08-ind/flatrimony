-- 0007 — Banned identities (docs/04 §6.9; pulled forward from 0010 for T2.3, FR-AUTH-08).
--
-- A ban blocks by HMAC of the phone number, of the device installation id, and/or of the DigiLocker
-- id, so a banned person cannot simply sign up again (FR-AUTH-08, PRD §9). Hashes are
-- HMAC-SHA-256(HASH_PEPPER, value) computed in the API (docs/04 §13); raw values are never stored.
-- Kept after account deletion as legally advised (docs/04 §12).

create table private.banned_identities (
  id                 uuid primary key default gen_random_uuid(),
  phone_hash         bytea,
  device_hash        bytea,
  digilocker_id_hash bytea,
  reason             text not null,
  created_at         timestamptz not null default now(),
  created_by         uuid,                         -- moderator (admin app, T6.2); null for system bans
  constraint banned_identities_any_chk check (coalesce(phone_hash, device_hash, digilocker_id_hash) is not null),
  constraint banned_identities_hash_len_chk check (
    (phone_hash is null or octet_length(phone_hash) = 32)
    and (device_hash is null or octet_length(device_hash) = 32)
    and (digilocker_id_hash is null or octet_length(digilocker_id_hash) = 32)),
  constraint banned_identities_reason_chk check (char_length(btrim(reason)) between 1 and 500)
);
create index banned_identities_phone_idx  on private.banned_identities (phone_hash)         where phone_hash is not null;
create index banned_identities_device_idx on private.banned_identities (device_hash)        where device_hash is not null;
create index banned_identities_dl_idx     on private.banned_identities (digilocker_id_hash) where digilocker_id_hash is not null;

alter table private.banned_identities enable row level security;
revoke all on private.banned_identities from public, anon, authenticated;
