import { randomUUID } from 'expo-crypto';
import { storage } from './storage';

const KEY = 'flatrimony.install_id';
let cached: string | undefined;

/**
 * A random per-installation id for otp-guard's per-device limits and device bans (FR-AUTH-08).
 * Not a hardware identifier; it resets on reinstall. The API only ever stores its HMAC.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const existing = await storage.getItem(KEY);
  if (existing) return (cached = existing);
  const id = randomUUID();
  await storage.setItem(KEY, id);
  return (cached = id);
}
