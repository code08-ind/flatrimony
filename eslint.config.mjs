import { base } from '@flatrimony/config/eslint';

export default [
  ...base,
  {
    ignores: ['docs/**', 'apps/**', 'packages/**', 'supabase/**', 'infra/**'],
  },
];
