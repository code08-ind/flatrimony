import { describe, expect, it } from 'vitest';
import { mp4DurationSeconds, mp4Header, walkthroughRequestHashInput } from './index.js';

/** A minimal MP4: ftyp, some media data, then moov/mvhd with the duration and creation time. */
function mp4(
  durationS: number,
  {
    version = 0,
    createdAt = Date.parse('2026-11-27T10:00:00Z') as number | null,
    largeMdat = false,
    timescale = 1000,
  } = {},
): Uint8Array {
  const box = (type: string, body: Buffer, large = false) => {
    if (!large) {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.length, 0);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    }
    const head = Buffer.alloc(16);
    head.writeUInt32BE(1, 0); // the 64-bit size follows the type
    head.write(type, 4, 'latin1');
    head.writeBigUInt64BE(BigInt(16 + body.length), 8);
    return Buffer.concat([head, body]);
  };
  const created = createdAt === null ? 0 : Math.floor(createdAt / 1000) + 2_082_844_800;
  let mvhd: Buffer;
  if (version === 0) {
    mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(created, 4);
    mvhd.writeUInt32BE(timescale, 12);
    mvhd.writeUInt32BE(Math.round(durationS * timescale), 16);
  } else {
    mvhd = Buffer.alloc(112);
    mvhd[0] = version;
    mvhd.writeBigUInt64BE(BigInt(created), 4);
    mvhd.writeUInt32BE(timescale, 20);
    mvhd.writeBigUInt64BE(BigInt(Math.round(durationS * timescale)), 24);
  }
  return Buffer.concat([
    box('ftyp', Buffer.from('isom\0\0\0\0isom', 'latin1')),
    box('mdat', Buffer.alloc(512, 1), largeMdat),
    box('moov', box('mvhd', mvhd)),
  ]);
}

describe('MP4 movie header (the walkthrough judged by its file)', () => {
  it('reads the duration and creation time, 32- and 64-bit headers and boxes', () => {
    expect(mp4Header(mp4(45))).toEqual({
      durationS: 45,
      createdAt: Date.parse('2026-11-27T10:00:00Z'),
    });
    expect(mp4Header(mp4(61.5, { version: 1, largeMdat: true }))?.durationS).toBe(61.5);
    expect(mp4Header(mp4(30, { createdAt: null }))).toEqual({ durationS: 30, createdAt: null });
    expect(mp4DurationSeconds(mp4(90))).toBe(90);
    // A Uint8Array view into a bigger buffer (as phones hand them over) reads the same.
    const inner = mp4(45);
    const outer = new Uint8Array(inner.length + 10);
    outer.set(inner, 10);
    expect(mp4DurationSeconds(outer.subarray(10))).toBe(45);
  });

  it('anything else is not an MP4 we can read', () => {
    expect(mp4Header(new Uint8Array(0))).toBeNull();
    expect(mp4Header(Buffer.from('not a video, just some bytes'))).toBeNull();
    expect(mp4Header(mp4(45).subarray(0, 40))).toBeNull(); // cut before the movie header
    expect(mp4Header(mp4(45, { version: 2 }))).toBeNull(); // unknown header version
    expect(mp4Header(mp4(45, { timescale: 0 }))).toBeNull();
    const broken = Buffer.from(mp4(45));
    broken.writeUInt32BE(0x7fffffff, 20); // the mdat box (after the 20-byte ftyp) runs past the end
    expect(mp4Header(broken)).toBeNull();
    const tooSmall = Buffer.from(mp4(45));
    tooSmall.writeUInt32BE(4, 20); // a box smaller than its own header
    expect(mp4Header(tooSmall)).toBeNull();
    const largeTooBig = Buffer.from(mp4(45, { largeMdat: true }));
    largeTooBig.writeBigUInt64BE(BigInt(1) << BigInt(40), 28); // its 64-bit size
    expect(mp4Header(largeTooBig)).toBeNull();
  });

  it('the integrity request names the upload and the file', () => {
    expect(walkthroughRequestHashInput('uploads/l1/u1.mp4', 'ab12')).toBe('uploads/l1/u1.mp4:ab12');
  });
});
