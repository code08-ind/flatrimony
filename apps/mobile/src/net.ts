/** Network calls give up after this long: a dead mobile network must not leave a spinner forever. */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * fetch with a timeout (React Native's fetch has none by default). A timed-out request rejects
 * with an AbortError, which the auth flow treats like any other network failure.
 */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}
