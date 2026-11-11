/**
 * Base rule set for every package in the monorepo.
 *
 * Note: in the legacy eslintrc format, `parser` and `plugins` must be package
 * names (strings) resolved by ESLint, not the required module objects.
 *
 * This module is a plain eslintrc shareable config, so it must not export any
 * additional top-level keys. React-specific rules live in ./react.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
    'prettier',
  ],
  env: { es2022: true, node: true },
  settings: { react: { version: 'detect' } },
  ignorePatterns: ['node_modules', 'dist', 'coverage', '.expo', '*.config.js'],
  rules: {
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    eqeqeq: ['error', 'smart'],
    'prefer-const': 'error',
    'object-shorthand': ['error', 'always'],

    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
    ],
    '@typescript-eslint/no-explicit-any': 'warn',
    // Type-aware rules (e.g. no-floating-promises) are intentionally omitted:
    // they need parserOptions.project, which slows linting considerably. The
    // compiler covers unhandled promises, and call sites use `void`.

    // React Native's JSX runtime means React need not be in scope.
    'react/react-in-jsx-scope': 'off',
    'react/prop-types': 'off',
  },
};
