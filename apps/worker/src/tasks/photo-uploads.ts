/**
 * Daily sweep of abandoned photo uploads (T2.10 launch gate; docs/05 §8.3, §8.6). An original (EXIF
 * and GPS included) lands at `<user id>/uploads/<uuid>` in `profile-photos`, or at
 * `<listing id>/uploads/<uuid>` in `listing-photos` (T3.6), through a 2-hour signed URL, and is
 * re-encoded and deleted when the app confirms it. If the app never confirms (closed, offline, the
 * listing deleted meanwhile), the API only cleans up on the next upload URL for that user or
 * listing; this task removes the rest. Deletes go through the Storage API so the file and its row
 * go together. (Walkthrough uploads live in R2, where a lifecycle rule removes them.)
 */
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { errorFields } from '../log.js';
import type { Task } from '../runner.js';

export const PHOTO_BUCKET = 'profile-photos';
export const LISTING_PHOTO_BUCKET = 'listing-photos';
/** Buckets whose `<uuid>/uploads/` originals are swept. */
export const SWEPT_BUCKETS = [PHOTO_BUCKET, LISTING_PHOTO_BUCKET] as const;
/** Supabase signed upload URLs last 2 hours: an older staged upload can never be confirmed. */
export const UPLOAD_TTL_MINUTES = 120;
/** Per run; anything left is taken the next day. */
export const SWEEP_LIMIT = 1_000;
const REMOVE_BATCH = 100;

export interface ObjectRemover {
  remove(bucket: string, keys: string[]): Promise<void>;
}

/** Staged uploads older than the signed-URL lifetime, oldest first. */
export async function staleUploads(
  db: Database,
  bucket: string = PHOTO_BUCKET,
  limit = SWEEP_LIMIT,
): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select name from storage.objects
     where bucket_id = ${bucket}
       and name ~ '^[0-9a-f-]{36}/uploads/[^/]+$'
       and created_at < now() - make_interval(mins => ${UPLOAD_TTL_MINUTES})
     order by created_at
     limit ${limit}`.execute(db);
  return rows.map((r) => r.name);
}

export function photoUploadSweep(storage: ObjectRemover): Task {
  return {
    name: 'photos.sweep-uploads',
    async run({ db, log, signal }) {
      let found = 0;
      let removed = 0;
      let batches = 0;
      let failedBatches = 0;
      for (const bucket of SWEPT_BUCKETS) {
        const keys = await staleUploads(db, bucket);
        found += keys.length;
        for (let i = 0; i < keys.length && !signal.aborted; i += REMOVE_BATCH) {
          const batch = keys.slice(i, i + REMOVE_BATCH);
          batches += 1;
          try {
            await storage.remove(bucket, batch);
            removed += batch.length;
          } catch (err) {
            // Keep going: the next batches may work; these keys are found again tomorrow.
            failedBatches += 1;
            log.warn('upload sweep batch failed', {
              bucket,
              size: batch.length,
              ...errorFields(err),
            });
          }
        }
      }
      if (failedBatches > 0)
        throw new Error(
          `${failedBatches} of ${batches} batches failed (removed ${removed} of ${found})`,
        );
      return { found, removed };
    },
  };
}
