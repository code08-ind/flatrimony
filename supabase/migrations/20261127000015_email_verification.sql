-- 0015 — Work and college email verification (T3.3; FR-VER-05; docs/05 §8.4, docs/04 §15.10).
--
-- A member proves they read a work or college mailbox by opening a one-time link. We keep the
-- domain (for the employer opt-in later) and an HMAC of the address (one mailbox, one account);
-- never the address itself (docs/04 §6.3: "drop the full address").
--
-- Each link belongs to one attempt in public.verifications (type work_email / college_email), so
-- the app can show its status and a newer request replaces an older one. The badge on the profile
-- (has_work_badge / has_college_badge) must always be backed by a confirmed link: deferred
-- triggers enforce it, so a bug in the API cannot hand out a badge.

alter table private.email_verifications
  add column verification_id uuid not null references public.verifications(id) on delete cascade,
  add column address_hash bytea not null,
  add column created_at timestamptz not null default now(),
  add constraint email_verifications_address_hash_len_chk check (octet_length(address_hash) = 32),
  add constraint email_verifications_expiry_chk check (expires_at > created_at),
  add constraint email_verifications_consumed_chk check (consumed_at is null or consumed_at >= created_at),
  add constraint email_verifications_verification_key unique (verification_id);

-- One mailbox, one account: an address confirmed for one member cannot badge another.
create unique index email_verifications_address_confirmed_key
  on private.email_verifications (address_hash) where consumed_at is not null;
-- Links sent to one address in the last day (the API caps them so nobody's inbox is flooded).
create index email_verifications_address_recent_idx
  on private.email_verifications (address_hash, created_at desc);

-- The confirm can find the address already confirmed by another member.
alter table public.verifications
  drop constraint verifications_failure_code_values_chk,
  add constraint verifications_failure_code_values_chk check (
    failure_code in ('name_mismatch', 'underage', 'provider_error', 'user_cancelled', 'identity_in_use',
                     'banned', 'email_in_use'));

-- ---------------------------------------------------------------------------
-- Badge ↔ confirmed link consistency (deferred: checked at commit).
-- ---------------------------------------------------------------------------
create or replace function private.check_profile_email_badges() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid;
  p public.profiles;
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
    return null;  -- profile deleted (cascade)
  end if;

  if p.has_work_badge and not exists (
    select 1 from private.email_verifications e
     where e.user_id = uid and e.type = 'work_email' and e.consumed_at is not null) then
    raise exception 'work_badge_unconfirmed' using errcode = '23514',
      detail = 'has_work_badge needs a confirmed work email link';
  end if;
  if p.has_college_badge and not exists (
    select 1 from private.email_verifications e
     where e.user_id = uid and e.type = 'college_email' and e.consumed_at is not null) then
    raise exception 'college_badge_unconfirmed' using errcode = '23514',
      detail = 'has_college_badge needs a confirmed college email link';
  end if;
  return null;
end $$;
revoke execute on function private.check_profile_email_badges() from public, anon, authenticated;

create constraint trigger profiles_email_badges_confirmed
  after insert or update of has_work_badge, has_college_badge on public.profiles
  deferrable initially deferred
  for each row execute function private.check_profile_email_badges();

create constraint trigger email_verifications_badges_confirmed
  after update or delete on private.email_verifications
  deferrable initially deferred
  for each row execute function private.check_profile_email_badges();

-- The link row and its attempt agree on the member and the type.
create or replace function private.check_email_verification_attempt() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.verifications;
begin
  select * into v from public.verifications where id = new.verification_id;
  if v.user_id is distinct from new.user_id or v.type is distinct from new.type then
    raise exception 'email_verification_attempt_mismatch' using errcode = '23514',
      detail = 'The link must belong to an attempt of the same member and type';
  end if;
  return new;
end $$;
revoke execute on function private.check_email_verification_attempt() from public, anon, authenticated;

create trigger email_verifications_attempt_matches
  before insert or update of verification_id, user_id, type on private.email_verifications
  for each row execute function private.check_email_verification_attempt();

comment on column private.email_verifications.address_hash is
  'HMAC-SHA-256(HASH_PEPPER, "email:" || normalised address). Never the address itself.';
