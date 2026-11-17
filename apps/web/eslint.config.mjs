import globals from 'globals';
import { appBoundaries, base, react } from '@flatrimony/config/eslint';

export default [
  ...base,
  ...react,
  ...appBoundaries,
  { ignores: ['.next/**', 'next-env.d.ts'] },
  { languageOptions: { globals: { ...globals.browser } } },
];
