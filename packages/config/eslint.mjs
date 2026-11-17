// Shared flat ESLint config. Module boundaries follow docs/03-technical-stack.md §3:
// packages never import apps; apps import packages only through their public entry points.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export const base = [
  { ignores: ['**/dist/**', '**/.next/**', '**/.expo/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];

/** For code under packages/*: forbid importing from apps/*. */
export const packageBoundaries = [
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/apps/**',
                '@flatrimony/api',
                '@flatrimony/web',
                '@flatrimony/admin',
                '@flatrimony/mobile',
              ],
              message: 'Packages must never import apps (docs/03 §3).',
            },
            {
              group: ['@flatrimony/*/src/*'],
              message: 'Import packages through their public entry point.',
            },
          ],
        },
      ],
    },
  },
];

/** Import patterns apps may not use (exported so an app can extend `no-restricted-imports`). */
export const appBoundaryPatterns = [
  {
    group: ['@flatrimony/*/src/*', '**/packages/**'],
    message: 'Import packages through their public entry point.',
  },
];

/** For code under apps/*: only public package entry points. */
export const appBoundaries = [
  {
    rules: {
      'no-restricted-imports': ['error', { patterns: appBoundaryPatterns }],
    },
  },
];

/** React apps (mobile, web, admin): rules of hooks and effect dependencies. */
export const react = [
  {
    files: ['**/*.{tsx,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
