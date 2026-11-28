-- pgTAP: profiles, Flat Biodata and identity (docs/04 §6.2–6.3, §7, §8.4, §16; T2.1).
-- Covers constraints at and past each boundary, the access matrix (grants + RLS), JWT edge cases,
-- the profile ↔ DigiLocker identity invariant, limit triggers, cascade and updated_at.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- ------------------------------------------------------------------ fixtures (self-contained)
insert into ref.areas (slug, name_en, name_hi, city, centroid) values
  ('t-area-1', 'T1', 'T1', 'delhi', st_point(77.2, 28.6)::geography),
  ('t-area-2', 'T2', 'T2', 'delhi', st_point(77.2, 28.6)::geography),
  ('t-area-3', 'T3', 'T3', 'delhi', st_point(77.2, 28.6)::geography),
  ('t-area-4', 'T4', 'T4', 'delhi', st_point(77.2, 28.6)::geography);
create temp table t_areas on commit drop as select id from ref.areas where slug like 't-area-%' order by id;

-- A = Karan, B = Meera, C = auth user without a profile.
insert into auth.users (id, aud, role) values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated'),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated');
insert into public.profiles (id, display_name, intent, category, date_of_birth) values
  ('00000000-0000-4000-8000-00000000000a', 'Karan', 'need_room', 'professional', '2002-01-01'),
  ('00000000-0000-4000-8000-00000000000b', 'Meera', 'have_room', 'professional', '1998-01-01');
insert into public.preferences (user_id, budget_min_inr, budget_max_inr, move_in_from, move_in_to) values
  ('00000000-0000-4000-8000-00000000000a', 15000, 20000, '2026-12-01', '2026-12-31'),
  ('00000000-0000-4000-8000-00000000000b', 18000, 25000, '2026-12-01', '2026-12-31');
insert into public.lifestyle (user_id, bedtime, wake_time, cleaning, smoking, pets, food) values
  ('00000000-0000-4000-8000-00000000000a', '23:00', '07:00', 'daily', 'no', 'love', 'veg'),
  ('00000000-0000-4000-8000-00000000000b', '00:30', '08:00', 'weekly', 'outside_only', 'ok', 'non_veg');
insert into public.anchors (user_id, kind, label, location) values
  ('00000000-0000-4000-8000-00000000000a', 'office', 'Sector 62 office', st_point(77.365, 28.627)::geography),
  ('00000000-0000-4000-8000-00000000000b', 'office', 'Cyber City office', st_point(77.089, 28.495)::geography);

-- accepts(sql): true if the statement succeeds; the change is always rolled back (sub-transaction).
create or replace function pg_temp.accepts(stmt text) returns boolean language plpgsql as $$
begin
  execute stmt;
  raise exception 'rollback' using errcode = 'P9999';
exception
  when sqlstate 'P9999' then return true;
  when others then raise notice 'accepts() failed: %', sqlerrm; return false;
end $$;

-- Helper for constraint-name assertions.
create or replace function pg_temp.chk(t text, c text) returns text language sql as
  $$ select format('new row for relation "%s" violates check constraint "%s"', t, c) $$;

-- ================================================================== structure + access matrix
select has_table('private', 'identity_records', 'identity_records lives in private');
select has_table('private', 'user_contact', 'user_contact lives in private');

select is(
  (select array_agg(n.nspname || '.' || c.relname order by n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private', 'ref') and c.relkind in ('r', 'p') and not c.relrowsecurity),
  null, 'RLS is enabled on every table in public, private and ref');

select is(
  (select array_agg(format('%s:%s.%s:%s', grantee, table_schema, table_name, privilege_type) order by grantee, table_schema, table_name, privilege_type)
   from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated') and table_schema in ('public', 'private')),
  array['authenticated:public.anchors:SELECT', 'authenticated:public.consents:SELECT',
        'authenticated:public.contact_shares:SELECT', 'authenticated:public.lifestyle:SELECT',
        'authenticated:public.match_decisions:SELECT', 'authenticated:public.matches:SELECT',
        'authenticated:public.preferences:SELECT', 'authenticated:public.profiles:SELECT'],
  'clients hold exactly these grants in public/private: SELECT on their own-row tables (consents from 0008; matches, own decisions and contact shares from 0016)');

select schema_privs_are('private', 'anon', '{}', 'anon has no privileges on schema private');
select schema_privs_are('private', 'authenticated', '{}', 'authenticated has no privileges on schema private');
select ok(not has_function_privilege('anon', 'public.uid()', 'execute'), 'anon cannot call uid()');
select ok(not has_function_privilege('authenticated', 'public.enforce_max_rows()', 'execute'), 'clients cannot call enforce_max_rows()');
select ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'), 'clients cannot call set_updated_at()');
select ok(not has_function_privilege('authenticated', 'private.check_profile_identity()', 'execute'), 'clients cannot call private functions');

-- Default privileges: a table created later in public is closed to clients by default.
create table public.t_future (id int);
select ok(not has_table_privilege('anon', 'public.t_future', 'select') and not has_table_privilege('authenticated', 'public.t_future', 'insert'),
  'future tables in public are not granted to clients by default');
drop table public.t_future;

-- ================================================================== profiles constraints
select throws_ok($$insert into public.profiles (id, display_name, intent, date_of_birth)
  values ('00000000-0000-4000-8000-00000000000c', 'Teen', 'need_room', (now() at time zone 'Asia/Kolkata')::date - interval '18 years' + interval '1 day')$$,
  '23514', pg_temp.chk('profiles', 'profiles_adult_chk'), 'one day short of 18 (date in India) is rejected');
select ok(pg_temp.accepts($$insert into public.profiles (id, display_name, intent, date_of_birth)
  values ('00000000-0000-4000-8000-00000000000c', 'Adult', 'need_room', (now() at time zone 'Asia/Kolkata')::date - interval '18 years')$$), 'exactly 18 today in India is accepted (0008)');
select throws_ok($$insert into public.profiles (id, display_name, intent, date_of_birth) values ('00000000-0000-4000-8000-00000000000c', 'Old', 'need_room', '1899-12-31')$$,
  '23514', pg_temp.chk('profiles', 'profiles_adult_chk'), 'implausible dates of birth are rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-0000000000ff', 'Ghost', 'need_room')$$,
  '23503', null, 'a profile needs an auth user');

-- Display names: 1..40, visible, trimmed, no invisible/bidi characters.
select ok(pg_temp.accepts($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', 'K', 'need_room')$$), '1-character name ok');
select ok(pg_temp.accepts($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', repeat('क', 40), 'need_room')$$), '40-character Devanagari name ok');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', repeat('x', 41), 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), '41 characters rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', '', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'empty name rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', '   ', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'whitespace-only name rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', '  Karan  ', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'untrimmed name rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', U&'\200B', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'zero-width-only name rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', U&'Admin\202E', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'bidi-override name rejected');
select throws_ok($$insert into public.profiles (id, display_name, intent) values ('00000000-0000-4000-8000-00000000000c', E'Ka\tran', 'need_room')$$,
  '23514', pg_temp.chk('profiles', 'profiles_display_name_chk'), 'control characters rejected');

select ok(pg_temp.accepts($$update public.profiles set bio = repeat('x', 300) where id = '00000000-0000-4000-8000-00000000000a'$$), 'bio of 300 ok');
select throws_ok($$update public.profiles set bio = repeat('x', 301) where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_bio_chk'), 'bio of 301 rejected');

select ok(pg_temp.accepts($$update public.profiles set languages = '{hi,en,pa}' where id = '00000000-0000-4000-8000-00000000000a'$$), 'ISO 639-1 languages ok');
select throws_ok($$update public.profiles set languages = '{klingon}' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_languages_chk'), 'non-ISO language rejected');
select throws_ok($$update public.profiles set languages = array['en', null] where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_languages_chk'), 'NULL language rejected');
select throws_ok($$update public.profiles set languages = array_fill('en'::text, array[11]) where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_languages_chk'), 'more than 10 languages rejected');

-- ================================================================== verified identity invariants
-- Verified ⇔ has a verified gender.
select throws_ok($$update public.profiles set is_identity_verified = true where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_verified_gender_chk'), 'verified without a verified gender rejected');
select throws_ok($$update public.profiles set verified_gender = 'female' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_verified_gender_chk'), 'a verified gender on an unverified profile rejected');

-- Women-only (FR-VER-06). Each case isolates profiles_women_only_chk: the profile is verified with
-- a gender, so profiles_verified_gender_chk holds.
select ok(pg_temp.accepts($$update public.profiles set category = 'women_only' where id = '00000000-0000-4000-8000-00000000000a'$$), 'an unverified user may pick women_only (invisible until verified)');
select throws_ok($$update public.profiles set category = 'women_only', is_identity_verified = true, verified_gender = 'male' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_women_only_chk'), 'women_only + verified male rejected');
select throws_ok($$update public.profiles set category = 'women_only', is_identity_verified = true, verified_gender = 'transgender' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('profiles', 'profiles_women_only_chk'), 'women_only + verified transgender rejected');

-- Profile ↔ private.identity_records (deferred constraint triggers; forced immediate here).
set constraints all immediate;
select throws_ok($$update public.profiles set is_identity_verified = true, verified_gender = 'female' where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', 'identity_record_missing', 'a profile cannot claim verification without a DigiLocker record');
insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-00000000000b', '\x01' || decode(repeat('00', 40), 'hex'), '1998-01-01', 'female', decode(repeat('ab', 32), 'hex'));
select throws_ok($$update public.profiles set is_identity_verified = true, verified_gender = 'male' where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', 'verified_gender_mismatch', 'the profile''s verified gender must equal the DigiLocker result');
select lives_ok($$update public.profiles set is_identity_verified = true, verified_gender = 'female', category = 'women_only' where id = '00000000-0000-4000-8000-00000000000b'$$,
  'verified female from DigiLocker can be women_only');
select throws_ok($$update public.profiles set date_of_birth = '1999-05-05' where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', 'verified_dob_mismatch', 'once verified, the DOB is the DigiLocker DOB');
select throws_ok($$update private.identity_records set verified_gender = 'male' where user_id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', 'verified_gender_mismatch', 'changing the identity record alone cannot desync the profile');
select throws_ok($$delete from private.identity_records where user_id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', 'identity_record_missing', 'the identity record of a verified profile cannot be deleted on its own');
select throws_ok($$update public.profiles set verified_gender = null where id = '00000000-0000-4000-8000-00000000000b'$$,
  '23514', null, 'a verified women_only user cannot lose the female verified gender');
set constraints all deferred;

-- ================================================================== identity records
select throws_ok($$insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-00000000000a', '\x01' || decode(repeat('00', 40), 'hex'), '2002-01-01', 'male', decode(repeat('ab', 32), 'hex'))$$,
  '23505', null, 'a DigiLocker identity can back only one account');
select throws_ok($$insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-00000000000a', convert_to('Karan Mehta S/O Rajesh Mehta, New Delhi', 'UTF8'), '2002-01-01', 'male', decode(repeat('cd', 32), 'hex'))$$,
  '23514', null, 'a plaintext name (no envelope version byte) is rejected');
select throws_ok($$insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-00000000000a', '\x01' || decode(repeat('00', 40), 'hex'), current_date - interval '15 years', 'male', decode(repeat('cd', 32), 'hex'))$$,
  '23514', null, 'a minor''s verified DOB is never stored');
select throws_ok($$insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
  values ('00000000-0000-4000-8000-00000000000a', '\x01' || decode(repeat('00', 40), 'hex'), '2002-01-01', 'male', decode(repeat('cd', 31), 'hex'))$$,
  '23514', null, 'DigiLocker id must be a 32-byte HMAC');

insert into private.user_contact (user_id, phone_hash) values ('00000000-0000-4000-8000-00000000000a', decode(repeat('11', 32), 'hex'));
select throws_ok($$insert into private.user_contact (user_id, phone_hash) values ('00000000-0000-4000-8000-00000000000b', decode(repeat('11', 32), 'hex'))$$,
  '23505', null, 'one account per phone hash');
select throws_ok($$insert into private.user_contact (user_id, phone_hash) values ('00000000-0000-4000-8000-00000000000b', '\x01')$$,
  '23514', null, 'phone is stored only as a 32-byte HMAC');

-- ================================================================== verifications
select throws_ok($$insert into public.verifications (user_id, type, status, completed_at) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'failed', now())$$,
  '23514', pg_temp.chk('verifications', 'verifications_failure_code_chk'), 'failed without a failure code rejected');
select throws_ok($$insert into public.verifications (user_id, type, status, failure_code) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'failed', 'user_cancelled')$$,
  '23514', pg_temp.chk('verifications', 'verifications_completed_chk'), 'failed without completion time rejected');
select throws_ok($$insert into public.verifications (user_id, type, status, failure_code, completed_at) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'verified', 'user_cancelled', now())$$,
  '23514', pg_temp.chk('verifications', 'verifications_failure_code_chk'), 'verified with a failure code rejected');
select throws_ok($$insert into public.verifications (user_id, type, status) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'verified')$$,
  '23514', pg_temp.chk('verifications', 'verifications_completed_chk'), 'verified without completion time rejected');
select throws_ok($$insert into public.verifications (user_id, type, status, failure_code, completed_at) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'failed', 'whatever', now())$$,
  '23514', pg_temp.chk('verifications', 'verifications_failure_code_values_chk'), 'unknown failure code rejected');
select throws_ok($$insert into public.verifications (user_id, type, provider_ref) values ('00000000-0000-4000-8000-00000000000a', 'digilocker', '1234 5678 9012')$$,
  '23514', pg_temp.chk('verifications', 'verifications_provider_ref_chk'), 'an Aadhaar-like number is never stored as provider ref');
insert into public.verifications (user_id, type) values ('00000000-0000-4000-8000-00000000000a', 'digilocker');
select throws_ok($$insert into public.verifications (user_id, type) values ('00000000-0000-4000-8000-00000000000a', 'digilocker')$$,
  '23505', null, 'one pending verification per user and type');

select throws_ok($$insert into private.email_verifications (user_id, type, email_domain, token_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', 'digilocker', 'example.com', decode(repeat('ab', 32), 'hex'), now())$$,
  '23514', null, 'email verifications are work or college email only');
select throws_ok($$insert into private.email_verifications (user_id, type, email_domain, token_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000000a', 'work_email', '..com', decode(repeat('ab', 32), 'hex'), now())$$,
  '23514', null, 'malformed email domain rejected');

-- ================================================================== preferences, anchors, lifestyle
select ok(pg_temp.accepts($$update public.preferences set budget_min_inr = 1000, budget_max_inr = 200000 where user_id = '00000000-0000-4000-8000-00000000000a'$$), 'budget exactly ₹1,000–₹2,00,000 ok');
select ok(pg_temp.accepts($$update public.preferences set budget_min_inr = 20000 where user_id = '00000000-0000-4000-8000-00000000000a'$$), 'minimum = maximum ok');
select throws_ok($$update public.preferences set budget_min_inr = 999 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_budget_min_chk'), 'budget below ₹1,000 rejected');
select throws_ok($$update public.preferences set budget_max_inr = 200001 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_budget_max_chk'), 'budget above ₹2,00,000 rejected');
select throws_ok($$update public.preferences set budget_min_inr = 21000 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_budget_chk'), 'minimum above maximum rejected');
select throws_ok($$update public.preferences set move_in_to = '2026-11-30' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_dates_chk'), 'move-in window ending before it starts rejected');
select throws_ok($$update public.preferences set move_in_to = 'infinity' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_dates_chk'), 'infinite move-in dates rejected');
select is((select lease_months::int from public.preferences where user_id = '00000000-0000-4000-8000-00000000000a'), 11, 'lease defaults to 11 months');
select ok(pg_temp.accepts($$update public.preferences set lease_months = 1 where user_id = '00000000-0000-4000-8000-00000000000a';
  update public.preferences set lease_months = 36 where user_id = '00000000-0000-4000-8000-00000000000a'$$), 'lease 1 and 36 ok');
select throws_ok($$update public.preferences set lease_months = 0 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_lease_months_chk'), 'lease 0 rejected');
select throws_ok($$update public.preferences set lease_months = 37 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('preferences', 'preferences_lease_months_chk'), 'lease 37 rejected');

select is((select max_commute_min::int from public.anchors where user_id = '00000000-0000-4000-8000-00000000000a'), 45, 'commute defaults to 45 minutes');
select ok(pg_temp.accepts($$update public.anchors set max_commute_min = 15 where user_id = '00000000-0000-4000-8000-00000000000a';
  update public.anchors set max_commute_min = 90 where user_id = '00000000-0000-4000-8000-00000000000a'$$), 'commute 15 and 90 ok');
select throws_ok($$update public.anchors set max_commute_min = 14 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('anchors', 'anchors_max_commute_min_chk'), 'commute 14 rejected');
select throws_ok($$update public.anchors set max_commute_min = 91 where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('anchors', 'anchors_max_commute_min_chk'), 'commute 91 rejected');
select throws_ok($$update public.anchors set label = '   ' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('anchors', 'anchors_label_chk'), 'blank anchor label rejected');
select throws_ok($$update public.anchors set label = repeat('x', 81) where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('anchors', 'anchors_label_chk'), 'anchor label over 80 rejected');
select throws_ok($$insert into public.commute_zones (user_id, travel_mode, max_minutes, zone)
  values ('00000000-0000-4000-8000-00000000000a', 'car', 91, st_multi(st_buffer(st_point(77.2, 28.6)::geography, 1000)::geometry)::geography)$$,
  '23514', pg_temp.chk('commute_zones', 'commute_zones_max_minutes_chk'), 'commute zone over 90 minutes rejected');
select throws_ok($$update public.lifestyle set bedtime = '24:00' where user_id = '00000000-0000-4000-8000-00000000000a'$$,
  '23514', pg_temp.chk('lifestyle', 'lifestyle_times_chk'), 'bedtime 24:00 rejected');

insert into public.lifestyle_importance (user_id, attribute) values ('00000000-0000-4000-8000-00000000000a', 'cleaning');
select is((select importance::text from public.lifestyle_importance where user_id = '00000000-0000-4000-8000-00000000000a' and attribute = 'cleaning'),
  'matters', 'importance defaults to matters (FR-BIO-05)');

-- Scenario answers must use one of the question's options.
select ok(pg_temp.accepts($$insert into public.scenario_answers (user_id, question_id, option_id) values ('00000000-0000-4000-8000-00000000000a', 'sink_dishes_10pm', 'wash_now')$$), 'a real option is accepted');
select throws_ok($$insert into public.scenario_answers (user_id, question_id, option_id) values ('00000000-0000-4000-8000-00000000000a', 'sink_dishes_10pm', 'set_house_on_fire')$$,
  '23514', 'invalid_scenario_option', 'a made-up option is rejected');

-- ================================================================== limits: areas (3) and photos (6)
insert into public.preference_areas (user_id, area_id) select '00000000-0000-4000-8000-00000000000a', id from t_areas order by id limit 3;
select throws_ok($$insert into public.preference_areas (user_id, area_id) select '00000000-0000-4000-8000-00000000000a', id from t_areas order by id offset 3 limit 1$$,
  'P0001', 'limit_exceeded', 'a 4th preferred area is rejected');
select lives_ok($$insert into public.preference_areas (user_id, area_id) select '00000000-0000-4000-8000-00000000000a', id from t_areas order by id limit 1 on conflict do nothing$$,
  're-saving an existing area at the limit is not growth');
select throws_ok($$insert into public.preference_areas (user_id, area_id) select '00000000-0000-4000-8000-00000000000a', id from t_areas order by id limit 1$$,
  '23505', null, 'a duplicate area at the limit reports the duplicate, not the limit');
-- B already has 3 areas (t-area-2..4); moving A's t-area-1 row to B would make 4.
insert into public.preference_areas (user_id, area_id) select '00000000-0000-4000-8000-00000000000b', id from t_areas order by id offset 1 limit 3;
select throws_ok($$update public.preference_areas set user_id = '00000000-0000-4000-8000-00000000000b'
  where user_id = '00000000-0000-4000-8000-00000000000a' and area_id = (select min(id) from t_areas)$$,
  'P0001', 'limit_exceeded', 'moving areas to another user cannot exceed their limit');

insert into public.profile_photos (user_id, storage_path, position)
  select '00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || gen_random_uuid() || '.webp', g from generate_series(0, 5) g;
select is((select count(*)::int from public.profile_photos where user_id = '00000000-0000-4000-8000-00000000000a'), 6, 'six photos allowed');
select throws_ok($$insert into public.profile_photos (user_id, storage_path, position)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || gen_random_uuid() || '.webp', 6)$$,
  '23514', pg_temp.chk('profile_photos', 'profile_photos_position_chk'), 'a 7th photo (position 6) rejected');
select lives_ok($$insert into public.profile_photos (user_id, storage_path, position)
  values ('00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000a/' || gen_random_uuid() || '.webp', 3)
  on conflict (user_id, position) do update set storage_path = excluded.storage_path$$,
  'replacing the photo at a position works at the limit');
select throws_ok($$insert into public.profile_photos (user_id, storage_path, position)
  values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000a/' || gen_random_uuid() || '.webp', 0)$$,
  '23514', pg_temp.chk('profile_photos', 'profile_photos_storage_path_chk'), 'a photo path in another user''s folder is rejected');
select throws_ok($$insert into public.profile_photos (user_id, storage_path, position)
  values ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000b/../../secret.webp', 0)$$,
  '23514', pg_temp.chk('profile_photos', 'profile_photos_storage_path_chk'), 'path traversal in a photo path is rejected');

-- ================================================================== updated_at
update public.profiles    set updated_at = '2000-01-01' where id = '00000000-0000-4000-8000-00000000000a';
update public.preferences set updated_at = '2000-01-01' where user_id = '00000000-0000-4000-8000-00000000000a';
update public.anchors     set updated_at = '2000-01-01' where user_id = '00000000-0000-4000-8000-00000000000a';
update public.lifestyle   set updated_at = '2000-01-01' where user_id = '00000000-0000-4000-8000-00000000000a';
update private.user_contact set updated_at = '2000-01-01' where user_id = '00000000-0000-4000-8000-00000000000a';
select ok(
  (select updated_at = now() from public.profiles where id = '00000000-0000-4000-8000-00000000000a')
  and (select updated_at = now() from public.preferences where user_id = '00000000-0000-4000-8000-00000000000a')
  and (select updated_at = now() from public.anchors where user_id = '00000000-0000-4000-8000-00000000000a')
  and (select updated_at = now() from public.lifestyle where user_id = '00000000-0000-4000-8000-00000000000a')
  and (select updated_at = now() from private.user_contact where user_id = '00000000-0000-4000-8000-00000000000a'),
  'updated_at is set by the trigger on every table (a forged value is overwritten)');

-- ================================================================== uid() edge cases
select is(public.uid(), null, 'uid() is NULL when no claims are set');
select set_config('request.jwt.claims', '', true);
select is(public.uid(), null, 'uid() is NULL for empty claims (pooled connection after SET LOCAL)');
select set_config('request.jwt.claims', '{}', true);
select is(public.uid(), null, 'uid() is NULL without sub');
select set_config('request.jwt.claims', '{"sub":"user-1"}', true);
select is(public.uid(), null, 'uid() is NULL for a non-UUID sub');

-- ================================================================== access as Karan (authenticated)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

select is(public.uid(), '00000000-0000-4000-8000-00000000000a'::uuid, 'uid() reads the JWT subject');
select is((select array_agg(display_name) from public.profiles), array['Karan'], 'a user sees exactly one profile: their own');
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-00000000000b'), 0,
  'cannot read another user''s profile (or learn she is women_only)');
select is((select count(*)::int from public.preferences), 1, 'own preferences only');
select is((select count(*)::int from public.lifestyle), 1, 'own lifestyle only');
select is((select count(*)::int from public.anchors), 1, 'own anchor only');
select throws_ok($$select 1 from public.profile_photos$$, '42501', null, 'no direct access to photos rows (served via API)');
select throws_ok($$select 1 from public.preference_areas$$, '42501', null, 'no direct access to preference areas');
select throws_ok($$select 1 from public.commute_zones$$, '42501', null, 'no direct access to commute zones');
select throws_ok($$select 1 from public.scenario_answers$$, '42501', null, 'no direct access to scenario answers');
select throws_ok($$select 1 from public.lifestyle_importance$$, '42501', null, 'no direct access to importance rows');
select throws_ok($$select 1 from public.verifications$$, '42501', null, 'no direct access to verifications');
select throws_ok($$select 1 from private.identity_records$$, '42501', null, 'no access to identity records');
select throws_ok($$update public.profiles set display_name = 'Hacker' where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'cannot update even their own profile directly (writes go through the API)');
select throws_ok($$update public.profiles set verified_gender = 'female', is_identity_verified = true where id = '00000000-0000-4000-8000-00000000000a'$$,
  '42501', null, 'cannot self-assign a verified gender');
select throws_ok($$insert into public.preference_areas (user_id, area_id) values ('00000000-0000-4000-8000-00000000000a', 1)$$,
  '42501', null, 'cannot insert rows directly');
select throws_ok($$delete from public.profiles$$, '42501', null, 'cannot delete profiles');

-- A signed-in user with no profile, and a malformed subject, see nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 0, 'a user without a profile sees no profiles');
select set_config('request.jwt.claims', '{"sub":"not-a-uuid","role":"authenticated"}', true);
select is((select count(*)::int from public.profiles), 0, 'a malformed subject sees no profiles (and does not error)');
reset role;

-- ================================================================== anonymous
set local role anon;
select throws_ok($$select 1 from public.profiles$$, '42501', null, 'anon cannot read profiles');
select throws_ok($$select 1 from public.preferences$$, '42501', null, 'anon cannot read preferences');
select throws_ok($$select 1 from public.lifestyle$$, '42501', null, 'anon cannot read lifestyle');
select throws_ok($$select 1 from public.anchors$$, '42501', null, 'anon cannot read anchors');
select throws_ok($$select 1 from public.verifications$$, '42501', null, 'anon cannot read verifications');
reset role;

-- ================================================================== deletion cascades from auth
set constraints all immediate;
delete from auth.users where id = '00000000-0000-4000-8000-00000000000a';
select is(
  (select (select count(*) from public.profiles where id = u) + (select count(*) from public.profile_photos where user_id = u)
        + (select count(*) from public.preferences where user_id = u) + (select count(*) from public.preference_areas where user_id = u)
        + (select count(*) from public.anchors where user_id = u) + (select count(*) from public.lifestyle where user_id = u)
        + (select count(*) from public.lifestyle_importance where user_id = u) + (select count(*) from public.scenario_answers where user_id = u)
        + (select count(*) from public.verifications where user_id = u) + (select count(*) from private.user_contact where user_id = u)
   from (select '00000000-0000-4000-8000-00000000000a'::uuid as u) x)::int,
  0, 'deleting the auth user removes every row of that user (FR-PRIV-02)');
select is((select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-00000000000b'), 1, 'other users are untouched');

select * from finish();
rollback;
