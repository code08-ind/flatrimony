-- pgTAP: consents and devices (docs/04 §6.10; T2.5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

insert into auth.users (id, aud, role) values
  ('00000000-0000-4000-8000-0000000008a1', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-0000000008b1', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000008a1', 'Asha', 'need_room'),
  ('00000000-0000-4000-8000-0000000008b1', 'Ravi', 'have_room');

-- ------------------------------------------------------------------ consents
select has_table('public', 'consents', 'consents table exists');
select lives_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'terms', '2026-11-01'),
  ('00000000-0000-4000-8000-0000000008a1', 'privacy', '2026-11-01'),
  ('00000000-0000-4000-8000-0000000008b1', 'terms', '2026-11-01')$$, 'consents are stored per purpose and version');
select lives_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'terms', '2027-01-15')$$, 'a newer version adds a row (history kept)');
select throws_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'terms', '2026-11-01')$$, '23505', null, 'one ACTIVE grant per purpose and version');
select throws_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'analytics', '')$$, '23514', null, 'a version is required');
select throws_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'analytics', 'v 1; drop')$$, '23514', null, 'versions are short tokens');
select throws_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'aadhaar', 'v1')$$, '22P02', null, 'only known purposes');
select throws_ok($$update public.consents set withdrawn_at = granted_at - interval '1 second'
  where user_id = '00000000-0000-4000-8000-0000000008a1' and purpose = 'privacy'$$, '23514', null, 'cannot be withdrawn before it was granted');
select lives_ok($$update public.consents set withdrawn_at = now()
  where user_id = '00000000-0000-4000-8000-0000000008a1' and purpose = 'privacy' and withdrawn_at is null$$, 'a grant is withdrawn');
select lives_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'privacy', '2026-11-01')$$, 'granting again adds a new row');
select is((select count(*)::int from public.consents where user_id = '00000000-0000-4000-8000-0000000008a1' and purpose = 'privacy'),
  2, 'the withdrawal stays on record (append-only history)');
select throws_ok($$update public.consents set withdrawn_at = null
  where user_id = '00000000-0000-4000-8000-0000000008a1' and purpose = 'privacy' and withdrawn_at is not null$$, '23514', null, 'a withdrawal cannot be undone in place');
select throws_ok($$update public.consents set granted_at = granted_at - interval '1 day'
  where user_id = '00000000-0000-4000-8000-0000000008b1'$$, '23514', null, 'grants are never re-dated');
select throws_ok($$update public.consents set version = '2099-01-01'
  where user_id = '00000000-0000-4000-8000-0000000008b1'$$, '23514', null, 'grants are never edited');

-- ------------------------------------------------------------------ devices
select has_table('public', 'devices', 'devices table exists');
select lives_ok($$insert into public.devices (user_id, device_hash, platform, app_version, push_token, integrity_verdict) values
  ('00000000-0000-4000-8000-0000000008a1', decode(repeat('ab', 32), 'hex'), 'android', '1.0.0', 'ExponentPushToken[abc]', 'unverified')$$,
  'a device is registered');
select throws_ok($$insert into public.devices (user_id, device_hash, platform) values
  ('00000000-0000-4000-8000-0000000008a1', decode(repeat('ab', 32), 'hex'), 'android')$$, '23505', null, 'one row per user and device');
select lives_ok($$insert into public.devices (user_id, device_hash, platform) values
  ('00000000-0000-4000-8000-0000000008b1', decode(repeat('ab', 32), 'hex'), 'android')$$, 'a shared device can belong to two users (broker signal, not an error)');
select throws_ok($$insert into public.devices (user_id, device_hash, platform) values
  ('00000000-0000-4000-8000-0000000008a1', '\x01', 'android')$$, '23514', null, 'device hashes are 32-byte HMACs, never raw ids');
select throws_ok($$insert into public.devices (user_id, device_hash, platform, app_version) values
  ('00000000-0000-4000-8000-0000000008a1', decode(repeat('cd', 32), 'hex'), 'android', 'latest')$$, '23514', null, 'app versions are semver');
select throws_ok($$insert into public.devices (user_id, device_hash, platform, integrity_verdict) values
  ('00000000-0000-4000-8000-0000000008a1', decode(repeat('cd', 32), 'hex'), 'android', 'trust me')$$, '23514', null, 'only known integrity verdicts');

-- ------------------------------------------------------------------ human text (QA T2.5 D2)
select ok(not public.is_human_text(E'\u3164') and not public.is_human_text(E'A\u2800') and not public.is_human_text(E'\u115F\u1160'),
  'blank-looking characters do not make a name');
select ok(public.is_human_text('अर्जुन 🙂') and public.is_human_text('Meera'), 'Devanagari, emoji and Latin names still pass');
select throws_ok($$update public.profiles set display_name = E'\u3164' where id = '00000000-0000-4000-8000-0000000008a1'$$,
  '23514', null, 'the profile name constraint uses the tightened rule');

-- ------------------------------------------------------------------ access
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000008a1","role":"authenticated"}', true);
select is((select count(*)::int from public.consents), 4, 'a user reads only their own consents');
select throws_ok($$insert into public.consents (user_id, purpose, version) values
  ('00000000-0000-4000-8000-0000000008a1', 'marketing', 'v1')$$, '42501', null, 'clients cannot write consents');
select throws_ok($$select 1 from public.devices$$, '42501', null, 'clients cannot read devices');
reset role;
set local role anon;
select throws_ok($$select 1 from public.consents$$, '42501', null, 'anon cannot read consents');
reset role;

select * from finish();
rollback;
