module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

  /*
   * A separate transform cache per auth mode.
   *
   * `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` at transform time,
   * and Jest's cache key covers file contents and config -- but not the process
   * environment. So a run in mock mode leaves every module transformed with
   * `EXPO_PUBLIC_AUTH_MODE` baked in as "mock", and the next `test:api` run
   * reuses those cached modules and silently exercises the mock again while
   * reporting HTTP failures.
   *
   * Two cache directories means each mode is transformed under the environment
   * it actually runs in.
   */
  cacheDirectory:
    process.env.RUN_API_TESTS === '1' ? '<rootDir>/.jest-cache-api' : '<rootDir>/.jest-cache',

  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@match-makers/.*)',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@match-makers/shared$': '<rootDir>/../shared/src/index.ts',
    '^@match-makers/shared/(.*)$': '<rootDir>/../shared/src/$1',
  },
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
  testMatch: ['<rootDir>/src/**/*.test.{ts,tsx}'],
};
