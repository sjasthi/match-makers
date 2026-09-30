import type { User, VerificationStatus } from '@match-makers/shared';
import { APP_CONFIG } from '@/constants';
import { getAuthAdapter } from '@/services/auth';
import { getApiClient } from '@/services/api/client';

/** True while the profile is too incomplete to show in the feed. */
export function isProfileComplete(user: User | null): boolean {
  if (!user) return false;
  const hasBasics = Boolean(user.bio.trim()) && Boolean(user.location.city);
  const hasPhoto = user.photos.some((photo) => photo.isPrimary) || user.photos.length > 0;
  const hasPreferences =
    user.preferences.genders.length > 0 && user.preferences.relationshipGoals.length > 0;
  return hasBasics && hasPhoto && hasPreferences;
}

export function getMissingProfileSections(user: User | null): string[] {
  const missing: string[] = [];
  if (!user) return ['basics', 'preferences', 'location'];
  if (!user.bio.trim()) missing.push('bio');
  if (user.photos.length === 0) missing.push('photos');
  if (!user.location.city) missing.push('location');
  if (user.preferences.genders.length === 0) missing.push('preferences');
  if (user.preferences.relationshipGoals.length === 0) missing.push('preferences');
  return [...new Set(missing)];
}

export const photoLimit = APP_CONFIG.MAX_PHOTOS;

export async function updateProfile(updates: Partial<User>): Promise<User> {
  return getAuthAdapter().updateProfile(updates);
}

export async function fetchVerificationStatus(): Promise<VerificationStatus> {
  return getAuthAdapter().getVerificationStatus();
}

/**
 * Stand-in for a real verification submission. The FP1 notes called for a
 * low-friction proof flow, so this only records intent and flips the badge.
 */
export async function submitVerification(method: VerificationStatus['method']) {
  const adapter = getAuthAdapter();
  if (adapter.mode === 'mock') {
    const user = await adapter.getCurrentUser();
    if (!user) throw new Error('Not signed in');
    const updated = await adapter.updateProfile({ isVerified: true });
    return { status: 'verified' as const, method, user: updated };
  }
  const response = await getApiClient().post<VerificationStatus>('/profile/verification', {
    method,
  });
  return { status: response.data.status, method, user: null };
}
