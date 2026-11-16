-- 0006 — Supabase Auth hooks: before user created + password verification (T2.2, FR-AUTH-01).
--
-- Flatrimony accepts only Indian mobile numbers (+91, 10 digits starting 6–9). The Send SMS hook
-- in the API also refuses other numbers, but by then Auth has already created an unconfirmed user.
-- This hook runs first, inside Auth's transaction, so a refused number never creates a user.
-- Email/OAuth/anonymous sign-ups are not offered; anything without an Indian mobile is refused.
--
-- Called only by Auth (role supabase_auth_admin). Not SECURITY DEFINER (Supabase guidance); it
-- reads nothing but the event.

create or replace function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  phone text := regexp_replace(coalesce(event -> 'user' ->> 'phone', ''), '^\+', '');
begin
  if phone ~ '^91[6-9][0-9]{9}$' then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 400,
      'message', 'Only Indian mobile numbers (+91) can sign up.'
    )
  );
end $$;

revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- Password verification attempt hook: phone OTP is the ONLY way in (FR-AUTH-01).
-- Supabase has no switch to turn password sign-in off, and anyone can call /signup with a phone
-- and a password, or set a password with PUT /user. Without this hook a password set on an
-- account (even before its real owner first signs in by OTP) would keep working. Every password
-- attempt is rejected and the user's sessions are revoked.
-- ---------------------------------------------------------------------------
create or replace function public.hook_password_verification_attempt(event jsonb) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'decision', 'reject',
    'message', 'Sign in with the one-time code sent to your phone.',
    'should_logout_user', true
  )
$$;

revoke execute on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin;
