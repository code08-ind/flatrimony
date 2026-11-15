import { defineConfig } from 'vitest/config';

// Pure-logic tests only; component tests (jest-expo + RNTL) arrive with the first real screens.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
