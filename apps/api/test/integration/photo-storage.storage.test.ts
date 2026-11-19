/**
 * The Supabase Storage adapter against a real local stack with the `profile-photos` bucket
 * (`pnpm exec supabase seed buckets`). Skipped without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (CI starts only the database).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { supabasePhotoStorage } from '../../src/lib/photo-storage.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!url || !key)('supabasePhotoStorage (local Storage)', () => {
  const store = supabasePhotoStorage(url!, key!);
  const user = randomUUID();
  const created: string[] = [];
  afterAll(async () => {
    await store.remove(created);
  });

  it('signed upload, download, list, signed view URLs, remove; missing objects read as null', async () => {
    const staging = `${user}/uploads/${randomUUID()}`;
    const uploadUrl = await store.createUploadUrl(staging);
    const jpeg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#6a4' } })
      .jpeg()
      .toBuffer();
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'image/jpeg' },
      body: jpeg,
    });
    expect(put.status).toBe(200);
    created.push(staging);

    expect((await store.download(staging))?.equals(jpeg)).toBe(true);
    const listed = await store.list(`${user}/uploads`);
    expect(listed.map((o) => o.key)).toEqual([staging]);
    expect(listed[0]!.createdAt).toBeGreaterThan(Date.now() - 5 * 60_000);

    const final = `${user}/${randomUUID()}.webp`;
    await store.upload(final, await sharp(jpeg).webp().toBuffer(), 'image/webp');
    created.push(final);
    const urls = await store.signedUrls([final]);
    const view = await fetch(urls.get(final)!);
    expect(view.status).toBe(200);
    expect(view.headers.get('content-type')).toBe('image/webp');

    // The bucket refuses other types (bucket config), and missing objects are null.
    const png = `${user}/uploads/${randomUUID()}`;
    const pngPut = await fetch(await store.createUploadUrl(png), {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: await sharp(jpeg).png().toBuffer(),
    });
    expect(pngPut.status).toBeGreaterThanOrEqual(400);
    expect(await store.download(`${user}/uploads/${randomUUID()}`)).toBeNull();

    await store.remove([staging]);
    expect(await store.download(staging)).toBeNull();
  });
});
