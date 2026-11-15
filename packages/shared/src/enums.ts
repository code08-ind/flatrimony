/**
 * Enum values, exactly as in Postgres (docs/04 §5, supabase/migrations/*_enums.sql).
 * A contract test parses the migration and fails if the two drift.
 * Clients must ignore unknown values they receive (docs/05 §11).
 */
import { z } from 'zod';

export const ENUMS = {
  user_intent: ['have_room', 'need_room', 'pair_up'],
  user_category: ['professional', 'student', 'women_only', 'relocating'],
  verified_gender: ['female', 'male', 'transgender'],
  gender_preference: ['female_only', 'male_only', 'any'],
  travel_mode: ['car', 'two_wheeler', 'metro_transit', 'walk'],
  anchor_kind: ['office', 'college'],
  cleaning_level: ['daily', 'few_times_week', 'weekly', 'rarely'],
  smoking_habit: ['no', 'outside_only', 'yes'],
  pet_attitude: ['have', 'love', 'ok', 'no'],
  food_habit: ['veg', 'eggetarian', 'non_veg', 'vegan'],
  frequency_level: ['never', 'rarely', 'sometimes', 'often'],
  work_mode: ['office', 'hybrid', 'wfh', 'night_shift', 'student'],
  importance_level: ['dealbreaker', 'matters', 'dont_care'],
  lifestyle_attribute: [
    'bedtime',
    'wake_time',
    'cleaning',
    'smoking',
    'pets',
    'food',
    'cooks_at_home',
    'drinking',
    'guests',
    'parties',
    'work_mode',
  ],
  verification_type: ['digilocker', 'selfie', 'work_email', 'college_email', 'listing_proof'],
  verification_status: ['pending', 'verified', 'failed', 'expired'],
  listing_status: ['draft', 'pending_review', 'active', 'paused', 'expired', 'removed'],
  room_type: ['private', 'shared'],
  furnishing_level: ['unfurnished', 'semi_furnished', 'furnished'],
  food_rule: ['any', 'veg_only', 'eggetarian_ok'],
  guests_rule: ['allowed', 'day_only', 'not_allowed'],
  media_kind: ['photo', 'walkthrough_video'],
  moderation_status: ['pending', 'approved', 'rejected'],
  swipe_action: ['like', 'pass', 'super_like'],
  match_status: ['matched', 'chatting', 'met', 'moving_in', 'closed'],
  match_close_reason: [
    'unmatched',
    'not_interested',
    'blocked',
    'reported',
    'expired',
    'account_deleted',
  ],
  message_kind: ['text', 'image', 'system', 'meetup', 'contact_share'],
  meetup_status: ['proposed', 'accepted', 'declined', 'cancelled', 'completed'],
  safety_session_type: ['visit', 'sos'],
  stay_status: ['pending_confirmation', 'active', 'ended'],
  confirmation_verdict: ['confirmed', 'disputed'],
  replacement_status: ['open', 'filled', 'cancelled'],
  approval_verdict: ['approved', 'rejected'],
  chore_recurrence: ['daily', 'weekly', 'monthly'],
  bill_share_status: ['pending', 'settled'],
  report_target: ['user', 'listing', 'message', 'reference'],
  report_reason: [
    'fake_profile',
    'broker',
    'scam_payment',
    'harassment',
    'threat_safety',
    'sexual_content',
    'discrimination',
    'spam',
    'other',
  ],
  report_status: ['open', 'in_review', 'actioned', 'dismissed'],
  mod_action: ['none', 'warn', 'remove_content', 'suspend', 'ban', 'restore'],
  product_code: ['move_pass_30d', 'listing_boost_7d'],
  purchase_status: ['created', 'paid', 'failed', 'refunded'],
  platform: ['android', 'ios', 'web'],
  app_locale: ['en', 'hi'],
  consent_purpose: [
    'terms',
    'privacy',
    'identity_verification',
    'location_safety',
    'marketing',
    'analytics',
  ],
  data_request_type: ['export', 'delete'],
  data_request_status: ['requested', 'processing', 'completed', 'failed'],
} as const;

export type EnumName = keyof typeof ENUMS;

export const Intent = z.enum(ENUMS.user_intent);
export const Category = z.enum(ENUMS.user_category);
export const VerifiedGender = z.enum(ENUMS.verified_gender);
export const GenderPreference = z.enum(ENUMS.gender_preference);
export const TravelMode = z.enum(ENUMS.travel_mode);
export const AnchorKind = z.enum(ENUMS.anchor_kind);
export const CleaningLevel = z.enum(ENUMS.cleaning_level);
export const SmokingHabit = z.enum(ENUMS.smoking_habit);
export const PetAttitude = z.enum(ENUMS.pet_attitude);
export const FoodHabit = z.enum(ENUMS.food_habit);
export const FrequencyLevel = z.enum(ENUMS.frequency_level);
export const WorkMode = z.enum(ENUMS.work_mode);
export const Importance = z.enum(ENUMS.importance_level);
export const LifestyleAttribute = z.enum(ENUMS.lifestyle_attribute);
export const VerificationType = z.enum(ENUMS.verification_type);
export const VerificationStatus = z.enum(ENUMS.verification_status);
export const ListingStatus = z.enum(ENUMS.listing_status);
export const RoomType = z.enum(ENUMS.room_type);
export const Furnishing = z.enum(ENUMS.furnishing_level);
export const FoodRule = z.enum(ENUMS.food_rule);
export const GuestsRule = z.enum(ENUMS.guests_rule);
export const MediaKind = z.enum(ENUMS.media_kind);
export const ModerationStatus = z.enum(ENUMS.moderation_status);
export const SwipeAction = z.enum(ENUMS.swipe_action);
export const MatchStatus = z.enum(ENUMS.match_status);
export const MessageKind = z.enum(ENUMS.message_kind);
export const MeetupStatus = z.enum(ENUMS.meetup_status);
export const ReportTarget = z.enum(ENUMS.report_target);
export const ReportReason = z.enum(ENUMS.report_reason);
export const ProductCode = z.enum(ENUMS.product_code);
export const Platform = z.enum(ENUMS.platform);
export const AppLocale = z.enum(ENUMS.app_locale);
export const ConsentPurpose = z.enum(ENUMS.consent_purpose);

export type Intent = z.infer<typeof Intent>;
export type Category = z.infer<typeof Category>;
export type VerifiedGender = z.infer<typeof VerifiedGender>;
export type GenderPreference = z.infer<typeof GenderPreference>;
export type TravelMode = z.infer<typeof TravelMode>;
export type Importance = z.infer<typeof Importance>;
export type LifestyleAttribute = z.infer<typeof LifestyleAttribute>;
export type MatchStatus = z.infer<typeof MatchStatus>;
export type Platform = z.infer<typeof Platform>;
export type AppLocale = z.infer<typeof AppLocale>;
