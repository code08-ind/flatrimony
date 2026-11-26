/**
 * Object storage for profile photos (docs/04 §7.1): the private bucket `profile-photos`, reached
 * only by the API with the service-role key. Clients upload with a signed upload URL and see photos
 * through short-lived signed URLs; they never get storage credentials.
 */
import { StorageClient } from '@supabase/storage-js';

export const PHOTO_BUCKET = 'profile-photos';
/** Signed view URLs (docs/04 §7.1: 1 hour). */
export const PHOTO_URL_TTL_SECONDS = 60 * 60;
/** Supabase signed upload URLs are valid for 2 hours (not configurable); see docs/05 §8.3. */
export const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

export interface PhotoStorage {
  createUploadUrl(key: string): Promise<string>;
  /** The object's bytes, or null when it does not exist. */
  download(key: string): Promise<Buffer | null>;
  upload(key: string, data: Buffer, contentType: string): Promise<void>;
  remove(keys: string[]): Promise<void>;
  signedUrls(keys: string[]): Promise<Map<string, string>>;
  /** Objects directly under `prefix` (a folder), with their creation time in ms. */
  list(prefix: string): Promise<{ key: string; createdAt: number }[]>;
}

export function supabasePhotoStorage(
  supabaseUrl: string,
  serviceRoleKey: string,
  /** Profile photos by default; listing photos use 'listing-photos' (docs/04 §8.4). */
  bucketName: string = PHOTO_BUCKET,
): PhotoStorage {
  const client = new StorageClient(`${supabaseUrl.replace(/\/$/, '')}/storage/v1`, {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
  });
  const bucket = () => client.from(bucketName);
  return {
    async createUploadUrl(key) {
      const { data, error } = await bucket().createSignedUploadUrl(key);
      if (error) throw error;
      return data.signedUrl;
    },
    async download(key) {
      const { data, error } = await bucket().download(key);
      if (error) {
        const status = (error as { statusCode?: string; status?: number }).statusCode;
        if (status === '404' || /not found/i.test(error.message)) return null;
        throw error;
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async upload(key, data, contentType) {
      const { error } = await bucket().upload(key, data, { contentType, upsert: false });
      if (error) throw error;
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const { error } = await bucket().remove(keys);
      if (error) throw error;
    },
    async signedUrls(keys) {
      const out = new Map<string, string>();
      if (keys.length === 0) return out;
      const { data, error } = await bucket().createSignedUrls(keys, PHOTO_URL_TTL_SECONDS);
      if (error) throw error;
      for (const item of data) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
      return out;
    },
    async list(prefix) {
      const { data, error } = await bucket().list(prefix, { limit: 100 });
      if (error) throw error;
      return data
        .filter((o) => o.id) // folders have no id
        .map((o) => ({
          key: `${prefix}/${o.name}`,
          createdAt: o.created_at ? Date.parse(o.created_at) : Date.now(),
        }));
    },
  };
}

/** For tests and local runs without Supabase Storage. */
export function memoryPhotoStorage(
  baseUrl = 'https://storage.test',
  now: () => number = Date.now,
): PhotoStorage & { objects: Map<string, Buffer>; created: Map<string, number> } {
  const objects = new Map<string, Buffer>();
  const created = new Map<string, number>();
  return {
    objects,
    created,
    async list(prefix) {
      return [...objects.keys()]
        .filter((k) => k.startsWith(`${prefix}/`) && !k.slice(prefix.length + 1).includes('/'))
        .map((key) => ({ key, createdAt: created.get(key) ?? now() }));
    },
    async createUploadUrl(key) {
      return `${baseUrl}/upload/${encodeURIComponent(key)}?token=t`;
    },
    async download(key) {
      return objects.get(key) ?? null;
    },
    async upload(key, data) {
      if (objects.has(key)) throw new Error('exists');
      objects.set(key, data);
      created.set(key, now());
    },
    async remove(keys) {
      for (const k of keys) {
        objects.delete(k);
        created.delete(k);
      }
    },
    async signedUrls(keys) {
      return new Map(keys.map((k) => [k, `${baseUrl}/sign/${encodeURIComponent(k)}?token=t`]));
    },
  };
}
