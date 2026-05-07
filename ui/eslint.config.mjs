/**
 * @file ESLint 10 flat config.
 *
 * Requires `typescript-eslint` (npm install -D typescript-eslint).
 * Uses the new flat config format — default in ESLint 9+.
 *
 * Flat config replaces the old .eslintrc.* format.
 * Each object in the exported array targets specific files and provides
 * settings/rules that are merged together.
 */

import tseslint from 'typescript-eslint';

export default tseslint.config(
  /* ── Files to ignore ──────────────────────────────────────────────────── */
  { ignores: ['dist/**', 'node_modules/**'] },

  /* ── TypeScript source files ──────────────────────────────────────────── */
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        // Enables type-aware linting rules (slower but more accurate)
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /* Disallow implicit `any` to keep strong typing */
      '@typescript-eslint/no-explicit-any': 'warn',
      /* Flag variables that are declared but never used */
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      /* Require explicit return types on exported functions */
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      /* Prefer const over let where the value is never reassigned */
      'prefer-const': 'error',
      /* Disallow console.log in production code (use proper logging) */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  /* ── Config files (vite.config.ts etc.) ──────────────────────────────── */
  {
    files: ['*.config.{ts,mjs,js}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  }
);
