export const AUTH_STORAGE_KEYS = {
  ACCESS_TOKEN: 'auth.access_token',
  REFRESH_TOKEN: 'auth.refresh_token',
  SESSION_ID: 'auth.session_id',
  AUTH_MODE: 'auth.mode',
} as const;

function readNumberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const MOCK_CONFIG = {
  /** Base simulated round-trip time, in ms. */
  LATENCY: readNumberEnv(process.env.EXPO_PUBLIC_MOCK_LATENCY, 350),
  /** Random jitter added on top of LATENCY, in ms. */
  JITTER: readNumberEnv(process.env.EXPO_PUBLIC_MOCK_JITTER, 250),
  /** 0..1 chance that a mocked request fails. Raise it to exercise error states. */
  FAILURE_RATE: readNumberEnv(process.env.EXPO_PUBLIC_MOCK_FAILURE_RATE, 0),
} as const;

export const API_CONFIG = {
  BASE_URL: process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api',
  TIMEOUT: 30000,
} as const;

export const APP_CONFIG = {
  MAX_PHOTOS: 6,
  MIN_AGE: 18,
  MAX_AGE: 100,
  MAX_DISTANCE: 500,
  SWIPE_LIMIT_DAILY: 100,
  /** Profile is considered incomplete until these are satisfied. */
  ONBOARDING_STEPS: ['photos', 'preferences', 'location'] as const,
} as const;

export const COLORS = {
  primary: '#FF6B6B',
  primaryDark: '#E85555',
  primaryLight: '#FF8E8E',
  secondary: '#4ECDC4',
  secondaryDark: '#3DBDB7',
  background: '#FFFFFF',
  surface: '#F8F9FA',
  surfaceVariant: '#EEF0F2',
  text: '#1A1A2E',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  border: '#E5E7EB',
  error: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
  overlay: 'rgba(0, 0, 0, 0.5)',
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const FONT_SIZES = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 18,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;
