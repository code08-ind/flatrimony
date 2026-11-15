import { randomUUID } from 'node:crypto';
import { HEADERS } from '@flatrimony/shared';

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Accept a well-formed client X-Request-Id or generate one (docs/03 §13.1). */
export function genReqId(req: { headers: Record<string, string | string[] | undefined> }): string {
  const incoming = req.headers[HEADERS.requestId];
  if (typeof incoming === 'string' && SAFE_ID.test(incoming)) return incoming;
  return `req_${randomUUID()}`;
}
