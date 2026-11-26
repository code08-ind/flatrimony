/**
 * The R2 (S3) video adapter against the local stand-in: Supabase Storage's S3 endpoint and its
 * `r2-walkthroughs` bucket (`pnpm dev:secrets` writes the R2_* settings). Skipped without them
 * (CI starts only the database).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { s3VideoStorage } from '../../src/lib/video-storage.js';
import { fakeMp4 } from '../helpers/mp4.js';

const endpoint = process.env.R2_ENDPOINT;
const keyId = process.env.R2_ACCESS_KEY_ID;
const secret = process.env.R2_SECRET_ACCESS_KEY;

describe.skipIf(!endpoint || !keyId || !secret)('s3VideoStorage (local S3)', () => {
  let cached: ReturnType<typeof s3VideoStorage> | undefined;
  const store = () =>
    (cached ??= s3VideoStorage({
      endpoint: endpoint!,
      region: process.env.R2_REGION ?? 'local',
      accessKeyId: keyId!,
      secretAccessKey: secret!,
      bucket: process.env.R2_BUCKET ?? 'r2-walkthroughs',
    }));
  const listing = randomUUID();
  const upload = `uploads/${listing}/${randomUUID()}.mp4`;
  const final = `${listing}/${randomUUID()}.mp4`;
  afterAll(async () => {
    await store().remove([upload, final]);
  });

  it('presigned PUT of exactly the signed size, then size, download, copy, links, remove', async () => {
    const file = fakeMp4(45);
    const url = await store().createUploadUrl(upload, file.length);
    const headers = { 'content-type': 'video/mp4', 'content-length': String(file.length) };
    // Another size than the one signed is refused.
    const wrong = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(Buffer.concat([file, Buffer.alloc(10)])),
      headers: { ...headers, 'content-length': String(file.length + 10) },
    });
    expect(wrong.ok).toBe(false);
    const put = await fetch(url, { method: 'PUT', body: new Uint8Array(file), headers });
    expect(put.status).toBe(200);

    expect(await store().size(upload)).toBe(file.length);
    expect(await store().list(`uploads/${listing}/`)).toEqual([upload]);
    await expect(store().download(upload, 100)).rejects.toThrow('video too large');
    expect((await store().download(upload, 1_000_000))?.equals(file)).toBe(true);
    await store().copy(upload, final);
    await store().remove([upload]);
    expect(await store().size(upload)).toBeNull();
    expect(await store().download(upload, 1_000_000)).toBeNull();
    const view = (await store().signedUrls([final])).get(final)!;
    const got = await fetch(view);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).length).toBe(file.length);
  });
});
