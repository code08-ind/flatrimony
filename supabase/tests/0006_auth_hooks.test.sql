-- pgTAP: Supabase Auth before_user_created hook (T2.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select is(public.hook_before_user_created('{"user":{"phone":"+919812345678"}}'), '{}'::jsonb, 'an Indian mobile with + is allowed');
select is(public.hook_before_user_created('{"user":{"phone":"919812345678"}}'), '{}'::jsonb, 'an Indian mobile without + is allowed');
select is(public.hook_before_user_created('{"user":{"phone":"916000000000"}}'), '{}'::jsonb, 'numbers starting with 6 are mobiles');

select is((public.hook_before_user_created('{"user":{"phone":"+14155550100"}}') -> 'error' ->> 'http_code')::int, 400, 'a US number is refused');
select is((public.hook_before_user_created('{"user":{"phone":"+915812345678"}}') -> 'error' ->> 'http_code')::int, 400, '+91 numbers starting with 5 are refused');
select is((public.hook_before_user_created('{"user":{"phone":"+9198123456789"}}') -> 'error' ->> 'http_code')::int, 400, 'too many digits refused');
select is((public.hook_before_user_created('{"user":{"phone":"","email":"a@b.c"}}') -> 'error' ->> 'http_code')::int, 400, 'email sign-ups are refused');
select is((public.hook_before_user_created('{"user":{}}') -> 'error' ->> 'http_code')::int, 400, 'a user without a phone is refused');

select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'), 'Auth can call the hook');
select ok(not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'), 'anon cannot call the hook');
select ok(not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'), 'authenticated cannot call the hook');

select is(public.hook_password_verification_attempt('{"user_id":"00000000-0000-4000-8000-000000000001","valid":true}') ->> 'decision', 'reject',
  'even a correct password is rejected: phone OTP is the only sign-in');
select is((public.hook_password_verification_attempt('{"user_id":"00000000-0000-4000-8000-000000000001","valid":true}') ->> 'should_logout_user')::boolean, true,
  'and the user''s sessions are revoked');
select ok(has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'execute'), 'Auth can call the password hook');
select ok(not has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'execute'), 'clients cannot call the password hook');

select * from finish();
rollback;
