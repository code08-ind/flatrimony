import { Platform } from 'react-native';
import { config } from './config';
import { fetchWithTimeout } from './net';
import { supabase } from './supabase';

/** A response from the Flatrimony API: status and parsed JSON (RFC 9457 problem on errors). */
export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  /** The profile version after a /me read or write (docs/05 §6.2), for the next `ifMatch`. */
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
 * Calls the API with the signed-in user's access token (docs/05 §1 client headers). Personal data
 * travels in the body only, never in the URL.
 */
export async function api<T = unknown>(
  path: string,
  {
    method = 'GET',
    body,
    locale,
    ifMatch,
    timeoutMs,
  }: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    /** Localised reference data and messages (docs/05 §1 Accept-Language). */
    locale?: 'en' | 'hi';
    /** Optimistic concurrency for profile writes: the ETag of the profile this edit started from. */
    ifMatch?: string;
    /** Longer than the default for requests that do heavy work (photo processing). */
    timeoutMs?: number;
  } = {},
): Promise<ApiResponse<T>> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null;
  const headers: Record<string, string> = {
    'x-app-platform': Platform.OS === 'web' ? 'web' : 'android',
    'x-app-version': config.appVersion,
  };
  if (session) headers.authorization = `Bearer ${session.access_token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (locale) headers['accept-language'] = locale;
  if (ifMatch) headers['if-match'] = ifMatch;
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${config.apiUrl}/v1${path}`,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      timeoutMs,
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

/** The problem code of an error response (docs/05 §13), if any. */
export const problemCode = (body: unknown): string | undefined =>
  body && typeof body === 'object' && 'code' in body ? String(body.code) : undefined;
