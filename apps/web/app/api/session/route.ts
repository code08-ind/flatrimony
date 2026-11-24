/**
 * The web session cookie (docs/05 §2).
 *   POST   { accessToken, refreshToken } → 204, tokens stored in HttpOnly cookies
 *   DELETE → 204, the session is revoked at Supabase and the cookies cleared (sign out)
 *
 * The browser verifies the OTP with Supabase itself (so Supabase's per-IP limits apply to the
 * user, not this server) and hands the tokens over once; it keeps no copy.
 */
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { webConfig } from '../../../lib/server/config';
import {
  ACCESS_COOKIE,
  cookieOptions,
  needsRefresh,
  REFRESH_COOKIE,
  refreshTokens,
  revokeSession,
  sameOrigin,
  tokenExpiry,
} from '../../../lib/server/session';

export const dynamic = 'force-dynamic';

const Body = z
  .object({
    accessToken: z.string().min(20).max(3800), // a cookie holds about 4 KB
    refreshToken: z.string().min(8).max(1024),
  })
  .strict();

const problem = (status: number, code: string, title: string) =>
  NextResponse.json(
    { type: `https://docs.flatrimony.in/errors/${code}`, title, status, code },
    {
      status,
      headers: { 'content-type': 'application/problem+json', 'cache-control': 'no-store' },
    },
  );

async function fromThisSite(): Promise<boolean> {
  const h = await headers();
  return sameOrigin(h.get('origin'), h.get('host'));
}

export async function POST(req: Request) {
  if (!(await fromThisSite())) return problem(403, 'forbidden', 'Forbidden');
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || tokenExpiry(parsed.data.accessToken) === null)
    return problem(400, 'validation.failed', 'Validation failed');
  const config = webConfig();
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, parsed.data.accessToken, cookieOptions(config));
  jar.set(REFRESH_COOKIE, parsed.data.refreshToken, cookieOptions(config));
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function DELETE() {
  if (!(await fromThisSite())) return problem(403, 'forbidden', 'Forbidden');
  const config = webConfig();
  const jar = await cookies();
  let access = jar.get(ACCESS_COOKIE)?.value;
  const refresh = jar.get(REFRESH_COOKIE)?.value;
  // Supabase only revokes with a valid access token: renew an expired one first.
  if (refresh && needsRefresh(access, Date.now())) {
    const renewed = await refreshTokens(config, refresh);
    if (typeof renewed === 'object') access = renewed.accessToken;
  }
  if (access) await revokeSession(config, access);
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
