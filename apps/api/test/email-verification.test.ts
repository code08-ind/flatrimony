import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadEnv } from '../src/env.js';
import { mockEmailProvider, type EmailProvider } from '../src/lib/email.js';
import type { ProfileState } from '../src/modules/me/repository.js';
import type {
  EmailConfirmOutcome,
  EmailStartWrite,
  EmailVerificationRepository,
} from '../src/modules/verification/email-repository.js';
import { emailVerificationMessage } from '../src/modules/verification/email-message.js';
import { tokenHash } from '../src/modules/verification/email-routes.js';

const USER = '2b7e4c1a-9d3f-4e5a-8b6c-0d1e2f3a4b5c';
const NOW = Date.parse('2026-11-27T06:00:00Z');

const profile = (over: Partial<ProfileState> = {}): ProfileState => ({
  category: 'professional',
  isIdentityVerified: false,
  verifiedGender: null,
  deleted: false,
  suspendedUntil: null,
  version: '1',
  ...over,
});

function memoryRepo() {
  const starts: (EmailStartWrite & { userId: string })[] = [];
  const failed: string[] = [];
  let badges = { hasWorkBadge: false, hasCollegeBadge: false, locale: 'en' };
  let startOutcome: Awaited<ReturnType<EmailVerificationRepository['start']>> = {
    status: 'started',
  };
  let confirmOutcome: EmailConfirmOutcome | null = null;
  const repo: EmailVerificationRepository = {
    async badges() {
      return badges;
    },
    async start(userId, w) {
      if (startOutcome.status === 'started') starts.push({ ...w, userId });
      return startOutcome;
    },
    async sendFailed(id) {
      failed.push(id);
    },
    async confirm(hash) {
      if (confirmOutcome) return confirmOutcome;
      const s = starts.find((x) => x.tokenHash.equals(hash));
      return s ? { status: 'verified', type: s.type, userId: s.userId } : { status: 'invalid' };
    },
  };
  return {
    repo,
    starts,
    failed,
    setBadges: (b: Partial<typeof badges>) => (badges = { ...badges, ...b }),
    setStart: (o: typeof startOutcome) => (startOutcome = o),
    setConfirm: (o: EmailConfirmOutcome) => (confirmOutcome = o),
  };
}

async function setup(opts: { state?: ProfileState | null; email?: EmailProvider } = {}) {
  const mem = memoryRepo();
  const mail = mockEmailProvider({ now: () => NOW });
  const lines: string[] = [];
  const state = 'state' in opts ? opts.state : profile();
  const app = await buildApp({
    env: loadEnv({ NODE_ENV: 'test', WEB_APP_URL: 'https://app.example.test' }),
    jwtVerifier: async () => ({ id: USER, appRole: 'user' }),
    now: () => NOW,
    meRepo: { profileState: async () => state ?? null } as never,
    emailVerificationRepo: mem.repo,
    emailProvider: opts.email ?? mail,
    logStream: { write: (line) => void lines.push(line) },
  });
  const start = (payload: object) =>
    app.inject({
      method: 'POST',
      url: '/v1/verifications/email',
      headers: { authorization: 'Bearer user.t.t' },
      payload,
    });
  const confirm = (payload: object) =>
    app.inject({ method: 'POST', url: '/v1/verifications/email/confirm', payload });
  const tokenFrom = (to: string) => {
    const text = mail.latest(to)?.text ?? '';
    return /#token=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? '';
  };
  return { app, mem, mail, start, confirm, tokenFrom, lines };
}

describe('POST /v1/verifications/email', () => {
  it('sends a one-time link and stores only the domain and hashes', async () => {
    const { app, mem, mail, start, tokenFrom, lines } = await setup();
    const res = await start({ email: ' Asha.Rao+flat@Infosys.com ', type: 'work_email' });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expiresAt).toBe(new Date(NOW + 24 * 60 * 60_000).toISOString());
    expect(mem.starts).toHaveLength(1);
    const w = mem.starts[0]!;
    expect(w).toMatchObject({ id: body.verificationId, type: 'work_email', domain: 'infosys.com' });
    expect(w.addressHash).toHaveLength(32);
    expect(w.maxPerAddressPerDay).toBe(3);

    // The link goes to the address as typed (local part kept), to the web confirm page.
    const message = mail.latest('asha.rao+flat@infosys.com')!;
    expect(message.to).toBe('Asha.Rao+flat@infosys.com');
    expect(message.subject).toBe('Confirm your work email for Flatrimony');
    expect(message.text).toMatch(
      /https:\/\/app\.example\.test\/en\/verify-email#token=[A-Za-z0-9_-]{43}/,
    );
    const token = tokenFrom('asha.rao+flat@infosys.com');
    expect(w.tokenHash.equals(tokenHash(token))).toBe(true);

    // Nothing about the address or the link in the logs.
    const log = lines.join('\n');
    expect(log).not.toMatch(/infosys|asha|token=/i);
    expect(log).not.toContain(token);
    await app.close();
  });

  it('the same mailbox hashes alike, whatever the case or +tag', async () => {
    const { app, mem, start } = await setup();
    await start({ email: 'asha@infosys.com', type: 'work_email' });
    await start({ email: 'ASHA+x@INFOSYS.COM', type: 'work_email' });
    expect(mem.starts[0]!.addressHash.equals(mem.starts[1]!.addressHash)).toBe(true);
    await app.close();
  });

  it('writes the email in Hindi for a Hindi profile, with the Hindi page', async () => {
    const { app, mem, mail, start } = await setup();
    mem.setBadges({ locale: 'hi' });
    await start({ email: 'asha@iitd.ac.in', type: 'college_email' });
    const m = mail.latest('asha@iitd.ac.in')!;
    expect(m.subject).toContain('कॉलेज');
    expect(m.text).toContain('/hi/verify-email#token=');
    await app.close();
  });

  it.each([
    ['asha@gmail.com', 'work_email', 'personal_domain'],
    ['asha@mailinator.com', 'work_email', 'disposable_domain'],
    ['asha@infosys.com', 'college_email', 'not_a_college_domain'],
    ['not-an-email', 'work_email', 'invalid_email'],
  ])('%s as %s → %s', async (email, type, code) => {
    const { app, mem, start } = await setup();
    const res = await start({ email, type });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors[0]).toMatchObject({ path: 'body.email', code });
    expect(mem.starts).toHaveLength(0);
    await app.close();
  });

  it('refuses a badge the profile already has', async () => {
    const { app, mem, start } = await setup();
    mem.setBadges({ hasWorkBadge: true });
    expect((await start({ email: 'a@infosys.com', type: 'work_email' })).statusCode).toBe(409);
    // The other badge is still open.
    expect((await start({ email: 'a@iitd.ac.in', type: 'college_email' })).statusCode).toBe(201);
    await app.close();
  });

  it('says when an address had its links for today', async () => {
    const { app, mem, mail, start } = await setup();
    mem.setStart({ status: 'address_limited' });
    const res = await start({ email: 'a@infosys.com', type: 'work_email' });
    expect(res.statusCode).toBe(429);
    expect(res.json().errors[0]).toMatchObject({ code: 'address_limited' });
    expect(mail.sentCount).toBe(0);
    await app.close();
  });

  it('a concurrent request is a conflict', async () => {
    const { app, mem, start } = await setup();
    mem.setStart({ status: 'in_progress' });
    expect((await start({ email: 'a@infosys.com', type: 'work_email' })).statusCode).toBe(409);
    await app.close();
  });

  it('a failed send fails the attempt (503) without logging the address', async () => {
    const email = mockEmailProvider({ fail: () => true });
    const { app, mem, start, lines } = await setup({ email });
    const res = await start({ email: 'asha@infosys.com', type: 'work_email' });
    expect(res.statusCode).toBe(503);
    expect(mem.failed).toEqual([mem.starts[0]!.id]);
    expect(lines.join('\n')).not.toMatch(/infosys|asha/i);
    await app.close();
  });

  it.each([
    [null, 409],
    [profile({ deleted: true }), 401],
    [profile({ suspendedUntil: '2026-12-01T00:00:00Z' }), 403],
  ])('profile %j → %i', async (state, status) => {
    const { app, start } = await setup({ state });
    expect((await start({ email: 'a@infosys.com', type: 'work_email' })).statusCode).toBe(status);
    await app.close();
  });

  it('needs a signed-in member and a known type', async () => {
    const { app, start } = await setup();
    const anon = await app.inject({
      method: 'POST',
      url: '/v1/verifications/email',
      payload: { email: 'a@infosys.com', type: 'work_email' },
    });
    expect(anon.statusCode).toBe(401);
    expect((await start({ email: 'a@infosys.com', type: 'digilocker' })).statusCode).toBe(422);
    expect((await start({ email: 'a@infosys.com', type: 'work_email', extra: 1 })).statusCode).toBe(
      422,
    );
    await app.close();
  });

  it('limits how many links a member asks for', async () => {
    const { app, start } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i += 1)
      codes.push((await start({ email: `a${i}@infosys.com`, type: 'work_email' })).statusCode);
    expect(codes.slice(0, 5).every((c) => c === 201)).toBe(true);
    expect(codes[5]).toBe(429);
    await app.close();
  });
});

describe('POST /v1/verifications/email/confirm', () => {
  it('confirms with the token from the email, without signing in', async () => {
    const { app, start, confirm, tokenFrom, lines } = await setup();
    await start({ email: 'asha@iitd.ac.in', type: 'college_email' });
    const token = tokenFrom('asha@iitd.ac.in');
    const res = await confirm({ token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verified', type: 'college_email' });
    expect(lines.join('\n')).not.toContain(token);
    await app.close();
  });

  it.each([
    [{ status: 'invalid' } as const, 'link_invalid'],
    [{ status: 'expired' } as const, 'link_expired'],
    [{ status: 'email_in_use', type: 'work_email' } as const, 'email_in_use'],
  ])('%j → %s', async (outcome, code) => {
    const { app, mem, confirm } = await setup();
    mem.setConfirm(outcome);
    const res = await confirm({ token: 'a'.repeat(43) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ code: 'verification.failed' });
    expect(res.json().errors[0]).toMatchObject({ path: 'body.token', code });
    await app.close();
  });

  it('refuses anything that is not a token', async () => {
    const { app, confirm } = await setup();
    for (const token of ['', 'short', 'a'.repeat(44), `${'a'.repeat(42)}=`])
      expect((await confirm({ token })).statusCode).toBe(422);
    await app.close();
  });
});

describe('the email', () => {
  it('names neither the member nor the employer, and says how to ignore it', () => {
    const m = emailVerificationMessage({
      to: 'a@infosys.com',
      type: 'work_email',
      locale: 'en',
      link: 'https://x.test/en/verify-email#token=abc',
    });
    expect(m.text).toContain('Verified company');
    expect(m.text).toContain('expires in 24 hours');
    expect(m.text).toContain('ignore this email');
    expect(m.text).not.toMatch(/infosys/i);
  });
});

describe('configuration', () => {
  it('takes a bare web origin for links and only the mock sender for now', () => {
    expect(loadEnv({ WEB_APP_URL: 'https://app.example.test' }).WEB_APP_URL).toBe(
      'https://app.example.test',
    );
    expect(() => loadEnv({ WEB_APP_URL: 'https://app.example.test/path' })).toThrow();
    expect(() => loadEnv({ EMAIL_PROVIDER: 'smtp' })).toThrow();
  });
});
