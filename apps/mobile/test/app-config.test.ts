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

describe('app.config: Android permissions', () => {
  const pluginOptions = (config: ExpoConfig, name: string) => {
    const entry = config.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === name);
    return (Array.isArray(entry) ? entry[1] : {}) as Record<string, unknown>;
  };

  it('nothing blocks the camera the walkthrough recorder needs (T3.11)', async () => {
    const config = await configFor('production');
    // expo-image-picker's `cameraPermission: false` removes CAMERA from the merged manifest.
    expect(pluginOptions(config, 'expo-image-picker').cameraPermission).not.toBe(false);
    expect(pluginOptions(config, 'expo-camera').cameraPermission).toEqual(expect.any(String));
    expect(config.android?.blockedPermissions ?? []).not.toContain('android.permission.CAMERA');
  });

  it('no microphone anywhere (walkthroughs are silent)', async () => {
    const config = await configFor('production');
    expect(pluginOptions(config, 'expo-image-picker').microphonePermission).toBe(false);
    expect(pluginOptions(config, 'expo-camera').microphonePermission).toBe(false);
  });
});
