import { describe, expect, it } from 'vitest';
import { mockIntegrityToken, mockIntegrityVerifier } from '../src/lib/integrity.js';
import { memoryVideoStorage, mp4DurationSeconds, sha256 } from '../src/lib/video-storage.js';
import { fakeMp4 } from './helpers/mp4.js';

describe('MP4 duration (the file decides, not the app)', () => {
  it('reads the movie header, version 0 and 1, wherever it sits', () => {
    expect(mp4DurationSeconds(fakeMp4(45))).toBe(45);
    expect(mp4DurationSeconds(fakeMp4(61.5, { version: 1 }))).toBe(61.5);
    expect(mp4DurationSeconds(fakeMp4(30, { padding: 0 }))).toBe(30);
  });

  it('refuses what is not an MP4 or has no movie header', () => {
    expect(mp4DurationSeconds(Buffer.from('not a video at all'))).toBeNull();
    expect(mp4DurationSeconds(Buffer.alloc(0))).toBeNull();
    const noMoov = fakeMp4(45).subarray(0, 28 + 8 + 4096);
    expect(mp4DurationSeconds(noMoov)).toBeNull();
    // A box that claims to run past the end of the file stops the walk.
    const broken = Buffer.from(fakeMp4(45));
    broken.writeUInt32BE(0x7fffffff, 28); // the mdat box after the 28-byte ftyp
    expect(mp4DurationSeconds(broken)).toBeNull();
  });
});

describe('Play Integrity (mock)', () => {
  const NOW = Date.parse('2026-11-26T10:00:00Z');
  const verifier = mockIntegrityVerifier(() => NOW);
  const hash = sha256(Buffer.from('video')).toString('hex');
  const at = (offsetS: number) => Math.floor(NOW / 1000) + offsetS;

  it('a token for this file gives its verdict', async () => {
    expect(await verifier.verify(mockIntegrityToken(hash, undefined, at(0)), hash)).toBe(
      'meets_device_integrity',
    );
    expect(
      await verifier.verify(mockIntegrityToken(hash, 'meets_basic_integrity', at(-60)), hash),
    ).toBe('meets_basic_integrity');
  });

  it('a token for another file, an old one, or a forged one is no token', async () => {
    const other = sha256(Buffer.from('other')).toString('hex');
    expect(await verifier.verify(mockIntegrityToken(other, undefined, at(0)), hash)).toBeNull();
    expect(
      await verifier.verify(mockIntegrityToken(hash, undefined, at(-11 * 60)), hash),
    ).toBeNull();
    expect(await verifier.verify('eyJhbGciOi.forged.token', hash)).toBeNull();
    expect(await verifier.verify('mock.not-json', hash)).toBeNull();
  });
});

describe('memory video storage', () => {
  it('copies, sizes and removes like the S3 one', async () => {
    const store = memoryVideoStorage();
    store.objects.set('uploads/a.mp4', Buffer.from('abc'));
    await store.copy('uploads/a.mp4', 'final/a.mp4');
    expect(await store.size('final/a.mp4')).toBe(3);
    await store.remove(['uploads/a.mp4', 'final/a.mp4']);
    expect(await store.size('final/a.mp4')).toBeNull();
  });
});
