import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as rtlWaitFor,
} from '@testing-library/react-native';
import App from '../../../App';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { getAuthAdapter } from '@/services/auth';
import { mockDb } from '@/services/mock/database';
import { useAuthStore } from '@/stores/authStore';
import { useFeedStore, useMatchesStore } from '@/stores/feedStore';
import { usePhotoFeedStore } from '@/stores/photoFeedStore';
import { isProfileComplete } from '@/services/profile';
import { hasCoordinates } from '@/utils/distance';
import { Gender, RelationshipGoal, type Photo } from '@match-makers/shared';

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
  usePhotoFeedStore.getState().reset();
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

/**
 * Moves from the landing photo feed to the Likes tab.
 *
 * Creation finishes on the feed rather than on any taste questionnaire, so
 * every assertion about the deck has to cross the tab bar first.
 */
async function openLikesTab() {
  // The tab bar settles a beat after the flow's last save replaces the root
  // stack, so it is waited for rather than assumed. Without this the press races
  // the navigator and fails intermittently on whichever test happens to get
  // there first.
  await waitFor(() => expect(screen.getByText('Likes')).toBeTruthy());
  fireEvent.press(screen.getByText('Likes'));
  // The deck is empty until the first like, so the building-up strip is not
  // guaranteed either. The subtitle is, in both states.
  await waitFor(() =>
    expect(screen.getByText(/Tap somebody to look|Your deck gathers here/)).toBeTruthy()
  );
}

describe('account creation', () => {
  it('finishes on the photo feed with nothing to answer first', async () => {
    await registerAndRender();
    await completeCreation();

    // The feed is the landing page and needs nothing answered to be usable, so
    // a finished signup lands there with something to do rather than on a form.
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const user = await storedUser();
    // Nothing about taste has to be collected before the app is usable, so the
    // account they just made has answered no photos. The seeded candidates still
    // carry their own reactions, so this is scoped to the new account's id
    // rather than counting the whole library.
    const reactions = (await mockDb.allPostReactions()).filter(
      (reaction) => reaction.userId === user?.id
    );
    expect(reactions).toHaveLength(0);
    expect(isProfileComplete(user ?? null)).toBe(true);
  });

  it('never asks a taste question anywhere in creation', async () => {
    await registerAndRender();
    await completeCreation();
    await openLikesTab();

    // The questionnaire used to end signup. Every one of these strings lived on
    // it, and they must not come back as a fresh gate now that taste is inferred
    // from photos instead.
    expect(screen.queryByText('Day to day')).toBeNull();
    expect(screen.queryByText('I want kids')).toBeNull();
    expect(screen.queryByText('Day to day, the unglamorous stuff')).toBeNull();
  });

  it('gives a brand new account an empty deck that says why, not a weak card', async () => {
    await registerAndRender();
    await completeCreation();
    await openLikesTab();

    // The decision the whole change turns on, reversed. A new account has no
    // likes, so the only points left to rank on are the twenty of stated fact,
    // and the first card this account would have seen was an "11% match, not
    // enough to go on" that taught anybody who read it that the percentage meant
    // nothing. An empty deck that names the fix is the honest shape.
    // Waited for rather than read directly: `openLikesTab` returns as soon as
    // the subtitle settles, which is before the deck fetch resolves, and the
    // store is empty-but-unlabelled in between.
    await waitFor(() =>
      expect(screen.getByText('Nothing to rank your matches on yet')).toBeTruthy()
    );
    expect(screen.queryByTestId(/^deck-card-/)).toBeNull();
    // The strip is for a deck that exists. On an empty one the empty state says
    // the same thing and links to the same place, twice over would be noise.
    expect(screen.queryByTestId('likes-building-up')).toBeNull();
    // No questionnaire prompt either. What stands between a new account and
    // cards is one photo like, and the empty state says so in those words.
    expect(screen.queryByText('What matters to you?')).toBeNull();
  });

  it('opens the deck on the first like, with no questionnaire prompt anywhere', async () => {
    await registerAndRender();
    await completeCreation();

    // Widened before the deck is opened, because what this test is about is
    // whether a questionnaire prompt stands between a new account and its cards.
    // Creation leaves the account on its chosen filters (one gender, a 24-38
    // range, a 50km radius), and whether a twenty row random seed leaves anyone
    // matching all three is a coin toss. That makes the card assertion pass or
    // fail on the seed instead of on the behaviour.
    // Through the adapter, not `mockDb.saveUser`: the running app reads the
    // session out of the auth store, which a direct storage write leaves stale.
    const adapter = getAuthAdapter();
    const stored = (await adapter.getCurrentUser())!;
    await adapter.updateProfile({
      preferences: {
        ...stored.preferences,
        genders: [Gender.FEMALE, Gender.MALE, Gender.NON_BINARY],
        ageRange: { min: 18, max: 99 },
        relationshipGoals: [
          RelationshipGoal.LONG_TERM,
          RelationshipGoal.SHORT_TERM,
          RelationshipGoal.CASUAL,
          RelationshipGoal.FRIENDSHIP,
          RelationshipGoal.NOT_SURE,
        ],
        distanceMode: 'global',
      },
    });

    // The one thing the deck gates on: a like. Recorded as the feed would
    // record it, before the tab is opened, so the deck loads with taste to rank
    // on. `stored` is the fresh account, already in scope from the widening.
    const posts = await mockDb.allPosts();
    await mockDb.recordPostReaction(stored.id, posts[0]!.id, 'like');

    await openLikesTab();

    // The old failure mode was a questionnaire prompt where the cards should be.
    // The gate now is a single like, and the empty state says so in those words,
    // so nothing else is allowed to stand between a person and their deck.
    expect(screen.queryByText('What matters to you?')).toBeNull();
    // Waited for rather than read directly: the grid arrives on the feed fetch
    // after the tab settles, so reading a card straight away races it.
    await waitFor(() => expect(screen.getAllByTestId(/^deck-card-/).length).toBeGreaterThan(0));
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
    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const user = await storedUser();
    expect(user?.location.city).toBe('Bradford');
    expect(user?.location.country).toBe('United Kingdom');
    expect(isProfileComplete(user ?? null)).toBe(true);
  });

  it('resolves a city it does know to real coordinates', async () => {
    await createWithTypedCity('Rotterdam', 'Netherlands');

    await waitFor(() => expect(screen.getByTestId('photo-grid')).toBeTruthy());

    const user = await storedUser();
    expect(hasCoordinates(user!.location)).toBe(true);
    expect(user?.location.city).toBe('Rotterdam');
  });
});
