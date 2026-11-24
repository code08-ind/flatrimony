import { fetchWithTimeout } from '@flatrimony/client';

/** An API answer: status, parsed JSON (RFC 9457 problem on errors) and the profile ETag. */
export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  etag?: string;
}

/** No connection or a timeout (the request may not have reached the API). */
export class NetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

/**
 * Calls the API through this site's /api/v1 (the server adds the session from its HttpOnly
 * cookie; docs/05 §2). Personal data goes in the body, never in the URL.
 */
export async function api<T = unknown>(
  path: string,
  {
    method = 'GET',
    body,
    locale,
    ifMatch,
  }: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    locale?: 'en' | 'hi';
    ifMatch?: string;
  } = {},
): Promise<ApiResponse<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (locale) headers['accept-language'] = locale;
  if (ifMatch) headers['if-match'] = ifMatch;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `/api/v1${path}`,
      {
        method,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      // Longer than the web server's own budget (two token refreshes and two API calls,
      // lib/server/proxy.ts), so a rotated session cookie is never dropped by a page that gave up.
      30_000,
    );
  } catch {
    throw new NetworkError();
  }
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const etag = res.headers.get('etag') ?? undefined;
  return { status: res.status, body: parsed as T, ...(etag ? { etag } : {}) };
}

/** The problem code of an error answer (docs/05 §13), if any. */
export const problemCode = (body: unknown): string | undefined =>
  body && typeof body === 'object' && 'code' in body ? String(body.code) : undefined;
