import { MOCK_CONFIG } from '@/constants';
import { AuthError } from '@/services/auth/AuthError';

/** Adds a realistic delay so loading states are actually visible while developing. */
export function simulateLatency(): Promise<void> {
  const delay = MOCK_CONFIG.LATENCY + Math.random() * MOCK_CONFIG.JITTER;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

/** Throws to simulate a transient server failure when a failure rate is configured. */
export function maybeSimulateFailure(): void {
  if (Math.random() < MOCK_CONFIG.FAILURE_RATE) {
    throw new AuthError('Network hiccup. Please try again.', { code: 'INTERNAL_ERROR' });
  }
}

export async function withMockNetwork<T>(produce: () => T | Promise<T>): Promise<T> {
  await simulateLatency();
  maybeSimulateFailure();
  return produce();
}
