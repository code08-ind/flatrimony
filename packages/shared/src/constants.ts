/**
 * Product limits stated in docs/02 (PRD) and docs/05 (API). Values the founder may tune at
 * runtime (like limits, conversation caps) live in ref.app_config, not here.
 */
export const LIMITS = {
  /** FR-BIO-01 */
  profilePhotos: { min: 1, max: 6 },
  bioMaxChars: 300,
  /** profiles.display_name (docs/04 §6.2) */
  displayNameMaxChars: 40,
  /** preferences (docs/04 §6.2): rent share per person per month */
  budgetInr: { min: 1000, max: 200_000 },
  leaseMonths: { min: 1, max: 36, default: 11 },
  /** anchors.label (docs/04 §6.2) */
  anchorLabelMaxChars: 80,
  /** profiles.languages: ISO 639-1 codes */
  languagesMax: 10,
  /** FR-BIO-02 */
  preferredAreasMax: 3,
  /** FR-BIO-03 */
  commuteMinutes: { min: 15, max: 90, default: 45 },
  /** profile.underage (docs/05 §13) */
  minAge: 18,
  /** FR-LST-05 */
  listingPhotos: { min: 3, max: 12 },
  walkthroughSeconds: { min: 30, max: 90 },
  /** NFR-PERF-07 */
  walkthroughMaxBytes: 25 * 1024 * 1024,
  /** FR-CHAT-02 */
  messageMaxChars: 2000,
  /** FR-PASS-03 */
  referenceMaxChars: 500,
  /** FR-SAFE-01 */
  trustedContactsMax: 3,
  /** FR-SAFE-02 */
  safetySessionMaxHours: 3,
  /** FR-DISC-02, FR-DISC-09 */
  moveInWindowDays: 30,
  passCooldownDays: 30,
  /** docs/05 §5 */
  page: { defaultLimit: 20, maxLimit: 50, messagesMaxLimit: 100 },
} as const;

/** The only emergency number the product shows (founder rule; FR-SAFE-03). */
export const EMERGENCY_NUMBER = '112' as const;

/** Endpoints that require an Idempotency-Key header (docs/05 §6.1). */
export const IDEMPOTENT_ENDPOINTS = [
  'POST /v1/swipes',
  'POST /v1/matches/{id}/messages',
  'POST /v1/matches/{id}/decision',
  'POST /v1/payments/orders',
  'POST /v1/safety/sos',
  'POST /v1/reports',
] as const;

/** Required client headers (docs/05 §1). */
export const HEADERS = {
  platform: 'x-app-platform',
  appVersion: 'x-app-version',
  requestId: 'x-request-id',
  idempotencyKey: 'idempotency-key',
  idempotentReplayed: 'idempotent-replayed',
} as const;

/**
 * Initial rate limits (docs/05 §6.3). They become remote-configurable later (FR-ADM-07).
 * `windowMs` is a fixed window.
 */
export const RATE_LIMITS = {
  globalPerIp: { limit: 300, windowMs: 60_000 },
  perUser: { limit: 120, windowMs: 60_000 },
  swipes: { limit: 60, windowMs: 60_000 },
  messages: { limit: 30, windowMs: 60_000 },
  reports: { limit: 10, windowMs: 24 * 60 * 60_000 },
  uploadUrls: { limit: 30, windowMs: 60 * 60_000 },
} as const;

/** Stored idempotent responses expire after 24 hours (docs/05 §6.1). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;
