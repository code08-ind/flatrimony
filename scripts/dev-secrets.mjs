#!/usr/bin/env node
/* eslint-disable no-console -- CLI script */
/**
 * Generates local-development secrets shared by Supabase (supabase/.env) and the API
 * (apps/api/.env.local). Both files are git-ignored. Existing values are kept.
 * Usage: pnpm dev:secrets
 */
import { randomBytes } from 'node:crypto';
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
  APP_ENV: 'local',
  DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  SUPABASE_JWT_ISSUER: 'http://127.0.0.1:54321/auth/v1',
  SUPABASE_JWKS_URL: 'http://127.0.0.1:54321/auth/v1/.well-known/jwks.json',
});
console.log(`supabase/.env: ${a.length ? `added ${a.join(', ')}` : 'unchanged'}`);
console.log(`apps/api/.env.local: ${b.length ? `added ${b.join(', ')}` : 'unchanged'}`);
