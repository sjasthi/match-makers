import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import App from '../../../App';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { mockDb } from '@/services/mock/database';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import { getMissingProfileSections, isProfileComplete } from '@/services/profile';
import { hasCoordinates } from '@/utils/distance';
import { Gender, type Photo } from '@match-makers/shared';

jest.setTimeout(180_000);

/**
 * RNTL's waitFor defaults to a 1000ms budget, which is not enough for a test
 * that renders the whole app and walks a flow. Every call in this file gets a
 * real budget so a slow run fails loudly rather than flaking.
 */
function waitFor(callback: () => unknown, options?: { timeout?: number }) {
  return rtlWaitFor(callback, { timeout: 30_000, ...options });
}

const NEW_ACCOUNT = {
  email: 'flow.tester@example.com',
  password: 'Str0ngPass',
  name: 'Flow Tester',
  dateOfBirth: '1994-02-02',
  gender: Gender.FEMALE,
};

/** One photo, since the creation flow refuses to continue without one. */
const PHOTO: Photo = { id: 'p1', url: 'file://photo.jpg', isPrimary: true, order: 0 };

// Rendering the app inside a test leaves navigator state behind, and a stale
// root can satisfy a screen query before the work under test has landed.
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await mockDb.reset();
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
});

beforeEach(async () => {
  useAuthStore.setState({ state: 'unknown', user: null, error: null });
  useFeedStore.getState().reset();
  useMatchesStore.getState().reset();
  await mockDb.reset();
});

function pressChip(label: string | RegExp) {
  fireEvent.press(screen.getByText(label));
}

function storedUser() {
  return mockDb.findUserByEmail(NEW_ACCOUNT.email);
}

/**
 * Registers an account that already has a photo and a location, because
 * picking a photo needs the native image picker and the location fields have
 * no placeholder to target. That leaves creation as four Continue presses,
 * which is the part actually worth testing here.
 */
async function registerAndRender() {
  await new MockAuthAdapter().register({ ...NEW_ACCOUNT });
  const stored = (await storedUser())!;
  await mockDb.saveUser({
    ...stored,
    photos: [PHOTO],
    location: { ...stored.location, city: 'Austin', country: 'United States' },
  });

  render(<App />);
  await waitFor(() => expect(screen.getByText('Get started')).toBeTruthy());
}

/**
 * The same, but with no location seeded, so the location step has to be typed.
 *
 * The seeded variant above cannot cover it: the city fields have no placeholder
 * to target and prefilled values are not what a person types.
 */
async function registerAndRenderWithoutLocation() {
  await new MockAuthAdapter().register({ ...NEW_ACCOUNT });
  const stored = (await storedUser())!;
  await mockDb.saveUser({ ...stored, photos: [PHOTO] });

  render(<App />);
  await waitFor(() => expect(screen.getByText('Get started')).toBeTruthy());
}

/**
 * Walks account creation end to end. Everything but the photo is prefilled, so
 * the only interaction is adding one and confirming.
 */
async function completeCreation() {
  fireEvent.press(screen.getByText('Get started'));
  await waitFor(() => expect(screen.getByText('About you')).toBeTruthy());
  // The bio is required for a complete profile, and it is optional on the step
  // itself, so leaving it out lands on the summary's "Almost there".
  fireEvent.changeText(screen.getByPlaceholderText('What are you into?'), 'Here for the quiz.');
  fireEvent.press(screen.getByText('Continue'));

  // Register leaves the goal on a placeholder, and the intent step insists on
  // an explicit answer, so this one is not just a Continue.
  await waitFor(() => expect(screen.getByText('What are you looking for?')).toBeTruthy());
  pressChip('Long term');
  fireEvent.press(screen.getByText('Continue'));

  // Photos and location are seeded, so both steps are a single press.
  await waitFor(() => expect(screen.getByText('Add photos')).toBeTruthy());
  fireEvent.press(screen.getByText('Continue'));

  // The location step also collects who you want to see and what you are
  // looking for, and register leaves both empty, so each needs a choice.
  await waitFor(() => expect(screen.getByText('Where are you?')).toBeTruthy());
  pressChip('Women');
  pressChip('Long term');
  fireEvent.press(screen.getByText('Finish setup'));
}

describe('account creation', () => {
  it('finishes without asking anything about the questionnaire', async () => {
    await registerAndRender();
    await completeCreation();

    // The profile is complete the moment the last step saves, so the feed takes
    // over directly rather than through a summary screen.
    await waitFor(() => expect(screen.getByText('What matters to you?')).toBeTruthy());

    const user = await storedUser();
    expect(user?.questionnaire).toBeUndefined();
    // Creation does not gate on the questionnaire: it is answered in the feed.
    expect(isProfileComplete(user ?? null)).toBe(true);
    expect(getMissingProfileSections(user ?? null)).not.toContain('prompts');
  });

  it('never mentions the questionnaire during creation', async () => {
    await registerAndRender();
    await completeCreation();

    await waitFor(() => expect(screen.getByText('What matters to you?')).toBeTruthy());
    expect(screen.queryByText('Day to day')).toBeNull();
    expect(screen.queryByText('I want kids')).toBeNull();
    expect(screen.queryByText('Day to day, the unglamorous stuff')).toBeNull();
  });

  it('shows nothing matchable before the questionnaire is answered', async () => {
    await registerAndRender();
    await completeCreation();

    await waitFor(() => expect(screen.getByText('Values (0/5)')).toBeTruthy());
    // No percentage anywhere, and no swipe actions: there is nothing to be
    // matched on until the questionnaire is answered.
    expect(screen.queryByText(/\d+%/)).toBeNull();
    expect(screen.queryByTestId('swipe-like')).toBeNull();
  });
});

describe('a city the app cannot place on the map', () => {
  /**
   * Walks creation, typing the city by hand instead of having it seeded.
   *
   * `cityCatalog` is a hand-maintained table of about forty cities, so most
   * places on earth miss it. Refusing to save in that case meant anyone outside
   * the table could not finish signing up, which is a worse bug than having no
   * coordinates.
   */
  async function createWithTypedCity(city: string, country: string) {
    await registerAndRenderWithoutLocation();

    fireEvent.press(screen.getByText('Get started'));
    await waitFor(() => expect(screen.getByText('About you')).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText('What are you into?'), 'Here for the quiz.');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(screen.getByText('What are you looking for?')).toBeTruthy());
    pressChip('Long term');
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(screen.getByText('Add photos')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));

    await waitFor(() => expect(screen.getByText('Where are you?')).toBeTruthy());
    fireEvent.changeText(screen.getByTestId('location-city'), city);
    fireEvent.changeText(screen.getByTestId('location-country'), country);
    pressChip('Women');
    pressChip('Long term');
    fireEvent.press(screen.getByText('Finish setup'));
  }

  it('says so rather than pretending the lookup worked', async () => {
    await registerAndRenderWithoutLocation();

    fireEvent.press(screen.getByText('Get started'));
    await waitFor(() => expect(screen.getByText('About you')).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText('What are you into?'), 'Here for the quiz.');
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(screen.getByText('What are you looking for?')).toBeTruthy());
    pressChip('Long term');
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(screen.getByText('Add photos')).toBeTruthy());
    fireEvent.press(screen.getByText('Continue'));
    await waitFor(() => expect(screen.getByText('Where are you?')).toBeTruthy());

    fireEvent.changeText(screen.getByTestId('location-city'), 'Bradford');
    fireEvent.changeText(screen.getByTestId('location-country'), 'United Kingdom');

    // Without this the save looks like it worked and the only symptom is that
    // the person never turns up in anyone else's nearby deck.
    await waitFor(() =>
      expect(screen.getByText(/We do not know where Bradford is yet/)).toBeTruthy()
    );
  });

  it('saves the city and finishes signup anyway', async () => {
    await createWithTypedCity('Bradford', 'United Kingdom');

    // The flow completes rather than bouncing back to the location step, which
    // is what blocking on the save would have caused.
    await waitFor(() => expect(screen.getByText('What matters to you?')).toBeTruthy());

    const user = await storedUser();
    expect(user?.location.city).toBe('Bradford');
    expect(user?.location.country).toBe('United Kingdom');
    expect(isProfileComplete(user ?? null)).toBe(true);
  });

  it('resolves a city it does know to real coordinates', async () => {
    await createWithTypedCity('Rotterdam', 'Netherlands');

    await waitFor(() => expect(screen.getByText('What matters to you?')).toBeTruthy());

    const user = await storedUser();
    expect(hasCoordinates(user!.location)).toBe(true);
    expect(user?.location.city).toBe('Rotterdam');
  });
});
