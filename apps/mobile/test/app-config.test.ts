import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExpoConfig } from 'expo/config';

/** Loads app.config.ts as a build with this APP_ENV would. */
async function configFor(appEnv: string | undefined): Promise<ExpoConfig & { mods?: unknown }> {
  vi.resetModules();
  vi.stubEnv('APP_ENV', appEnv);
  return (await import('../app.config')).default;
}

afterEach(() => vi.unstubAllEnvs());

describe('app.config: plain HTTP only for local builds (T2.12)', () => {
  it('local builds (the Android E2E run) add the cleartext manifest change', async () => {
    const local = await configFor('local');
    expect(local.mods).toBeDefined();
  });

  it.each(['staging', 'production', undefined])(
    '%s builds never allow cleartext traffic',
    async (env) => {
      const config = await configFor(env);
      expect(config.mods).toBeUndefined();
      expect(JSON.stringify(config)).not.toContain('usesCleartextTraffic');
    },
  );
});
