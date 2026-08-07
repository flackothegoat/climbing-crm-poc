import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import { globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.dist-dev/**',
    '**/.next/**',
    '**/.next-dev/**',
    '**/.next-build/**',
    '**/next-env.d.ts',
    '**/coverage/**',
    '**/.turbo/**',
  ]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web/' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    files: ['**/next.config.mjs'],
    languageOptions: { globals: { process: 'readonly' } },
  },
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
