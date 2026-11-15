/**
 * Integration tests against a real Supabase Postgres with migrations + dev seed applied
 * (`pnpm db:start` locally; the `db` CI job). Skipped when DATABASE_URL is not set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PublicConfig, ReferenceData } from '@flatrimony/shared';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { pgSystemRepository } from '../../src/modules/system/pg-repository.js';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('system endpoints on Postgres', () => {
  let db: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    db = createDatabase(url!, { max: 2 });
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test' }),
      systemRepo: pgSystemRepository(db),
    });
  });
  afterAll(async () => {
    await app?.close();
    await db?.destroy();
  });

  it('/readyz is ready and reports the latest migration', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ready', checks: { database: 'ok' } });
    expect(res.json().migrationVersion).toMatch(/^\d{14}$/);
  });

  it('/v1/config serves the values seeded by migration 0003', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.statusCode).toBe(200);
    expect(PublicConfig.parse(res.json())).toEqual({
      dailyLikeLimit: 50,
      features: { videoTours: false, houseAgreement: false },
      minSupportedAppVersion: '1.0.0',
    });
  });

  it('/v1/config never exposes non-public keys', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/config' });
    expect(res.body).not.toContain('new_account_daily_conversations');
    expect(res.body).not.toContain('listing_confirm_days');
  });

  it('/v1/reference is localised by Accept-Language', async () => {
    const en = ReferenceData.parse(
      (await app.inject({ method: 'GET', url: '/v1/reference' })).json(),
    );
    const hi = ReferenceData.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/v1/reference',
          headers: { 'accept-language': 'hi-IN' },
        })
      ).json(),
    );
    const cyberEn = en.areas.find((a) => a.slug === 'gurugram-cyber-city');
    const cyberHi = hi.areas.find((a) => a.slug === 'gurugram-cyber-city');
    expect(cyberEn).toMatchObject({ name: 'Cyber City', city: 'gurugram' });
    expect(cyberEn!.centroid.lat).toBeCloseTo(28.495, 3);
    expect(cyberEn!.centroid.lng).toBeCloseTo(77.089, 3);
    expect(cyberHi!.name).toBe('साइबर सिटी');

    const sinkEn = en.scenarioQuestions.find((q) => q.id === 'sink_dishes_10pm');
    const sinkHi = hi.scenarioQuestions.find((q) => q.id === 'sink_dishes_10pm');
    expect(sinkEn!.options.map((o) => o.label)).toContain('I wash them right now');
    expect(sinkHi!.prompt).toContain('सिंक');
    expect(en.habitTags.map((t) => t.id)).toContain('tidy');
    expect(en.products).toEqual([]); // prices are the founder's to set
  });

  it('/readyz reports failure when the database is unreachable', async () => {
    const dead = createDatabase('postgresql://postgres:postgres@127.0.0.1:1/postgres', { max: 1 });
    const broken = await buildApp({
      env: loadEnv({ NODE_ENV: 'test' }),
      systemRepo: pgSystemRepository(dead),
    });
    const res = await broken.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json().checks.database).toBe('fail');
    await broken.close();
    await dead.destroy();
  });
});
