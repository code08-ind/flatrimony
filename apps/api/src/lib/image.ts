/**
 * Profile photo processing (FR-BIO-07; docs/03 §14 Files): decode the upload, refuse anything that
 * is not a still JPEG or WebP image, apply the EXIF orientation, re-encode as WebP (which drops all
 * metadata: EXIF, GPS, camera, timestamps) and compute a 64-bit perceptual hash for duplicate
 * detection.
 *
 * Face and explicit-content checks need an image-moderation vendor (Blocked, docs/07 T2.10): photos
 * stay `pending` for human moderation until then.
 */
import sharp, { type Metadata } from 'sharp';
import { PHOTO_MAX_BYTES } from '@flatrimony/shared';

export { PHOTO_MAX_BYTES };
/** Stored size: the longer side is scaled down to this (never up). Technical choice, not product. */
export const PHOTO_MAX_SIDE = 1600;
/** Decompression-bomb guard: ~50 megapixels (a 8 MB JPEG never legitimately exceeds it). */
const MAX_INPUT_PIXELS = 50_000_000;

export class ImageError extends Error {
  constructor(readonly reason: 'unsupported_format' | 'not_an_image' | 'animated' | 'too_large') {
    super(reason);
    this.name = 'ImageError';
  }
}

export interface ProcessedPhoto {
  webp: Buffer;
  width: number;
  height: number;
  /** 64 characters of 0/1 (Postgres bit(64)). */
  phash: string;
}

/** JPEG starts FF D8 FF; WebP is a RIFF container of type WEBP. Checked before any decoder runs. */
function sniff(input: Buffer): 'jpeg' | 'webp' | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff)
    return 'jpeg';
  if (
    input.length >= 12 &&
    input.toString('latin1', 0, 4) === 'RIFF' &&
    input.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp';
  return null;
}

const isPixelLimit = (err: unknown) => /pixel limit/i.test((err as Error)?.message ?? '');

/**
 * Production hardening (called once at server start): only the JPEG and WebP decoders may read
 * untrusted bytes, so a flaw in another libvips loader (SVG, TIFF, HEIF, GIF…) is out of reach.
 */
export function restrictImageDecoders() {
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadWebpBuffer'] });
}

/**
 * At most two photos are decoded at a time per API instance (sharp work runs on the libuv pool,
 * which also serves DNS and file I/O). Further confirms wait their turn.
 */
const MAX_PARALLEL = 2;
let active = 0;
const waiting: (() => void)[] = [];
export async function withImageSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

export async function processPhoto(input: Buffer): Promise<ProcessedPhoto> {
  if (input.length > PHOTO_MAX_BYTES) throw new ImageError('too_large');
  if (!sniff(input)) throw new ImageError('unsupported_format');
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch (err) {
    throw new ImageError(isPixelLimit(err) ? 'too_large' : 'not_an_image');
  }
  if (meta.format !== 'jpeg' && meta.format !== 'webp') throw new ImageError('unsupported_format');
  if ((meta.pages ?? 1) > 1) throw new ImageError('animated');

  try {
    // rotate() with no angle applies the EXIF orientation; WebP output carries no metadata unless
    // asked for (keepMetadata/withMetadata is never called).
    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({
        width: PHOTO_MAX_SIDE,
        height: PHOTO_MAX_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return {
      webp: data,
      width: info.width,
      height: info.height,
      phash: await perceptualHash(data),
    };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    throw new ImageError(isPixelLimit(err) ? 'too_large' : 'not_an_image');
  }
}

/**
 * pHash: greyscale 32×32, 2-D DCT-II, keep the 8×8 lowest frequencies, set a bit for each value
 * above their median (the DC term is left out of the median). Similar images differ in few bits
 * (Hamming distance), so re-uploads and light edits are still caught (docs/04 §13).
 */
export async function perceptualHash(image: Buffer): Promise<string> {
  const N = 32;
  const { data } = await sharp(image)
    .greyscale()
    .resize(N, N, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = (x: number, y: number) => data[y * N + x]!;

  const cos: number[][] = Array.from({ length: 8 }, (_, u) =>
    Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))),
  );
  const coeffs: number[] = [];
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) sum += px(x, y) * cos[u]![x]! * cos[v]![y]!;
      }
      coeffs.push(sum);
    }
  }
  // Median of the 63 AC terms (the DC term, overall brightness, is left out).
  const sorted = coeffs.slice(1).sort((a, b) => a - b);
  const median = sorted[31]!;
  return coeffs.map((c) => (c > median ? '1' : '0')).join('');
}

/** Number of differing bits between two hashes. */
export function hammingDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
