import globals from 'globals';
import { appBoundaries, base } from '@flatrimony/config/eslint';

export default [
  ...base,
  ...appBoundaries,
  { ignores: ['.next/**', 'next-env.d.ts'] },
  { languageOptions: { globals: { ...globals.browser } } },
];
