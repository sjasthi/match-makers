// @testing-library/react-native v12.4+ ships the jest-native matchers
// (toBeOnTheScreen, toBeVisible, ...) out of the box, so no separate setup
// package is required.

// The mock adapter simulates network latency; tests should not wait for it.
process.env.EXPO_PUBLIC_MOCK_LATENCY = '0';
process.env.EXPO_PUBLIC_MOCK_JITTER = '0';
process.env.EXPO_PUBLIC_MOCK_FAILURE_RATE = '0';

// @expo/vector-icons calls expo-font's getLoadedFonts, which jest-expo's
// environment does not provide. Icon fonts are irrelevant in tests.
jest.mock('expo-font', () => ({
  isLoaded: () => true,
  loadAsync: jest.fn(async () => undefined),
  getLoadedFonts: () => [],
  useFonts: () => [true, null],
}));

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    isAvailableAsync: jest.fn(async () => true),
  };
});

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Without real layout events, SafeAreaProvider renders no children at all.
// The library ships a mock that supplies fixed insets. It is a default export,
// so `.default` is required here.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default
);
