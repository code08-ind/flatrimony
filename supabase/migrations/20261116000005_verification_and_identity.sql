-- 0005 — Verification and identity (docs/04-database-design.md §6.3, §13; ADR-0009; T2.1).
--
-- DigiLocker only (never Aadhaar). We store the verification RESULT, never documents:
-- an encrypted verified name, DOB, gender, an HMAC of the DigiLocker id (one account per
-- identity), and the provider's transaction reference. Sensitive rows live in `private`,
-- which the Data API never exposes. Encryption and HMAC happen in the API (docs/04 §13).
--
-- The profile's copy (profiles.is_identity_verified / verified_gender) must always agree with
-- private.identity_records: deferred constraint triggers below enforce it, so a bug in the API
-- cannot unlock women-only spaces (FR-VER-06, FR-SAFE-04).

create table public.verifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          public.verification_type not null,
  status        public.verification_status not null default 'pending',
  provider      text,                                  -- 'cashfree_digilocker', 'internal_email'
  provider_ref  text,                                  -- provider transaction id (not a document id)
  failure_code  text,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  expires_at    timestamptz,
  constraint verifications_completed_chk check ((status = 'pending') = (completed_at is null)),
  constraint verifications_completed_after_start_chk check (completed_at is null or completed_at >= started_at),
  constraint verifications_failure_code_chk check ((status = 'failed') = (failure_code is not null)),
  constraint verifications_failure_code_values_chk check (
    failure_code in ('name_mismatch', 'underage', 'provider_error', 'user_cancelled', 'identity_in_use')),
  -- Never an Aadhaar-like 12-digit number (FR-VER-02); provider refs are opaque transaction ids.
  constraint verifications_provider_ref_chk check (provider_ref is null or provider_ref !~ '\d{4}[\s-]?\d{4}[\s-]?\d{4}')
);
create index verifications_user_type_idx on public.verifications (user_id, type, started_at desc);
-- One open attempt per user and type (parallel pending verifications are a bug or abuse).
create unique index verifications_one_pending_idx on public.verifications (user_id, type) where status = 'pending';
comment on column public.verifications.provider_ref is 'Provider transaction reference only. Never a document number or Aadhaar number (FR-VER-02).';

-- Sensitive identity result. NEVER exposed to clients.
create table private.identity_records (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  verified_name_enc    bytea not null,          -- AES-256-GCM (app-level): version(1) ‖ iv(12) ‖ ciphertext ‖ tag(16)
  verified_dob         date not null,
  verified_gender      public.verified_gender not null,
  digilocker_id_hash   bytea not null,          -- HMAC-SHA-256(pepper, DigiLocker id) → one account per identity
  verified_at          timestamptz not null default now(),
  constraint identity_records_digilocker_id_hash_key unique (digilocker_id_hash),
  -- Envelope shape: key version byte (currently 1) + 12-byte IV + ≥1 byte ciphertext + 16-byte tag.
  -- This catches plaintext written by mistake; it cannot prove the bytes are ciphertext.
  constraint identity_records_name_enc_chk check (octet_length(verified_name_enc) >= 1 + 12 + 1 + 16 and get_byte(verified_name_enc, 0) = 1),
  constraint identity_records_hash_len_chk check (octet_length(digilocker_id_hash) = 32),
  -- Minors are never stored (data minimisation); the API rejects them with profile.underage.
  constraint identity_records_adult_chk check (verified_dob >= date '1900-01-01' and verified_dob <= (current_date - interval '18 years'))
);

create table private.email_verifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         public.verification_type not null,
  email_domain text not null,                   -- keep the domain; drop the full address after verification
  token_hash   bytea not null,                  -- SHA-256 of a 32-byte random token
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  constraint email_verifications_type_chk check (type in ('work_email', 'college_email')),
  constraint email_verifications_domain_chk check (email_domain ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+([a-z]{2,}|xn--[a-z0-9-]+)$'),
  constraint email_verifications_token_hash_len_chk check (octet_length(token_hash) = 32),
  -- POST /v1/verifications/email/confirm looks tokens up by hash (docs/05 §8.4).
  constraint email_verifications_token_hash_key unique (token_hash)
);
create index email_verifications_user_idx on private.email_verifications (user_id);
create index email_verifications_expires_idx on private.email_verifications (expires_at);  -- 7-day purge (docs/04 §12)

create table private.user_contact (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  phone_hash   bytea not null,                  -- HMAC of the E.164 number (auth.users holds the number)
  updated_at   timestamptz not null default now(),
  constraint user_contact_phone_hash_len_chk check (octet_length(phone_hash) = 32),
  constraint user_contact_phone_hash_key unique (phone_hash)
);

create trigger user_contact_set_updated_at before update on private.user_contact
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Profile ↔ identity record consistency (deferred: checked at commit, so the API can write the
-- identity record and the profile in either order within one transaction).
-- SECURITY DEFINER so the check sees private.identity_records regardless of the writer's RLS.
-- ---------------------------------------------------------------------------
create or replace function private.check_profile_identity() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.profiles;
  r private.identity_records;
  uid uuid;
begin
  if tg_table_name = 'profiles' then
    uid := new.id;
  elsif tg_op = 'DELETE' then
    uid := old.user_id;
  else
    uid := new.user_id;
  end if;

  select * into p from public.profiles where id = uid;
  if not found then
    return null;  -- profile deleted (cascade); nothing to keep consistent
  end if;
  select * into r from private.identity_records where user_id = uid;

  if p.is_identity_verified then
    if r.user_id is null then
      raise exception 'identity_record_missing' using errcode = '23514',
        detail = 'A verified profile needs a private.identity_records row';
    end if;
    if p.verified_gender is distinct from r.verified_gender then
      raise exception 'verified_gender_mismatch' using errcode = '23514',
        detail = 'profiles.verified_gender must equal the DigiLocker result';
    end if;
    if p.date_of_birth is distinct from r.verified_dob then
      raise exception 'verified_dob_mismatch' using errcode = '23514',
        detail = 'Once verified, profiles.date_of_birth is the DigiLocker date of birth (FR-VER-03)';
    end if;
  end if;
  return null;
end $$;
revoke execute on function private.check_profile_identity() from public, anon, authenticated;

create constraint trigger profiles_identity_consistent
  after insert or update of is_identity_verified, verified_gender, date_of_birth on public.profiles
  deferrable initially deferred
  for each row execute function private.check_profile_identity();

create constraint trigger identity_records_profile_consistent
  after insert or update or delete on private.identity_records
  deferrable initially deferred
  for each row execute function private.check_profile_identity();

-- ---------------------------------------------------------------------------
-- Access. verifications: clients have no direct access (status reaches them via the API).
-- ---------------------------------------------------------------------------
alter table public.verifications        enable row level security;
alter table private.identity_records    enable row level security;
alter table private.email_verifications enable row level security;
alter table private.user_contact        enable row level security;

revoke all on public.verifications from anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
