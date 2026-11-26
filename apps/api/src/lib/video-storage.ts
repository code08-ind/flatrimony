/**
 * Walkthrough video storage (FR-LST-05; docs/03 §4 ADR-0010): Cloudflare R2 through its S3 API,
 * signed with SigV4 (aws4fetch). Locally the same calls go to Supabase Storage's S3 endpoint and its
 * `r2-walkthroughs` bucket. The app PUTs the file to a presigned URL under `uploads/` (an R2
 * lifecycle rule on that prefix removes anything never confirmed); confirming copies it to
 * `<listing_id>/<uuid>.mp4` and deletes the upload. Clients never hold storage credentials.
 */
import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

/** Presigned upload URLs live 10 minutes (docs/03 §3.3). */
export const VIDEO_UPLOAD_TTL_SECONDS = 10 * 60;
/** Presigned view URLs: 1 hour, as photos. */
export const VIDEO_URL_TTL_SECONDS = 60 * 60;

export class VideoStorageUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoStorageUnavailable';
  }
}

/** The object is larger than the caller allows (it was not read to the end). */
export class VideoTooLarge extends Error {
  constructor() {
    super('video too large');
    this.name = 'VideoTooLarge';
  }
}

export interface VideoStorage {
  readonly bucket: string;
  /** A URL the app PUTs exactly `sizeBytes` of `video/mp4` to (both are signed). */
  createUploadUrl(key: string, sizeBytes: number): Promise<string>;
  /** The object's size, or null when it does not exist. */
  size(key: string): Promise<number | null>;
  /**
   * The object's bytes (null when it does not exist), read as a stream that stops with
   * VideoTooLarge past `maxBytes`: a large object is never held in memory.
   */
  download(key: string, maxBytes: number): Promise<Buffer | null>;
  /** Keys under a prefix (at most 1000; enough for one listing's uploads). */
  list(prefix: string): Promise<string[]>;
  copy(from: string, to: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  signedUrls(keys: string[]): Promise<Map<string, string>>;
}

export interface S3Settings {
  /** e.g. https://<account>.r2.cloudflarestorage.com, or the local Supabase S3 URL. */
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Keys are `uploads/<uuid>/<uuid>.mp4` or `<uuid>/<uuid>.mp4`: nothing to escape but the slashes. */
const objectPath = (key: string) => key.split('/').map(encodeURIComponent).join('/');

export function s3VideoStorage(settings: S3Settings): VideoStorage {
  const aws = new AwsClient({
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
    service: 's3',
    region: settings.region,
  });
  const base = `${settings.endpoint.replace(/\/$/, '')}/${settings.bucket}`;
  const url = (key: string) => `${base}/${objectPath(key)}`;

  async function call(input: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await aws.fetch(input, init);
    } catch (err) {
      throw new VideoStorageUnavailable(`video storage unreachable: ${(err as Error).name}`);
    }
    if (res.status >= 500) throw new VideoStorageUnavailable(`video storage ${res.status}`);
    return res;
  }

  async function presign(key: string, method: 'GET' | 'PUT', ttl: number, headers = {}) {
    const u = new URL(url(key));
    u.searchParams.set('X-Amz-Expires', String(ttl));
    const signed = await aws.sign(u.toString(), {
      method,
      headers,
      aws: { signQuery: true, allHeaders: true },
    });
    return signed.url;
  }

  return {
    bucket: settings.bucket,
    createUploadUrl(key, sizeBytes) {
      return presign(key, 'PUT', VIDEO_UPLOAD_TTL_SECONDS, {
        'content-type': 'video/mp4',
        'content-length': String(sizeBytes),
      });
    },
    async size(key) {
      const res = await call(url(key), { method: 'HEAD' });
      if (res.status === 404) return null;
      if (!res.ok) throw new VideoStorageUnavailable(`video storage HEAD ${res.status}`);
      const size = Number(res.headers.get('content-length') ?? NaN);
      if (!Number.isSafeInteger(size) || size < 0)
        throw new VideoStorageUnavailable('video storage gave no size');
      return size;
    },
    async download(key, maxBytes) {
      const res = await call(url(key));
      if (res.status === 404) return null;
      if (!res.ok || !res.body)
        throw new VideoStorageUnavailable(`video storage GET ${res.status}`);
      const chunks: Buffer[] = [];
      let total = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new VideoTooLarge();
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    },
    async list(prefix) {
      const u = new URL(base);
      u.searchParams.set('list-type', '2');
      u.searchParams.set('prefix', prefix);
      const res = await call(u.toString());
      if (!res.ok) throw new VideoStorageUnavailable(`video storage LIST ${res.status}`);
      const xml = await res.text();
      // <Key> values are XML-escaped object keys; ours contain only [0-9a-z/.-].
      return [...xml.matchAll(/<Key>([^<]+)<[/]Key>/g)].map((m) => m[1]!);
    },
    async copy(from, to) {
      const res = await call(url(to), {
        method: 'PUT',
        headers: { 'x-amz-copy-source': `/${settings.bucket}/${objectPath(from)}` },
      });
      // S3 can answer 200 with an error document for a failed copy.
      const text = await res.text();
      if (!res.ok || text.includes('<Error>'))
        throw new VideoStorageUnavailable(`video storage copy ${res.status}`);
    },
    async remove(keys) {
      for (const key of keys) {
        const res = await call(url(key), { method: 'DELETE' });
        if (!res.ok && res.status !== 404)
          throw new VideoStorageUnavailable(`video storage DELETE ${res.status}`);
      }
    },
    async signedUrls(keys) {
      const out = new Map<string, string>();
      for (const key of keys) out.set(key, await presign(key, 'GET', VIDEO_URL_TTL_SECONDS));
      return out;
    },
  };
}

/** For tests: objects in memory; "uploading" is putting bytes into `objects`. */
export function memoryVideoStorage(
  baseUrl = 'https://video.test',
): VideoStorage & { objects: Map<string, Buffer> } {
  const objects = new Map<string, Buffer>();
  return {
    bucket: 'r2-walkthroughs',
    objects,
    async createUploadUrl(key, sizeBytes) {
      return `${baseUrl}/upload/${encodeURIComponent(key)}?size=${sizeBytes}`;
    },
    async size(key) {
      return objects.get(key)?.length ?? null;
    },
    async download(key, maxBytes) {
      const data = objects.get(key);
      if (data && data.length > maxBytes) throw new VideoTooLarge();
      return data ?? null;
    },
    async list(prefix) {
      return [...objects.keys()].filter((k) => k.startsWith(prefix));
    },
    async copy(from, to) {
      const data = objects.get(from);
      if (!data) throw new VideoStorageUnavailable('missing');
      objects.set(to, data);
    },
    async remove(keys) {
      for (const k of keys) objects.delete(k);
    },
    async signedUrls(keys) {
      return new Map(keys.map((k) => [k, `${baseUrl}/view/${encodeURIComponent(k)}`]));
    },
  };
}

export const sha256 = (data: Buffer) => createHash('sha256').update(data).digest();

/** Seconds from 1904-01-01 (the MP4 epoch) to 1970-01-01. */
const MP4_EPOCH_OFFSET_S = 2_082_844_800;

/** The duration of an MP4 in seconds, or null (see mp4Header). */
export function mp4DurationSeconds(file: Buffer): number | null {
  return mp4Header(file)?.durationS ?? null;
}

/**
 * The movie header of an MP4 (`moov/mvhd`): its duration in seconds and its creation time (ms since
 * 1970, or null when the recorder left it 0), or null when the file is not an MP4 we can read (no
 * `ftyp` first, no movie header). Reads box headers only; nothing is decoded.
 */
export function mp4Header(file: Buffer): { durationS: number; createdAt: number | null } | null {
  if (file.length < 12 || file.toString('latin1', 4, 8) !== 'ftyp') return null;
  const boxes = function* (start: number, end: number) {
    let at = start;
    while (at + 8 <= end) {
      let size = file.readUInt32BE(at);
      const type = file.toString('latin1', at + 4, at + 8);
      let header = 8;
      if (size === 1) {
        if (at + 16 > end) return;
        const big = file.readBigUInt64BE(at + 8);
        if (big > BigInt(end - at)) return;
        size = Number(big);
        header = 16;
      } else if (size === 0) size = end - at;
      if (size < header || at + size > end) return;
      yield { type, body: at + header, end: at + size };
      at += size;
    }
  };
  for (const top of boxes(0, file.length)) {
    if (top.type !== 'moov') continue;
    for (const box of boxes(top.body, top.end)) {
      if (box.type !== 'mvhd') continue;
      const version = file[box.body];
      let created: number, timescale: number, duration: number;
      if (version === 0 && box.body + 20 <= box.end) {
        created = file.readUInt32BE(box.body + 4);
        timescale = file.readUInt32BE(box.body + 12);
        duration = file.readUInt32BE(box.body + 16);
      } else if (version === 1 && box.body + 32 <= box.end) {
        created = Number(file.readBigUInt64BE(box.body + 4));
        timescale = file.readUInt32BE(box.body + 20);
        duration = Number(file.readBigUInt64BE(box.body + 24));
      } else return null;
      if (timescale === 0) return null;
      return {
        durationS: duration / timescale,
        createdAt: created > 0 ? (created - MP4_EPOCH_OFFSET_S) * 1000 : null,
      };
    }
  }
  return null;
}
