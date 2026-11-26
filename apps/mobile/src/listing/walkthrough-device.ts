/**
 * The device side of a walkthrough upload (T3.7): the recorded file (its own length and SHA-256),
 * the PUT to the presigned R2 URL and the Play Integrity token. `submitWalkthrough` in
 * @flatrimony/client runs the sequence; this supplies the pieces.
 */
import * as AppIntegrity from '@expo/app-integrity';
import * as Crypto from 'expo-crypto';
import { File, UploadType } from 'expo-file-system';
import { mockIntegrityToken, type WalkthroughDeps, type WalkthroughTake } from '@flatrimony/client';
import { mp4Header } from '@flatrimony/shared';
import { api } from '../api';
import { config } from '../config';

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Hashes are worked out once per file (reading 25 MB twice is slow on a mid-range phone). */
const hashes = new Map<string, string>();

/**
 * The take as the API will judge it: the file's size and the length in its own MP4 header (the
 * recording clock starts before the camera does). Null when the file is missing or not an MP4.
 */
export async function readTake(uri: string, startedAt: number): Promise<WalkthroughTake | null> {
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const header = mp4Header(bytes);
    if (!header) return null;
    hashes.set(uri, hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)));
    return {
      uri,
      sizeBytes: bytes.byteLength,
      durationS: header.durationS,
      capturedAt: new Date(startedAt).toISOString(),
    };
  } catch {
    return null;
  }
}

let integrityReady: Promise<void> | null = null;
const prepare = () =>
  (integrityReady ??= AppIntegrity.prepareIntegrityTokenProviderAsync(
    config.playIntegrityCloudProject,
  ).catch((err: unknown) => {
    integrityReady = null; // try again next time
    throw err;
  }));

/**
 * A Play Integrity token bound to `requestHash` (the standard request; docs/05 §8.6). The token
 * provider can expire, so a failed request prepares it again once. Until the Play Console project
 * exists (docs/07 T3.6, Blocked) local and staging builds use the API's mock token; a production
 * build without it never offers the recorder (walkthroughUploadsAvailable).
 */
async function integrityToken(requestHash: string): Promise<string> {
  if (!config.playIntegrityCloudProject) {
    if (config.appEnv === 'production') throw new Error('play integrity is not configured');
    return mockIntegrityToken(requestHash);
  }
  await prepare();
  try {
    return await AppIntegrity.requestIntegrityCheckAsync(requestHash);
  } catch {
    integrityReady = null;
    await prepare();
    return AppIntegrity.requestIntegrityCheckAsync(requestHash);
  }
}

/** 25 MB on a slow 4G link takes a few minutes; past this the upload is given up and retried. */
const UPLOAD_TIMEOUT_MS = 6 * 60_000;

export const walkthroughDeps: WalkthroughDeps = {
  async post(path, body) {
    const res = await api(path, { method: 'POST', body, timeoutMs: 120_000 });
    return { status: res.status, body: res.body };
  },
  async put(uploadUrl, take, onProgress) {
    const task = new File(take.uri).createUploadTask(uploadUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      onProgress: ({ bytesSent, totalBytes }) =>
        onProgress?.(totalBytes > 0 ? bytesSent / totalBytes : 0),
      // The presigned URL signs exactly this type and length (docs/05 §8.6).
      headers: { 'content-type': 'video/mp4', 'content-length': String(take.sizeBytes) },
    });
    const timer = setTimeout(() => task.cancel(), UPLOAD_TIMEOUT_MS);
    try {
      const res = await task.uploadAsync();
      return { status: res.status };
    } finally {
      clearTimeout(timer);
    }
  },
  async fileSha256(take) {
    const known = hashes.get(take.uri);
    if (known) return known;
    const bytes = await new File(take.uri).arrayBuffer();
    return hex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
  },
  textSha256: (text) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text),
  integrityToken,
};

/** Removes a take that will not be used (retake, done, leaving the screen). */
export function discardTake(uri: string) {
  hashes.delete(uri);
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // The cache is cleared by the system anyway.
  }
}
