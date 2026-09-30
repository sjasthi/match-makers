const base = require('@match-makers/eslint-config');
const reactRules = require('@match-makers/eslint-config/react').rules;

module.exports = {
  ...base,
  env: { es2022: true, node: true, jest: true },
  rules: {
    ...base.rules,
    ...reactRules,
  },
  overrides: [
    {
      // This file, and other CommonJS config files, must use require().
      files: ['*.js'],
      rules: {
        '@typescript-eslint/consistent-type-imports': 'off',
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
    {
      // jest.mock factories are hoisted, so they cannot use top-level imports
      // and must require lazily.
      files: ['jest.setup.ts'],
      rules: {
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
};
