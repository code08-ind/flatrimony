/**
 * The photo upload sweep's query on `storage.objects` (T1.14 / T2.10 launch gate). Needs DATABASE_URL
 * and the Storage schema (present with `supabase start`); skipped without them. Rows are inserted
 * directly, so no files are involved: this checks which objects are chosen, not the Storage API.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db.js';
import { createLogger } from '../../src/log.js';
import { PHOTO_BUCKET, photoUploadSweep, staleUploads } from '../../src/tasks/photo-uploads.js';

const URL = process.env.DATABASE_URL;

describe.skipIf(!URL)('photo upload sweep (Postgres)', () => {
  let db: Database;
  let hasStorage = false;
  const user = randomUUID();
  const other = `e2e-sweep-${randomUUID()}`;
  const names: string[] = [];

  beforeAll(async () => {
    db = createDatabase(URL!, { max: 2 });
    const { rows } = await sql<{
      t: string | null;
    }>`select to_regclass('storage.objects')::text as t`.execute(db);
    hasStorage = rows[0]?.t != null;
    if (!hasStorage) return;
    await sql`insert into storage.buckets (id, name) values (${PHOTO_BUCKET}, ${PHOTO_BUCKET}) on conflict do nothing`.execute(
      db,
    );
    await sql`insert into storage.buckets (id, name) values (${other}, ${other}) on conflict do nothing`.execute(
      db,
    );
    const add = async (bucket: string, name: string, ageMinutes: number) => {
      names.push(name);
      await sql`insert into storage.objects (bucket_id, name, created_at)
                values (${bucket}, ${name}, now() - make_interval(mins => ${ageMinutes}))`.execute(
        db,
      );
    };
    await add(PHOTO_BUCKET, `${user}/uploads/old-1`, 180); // abandoned
    await add(PHOTO_BUCKET, `${user}/uploads/old-2`, 24 * 60); // abandoned
    await add(PHOTO_BUCKET, `${user}/uploads/fresh`, 30); // its upload URL is still valid
    await add(PHOTO_BUCKET, `${user}/old-final.webp`, 24 * 60); // a confirmed photo: never swept
    await add(other, `${user}/uploads/elsewhere`, 24 * 60); // another bucket
  });

  afterAll(async () => {
    if (hasStorage)
      // Test rows only (no files): Supabase blocks direct deletes unless this is set.
      await db.transaction().execute(async (tx) => {
        await sql`select set_config('storage.allow_delete_query', 'true', true)`.execute(tx);
        await sql`delete from storage.objects where name = any(${names})`.execute(tx);
        await sql`delete from storage.buckets where id = ${other}`.execute(tx);
      });
    await db.destroy();
  });

  it('chooses only staged uploads past the 2-hour upload URL, oldest first', async (ctx) => {
    if (!hasStorage) ctx.skip();
    const stale = (await staleUploads(db)).filter((n) => n.startsWith(user));
    expect(stale).toEqual([`${user}/uploads/old-2`, `${user}/uploads/old-1`]);
  });

  it('removes them through storage in batches and reports counts', async (ctx) => {
    if (!hasStorage) ctx.skip();
    const removed: string[][] = [];
    const task = photoUploadSweep({
      remove: async (bucket, keys) => void removed.push([bucket, ...keys]),
    });
    const counts = await task.run({
      db,
      log: createLogger('error', () => {}),
      signal: new AbortController().signal,
    });
    const ours = removed.flatMap(([bucket, ...keys]) =>
      keys.filter((k) => k.startsWith(user)).map((k) => `${bucket}:${k}`),
    );
    expect(ours.sort()).toEqual([
      `${PHOTO_BUCKET}:${user}/uploads/old-1`,
      `${PHOTO_BUCKET}:${user}/uploads/old-2`,
    ]);
    expect(counts).toMatchObject({ found: expect.any(Number), removed: expect.any(Number) });
  });
});
