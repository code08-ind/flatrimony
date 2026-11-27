import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { walkthroughAppLink } from '@flatrimony/client';
import { qrPath } from '../components/listing/QrCode';
import { fitWithin, PHOTO_CONFIRM_TIMEOUT_MS } from '../lib/client/listings';
import { MEDIA_API_TIMEOUT_MS } from '../lib/server/proxy';

/** Draws the QR path's squares (`M{x} {y}h1v1h-1z`) into RGBA pixels, `scale` px per module. */
function rasterise(text: string, scale = 8) {
  const { size, d } = qrPath(text);
  const px = size * scale;
  const data = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const m of d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = Number(m[1]) * scale;
    const y0 = Number(m[2]) * scale;
    for (let y = y0; y < y0 + scale; y++)
      for (let x = x0; x < x0 + scale; x++) {
        const i = (y * px + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
  }
  return { data, px };
}

describe('the "Continue on your phone" QR code (FR-LST-05)', () => {
  it('decodes to the link that opens this draft at the Video step in the app', () => {
    const id = crypto.randomUUID();
    const link = walkthroughAppLink(id)!;
    const { data, px } = rasterise(link);
    expect(jsQR(data, px, px)?.data).toBe(`flatrimony://listings/${id}/video`);
  });
});

describe('photos from the browser', () => {
  it('are drawn at most 1600 px on the longest side, never scaled up', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 900, height: 1600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
  it('the browser waits as long as the server gives the photo confirm', () => {
    expect(PHOTO_CONFIRM_TIMEOUT_MS).toBe(MEDIA_API_TIMEOUT_MS);
  });
});
