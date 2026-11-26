/**
 * The listing walkthrough video on the client (T3.7; FR-LST-05; docs/05 §8.6; docs/06 listing
 * stepper): the recording rules, the upload sequence and what each failure tells the user. Pure and
 * unit-tested; the Android recorder screen supplies the camera, the file, hashing, the Play
 * Integrity token and the network.
 */
import type { MessageKey } from '@flatrimony/i18n';
import {
  ListingMediaUploadUrlResponse,
  OwnerListing,
  VIDEO_MAX_BYTES,
  WALKTHROUGH,
  walkthroughRequestHashInput,
} from '@flatrimony/shared';

/**
 * The stop button works a second after the minimum: the clock starts before the camera does, so a
 * take stopped exactly at 30 s on the clock can be a little shorter in the file. The camera stops
 * itself at the maximum.
 */
export const STOP_AFTER_SECONDS = WALKTHROUGH.minSeconds + 1;
export const canStopRecording = (elapsedS: number) => elapsedS >= STOP_AFTER_SECONDS;

/** "0:45 / 1:30" style clock text for the recorder. */
export function recordingClock(elapsedS: number): string {
  const s = Math.max(0, Math.floor(elapsedS));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A recorded take is usable when its file is 30–90 s long, in whole seconds, as the API judges it
 * (the length comes from the MP4 itself, not the clock), and within the size limit.
 */
export const takeIsUsable = (take: Pick<WalkthroughTake, 'durationS' | 'sizeBytes'>) =>
  Math.round(take.durationS) >= WALKTHROUGH.minSeconds &&
  Math.round(take.durationS) <= WALKTHROUGH.maxSeconds &&
  take.sizeBytes > 0 &&
  take.sizeBytes <= VIDEO_MAX_BYTES;

/**
 * Whether this build can upload walkthroughs: it needs the Play Console project number for real
 * integrity tokens, except in local and staging builds, which send the API's mock tokens.
 */
export const walkthroughUploadsAvailable = (appEnv: string, playIntegrityCloudProject: string) =>
  playIntegrityCloudProject !== '' || appEnv !== 'production';

export interface WalkthroughTake {
  /** Local file of the recording. */
  uri: string;
  sizeBytes: number;
  /** The length of the file itself (its MP4 header), in seconds. */
  durationS: number;
  /** When recording started (ISO). */
  capturedAt: string;
}

/** What the screen supplies (real camera, file system and network on Android; fakes in tests). */
export interface WalkthroughDeps {
  post(path: string, body: unknown): Promise<{ status: number; body: unknown }>;
  /** PUTs the take's bytes to the presigned URL with the signed content type and length. */
  put(
    uploadUrl: string,
    take: WalkthroughTake,
    onProgress?: (fraction: number) => void,
  ): Promise<{ status: number }>;
  /** Lower-case hex SHA-256 of the take's file. */
  fileSha256(take: WalkthroughTake): Promise<string>;
  /** Lower-case hex SHA-256 of a text. */
  textSha256(text: string): Promise<string>;
  /** A Play Integrity token for this request hash (a mock in local/staging builds). */
  integrityToken(requestHash: string): Promise<string>;
}

export type WalkthroughResult =
  | { ok: true; listing: OwnerListing }
  | {
      ok: false;
      error: MessageKey;
      /**
       * retry: upload the same take again; record: the take cannot be used, record again;
       * stop: recording again on this phone will not help (the integrity check failed).
       */
      next: 'retry' | 'record' | 'stop';
    };

/**
 * Uploads a recorded take and confirms it: upload URL → PUT → hash the file → integrity token for
 * this upload → confirm. Any failure is mapped to a message and whether to retry or record again.
 */
export async function submitWalkthrough(
  listingId: string,
  take: WalkthroughTake,
  deps: WalkthroughDeps,
  { onProgress }: { onProgress?: (fraction: number) => void } = {},
): Promise<WalkthroughResult> {
  if (take.sizeBytes > VIDEO_MAX_BYTES)
    return { ok: false, error: 'listing.video.errors.tooLarge', next: 'record' };
  try {
    const url = await deps.post(`/listings/${listingId}/media/upload-url`, {
      kind: 'walkthrough_video',
      contentType: 'video/mp4',
      sizeBytes: take.sizeBytes,
    });
    if (url.status !== 200) return failure(url.status, url.body);
    const { uploadUrl, storageKey } = ListingMediaUploadUrlResponse.parse(url.body);

    const put = await deps.put(uploadUrl, take, onProgress);
    if (put.status < 200 || put.status >= 300)
      return { ok: false, error: 'listing.video.errors.upload', next: 'retry' };

    const sha256 = await deps.fileSha256(take);
    const requestHash = await deps.textSha256(walkthroughRequestHashInput(storageKey, sha256));
    let integrityToken: string;
    try {
      integrityToken = await deps.integrityToken(requestHash);
    } catch {
      // Google Play's check could not run (offline, Play services busy): the take is fine.
      return { ok: false, error: 'listing.video.errors.unavailable', next: 'retry' };
    }

    const confirm = await deps.post(`/listings/${listingId}/media`, {
      kind: 'walkthrough_video',
      storageKey,
      sha256,
      // The file's own length; the API checks it against the file again.
      durationS: Math.round(take.durationS),
      capturedAt: take.capturedAt,
      recordedInApp: true,
      integrityToken,
    });
    if (confirm.status !== 201) return failure(confirm.status, confirm.body);
    return { ok: true, listing: OwnerListing.parse(confirm.body) };
  } catch {
    return { ok: false, error: 'listing.video.errors.network', next: 'retry' };
  }
}

/** The message for a refused request (docs/05 §13 codes; §8.6 video_invalid reasons). */
export function failure(status: number, body: unknown): Extract<WalkthroughResult, { ok: false }> {
  const problem = (body ?? {}) as { code?: string; errors?: { code?: string }[] };
  const reason = problem.errors?.[0]?.code;
  if (problem.code === 'listing.video_invalid') {
    if (reason === 'old') return { ok: false, error: 'listing.video.errors.old', next: 'record' };
    if (reason === 'duration')
      return { ok: false, error: 'listing.video.errors.duration', next: 'record' };
    if (reason === 'too_large')
      return { ok: false, error: 'listing.video.errors.tooLarge', next: 'record' };
    if (reason === 'hash_mismatch')
      return { ok: false, error: 'listing.video.errors.upload', next: 'retry' };
    return { ok: false, error: 'listing.video.errors.invalid', next: 'record' };
  }
  if (problem.code === 'integrity.failed')
    return { ok: false, error: 'listing.video.errors.integrity', next: 'stop' };
  if (problem.code === 'validation.failed')
    return { ok: false, error: 'listing.video.errors.invalid', next: 'record' };
  // Recording again will not help: the listing is gone, or cannot be changed now.
  if (status === 404) return { ok: false, error: 'listing.video.errors.notFound', next: 'stop' };
  if (status === 409) return { ok: false, error: 'listing.video.errors.notEditable', next: 'stop' };
  if (status === 429) return { ok: false, error: 'listing.video.errors.tooMany', next: 'retry' };
  if (status === 503)
    return { ok: false, error: 'listing.video.errors.unavailable', next: 'retry' };
  return { ok: false, error: 'listing.video.errors.generic', next: 'retry' };
}

/**
 * A token the API's mock verifier accepts (local and staging only; production refuses the mock and
 * the app asks Google instead, once the Play Console project exists: docs/07 T3.6).
 */
export function mockIntegrityToken(requestHash: string, nowMs: number = Date.now()): string {
  const json = JSON.stringify({
    verdict: 'meets_device_integrity',
    requestHash,
    issuedAt: Math.floor(nowMs / 1000),
  });
  const base64 = btoa(json); // ASCII only: a hex hash, a verdict and a number
  return `mock.${base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
