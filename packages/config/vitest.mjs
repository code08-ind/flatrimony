import { defineConfig } from 'vitest/config';

/** Shared Vitest preset for library packages (unit tests, V8 coverage). */
export function libraryConfig(overrides = {}) {
  return defineConfig({
    test: {
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
        thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
      ...overrides,
    },
  });
}
