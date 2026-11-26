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

/**
 * Server code that queries the database (api, worker). A listing row holds the exact pin and the
 * encrypted address (FR-LST-06, docs/04 §15.6), so listing queries name their columns: no
 * `selectAll()` / `returningAll()` on a query over `listings`.
 */
export const database = [
  {
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(selectAll|returningAll)$/]:has(CallExpression[callee.property.name=/^(selectFrom|insertInto|updateTable|deleteFrom|innerJoin|leftJoin)$/] > Literal[value=/^(public\\.)?listings( |$)/])',
          message:
            'Name the listing columns: a listing row holds the exact location and the address (docs/04 §15.6).',
        },
      ],
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
