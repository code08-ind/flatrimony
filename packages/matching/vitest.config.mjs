import { libraryConfig } from '@flatrimony/config/vitest';

// T4.1: the matching rules are fully unit tested (docs/07).
export default libraryConfig({
  coverage: {
    provider: 'v8',
    include: ['src/**/*.ts'],
    exclude: ['src/**/*.test.ts'],
    thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
  },
});
