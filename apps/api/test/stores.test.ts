import { describe, expect, it } from 'vitest';
import { memoryIdempotencyStore, memoryRateLimitStore } from '../src/lib/stores.js';

describe('memory rate-limit store', () => {
  it('counts per bucket and window, and prunes expired windows when large', async () => {
    const store = memoryRateLimitStore();
    expect(await store.hit('a', 1000, 0)).toEqual({ count: 1, resetAt: 1000 });
    expect(await store.hit('a', 1000, 999)).toEqual({ count: 2, resetAt: 1000 });
    expect(await store.hit('a', 1000, 1000)).toEqual({ count: 1, resetAt: 2000 });
    for (let i = 0; i < 10_001; i++) await store.hit(`bulk-${i}`, 1000, 0);
    // After pruning, old windows are gone but current ones keep counting.
    expect(await store.hit('a', 1000, 1500)).toEqual({ count: 2, resetAt: 2000 });
  });
});

describe('memory idempotency store', () => {
  it('claims, completes, replays, expires and releases', async () => {
    const store = memoryIdempotencyStore(1000);
    expect(await store.begin('u:k', 'h1', 0)).toBeNull();
    expect(await store.begin('u:k', 'h1', 10)).toMatchObject({
      state: 'in_flight',
      requestHash: 'h1',
    });
    await store.complete('u:k', { statusCode: 201, contentType: 'application/json', body: '{}' });
    expect(await store.begin('u:k', 'h1', 20)).toMatchObject({
      state: 'done',
      response: { statusCode: 201 },
    });
    expect(await store.begin('u:k', 'h1', 1001)).toBeNull(); // expired: claimable again
    await store.release('u:k');
    await store.complete('u:k', { statusCode: 200, contentType: undefined, body: '' }); // no-op when not claimed
    expect(await store.begin('u:k', 'h2', 1002)).toBeNull();
  });
});
