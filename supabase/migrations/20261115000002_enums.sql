-- 0002 — Enums (docs/04-database-design.md §5).
-- Mirrored in packages/shared/src/enums.ts; a contract test keeps both in sync.
-- Changing an enum: `alter type ... add value` in its own migration. Never remove values.

create type public.user_intent        as enum ('have_room', 'need_room', 'pair_up');
create type public.user_category      as enum ('professional', 'student', 'women_only', 'relocating');
create type public.verified_gender    as enum ('female', 'male', 'transgender');
create type public.gender_preference  as enum ('female_only', 'male_only', 'any');
create type public.travel_mode        as enum ('car', 'two_wheeler', 'metro_transit', 'walk');
create type public.anchor_kind        as enum ('office', 'college');
create type public.cleaning_level     as enum ('daily', 'few_times_week', 'weekly', 'rarely');
create type public.smoking_habit      as enum ('no', 'outside_only', 'yes');
create type public.pet_attitude       as enum ('have', 'love', 'ok', 'no');
create type public.food_habit         as enum ('veg', 'eggetarian', 'non_veg', 'vegan');
create type public.frequency_level    as enum ('never', 'rarely', 'sometimes', 'often');
create type public.work_mode          as enum ('office', 'hybrid', 'wfh', 'night_shift', 'student');
create type public.importance_level   as enum ('dealbreaker', 'matters', 'dont_care');
create type public.lifestyle_attribute as enum (
  'bedtime', 'wake_time', 'cleaning', 'smoking', 'pets', 'food',
  'cooks_at_home', 'drinking', 'guests', 'parties', 'work_mode'
);
create type public.verification_type   as enum ('digilocker', 'selfie', 'work_email', 'college_email', 'listing_proof');
create type public.verification_status as enum ('pending', 'verified', 'failed', 'expired');
create type public.listing_status      as enum ('draft', 'pending_review', 'active', 'paused', 'expired', 'removed');
create type public.room_type           as enum ('private', 'shared');
create type public.furnishing_level    as enum ('unfurnished', 'semi_furnished', 'furnished');
create type public.food_rule           as enum ('any', 'veg_only', 'eggetarian_ok');
create type public.guests_rule         as enum ('allowed', 'day_only', 'not_allowed');
create type public.media_kind          as enum ('photo', 'walkthrough_video');
create type public.moderation_status   as enum ('pending', 'approved', 'rejected');
create type public.swipe_action        as enum ('like', 'pass', 'super_like');
create type public.match_status        as enum ('matched', 'chatting', 'met', 'moving_in', 'closed');
create type public.match_close_reason  as enum ('unmatched', 'not_interested', 'blocked', 'reported', 'expired', 'account_deleted');
create type public.message_kind        as enum ('text', 'image', 'system', 'meetup', 'contact_share');
create type public.meetup_status       as enum ('proposed', 'accepted', 'declined', 'cancelled', 'completed');
create type public.safety_session_type as enum ('visit', 'sos');
create type public.stay_status         as enum ('pending_confirmation', 'active', 'ended');
create type public.confirmation_verdict as enum ('confirmed', 'disputed');
create type public.replacement_status  as enum ('open', 'filled', 'cancelled');
create type public.approval_verdict    as enum ('approved', 'rejected');
create type public.chore_recurrence    as enum ('daily', 'weekly', 'monthly');
create type public.bill_share_status   as enum ('pending', 'settled');
create type public.report_target       as enum ('user', 'listing', 'message', 'reference');
create type public.report_reason       as enum ('fake_profile', 'broker', 'scam_payment', 'harassment', 'threat_safety', 'sexual_content', 'discrimination', 'spam', 'other');
create type public.report_status       as enum ('open', 'in_review', 'actioned', 'dismissed');
create type public.mod_action          as enum ('none', 'warn', 'remove_content', 'suspend', 'ban', 'restore');
create type public.product_code        as enum ('move_pass_30d', 'listing_boost_7d');
create type public.purchase_status     as enum ('created', 'paid', 'failed', 'refunded');
create type public.platform            as enum ('android', 'ios', 'web');
create type public.app_locale          as enum ('en', 'hi');
create type public.consent_purpose     as enum ('terms', 'privacy', 'identity_verification', 'location_safety', 'marketing', 'analytics');
create type public.data_request_type   as enum ('export', 'delete');
create type public.data_request_status as enum ('requested', 'processing', 'completed', 'failed');
