import { appBoundaries, base } from '@flatrimony/config/eslint';

export default [
  ...base,
  ...appBoundaries,
  { ignores: ['.expo/**', 'dist/**', 'expo-env.d.ts', 'app.config.ts'] },
];
