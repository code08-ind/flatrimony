/**
 * Daily sweep of abandoned photo uploads (T2.10 launch gate; docs/05 §8.3). An upload lands at
 * `<user id>/uploads/<uuid>` in the private `profile-photos` bucket through a 2-hour signed URL and
 * is moved into place when the app confirms it. If the app never confirms (closed, offline, user
 * gone), the API only cleans up when that user asks for another upload URL; this task removes the
 * rest. Deletes go through the Storage API so the file and its row go together.
 */
import { sql } from 'kysely';
import type { Database } from '../db.js';
import { errorFields } from '../log.js';
import type { Task } from '../runner.js';

export const PHOTO_BUCKET = 'profile-photos';
/** Supabase signed upload URLs last 2 hours: an older staged upload can never be confirmed. */
export const UPLOAD_TTL_MINUTES = 120;
/** Per run; anything left is taken the next day. */
export const SWEEP_LIMIT = 1_000;
const REMOVE_BATCH = 100;

export interface ObjectRemover {
  remove(bucket: string, keys: string[]): Promise<void>;
}

/** Staged uploads older than the signed-URL lifetime, oldest first. */
export async function staleUploads(db: Database, limit = SWEEP_LIMIT): Promise<string[]> {
  const { rows } = await sql<{ name: string }>`
    select name from storage.objects
     where bucket_id = ${PHOTO_BUCKET}
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
      const keys = await staleUploads(db);
      let removed = 0;
      let failedBatches = 0;
      for (let i = 0; i < keys.length && !signal.aborted; i += REMOVE_BATCH) {
        const batch = keys.slice(i, i + REMOVE_BATCH);
        try {
          await storage.remove(PHOTO_BUCKET, batch);
          removed += batch.length;
        } catch (err) {
          // Keep going: the next batches may work; these keys are found again tomorrow.
          failedBatches += 1;
          log.warn('upload sweep batch failed', { size: batch.length, ...errorFields(err) });
        }
      }
      if (failedBatches > 0)
        throw new Error(
          `${failedBatches} of ${Math.ceil(keys.length / REMOVE_BATCH)} batches failed (removed ${removed} of ${keys.length})`,
        );
      return { found: keys.length, removed };
    },
  };
}
