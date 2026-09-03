// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import playwright from 'eslint-plugin-playwright';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.features-gen/**',
      '**/.automax/**',
      'apps/docs/out/**',
      'apps/docs/.next/**',
      'apps/docs/.source/**',
      'apps/docs/next-env.d.ts',
      'packages/web/dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['projects/**/*.ts', 'packages/core/src/steps/**/*.ts'],
    ...playwright.configs['flat/recommended'],
    rules: { ...playwright.configs['flat/recommended'].rules, 'playwright/expect-expect': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  prettier,
);
