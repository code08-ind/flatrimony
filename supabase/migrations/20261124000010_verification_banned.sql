-- 0010 — DigiLocker verification outcomes (T3.1; docs/05 §8.4).
--
-- docs/05 lists `banned` among the DigiLocker failure codes (the DigiLocker identity is on the
-- banned list, FR-AUTH-08), but 0005 did not allow it. The verification stays a plain "failed"
-- with that code; nothing about the ban itself is stored on the row.

alter table public.verifications
  drop constraint verifications_failure_code_values_chk,
  add constraint verifications_failure_code_values_chk check (
    failure_code in ('name_mismatch', 'underage', 'provider_error', 'user_cancelled', 'identity_in_use', 'banned'));
