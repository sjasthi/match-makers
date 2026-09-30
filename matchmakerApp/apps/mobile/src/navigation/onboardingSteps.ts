import type { OnboardingStackParamList } from './types';

/** Which onboarding step fixes a given missing profile section. */
export const STEP_FOR_SECTION: Record<string, keyof OnboardingStackParamList> = {
  bio: 'Basics',
  photos: 'Photos',
  preferences: 'Preferences',
  location: 'Location',
};

/**
 * Resolves the first step a user still needs to visit, given the output of
 * `getMissingProfileSections`. Returns undefined when nothing is missing.
 */
export function firstIncompleteStep(
  missing: readonly string[]
): keyof OnboardingStackParamList | undefined {
  const first = missing[0];
  if (!first) return undefined;
  return STEP_FOR_SECTION[first];
}
