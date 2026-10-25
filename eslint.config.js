import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'tmp', 'prisma/migrations'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/client/**/*.{ts,tsx}', 'tests/client/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/server/**/*.ts', 'prisma/**/*.ts', 'tests/server/**/*.ts', 'scripts/**/*.{js,mjs}', '*.config.{ts,js}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);
