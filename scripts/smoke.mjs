#!/usr/bin/env node
/* eslint-disable no-console -- CLI script: output is the point. */
// Post-deploy smoke test (docs/03 §10.2): checks health and public contracts on a deployed API.
// Usage: node scripts/smoke.mjs --base-url https://api-xyz.a.run.app [--web-url https://web-xyz.a.run.app]
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    'web-url': { type: 'string' },
    retries: { type: 'string', default: '5' },
  },
});
const api = values['base-url'];
if (!api) {
  console.error('--base-url is required');
  process.exit(2);
}

const retries = Number(values.retries);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function check(name, url, assert) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'x-app-platform': 'web', 'x-app-version': '0.0.0' },
      });
      const body = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text();
      const problem = assert(res, body);
      if (!problem) {
        console.log(`ok   ${name}`);
        return true;
      }
      if (attempt === retries) console.error(`FAIL ${name}: ${problem}`);
    } catch (err) {
      if (attempt === retries) console.error(`FAIL ${name}: ${err.message}`);
    }
    await sleep(2000 * attempt); // cold starts on scale-to-zero services
  }
  return false;
}

const results = await Promise.all([
  check('GET /healthz', `${api}/healthz`, (r, b) =>
    r.status === 200 && b.status === 'ok' ? null : `status ${r.status}`,
  ),
  check('GET /readyz', `${api}/readyz`, (r, b) =>
    r.status === 200 && b.status === 'ready' ? null : `status ${r.status} ${JSON.stringify(b)}`,
  ),
  check('GET /v1/config', `${api}/v1/config`, (r, b) =>
    r.status === 200 &&
    Number.isInteger(b.dailyLikeLimit) &&
    typeof b.minSupportedAppVersion === 'string'
      ? null
      : `status ${r.status}`,
  ),
  check('unknown route is problem+json 404', `${api}/v1/__smoke_missing__`, (r) =>
    r.status === 404 && r.headers.get('content-type')?.includes('application/problem+json')
      ? null
      : `status ${r.status}`,
  ),
  ...(values['web-url']
    ? [
        check('web /en renders', `${values['web-url']}/en`, (r, b) =>
          r.status === 200 && String(b).includes('Flatrimony') ? null : `status ${r.status}`,
        ),
      ]
    : []),
]);

process.exit(results.every(Boolean) ? 0 : 1);
