/**
 * The mock DigiLocker consent page (only with DIGILOCKER_PROVIDER=mock, which production refuses).
 * A tester sees what DigiLocker would share and chooses: approve with the identity they enter, or
 * cancel. The choice is then delivered the way a real provider would: a signed webhook to
 * /webhooks/digilocker (sent through the app itself), after which the API fetches the result.
 *
 *   GET  /dev/digilocker/:ref   the consent page
 *   POST /dev/digilocker/:ref   approve or cancel (an HTML form post)
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { VerifiedGender } from '@flatrimony/shared';
import { signWebhook } from '../../lib/standard-webhooks.js';
import type { MockDigiLocker } from './provider.js';

export interface DevDigiLockerOptions {
  mock: MockDigiLocker;
  /** The first DIGILOCKER_WEBHOOK_SECRETS key: the mock signs its webhooks like a provider. */
  key: Buffer;
  /** Local development: also serve /dev/digilocker-latest (loopback only). */
  local?: boolean;
  now?: () => number;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:480px;margin:2rem auto;padding:0 1rem;color:#1c1b29}
label{display:block;margin:1rem 0 .25rem;font-weight:600}
input,select{width:100%;padding:.6rem;font:inherit;box-sizing:border-box}
.actions{display:flex;gap:.75rem;margin-top:1.5rem}
button{flex:1;padding:.8rem;font:inherit;font-weight:700;border-radius:999px;border:1px solid #5b3fd6}
.approve{background:#5b3fd6;color:#fff}.cancel{background:#fff;color:#5b3fd6}
.note{background:#fff4d6;padding:.75rem;border-radius:8px}
</style></head><body><main>${body}</main></body></html>`;
}

/** The identity entered on the form, or why not. */
function readForm(form: Record<string, string>) {
  const name = (form.name ?? '').trim();
  const dateOfBirth = (form.dateOfBirth ?? '').trim();
  const gender = VerifiedGender.safeParse(form.gender);
  const digilockerId = (form.digilockerId ?? '').trim();
  if (!name || name.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !gender.success)
    return null;
  if (!/^[A-Za-z0-9-]{4,64}$/.test(digilockerId)) return null;
  return { name, dateOfBirth, gender: gender.data, digilockerId };
}

export const devDigiLockerRoutes: FastifyPluginAsync<DevDigiLockerOptions> = async (
  app: FastifyInstance,
  opts,
) => {
  const now = opts.now ?? Date.now;
  // A test page, but still: no scripts, no framing, no outside resources.
  app.addHook('onSend', async (_req, reply) => {
    reply.header(
      'content-security-policy',
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    );
    reply.header('x-frame-options', 'DENY');
  });
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string', bodyLimit: 4 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  // Local end-to-end flows (Maestro on an emulator, whose browser cannot reach this machine's
  // localhost): the newest waiting session's consent page path, for loopback callers only and only
  // in local development (never on a test environment that serves the consent page).
  if (opts.local)
    app.post('/dev/digilocker-latest', { config: { rateLimit: false } }, async (req, reply) => {
      if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return reply.code(404).send({});
      const ref = opts.mock.latestPending();
      if (!ref) return reply.code(404).send({});
      return { consentPath: `/dev/digilocker/${ref}` };
    });

  app.get<{ Params: { ref: string } }>('/dev/digilocker/:ref', async (req, reply) => {
    const session = opts.mock.session(req.params.ref);
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    if (!session || session.done || session.expiresAt.getTime() < now())
      return reply
        .code(404)
        .send(page('Not found', '<h1>This verification link has expired.</h1>'));
    return page(
      'DigiLocker (test)',
      `<h1>DigiLocker (test)</h1>
<p class="note">Test page: no real DigiLocker. Enter the identity DigiLocker would return.</p>
<p>Flatrimony asks for your <strong>name, date of birth and gender</strong>.</p>
<form method="post">
<label for="name">Name on the documents</label><input id="name" name="name" required maxlength="120">
<label for="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" required>
<label for="gender">Gender</label><select id="gender" name="gender" required>
<option value="" selected disabled>Choose</option><option value="female">Female</option><option value="male">Male</option><option value="transgender">Transgender</option></select>
<label for="digilockerId">DigiLocker id</label><input id="digilockerId" name="digilockerId" value="${escape(`DL-${randomUUID().slice(0, 13)}`)}" required>
<div class="actions"><button class="approve" name="action" value="approve">Allow</button>
<button class="cancel" name="action" value="cancel" formnovalidate>Deny</button></div>
</form>`,
    );
  });

  app.post<{ Params: { ref: string }; Body: Record<string, string> }>(
    '/dev/digilocker/:ref',
    async (req, reply) => {
      reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
      const ref = req.params.ref;
      const session = opts.mock.session(ref);
      if (!session || session.done || session.expiresAt.getTime() < now())
        return reply
          .code(404)
          .send(page('Not found', '<h1>This verification link has expired.</h1>'));
      const body = req.body ?? {};
      let ok: boolean;
      if (body.action === 'cancel') ok = opts.mock.complete(ref, { cancelled: true });
      else {
        const identity = readForm(body);
        if (!identity)
          return reply
            .code(400)
            .send(page('Check the form', '<h1>Check the form and try again.</h1>'));
        ok = opts.mock.complete(ref, { identity });
      }
      if (!ok) return reply.code(409).send(page('Already done', '<h1>Already done.</h1>'));

      // Deliver the result the way a provider does: a signed webhook.
      const payload = JSON.stringify({ providerRef: ref });
      const id = `msg_${randomUUID()}`;
      const timestamp = Math.floor(now() / 1000);
      const res = await app.inject({
        method: 'POST',
        url: '/webhooks/digilocker',
        headers: {
          'content-type': 'application/json',
          'webhook-id': id,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': `v1,${signWebhook(opts.key, id, timestamp, payload)}`,
        },
        payload,
      });
      if (res.statusCode !== 200)
        return reply.code(502).send(page('Error', '<h1>Could not finish. Try again.</h1>'));
      return page(
        'Done',
        `<h1>${body.action === 'cancel' ? 'Cancelled' : 'Done'}</h1><p>You can go back to Flatrimony now.</p>`,
      );
    },
  );
};
