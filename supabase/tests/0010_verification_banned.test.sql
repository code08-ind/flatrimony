-- pgTAP: DigiLocker failure codes (T3.1, migration 0010).
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000000b1', 'authenticated', 'authenticated', '919600000101');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000000b1', 'Banned Test', 'need_room');

select lives_ok($$insert into public.verifications (user_id, type, status, failure_code, completed_at)
  values ('00000000-0000-4000-8000-0000000000b1', 'digilocker', 'failed', 'banned', now())$$,
  'a banned DigiLocker identity is a failure code');
select lives_ok($$insert into public.verifications (user_id, type, status, failure_code, completed_at)
  values ('00000000-0000-4000-8000-0000000000b1', 'digilocker', 'failed', 'identity_in_use', now())$$,
  'the earlier codes still work');
select throws_ok($$insert into public.verifications (user_id, type, status, failure_code, completed_at)
  values ('00000000-0000-4000-8000-0000000000b1', 'digilocker', 'failed', 'expired', now())$$,
  '23514', null, 'expiry is a status, not a failure code');

select * from finish();
rollback;
