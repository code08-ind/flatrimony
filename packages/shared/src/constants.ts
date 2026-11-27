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
  /** profiles.college_name (docs/04 §6.2): student category only */
  collegeNameMaxChars: 120,
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
  /**
   * Anchors must be in Delhi NCR (FR-BIO-03): an approximate bounding box used only as a sanity
   * check. Initial value for the founder to confirm (official NCR, or a box around the six launch
   * cities); keep it aligned with the routing extent (T2.9).
   */
  ncrBounds: { minLat: 27.5, maxLat: 29.5, minLng: 76.0, maxLng: 78.5 },
  /** Technical caps (not product numbers): Postgres smallint, answers per request. */
  smallintMax: 32_767,
  scenarioAnswersPerRequest: 50,
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
  /** Commute zone previews while moving the map pin (each may call the routing service). */
  commutePreview: { limit: 30, windowMs: 60_000 },
  /** Place search keystrokes (each may be a paid Places request). */
  places: { limit: 60, windowMs: 60_000 },
  /** Starting DigiLocker verification (each start is a paid provider session). */
  verificationStart: { limit: 5, windowMs: 60 * 60_000 },
  /** Work/college email links a member may ask for (each sends an email; T3.3). */
  emailVerificationStart: { limit: 5, windowMs: 60 * 60_000 },
  /** Opening email links, per IP (each token is 32 random bytes: this only bounds the work). */
  emailVerificationConfirm: { limit: 30, windowMs: 60 * 60_000 },
  /** Creating listing drafts (an owner lists one room, rarely a few; T3.5). */
  listingCreate: { limit: 10, windowMs: 24 * 60 * 60_000 },
} as const;

/**
 * Links to one email address per day (T3.3): at most 3 from any one member, 10 from all members
 * together, so nobody's inbox gets flooded and one member cannot use up the owner's links.
 */
export const EMAIL_LINKS_PER_MEMBER_ADDRESS_PER_DAY = 3;
export const EMAIL_LINKS_PER_ADDRESS_PER_DAY = 10;
/** How long an email verification link works. */
export const EMAIL_LINK_TTL_MS = 24 * 60 * 60_000;

/** Stored idempotent responses expire after 24 hours (docs/05 §6.1). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60_000;

/** OTP request limits (docs/05 §6.3; FR-AUTH-02). Initial values; remote-configurable later. */
export const OTP_LIMITS = {
  perPhone: { max: 5, windowMs: 15 * 60_000 },
  perDevice: { max: 20, windowMs: 60 * 60_000 },
  perIp: { max: 50, windowMs: 60 * 60_000 },
} as const;
