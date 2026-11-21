import { describe, expect, it } from 'vitest';
import { loadEnv, workerId } from '../src/env.js';
import { createLogger, errorFields } from '../src/log.js';
import { backoffMinutes } from '../src/queue.js';

describe('configuration', () => {
  it('prefers the direct database URL and names missing settings without values', () => {
    expect(
      loadEnv({ DATABASE_URL_DIRECT: 'postgres://d', DATABASE_URL: 'postgres://p' }).databaseUrl,
    ).toBe('postgres://d');
    expect(loadEnv({ DATABASE_URL: 'postgres://p' }).databaseUrl).toBe('postgres://p');
    expect(() => loadEnv({})).toThrow(/DATABASE_URL_DIRECT/);
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://p', SUPABASE_URL: 'not a url secret-value' }),
    ).toThrow(/SUPABASE_URL/);
    try {
      loadEnv({ DATABASE_URL: 'postgres://p', SUPABASE_URL: 'not a url secret-value' });
    } catch (err) {
      expect((err as Error).message).not.toContain('secret-value');
    }
  });

  it('names the worker after the Cloud Run execution, task and attempt, or the host and process', () => {
    const base = loadEnv({ DATABASE_URL: 'postgres://p' });
    expect(workerId(base, 42, 'laptop')).toBe('laptop-42');
    expect(
      workerId(
        loadEnv({
          DATABASE_URL: 'postgres://p',
          CLOUD_RUN_EXECUTION: 'worker-abc',
          CLOUD_RUN_TASK_INDEX: '0',
          CLOUD_RUN_TASK_ATTEMPT: '1',
        }),
      ),
    ).toBe('worker-abc/0/1');
  });

  it('keeps the run budget inside the 10-minute task timeout by default', () => {
    expect(loadEnv({ DATABASE_URL: 'postgres://p' }).WORKER_BUDGET_SECONDS).toBe(480);
  });

  it('never lets a run outlive the task timeout (a lock would go stale while held)', () => {
    expect(() => loadEnv({ DATABASE_URL: 'postgres://p', WORKER_BUDGET_SECONDS: '900' })).toThrow(
      /WORKER_BUDGET_SECONDS/,
    );
  });

  it('requires Storage settings outside local, so the upload sweep cannot be off silently', () => {
    const staging = { DATABASE_URL: 'postgres://p', APP_ENV: 'staging' };
    expect(() => loadEnv(staging)).toThrow(/SUPABASE_URL/);
    expect(
      loadEnv({
        ...staging,
        SUPABASE_URL: 'https://x.supabase.co',
        SUPABASE_SERVICE_ROLE_KEY: 'k',
      }).APP_ENV,
    ).toBe('staging');
    expect(loadEnv({ DATABASE_URL: 'postgres://p' }).SUPABASE_URL).toBeUndefined(); // local: optional
  });
});

describe('logging', () => {
  it('writes one JSON line with severity and message, filtered by level', () => {
    const lines: string[] = [];
    const log = createLogger('info', (l) => lines.push(l), { worker: 'w1' });
    log.debug('hidden');
    log.warn('released stale job locks', { count: 2 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      severity: 'WARN',
      message: 'released stale job locks',
      worker: 'w1',
      count: 2,
    });
  });

  it('logs errors by name and a bounded message', () => {
    const fields = errorFields(new TypeError('x'.repeat(2000)));
    expect(fields.err).toBe('TypeError');
    expect(fields.errMessage).toHaveLength(500);
    expect(errorFields('plain').err).toBe('Error');
  });
});

describe('backoff (docs/04 §11)', () => {
  it('waits 2^attempts minutes, at most a day', () => {
    expect([1, 2, 3, 5].map(backoffMinutes)).toEqual([2, 4, 8, 32]);
    expect(backoffMinutes(20)).toBe(24 * 60);
  });
});
