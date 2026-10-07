import { STEP_FOR_SECTION, firstIncompleteStep } from './onboardingSteps';
import type { OnboardingStackParamList } from './types';
import { APP_CONFIG } from '@/constants';
import { getMissingProfileSections } from '@/services/profile';

/**
 * `getMissingProfileSections` and `STEP_FOR_SECTION` are two halves of a
 * lookup the app relies on for its deep links: a profile with a gap has to
 * resolve to a route that exists. A key that is missing from the map resolves
 * to undefined and the "finish your profile" button silently does nothing,
 * which no other test would catch.
 */
describe('onboardingSteps', () => {
  it('maps every gated section to a real route', () => {
    for (const section of APP_CONFIG.ONBOARDING_STEPS) {
      expect(STEP_FOR_SECTION[section]).toBeDefined();
    }
  });

  it('has no map entries for sections that are never reported as missing', () => {
    const reported = new Set(['bio', 'photos', 'location', 'preferences']);
    for (const section of Object.keys(STEP_FOR_SECTION)) {
      expect(reported.has(section)).toBe(true);
    }
  });

  it('never maps to the questionnaire, which is not an onboarding section', () => {
    expect(STEP_FOR_SECTION.prompts).toBeUndefined();
  });

  it('resolves preferences to the location step', () => {
    // FP3 moved the age range and distance onto the location step, so that is
    // where a missing preference is fixed during onboarding.
    expect(firstIncompleteStep(['preferences'])).toBe('Location');
  });

  it('takes the first gap when several are missing', () => {
    expect(firstIncompleteStep(['photos', 'location', 'bio'])).toBe('Photos');
  });

  it('returns undefined when nothing is missing', () => {
    expect(firstIncompleteStep([])).toBeUndefined();
  });

  it('agrees with the sections getMissingProfileSections reports', () => {
    const sections = getMissingProfileSections(null);
    expect(sections.length).toBeGreaterThan(0);
    // Every reported section must resolve, so no "finish your profile" button
    // can end up navigating nowhere.
    for (const section of sections) {
      expect(STEP_FOR_SECTION[section]).toBeDefined();
    }
    expect(firstIncompleteStep(sections)).toBeDefined();
  });
});

describe('route names', () => {
  it('every mapped route actually exists', () => {
    // Prompts is a root-stack route, which is why STEP_FOR_SECTION is typed
    // FixableStep rather than a key of the onboarding param list.
    const routes: Array<keyof OnboardingStackParamList> = [
      'Welcome',
      'Basics',
      'Intent',
      'Photos',
      'Location',
      'OnboardingDone',
    ];
    for (const route of Object.values(STEP_FOR_SECTION)) {
      expect(routes).toContain(route);
    }
  });
});
