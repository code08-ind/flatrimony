import { appBoundaryPatterns, base, react } from '@flatrimony/config/eslint';

export default [
  ...base,
  ...react,
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: appBoundaryPatterns,
          paths: [
            {
              name: 'phosphor-react-native',
              message:
                'Import icons from src/ui/icons.ts (per-icon imports; the barrel adds ~6 MB to the bundle).',
            },
          ],
        },
      ],
    },
  },
  { files: ['src/ui/icons.ts'], rules: { 'no-restricted-imports': 'off' } },
  { ignores: ['.expo/**', 'dist/**', 'expo-env.d.ts', 'app.config.ts'] },
];
