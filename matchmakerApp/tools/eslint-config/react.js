/**
 * React and hooks rule overrides, spread into the `rules` block by the mobile
 * app. Kept separate so the shared package (which has no JSX) can use the base
 * config without pulling in React settings.
 */
module.exports = {
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};
