import { questionnaireSchema } from '@match-makers/shared';
import type { User, VerificationStatus } from '@match-makers/shared';
import { APP_CONFIG } from '@/constants';
import { getAuthAdapter } from '@/services/auth';
import { getApiClient } from '@/services/api/client';

/**
 * True once the questionnaire is a whole, valid answer set, which is what makes
 * a match percentage meaningful.
 *
 * The schema is the source of truth rather than a hand-rolled field check, so
 * this stays honest as the questionnaire grows: a half-graded value or a deal
 * breaker that is not in the picked list fails here exactly as it would on the
 * server.
 *
 * This is not what gates the feed. Prompts are answered progressively, so a
 * partially answered questionnaire is a normal state rather than an error.
 */
export function hasCompleteQuestionnaire(user: User | null): boolean {
  if (!user?.questionnaire) return false;
  return questionnaireSchema.safeParse(user.questionnaire).success;
}

/**
 * True once the questionnaire is answered enough to be matched on.
 *
 * This is what gates the deck, not `isProfileComplete`. Account creation ends
 * without it and the feed opens onto the questionnaire instead, because the
 * answer set is a long one and asking for it up front is what we were trying to
 * get away from.
 */

/** True while the profile is too incomplete to show in the feed. */
export function isProfileComplete(user: User | null): boolean {
  if (!user) return false;
  const hasBasics = Boolean(user.bio.trim()) && hasLocation(user);
  const hasPhoto = user.photos.some((photo) => photo.isPrimary) || user.photos.length > 0;
  const hasPreferences =
    user.preferences.genders.length > 0 && user.preferences.relationshipGoals.length > 0;
  return hasBasics && hasPhoto && hasPreferences;
}

/**
 * Whether a profile holds a place as well as a name.
 *
 * City only, deliberately, and this is looser than it should end up being. The
 * distance rules can do nothing with a city name: a profile at `0,0` is excluded
 * from everyone else's nearby deck, because that is genuinely 10,000 km from
 * them. Requiring coordinates here would block signing up for anyone whose town
 * is not in `cityCatalog`, which is a hand-maintained table of about forty
 * cities and not a geocoder.
 *
 * So onboarding accepts the name and leaves the profile visible to its owner,
 * who the rules treat as global and who therefore still gets a full deck. The
 * cost is that this person is invisible to nearby viewers until their city is
 * recognised or they use GPS. The permanent fix is a real geocoder on the
 * backend; until then, the honest thing is to say so on the location step
 * rather than refuse to let anybody in.
 */
function hasLocation(user: User): boolean {
  return Boolean(user.location.city.trim());
}

/**
 * The sections still outstanding, in the order the questionnaire asks them.
 *
 * Order matters: onboardingSteps maps the first entry to a route, so a user
 * deep linked to the end of the flow lands on the step they actually missed
 * rather than the first one alphabetically.
 *
 * The intent step is deliberately absent. "Not sure yet" and "prefer not to
 * say" are both real answers that the intent screen offers, and a freshly
 * registered account holds the same placeholder values, so there is no value
 * left to tell the two apart. Treating those answers as missing would nag
 * people for answering honestly. The step is still mandatory to pass through,
 * it just does not gate the feed.
 */
export function getMissingProfileSections(user: User | null): string[] {
  if (!user) return [...APP_CONFIG.ONBOARDING_STEPS];
  const missing: string[] = [];
  if (!user.bio.trim()) missing.push('bio');
  if (user.photos.length === 0) missing.push('photos');
  if (!hasLocation(user)) missing.push('location');
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
