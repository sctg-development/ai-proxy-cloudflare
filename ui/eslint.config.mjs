// MIT License
// Copyright (c) 2024-2026 Ronan Le Meillat - SCTG Development
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
//

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
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  /* ── Files to ignore ──────────────────────────────────────────────────── */
  { ignores: ['dist/**', 'node_modules/**'] },

  /* ── TypeScript source files ──────────────────────────────────────────── */
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
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
      '@typescript-eslint/no-unused-vars': ['error', { 
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      }],
      /* Require explicit return types on exported functions */
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      /* Prefer const over let where the value is never reassigned */
      'prefer-const': 'error',
      /* Disallow console.log in production code (use proper logging) */
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      ...reactHooks.configs.recommended.rules,
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/set-state-in-effect': 'off',
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
