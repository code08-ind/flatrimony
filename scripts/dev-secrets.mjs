#!/usr/bin/env node
/* eslint-disable no-console -- CLI script */
/**
 * Generates local-development secrets shared by Supabase (supabase/.env), the API
 * (apps/api/.env.local), the web app (apps/web/.env.local) and the other apps. All are
 * git-ignored. Existing values are kept.
 * Usage: pnpm dev:secrets
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(path) {
  if (!existsSync(path)) return new Map();
  return new Map(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

/** Appends only the missing keys; existing lines, comments and order are left untouched. */
function upsert(path, values) {
  const current = readEnv(path);
  const missing = Object.entries(values).filter(([k]) => !current.has(k));
  if (missing.length > 0) {
    const prefix = existsSync(path) && !readFileSync(path, 'utf8').endsWith('\n') ? '\n' : '';
    appendFileSync(path, prefix + missing.map(([k, v]) => `${k}=${v}`).join('\n') + '\n', {
      mode: 0o600,
    });
  }
  return missing.map(([k]) => k);
}

const supabaseEnv = join(root, 'supabase/.env');
const apiEnv = join(root, 'apps/api/.env.local');

// Reuse the hook secret if either side already has one, so both always match.
const existing =
  readEnv(supabaseEnv).get('SEND_SMS_HOOK_SECRETS') ?? readEnv(apiEnv).get('SEND_SMS_HOOK_SECRETS');
const hookSecret = existing ?? `v1,whsec_${randomBytes(32).toString('base64')}`;

const a = upsert(supabaseEnv, { SEND_SMS_HOOK_SECRETS: hookSecret });
const b = upsert(apiEnv, {
  SEND_SMS_HOOK_SECRETS: hookSecret,
  HASH_PEPPER: randomBytes(32).toString('base64'),
  // FIELD_ENCRYPTION_KEY encrypts verified names (DigiLocker, T3.1); the mock provider signs its
  // webhooks with DIGILOCKER_WEBHOOK_SECRETS (its first key).
  FIELD_ENCRYPTION_KEY: `v1:${randomBytes(32).toString('base64')}`,
  DIGILOCKER_WEBHOOK_SECRETS: `v1,whsec_${randomBytes(32).toString('base64')}`,
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
  // Browser origins: the mobile web preview (Expo, 8081) and the web app (3000).
  CORS_ALLOWED_ORIGINS: 'http://localhost:8081,http://localhost:3000',
});

// Mobile app public config for local runs (Expo loads apps/mobile/.env.local). The anon key is
// public by design; it is read from the running local stack when available. The local
// service-role key (a well-known default of the Supabase CLI, local only) lets the API use Storage.
let anonKey = '';
let serviceRoleKey = '';
let s3 = null;
try {
  const status = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  anonKey = /^ANON_KEY="?([^"\n]+)"?$/m.exec(status)?.[1] ?? '';
  serviceRoleKey = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(status)?.[1] ?? '';
  // Walkthrough videos (T3.6): the local stand-in for R2 is Storage's S3 endpoint.
  const field = (name) => new RegExp(`^${name}="?([^"\\n]+)"?$`, 'm').exec(status)?.[1];
  const [endpoint, keyId, secret, region] = [
    'STORAGE_S3_URL',
    'S3_PROTOCOL_ACCESS_KEY_ID',
    'S3_PROTOCOL_ACCESS_KEY_SECRET',
    'S3_PROTOCOL_REGION',
  ].map(field);
  if (endpoint && keyId && secret) s3 = { endpoint, keyId, secret, region: region ?? 'local' };
} catch {
  // Supabase not running: the mobile file is written without the key; re-run after `supabase start`.
}
if (serviceRoleKey)
  b.push(
    ...upsert(apiEnv, {
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    }),
  );
if (s3)
  b.push(
    ...upsert(apiEnv, {
      R2_ENDPOINT: s3.endpoint,
      R2_REGION: s3.region,
      R2_ACCESS_KEY_ID: s3.keyId,
      R2_SECRET_ACCESS_KEY: s3.secret,
    }),
  );
// The worker (apps/worker): direct database connection, and Storage for the upload sweep.
const workerEnv = join(root, 'apps/worker/.env.local');
const w = upsert(workerEnv, {
  APP_ENV: 'local',
  DATABASE_URL_DIRECT: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  ...(serviceRoleKey
    ? { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }
    : {}),
});
const mobileEnv = join(root, 'apps/mobile/.env.local');
const c = upsert(mobileEnv, {
  EXPO_PUBLIC_API_URL: 'http://localhost:8080',
  EXPO_PUBLIC_WEB_URL: 'http://localhost:3000',
  EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  ...(anonKey ? { EXPO_PUBLIC_SUPABASE_ANON_KEY: anonKey } : {}),
});
// The web app's server (apps/web): the API, Supabase Auth for the browser's OTP calls, and the
// secret that lets the API rate-limit web users by their own IP (docs/05 §2).
const webEnv = join(root, 'apps/web/.env.local');
const proxySecret =
  readEnv(webEnv).get('WEB_PROXY_SECRET') ??
  readEnv(apiEnv).get('WEB_PROXY_SECRET') ??
  randomBytes(32).toString('base64url');
b.push(...upsert(apiEnv, { WEB_PROXY_SECRET: proxySecret }));
const web = upsert(webEnv, {
  APP_ENV: 'local',
  API_URL: 'http://localhost:8080',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  WEB_PROXY_SECRET: proxySecret,
  ...(anonKey ? { SUPABASE_ANON_KEY: anonKey } : {}),
});
console.log(`supabase/.env: ${a.length ? `added ${a.join(', ')}` : 'unchanged'}`);
console.log(`apps/api/.env.local: ${b.length ? `added ${b.join(', ')}` : 'unchanged'}`);
console.log(`apps/mobile/.env.local: ${c.length ? `added ${c.join(', ')}` : 'unchanged'}`);
console.log(`apps/web/.env.local: ${web.length ? `added ${web.join(', ')}` : 'unchanged'}`);
console.log(`apps/worker/.env.local: ${w.length ? `added ${w.join(', ')}` : 'unchanged'}`);
