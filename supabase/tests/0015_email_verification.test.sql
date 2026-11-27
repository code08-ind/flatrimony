-- pgTAP: work and college email verification (T3.3, migration 0015).
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, aud, role, phone) values
  ('00000000-0000-4000-8000-0000000000e1', 'authenticated', 'authenticated', '919600000151'),
  ('00000000-0000-4000-8000-0000000000e2', 'authenticated', 'authenticated', '919600000152');
insert into public.profiles (id, display_name, intent) values
  ('00000000-0000-4000-8000-0000000000e1', 'Email One', 'need_room'),
  ('00000000-0000-4000-8000-0000000000e2', 'Email Two', 'need_room');

insert into public.verifications (id, user_id, type, provider, expires_at) values
  ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000e1', 'work_email', 'internal_email', now() + interval '1 day'),
  ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000e2', 'work_email', 'internal_email', now() + interval '1 day'),
  ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000e1', 'college_email', 'internal_email', now() + interval '1 day');

-- 1. A link for an attempt of the same member and type.
select lives_ok($$insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000e1', 'work_email',
          'example.com', extensions.digest('t1', 'sha256'), extensions.digest('a1', 'sha256'), now() + interval '1 day')$$,
  'a link belongs to its attempt');

-- 2–3. Another member's attempt, or another type, is refused.
select throws_ok($$insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000e1', 'work_email',
          'example.com', extensions.digest('t2', 'sha256'), extensions.digest('a2', 'sha256'), now() + interval '1 day')$$,
  '23514', 'email_verification_attempt_mismatch', 'a link cannot use another member''s attempt');
select throws_ok($$insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000e1', 'work_email',
          'example.com', extensions.digest('t3', 'sha256'), extensions.digest('a3', 'sha256'), now() + interval '1 day')$$,
  '23514', 'email_verification_attempt_mismatch', 'a work link cannot use a college attempt');

-- 4. One link per attempt.
select throws_ok($$insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000e1', 'work_email',
          'example.com', extensions.digest('t4', 'sha256'), extensions.digest('a1', 'sha256'), now() + interval '1 day')$$,
  '23505', null, 'one link per attempt');

-- 5. The address is an HMAC (32 bytes), never the address.
select throws_ok($$insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000e1', 'college_email',
          'iitd.ac.in', extensions.digest('t5', 'sha256'), convert_to('someone@iitd.ac.in', 'utf8'), now() + interval '1 day')$$,
  '23514', null, 'a plain address is refused');

-- 6. A badge without a confirmed link is refused at commit (deferred: checked here immediately).
set constraints all immediate;
select throws_ok($$update public.profiles set has_work_badge = true
  where id = '00000000-0000-4000-8000-0000000000e1'$$,
  '23514', 'work_badge_unconfirmed', 'no work badge without a confirmed link');
select throws_ok($$update public.profiles set has_college_badge = true
  where id = '00000000-0000-4000-8000-0000000000e1'$$,
  '23514', 'college_badge_unconfirmed', 'no college badge without a confirmed link');
set constraints all deferred;

-- 8. Confirming the link, then the badge.
update private.email_verifications set consumed_at = now()
 where verification_id = '00000000-0000-4000-8000-00000000a001';
update public.verifications set status = 'verified', completed_at = now()
 where id = '00000000-0000-4000-8000-00000000a001';
set constraints all immediate;
select lives_ok($$update public.profiles set has_work_badge = true
  where id = '00000000-0000-4000-8000-0000000000e1'$$, 'a confirmed link backs the badge');

-- 9. Removing the confirmed link while the badge stands is refused.
select throws_ok($$delete from private.email_verifications
  where verification_id = '00000000-0000-4000-8000-00000000a001'$$,
  '23514', 'work_badge_unconfirmed', 'the badge keeps its confirmed link');
set constraints all deferred;

-- 10. One mailbox, one account: the same address confirmed for another member is refused.
insert into private.email_verifications
    (verification_id, user_id, type, email_domain, token_hash, address_hash, expires_at)
  values ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000e2', 'work_email',
          'example.com', extensions.digest('t6', 'sha256'), extensions.digest('a1', 'sha256'), now() + interval '1 day');
select throws_ok($$update private.email_verifications set consumed_at = now()
  where verification_id = '00000000-0000-4000-8000-00000000a002'$$,
  '23505', null, 'an address confirmed by one member cannot be confirmed by another');

-- 11. The new failure code.
select lives_ok($$update public.verifications set status = 'failed', failure_code = 'email_in_use', completed_at = now()
  where id = '00000000-0000-4000-8000-00000000a002'$$, 'email_in_use is a failure code');

-- 12. Deleting the profile takes its links (cascade) without tripping the badge check.
set constraints all immediate;
select lives_ok($$delete from public.profiles where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'a deleted profile takes its links');
set constraints all deferred;

-- 13. Clients have no access to the private links.
select is(has_table_privilege('authenticated', 'private.email_verifications', 'select'), false,
  'members cannot read the links');

select * from finish();
rollback;
