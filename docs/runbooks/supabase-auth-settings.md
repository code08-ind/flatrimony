# Supabase Auth settings for hosted projects (staging, production)

`supabase/config.toml` configures only the **local** stack. Hosted projects are configured in the
Supabase dashboard (or the Management API). Set these before enabling staging (T1.12) and before
launch, and re-check after any Supabase upgrade. Founder-owned: needs the Supabase account.

Source: T2.2 (phone OTP). Every item below closes a hole found by manual QA on 16 Nov 2026.

| Setting | Value | Why |
| --- | --- | --- |
| Phone provider | **Enabled** | Phone OTP is the only sign-in (FR-AUTH-01). |
| Phone confirmations ("Confirm phone") | **On** | Off lets `/signup` with phone + password, and `PUT /user {phone}`, skip the OTP entirely (QA T2.2 D1/D2). |
| SMS OTP expiry | **≤ 300 seconds** | The local CLI default is 6000 s (100 min) and cannot be changed in `config.toml`; a long window helps brute force until the T2.3 lockout exists (QA D3). |
| SMS OTP length | 6 | The Send SMS hook accepts exactly 6 digits; change both together. |
| SMS rate limit / resend interval | Resend ≥ 30 s; review the hourly SMS cap against expected sign-ups | Matches the OTP screen (docs/06 §8.2). The default project-wide cap (30/h) is far too low for launch. |
| Email provider | **Disabled** | No email accounts; otherwise email + password sign-ups bypass phone verification (QA D1). |
| Anonymous sign-ins | Disabled | Not offered. |
| Send SMS hook | HTTPS → `<api-url>/webhooks/auth/send-sms`, secret = `SEND_SMS_HOOK_SECRETS` (same value in Secret Manager for the API) | Our API sends the DLT SMS (T2.2). |
| Before User Created hook | Postgres → `public.hook_before_user_created` | Refuses non-Indian numbers before a user row exists (migration 0006). |
| Password Verification Attempt hook | Postgres → `public.hook_password_verification_attempt` | Rejects every password attempt and signs the user out; passwords can never become a second way in. Check plan availability for hosted projects. |
| JWT signing keys | Asymmetric (ES256), JWKS at `/auth/v1/.well-known/jwks.json` | The API verifies tokens with JWKS (`SUPABASE_JWKS_URL`) and requires `amr` to contain `otp`. |

**Never** run `supabase config push` from this repository: `config.toml` points hooks at
`host.docker.internal` and contains a placeholder Twilio provider for local use only.

Privacy note for the DPDP review (T0.10): Supabase Auth's own logs record the phone number
(`actor_username`) for each OTP request. Our API never logs it; the hosted Auth logs do.
