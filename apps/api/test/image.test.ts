/** Photo processing (T2.10; FR-BIO-07): metadata stripped, orientation applied, formats, pHash. */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import type { ImageError } from '../src/lib/image.js';
import {
  hammingDistance,
  perceptualHash,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_SIDE,
  processPhoto,
} from '../src/lib/image.js';

/** A test picture with structure (gradient + block) so the hash has something to describe. */
async function picture(
  width: number,
  height: number,
  format: 'jpeg' | 'webp' | 'png' = 'jpeg',
  flip = false,
) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const inBlock = x > width * 0.3 && x < width * 0.6 && y > height * 0.2 && y < height * 0.5;
      const v = inBlock ? 230 : Math.round((255 * (flip ? width - x : x)) / width);
      pixels[i] = v;
      pixels[i + 1] = Math.round((255 * y) / height);
      pixels[i + 2] = 90;
    }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .toFormat(format)
    .toBuffer();
}

describe('processPhoto', () => {
  it('re-encodes as WebP and drops EXIF, including GPS', async () => {
    const withGps = await sharp(await picture(800, 600))
      .withExif({
        IFD0: { Make: 'TestCam', Model: 'Phone 1' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '28/1 29/1 0/1',
          GPSLongitudeRef: 'E',
          GPSLongitude: '77/1 5/1 0/1',
        },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const out = await processPhoto(withGps);
    const meta = await sharp(out.webp).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.webp.includes(Buffer.from('TestCam'))).toBe(false);
    expect({ width: out.width, height: out.height }).toEqual({ width: 800, height: 600 });
  });

  it('drops ICC profiles and XMP (which can also carry GPS)', async () => {
    const xmp = Buffer.from(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="28,29.0N"/></rdf:RDF></x:xmpmeta>',
    );
    const input = await sharp(await picture(400, 300))
      .withIccProfile('p3')
      .withXmp(xmp.toString())
      .jpeg()
      .toBuffer();
    const inMeta = await sharp(input).metadata();
    expect(inMeta.icc).toBeDefined();
    expect(inMeta.xmp).toBeDefined();
    const out = await processPhoto(input);
    const meta = await sharp(out.webp).metadata();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.webp.includes(Buffer.from('GPSLatitude'))).toBe(false);
  });

  it('reports images over the pixel limit as too large', async () => {
    // A decompression bomb: a tiny file whose header claims 9000×9000 (81 MP). Built by rewriting
    // the frame header of a 16×16 JPEG, so the test does not spend seconds encoding 81 MP.
    const bomb = await sharp({
      create: { width: 16, height: 16, channels: 3, background: '#123' },
    })
      .jpeg()
      .toBuffer();
    const sof = bomb.indexOf(Buffer.from([0xff, 0xc0])); // baseline frame header
    expect(sof).toBeGreaterThan(0);
    bomb.writeUInt16BE(9000, sof + 5); // height
    bomb.writeUInt16BE(9000, sof + 7); // width
    expect((await sharp(bomb).metadata()).width).toBe(9000);
    await expect(processPhoto(bomb)).rejects.toMatchObject({ reason: 'too_large' });
  });

  it('applies the EXIF orientation before stripping it', async () => {
    // Orientation 6 = rotate 90° clockwise: a landscape file is a portrait photo.
    const rotated = await sharp(await picture(800, 600))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const out = await processPhoto(rotated);
    expect({ width: out.width, height: out.height }).toEqual({ width: 600, height: 800 });
  });

  it('scales large photos down to 1600 px on the longer side, never up', async () => {
    const big = await processPhoto(await picture(3200, 2400));
    expect(Math.max(big.width, big.height)).toBe(PHOTO_MAX_SIDE);
    const small = await processPhoto(await picture(300, 200));
    expect({ width: small.width, height: small.height }).toEqual({ width: 300, height: 200 });
  });

  it.each([
    ['PNG', async () => picture(100, 100, 'png'), 'unsupported_format'],
    ['a text file', async () => Buffer.from('hello, not a picture'), 'unsupported_format'],
    [
      'a truncated JPEG',
      async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]),
      'not_an_image',
    ],
    [
      'an SVG named like a photo',
      async () =>
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'unsupported_format',
    ],
    ['over 8 MB', async () => Buffer.alloc(PHOTO_MAX_BYTES + 1), 'too_large'],
    [
      'animated WebP',
      async () => {
        const frame = (bg: string) =>
          sharp({ create: { width: 60, height: 60, channels: 3, background: bg } })
            .png()
            .toBuffer();
        return sharp([await frame('#335'), await frame('#a53')], { join: { animated: true } })
          .webp({ loop: 0 })
          .toBuffer();
      },
      'animated',
    ],
  ] as const)('refuses %s', async (_name, make, reason) => {
    await expect(processPhoto(await make())).rejects.toMatchObject({
      name: 'ImageError',
      reason,
    } satisfies Partial<ImageError>);
  });

  it('accepts WebP input', async () => {
    const out = await processPhoto(await picture(400, 300, 'webp'));
    expect(out.phash).toMatch(/^[01]{64}$/);
  });
});

describe('perceptualHash', () => {
  it('is stable, close for a resized copy and far for a different picture', async () => {
    const a = await picture(800, 600);
    const resized = await sharp(a).resize(400, 300).jpeg({ quality: 60 }).toBuffer();
    const other = await picture(800, 600, 'jpeg', true);
    const [ha, hr, ho] = (await Promise.all([a, resized, other].map(perceptualHash))) as [
      string,
      string,
      string,
    ];
    expect(ha).toMatch(/^[01]{64}$/);
    expect(await perceptualHash(a)).toBe(ha);
    expect(hammingDistance(ha, hr)).toBeLessThanOrEqual(6);
    expect(hammingDistance(ha, ho)).toBeGreaterThan(10);
  });
});
