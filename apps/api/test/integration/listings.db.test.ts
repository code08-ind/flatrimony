/**
 * /v1/listings against Postgres (T3.5; docs/05 §8.6, docs/04 §15.6): a have_room member creates a
 * draft, fills rules and costs, and submits once complete and DigiLocker-verified; pause, resume,
 * confirm and delete; the owner's view only. Media rows are written directly (uploads are T3.6).
 * Skipped without DATABASE_URL.
 */
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { OwnerListing } from '@flatrimony/shared';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/env.js';
import { createDatabase, type Database } from '../../src/lib/db.js';
import { pgListingRepository } from '../../src/modules/listings/repository.js';

const url = process.env.DATABASE_URL;
const KEY = randomBytes(32);

describe.skipIf(!url)('/v1/listings on Postgres', () => {
  let db: Database;
  let app: FastifyInstance;
  let areaId: number;
  const users: { id: string; token: string }[] = [];

  async function newUser(intent: 'have_room' | 'need_room' = 'have_room') {
    const id = randomUUID();
    const phone = `9197${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;
    await sql`insert into auth.users (id, aud, role, phone) values (${id}, 'authenticated', 'authenticated', ${phone})`.execute(
      db,
    );
    await sql`insert into public.profiles (id, display_name, intent, date_of_birth)
      values (${id}, 'Meera', ${intent}::public.user_intent, '1998-01-01')`.execute(db);
    const user = { id, token: `l.${users.length}.${randomUUID()}` };
    users.push(user);
    return user;
  }

  /** What a DigiLocker success leaves behind (T3.1). */
  async function verify(userId: string) {
    await db.transaction().execute(async (tx) => {
      await sql`insert into private.identity_records (user_id, verified_name_enc, verified_dob, verified_gender, digilocker_id_hash)
        values (${userId}, ${Buffer.concat([Buffer.from([1]), randomBytes(40)])}, '1998-01-01', 'female', ${randomBytes(32)})`.execute(
        tx,
      );
      await sql`update public.profiles set is_identity_verified = true, verified_gender = 'female' where id = ${userId}`.execute(
        tx,
      );
    });
  }

  /** A photo or the video, as the upload flow (T3.6) will record it. */
  async function addMedia(listingId: string, kind: 'photo' | 'walkthrough_video', position = 0) {
    const ext = kind === 'photo' ? 'webp' : 'mp4';
    const bucket = kind === 'photo' ? 'listing-photos' : 'r2-walkthroughs';
    const video = kind === 'walkthrough_video';
    const row = await sql<{ id: string }>`insert into public.listing_media
        (listing_id, kind, storage_bucket, storage_key, sha256, position, duration_s, recorded_in_app, captured_at, integrity_verdict)
      values (${listingId}, ${kind}::public.media_kind, ${bucket}, ${`${listingId}/${randomUUID()}.${ext}`},
        ${randomBytes(32)}, ${position}, ${video ? 45 : null}, ${video}, ${video ? sql`now()` : null},
        ${video ? 'meets_device_integrity' : null})
      returning id`.execute(db);
    return row.rows[0]!.id;
  }

  const call = (
    user: { token: string },
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url: `/v1${path}`,
      headers: { authorization: `Bearer ${user.token}`, ...headers },
      ...(payload ? { payload } : {}),
    });

  const draft = (over: object = {}) => ({
    title: 'Sunny room near Cyber Hub',
    description: 'Two working professionals.\nQuiet weeknights.',
    areaId,
    location: { lat: 28.4951, lng: 77.0889 },
    address: 'Tower B, Flat 1203, DLF Phase 2',
    bhk: 3,
    roomType: 'private',
    furnishing: 'semi_furnished',
    availableFrom: '2026-12-15',
    totalFlatmates: 3,
    currentFlatmates: 2,
    rentPerPersonInr: 18000,
    depositPerPersonInr: 36000,
    ...over,
  });
  const rules = {
    bachelorsAllowed: true,
    foodRule: 'any',
    guestsRule: 'day_only',
    petsAllowed: false,
    smokingAllowed: false,
    genderRule: 'any',
  };
  const costs = {
    maintenanceInr: 1500,
    electricityEstimateInr: 1200,
    wifiInr: 400,
    helpInr: 1000,
    otherRecurringInr: 0,
    oneTimeCosts: [{ label: 'Setup', amountInr: 2000 }],
  };

  async function created(user: { token: string }, over: object = {}) {
    const res = await call(user, 'POST', '/listings', draft(over));
    expect(res.statusCode, res.body).toBe(201);
    return OwnerListing.parse(res.json());
  }

  beforeAll(async () => {
    db = createDatabase(url!, { max: 3 });
    areaId = (
      await sql<{ id: number }>`select min(id)::int as id from ref.areas where is_active`.execute(
        db,
      )
    ).rows[0]!.id;
    app = await buildApp({
      env: loadEnv({ NODE_ENV: 'test', FIELD_ENCRYPTION_KEY: `v1:${KEY.toString('base64')}` }),
      jwtVerifier: async (token) => {
        const user = users.find((u) => u.token === token);
        if (!user) throw new Error('unknown');
        return { id: user.id, appRole: 'user' };
      },
      listingRepo: (deps) => pgListingRepository(db, deps),
    });
  });
  afterAll(async () => {
    await app.close();
    if (users.length)
      await sql`delete from auth.users where id = any(${users.map((u) => u.id)}::uuid[])`.execute(
        db,
      );
    await db.destroy();
  });

  it('only a member with a room can list one (FR-LST-01)', async () => {
    const seeker = await newUser('need_room');
    const res = await call(seeker, 'POST', '/listings', draft());
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('listing.not_allowed_for_intent');
  });

  it('a new draft: the owner sees the pin, the address and what is still missing', async () => {
    const owner = await newUser();
    const res = await call(owner, 'POST', '/listings', draft());
    expect(res.statusCode, res.body).toBe(201);
    const l = OwnerListing.parse(res.json());
    expect(res.headers.location).toBe(`/v1/listings/${l.id}`);
    expect(res.headers.etag).toMatch(/^W\/"\d+"$/);
    expect(l).toMatchObject({
      status: 'draft',
      location: { lat: 28.4951, lng: 77.0889 },
      address: 'Tower B, Flat 1203, DLF Phase 2',
      minLeaseMonths: 11,
      offersVideoTour: false,
      rules: null,
      costs: null,
      trueMonthlyPerPersonInr: null,
      missing: ['rules', 'costs', 'photos', 'video', 'verification'],
    });
    // Others will see a point on the 500 m grid, never the pin.
    expect(l.approxLocation).not.toEqual(l.location);
    expect(Math.abs(l.approxLocation.lat - l.location.lat)).toBeLessThan(0.005);
    // The address is stored encrypted and bound to this listing.
    const stored = (
      await sql<{
        enc: Buffer;
      }>`select address_enc as enc from public.listings where id = ${l.id}`.execute(db)
    ).rows[0]!.enc;
    expect(stored[0]).toBe(1);
    expect(stored.toString('utf8')).not.toContain('Tower B');

    const mine = await call(owner, 'GET', '/me/listings');
    expect(mine.json().listings.map((x: { id: string }) => x.id)).toEqual([l.id]);
  });

  it('titles and labels may join emoji and Hindi conjuncts (QA T3.5)', async () => {
    const owner = await newUser();
    const zwj = String.fromCodePoint(0x200d);
    const family = ['👨', '👩', '👧'].join(zwj);
    const l = await created(owner, { title: `Family flat ${family}` });
    expect(l.title).toBe(`Family flat ${family}`);
    const conjunct = `क्${zwj}ष शुल्क`;
    const res = await call(owner, 'PUT', `/listings/${l.id}/costs`, {
      ...costs,
      oneTimeCosts: [{ label: conjunct, amountInr: 500 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    // A joiner on its own is still not a title.
    const bare = await call(owner, 'POST', '/listings', draft({ title: `${zwj}Room with view` }));
    expect(bare.statusCode).toBe(422);
  });

  it('ten new drafts a day; refused requests do not count', async () => {
    const owner = await newUser();
    for (let i = 0; i < 12; i++)
      expect((await call(owner, 'POST', '/listings', draft({ areaId: 32000 }))).statusCode).toBe(
        422,
      );
    for (let i = 0; i < 10; i++) await created(owner);
    const over = await call(owner, 'POST', '/listings', draft());
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe('rate_limited');
  });

  it('refuses what the database would: outside NCR, unknown area, a full flat, brokerage', async () => {
    const owner = await newUser();
    const paths = async (res: Awaited<ReturnType<typeof call>>) => {
      expect(res.statusCode, res.body).toBe(422);
      return (res.json().errors as { path: string }[]).map((e) => e.path);
    };
    expect(
      await paths(
        await call(owner, 'POST', '/listings', draft({ location: { lat: 12.97, lng: 77.59 } })),
      ),
    ).toContain('body.location');
    expect(await paths(await call(owner, 'POST', '/listings', draft({ areaId: 32000 })))).toEqual([
      'body.areaId',
    ]);
    expect(
      await paths(await call(owner, 'POST', '/listings', draft({ currentFlatmates: 3 }))),
    ).toContain('body.currentFlatmates');
    const l = await created(owner);
    expect(
      await paths(
        await call(owner, 'PUT', `/listings/${l.id}/costs`, { ...costs, brokerageInr: 0 }),
      ),
    ).toContain('body.brokerageInr');
    for (const label of ['Agent fee', 'Brokerage', 'दलाली', 'One month commission']) {
      const broker = await call(owner, 'PUT', `/listings/${l.id}/costs`, {
        ...costs,
        oneTimeCosts: [
          { label: 'Setup', amountInr: 100 },
          { label, amountInr: 5000 },
        ],
      });
      expect(broker.json().code, label).toBe('listing.brokerage_not_allowed');
      expect(await paths(broker)).toEqual(['body.oneTimeCosts.1.label']);
    }
    // A patch that leaves no room: the database's check, as a field error.
    expect(
      await paths(await call(owner, 'PATCH', `/listings/${l.id}`, { currentFlatmates: 3 })),
    ).toEqual(['body.currentFlatmates']);
  });

  it("a listing is its owner's: others get 404 for reads and writes", async () => {
    const owner = await newUser();
    const other = await newUser();
    const l = await created(owner);
    for (const [method, path, payload] of [
      ['GET', `/listings/${l.id}`, undefined],
      ['PATCH', `/listings/${l.id}`, { title: 'Taken over listing' }],
      ['PUT', `/listings/${l.id}/rules`, rules],
      ['PUT', `/listings/${l.id}/costs`, costs],
      ['POST', `/listings/${l.id}/submit`, undefined],
      ['POST', `/listings/${l.id}/confirm-available`, undefined],
      ['POST', `/listings/${l.id}/resume`, undefined],
      ['POST', `/listings/${l.id}/pause`, undefined],
      ['DELETE', `/listings/${l.id}`, undefined],
    ] as const) {
      const res = await call(other, method, path, payload);
      expect(res.statusCode, `${method} ${path}`).toBe(404);
    }
  });

  it('edits with If-Match; rules and costs give the true monthly cost', async () => {
    const owner = await newUser();
    const l = await created(owner);
    const read = await call(owner, 'GET', `/listings/${l.id}`);
    const etag = read.headers.etag as string;
    const ok = await call(
      owner,
      'PATCH',
      `/listings/${l.id}`,
      { rentPerPersonInr: 19000, address: null },
      { 'if-match': etag },
    );
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ rentPerPersonInr: 19000, address: null });
    expect(ok.headers.etag).not.toBe(etag);
    const stale = await call(owner, 'PATCH', `/listings/${l.id}`, { bhk: 2 }, { 'if-match': etag });
    expect(stale.statusCode).toBe(412);
    const staleRules = await call(owner, 'PUT', `/listings/${l.id}/rules`, rules, {
      'if-match': etag,
    });
    expect(staleRules.statusCode).toBe(412);
    const malformed = await call(
      owner,
      'PATCH',
      `/listings/${l.id}`,
      { bhk: 2 },
      { 'if-match': 'v7' },
    );
    expect(malformed.statusCode).toBe(422);
    expect(malformed.json().errors[0].path).toBe('headers.if-match');
    expect(
      (await call(owner, 'PATCH', `/listings/${l.id}`, { bhk: 2 }, { 'if-match': '*' })).statusCode,
    ).toBe(200);

    expect((await call(owner, 'PUT', `/listings/${l.id}/rules`, rules)).statusCode).toBe(200);
    const withCosts = await call(owner, 'PUT', `/listings/${l.id}/costs`, costs);
    expect(withCosts.statusCode, withCosts.body).toBe(200);
    expect(withCosts.json()).toMatchObject({
      rules,
      costs,
      trueMonthlyPerPersonInr: 19000 + 1500 + 1200 + 400 + 1000,
      missing: ['photos', 'video', 'verification'],
    });
  });

  it('submit needs a DigiLocker-verified owner and a complete listing, then goes live for 7 days', async () => {
    const owner = await newUser();
    const l = await created(owner);
    await call(owner, 'PUT', `/listings/${l.id}/rules`, rules);
    await call(owner, 'PUT', `/listings/${l.id}/costs`, costs);

    const unverified = await call(owner, 'POST', `/listings/${l.id}/submit`);
    expect(unverified.statusCode).toBe(403);
    expect(unverified.json().code).toBe('verification.required');

    await verify(owner.id);
    await addMedia(l.id, 'photo', 0);
    const partial = await call(owner, 'POST', `/listings/${l.id}/submit`);
    expect(partial.statusCode).toBe(409);
    expect(partial.json().code).toBe('listing.incomplete');
    expect(partial.json().errors.map((e: { path: string }) => e.path)).toEqual([
      'listing.photos',
      'listing.video',
    ]);

    const photos = [await addMedia(l.id, 'photo', 1), await addMedia(l.id, 'photo', 2)];
    await addMedia(l.id, 'walkthrough_video');
    const before = Date.now();
    const live = await call(owner, 'POST', `/listings/${l.id}/submit`);
    expect(live.statusCode, live.body).toBe(200);
    const body = OwnerListing.parse(live.json());
    expect(body.status).toBe('active');
    expect(body.missing).toEqual([]);
    expect(body.publishedAt).not.toBeNull();
    const days = (Date.parse(body.expiresAt!) - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    // Submitting twice is a conflict, not a second publish.
    expect((await call(owner, 'POST', `/listings/${l.id}/submit`)).statusCode).toBe(409);

    // Paused, a photo and the video go: it cannot go live short, and says all that is missing.
    expect((await call(owner, 'POST', `/listings/${l.id}/pause`)).json().status).toBe('paused');
    await sql`delete from public.listing_media where id = ${photos[0]} or (listing_id = ${l.id} and kind = 'walkthrough_video')`.execute(
      db,
    );
    const short = await call(owner, 'POST', `/listings/${l.id}/resume`);
    expect(short.statusCode).toBe(409);
    expect(short.json().code).toBe('listing.incomplete');
    expect(short.json().errors.map((e: { path: string }) => e.path)).toEqual([
      'listing.photos',
      'listing.video',
    ]);
    await addMedia(l.id, 'walkthrough_video');
    await addMedia(l.id, 'photo', 3);
    expect((await call(owner, 'POST', `/listings/${l.id}/resume`)).json().status).toBe('active');

    // Still available: another 7 days from now.
    const confirmed = await call(owner, 'POST', `/listings/${l.id}/confirm-available`);
    expect(confirmed.statusCode).toBe(200);
    expect(Date.parse(confirmed.json().expiresAt)).toBeGreaterThanOrEqual(
      Date.parse(body.expiresAt!),
    );
  });

  it('an expired listing comes back with one tap: confirm or resume (FR-LST-07)', async () => {
    const owner = await newUser();
    await verify(owner.id);
    const l = await created(owner);
    await call(owner, 'PUT', `/listings/${l.id}/rules`, rules);
    await call(owner, 'PUT', `/listings/${l.id}/costs`, costs);
    for (const p of [0, 1, 2]) await addMedia(l.id, 'photo', p);
    await addMedia(l.id, 'walkthrough_video');
    expect((await call(owner, 'POST', `/listings/${l.id}/submit`)).statusCode).toBe(200);
    for (const action of ['confirm-available', 'resume']) {
      await sql`update public.listings set status = 'expired' where id = ${l.id}`.execute(db);
      const back = await call(owner, 'POST', `/listings/${l.id}/${action}`);
      expect(back.statusCode, action).toBe(200);
      expect(back.json().status).toBe('active');
    }
  });

  it('a suspended owner can read, pause and delete, but not edit or go live', async () => {
    const owner = await newUser();
    await verify(owner.id);
    const l = await created(owner);
    await call(owner, 'PUT', `/listings/${l.id}/rules`, rules);
    await call(owner, 'PUT', `/listings/${l.id}/costs`, costs);
    for (const p of [0, 1, 2]) await addMedia(l.id, 'photo', p);
    await addMedia(l.id, 'walkthrough_video');
    expect((await call(owner, 'POST', `/listings/${l.id}/submit`)).statusCode).toBe(200);
    await sql`update public.profiles set suspended_until = now() + interval '1 day' where id = ${owner.id}`.execute(
      db,
    );
    expect((await call(owner, 'GET', `/listings/${l.id}`)).statusCode).toBe(200);
    const edit = await call(owner, 'PATCH', `/listings/${l.id}`, { bhk: 2 });
    expect(edit.json().code).toBe('account.suspended');
    expect((await call(owner, 'POST', `/listings/${l.id}/pause`)).json().status).toBe('paused');
    expect((await call(owner, 'POST', `/listings/${l.id}/resume`)).json().code).toBe(
      'account.suspended',
    );
    expect((await call(owner, 'DELETE', `/listings/${l.id}`)).statusCode).toBe(204);
  });

  it('a listing a moderator removed: the owner sees it, cannot edit it, can delete it', async () => {
    const owner = await newUser();
    const l = await created(owner);
    await sql`update public.listings set status = 'removed' where id = ${l.id}`.execute(db);
    expect((await call(owner, 'GET', `/listings/${l.id}`)).json().status).toBe('removed');
    expect((await call(owner, 'PATCH', `/listings/${l.id}`, { bhk: 2 })).statusCode).toBe(409);
    expect((await call(owner, 'PUT', `/listings/${l.id}/rules`, rules)).statusCode).toBe(409);
    expect((await call(owner, 'DELETE', `/listings/${l.id}`)).statusCode).toBe(204);
  });

  it('status changes only from where they make sense', async () => {
    const owner = await newUser();
    await verify(owner.id);
    const l = await created(owner);
    for (const action of ['pause', 'resume', 'confirm-available']) {
      const res = await call(owner, 'POST', `/listings/${l.id}/${action}`);
      expect(res.statusCode, action).toBe(409);
      expect(res.json().code).toBe('conflict');
    }
  });

  it('an owner who switches to looking for a room: listing paused, cannot go live', async () => {
    const owner = await newUser();
    await verify(owner.id);
    const l = await created(owner);
    await call(owner, 'PUT', `/listings/${l.id}/rules`, rules);
    await call(owner, 'PUT', `/listings/${l.id}/costs`, costs);
    for (const p of [0, 1, 2]) await addMedia(l.id, 'photo', p);
    await addMedia(l.id, 'walkthrough_video');
    expect((await call(owner, 'POST', `/listings/${l.id}/submit`)).statusCode).toBe(200);

    await sql`update public.profiles set intent = 'need_room' where id = ${owner.id}`.execute(db);
    expect((await call(owner, 'GET', `/listings/${l.id}`)).json().status).toBe('paused');
    const res = await call(owner, 'POST', `/listings/${l.id}/resume`);
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('listing.not_allowed_for_intent');
  });

  it('delete: gone for the owner, kept as removed for the record', async () => {
    const owner = await newUser();
    const l = await created(owner);
    expect((await call(owner, 'DELETE', `/listings/${l.id}`)).statusCode).toBe(204);
    expect((await call(owner, 'GET', `/listings/${l.id}`)).statusCode).toBe(404);
    expect((await call(owner, 'DELETE', `/listings/${l.id}`)).statusCode).toBe(404);
    expect((await call(owner, 'GET', '/me/listings')).json().listings).toEqual([]);
    const row = (
      await sql<{
        status: string;
        deleted: boolean;
      }>`select status, deleted_at is not null as deleted from public.listings where id = ${l.id}`.execute(
        db,
      )
    ).rows[0]!;
    expect(row).toEqual({ status: 'removed', deleted: true });
  });
});
