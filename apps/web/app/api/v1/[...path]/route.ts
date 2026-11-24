/**
 * /api/v1/<path> → the API, with the session from the HttpOnly cookies (docs/05 §2). The logic
 * lives in lib/server/proxy.ts (unit-tested); this file only adapts it to Next.js.
 */
import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { webConfig } from '../../../../lib/server/config';
import {
  precheck,
  problem,
  proxy,
  readCapped,
  type ProxyResult,
} from '../../../../lib/server/proxy';
import { ACCESS_COOKIE, cookieOptions, REFRESH_COOKIE } from '../../../../lib/server/session';

export const dynamic = 'force-dynamic';

function respond(result: ProxyResult, secure: boolean) {
  const out = new NextResponse(result.body, { status: result.status, headers: result.headers });
  if (result.session === 'clear') {
    out.cookies.delete(ACCESS_COOKIE);
    out.cookies.delete(REFRESH_COOKIE);
  } else if (result.session !== 'keep') {
    const options = cookieOptions({ secureCookies: secure });
    out.cookies.set(ACCESS_COOKIE, result.session.accessToken, options);
    out.cookies.set(REFRESH_COOKIE, result.session.refreshToken, options);
  }
  return out;
}

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const h = await headers();
  const config = webConfig();
  const refused = precheck(req.method, path, h);
  if (refused) return respond(refused, config.secureCookies);

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    const read = await readCapped(req.body);
    if (!read) return respond(problem(413, 'payload_too_large', 'Request too large'), true);
    body = read;
  }
  const jar = await cookies();
  const result = await proxy(
    {
      method: req.method,
      path,
      search: req.nextUrl.search,
      headers: h,
      body,
      access: jar.get(ACCESS_COOKIE)?.value,
      refresh: jar.get(REFRESH_COOKIE)?.value,
    },
    config,
  );
  return respond(result, config.secureCookies);
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
