/**
 * Sliding-window counters for small limits (OTP: 5 / 15 min, 20 / h, 50 / h). Each key keeps the
 * timestamps of its recent events, so "N per window" holds for ANY window, not per clock window
 * (a fixed window lets 2N through around a boundary; QA T2.3 D2).
 *
 * In memory, per API instance, until private.rate_limits (migration 0012). Bounded: at most
 * `maxKeys` keys (oldest inserted are evicted first) and expired keys are swept periodically,
 * because keys are attacker-chosen (phone and device hashes).
 */
export interface SlidingWindowLimit {
  max: number;
  windowMs: number;
}

export interface SlidingWindowStore {
  /** Seconds to wait if the key is at its limit now, else 0. Records nothing. */
  peek(key: string, limit: SlidingWindowLimit, now: number): number;
  /** Records one event. */
  record(key: string, limit: SlidingWindowLimit, now: number): void;
  readonly size: number;
}

export function memorySlidingWindowStore(
  opts: { maxKeys?: number; sweepEvery?: number } = {},
): SlidingWindowStore {
  const maxKeys = opts.maxKeys ?? 100_000;
  const sweepEvery = opts.sweepEvery ?? 1_000;
  // Value: event timestamps (ascending) and the window they were recorded with.
  const events = new Map<string, { at: number[]; windowMs: number }>();
  let ops = 0;

  const live = (key: string, windowMs: number, now: number): number[] => {
    const entry = events.get(key);
    if (!entry) return [];
    const kept = entry.at.filter((t) => now - t < windowMs);
    if (kept.length === 0) events.delete(key);
    else entry.at = kept;
    return kept;
  };

  const sweep = (now: number) => {
    for (const [key, entry] of events)
      if (entry.at.every((t) => now - t >= entry.windowMs)) events.delete(key);
  };

  return {
    peek(key, limit, now) {
      const at = live(key, limit.windowMs, now);
      if (at.length < limit.max) return 0;
      // The oldest event that must expire before one more is allowed.
      const oldestBlocking = at[at.length - limit.max]!;
      return Math.max(1, Math.ceil((oldestBlocking + limit.windowMs - now) / 1000));
    },
    record(key, limit, now) {
      if (++ops % sweepEvery === 0) sweep(now);
      const at = live(key, limit.windowMs, now);
      at.push(now);
      events.delete(key); // re-insert so Map order approximates recency
      events.set(key, { at: at.slice(-limit.max), windowMs: limit.windowMs });
      while (events.size > maxKeys) events.delete(events.keys().next().value!);
    },
    get size() {
      return events.size;
    },
  };
}

/** Rate-limit key for a client IP: IPv6 by its /64 (one subscriber's prefix), IPv4 as is. */
export function ipKey(ip: string): string {
  const v4 = /^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (v4) return v4[1]!;
  if (!ip.includes(':')) return ip;
  // Expand '::' to get 8 groups, then keep the first 4 (the /64 prefix).
  const [head, tail] = ip.toLowerCase().split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return `${groups
    .slice(0, 4)
    .map((g) => g || '0')
    .join(':')}::/64`;
}
