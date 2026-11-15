import { describe, expect, it } from 'vitest';
import config from '../next.config.js';

describe('admin security headers', () => {
  it('is never indexed, framed or cached', async () => {
    const rules = await config.headers!();
    const headers = Object.fromEntries(rules[0]!.headers.map((h) => [h.key, h.value]));
    expect(rules[0]!.source).toBe('/:path*');
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Cache-Control']).toBe('no-store');
    expect(config.poweredByHeader).toBe(false);
  });
});
