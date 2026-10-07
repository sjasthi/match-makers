import { MockAuthAdapter } from './MockAuthAdapter';
import { mockDb } from '@/services/mock/database';
import { fetchFeed, sendSwipe } from '@/services/feed';
import { fetchMatches, sendMessage, fetchMessages } from '@/services/matches';
import { getAuthAdapter } from '@/services/auth';
import { DEMO_EMAIL, DEMO_PASSWORD, ageFromDateOfBirth } from '@/utils/mockData';
import { distanceKm } from '@/utils/distance';
import {
  Gender,
  ImportanceScale,
  PromptTag,
  PromptChoice,
  PartnerValue,
  emptyLifestyle,
  questionnaireSchema,
  type Location,
  type User,
  type UserQuestionnaire,
} from '@match-makers/shared';
import { isProfileComplete } from '@/services/profile';

/** Where the demo account sits. Everything nearby is measured from here. */
const AUSTIN: Location = {
  latitude: 30.2672,
  longitude: -97.7431,
  city: 'Austin',
  country: 'United States',
};

async function othersApartFromDemo(): Promise<Array<User & { password: string }>> {
  return (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');
}

async function seedAndSignIn(): Promise<MockAuthAdapter> {
  await mockDb.reset();
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  return adapter;
}

describe('MockAuthAdapter', () => {
  it('signs in with the seeded demo account', async () => {
    const adapter = await seedAndSignIn();

    const user = await adapter.getCurrentUser();
    expect(user?.email).toBe(DEMO_EMAIL);
    expect(user).not.toHaveProperty('password');
  });

  it('rejects a wrong password', async () => {
    await seedAndSignIn();
    const adapter = new MockAuthAdapter();

    await expect(adapter.login({ email: DEMO_EMAIL, password: 'nope' })).rejects.toThrow(
      'Invalid email or password'
    );
  });

  it('registers a new account with a blank profile', async () => {
    await mockDb.reset();
    const adapter = new MockAuthAdapter();

    const result = await adapter.register({
      email: 'new.person@example.com',
      password: 'Str0ngPass',
      name: 'New Person',
      dateOfBirth: '1994-02-02',
      gender: Gender.FEMALE,
    });

    expect(result.user.email).toBe('new.person@example.com');
    expect(result.user.bio).toBe('');
    expect(result.user.photos).toHaveLength(0);
    expect(result.tokens?.accessToken).toMatch(/^mock\./);
  });

  it('leaves a new account without a questionnaire so onboarding cannot be skipped', async () => {
    await mockDb.reset();
    const adapter = new MockAuthAdapter();

    const result = await adapter.register({
      email: 'no.questionnaire@example.com',
      password: 'Str0ngPass',
      name: 'No Questionnaire',
      dateOfBirth: '1994-02-02',
      gender: Gender.FEMALE,
    });

    expect(result.user.questionnaire).toBeUndefined();
    expect(isProfileComplete(result.user)).toBe(false);
  });

  it('round-trips a questionnaire through updateProfile', async () => {
    const adapter = await seedAndSignIn();

    const questionnaire: UserQuestionnaire = {
      values: [PartnerValue.KINDNESS, PartnerValue.AMBITION],
      importance: {
        [PartnerValue.KINDNESS]: ImportanceScale.NON_NEGOTIABLE,
        [PartnerValue.AMBITION]: ImportanceScale.IMPORTANT,
      },
      dealBreakers: [PartnerValue.KINDNESS],
      prompts: [
        { promptId: 'family', tag: PromptTag.FAMILY, choice: PromptChoice.YES },
        { promptId: 'kitchen', tag: PromptTag.FOOD, choice: PromptChoice.SOMETIMES },
      ],
      lifestyle: emptyLifestyle(),
    };

    const updated = await adapter.updateProfile({ questionnaire });

    expect(updated.questionnaire).toEqual(questionnaire);
    expect(questionnaireSchema.safeParse(updated.questionnaire).success).toBe(true);
    // And it has to survive a fresh read, not just sit in the returned object.
    const reread = await adapter.getCurrentUser();
    expect(reread?.questionnaire?.values).toEqual(questionnaire.values);
  });

  it('refuses a duplicate email', async () => {
    await mockDb.reset();
    const adapter = new MockAuthAdapter();
    const payload = {
      email: 'dupe@example.com',
      password: 'Str0ngPass',
      name: 'Dupe',
      dateOfBirth: '1994-02-02',
      gender: Gender.FEMALE,
    };

    await adapter.register(payload);
    const second = new MockAuthAdapter();
    await expect(second.register(payload)).rejects.toThrow('already exists');
  });

  it('drops the session on logout', async () => {
    const adapter = await seedAndSignIn();
    await adapter.logout();

    expect(await adapter.getCurrentUser()).toBeNull();
    await expect(adapter.refresh()).rejects.toThrow('session has expired');
  });
});

describe('feed service (mock)', () => {
  it('only returns candidates the viewer has not swiped on', async () => {
    const adapter = await seedAndSignIn();
    const viewer = await adapter.getCurrentUser();
    expect(viewer).not.toBeNull();

    const first = await fetchFeed(1, 5);
    expect(first.items.length).toBeGreaterThan(0);
    expect(first.items.every((user) => user.id !== viewer?.id)).toBe(true);

    const target = first.items[0];
    expect(target).toBeDefined();
    await sendSwipe(target!.id, 'pass');

    const second = await fetchFeed(1, 5);
    expect(second.items.map((user) => user.id)).not.toContain(target!.id);
  });

  it('orders the feed by compatibility score', async () => {
    const adapter = await seedAndSignIn();
    const viewer = (await adapter.getCurrentUser())!;

    const page = await fetchFeed(1, 10);
    const ages = page.items.map((user) => {
      const dob = new Date(user.dateOfBirth);
      return new Date().getFullYear() - dob.getFullYear();
    });

    // The demo viewer's preference window is 24-38, so nothing outside it leaks in.
    for (const age of ages) {
      expect(age).toBeGreaterThanOrEqual(24);
      expect(age).toBeLessThanOrEqual(38);
    }
    expect(viewer).toBeDefined();
  });
});

describe('feed requirements (mock)', () => {
  async function feedFor(preferences: Partial<User['preferences']>): Promise<string[]> {
    await seedAndSignIn();
    const adapter = getAuthAdapter();
    const viewer = (await adapter.getCurrentUser())!;
    await adapter.updateProfile({ preferences: { ...viewer.preferences, ...preferences } });
    const page = await fetchFeed(1, 50);
    return page.items.map((user) => user.id);
  }

  it('shows nobody beyond the stated distance', async () => {
    // The regression this whole feature exists to prevent: maxDistance used to
    // be collected, stored, displayed and never compared to anything.
    const ids = await feedFor({ distanceMode: 'nearby', maxDistance: 50 });
    const others = (await mockDb.allUsers()).filter((user) => user.id !== 'user_demo');

    for (const id of ids) {
      const person = others.find((user) => user.id === id)!;
      expect(distanceKm(AUSTIN, person.location)).toBeLessThanOrEqual(50);
    }
  });

  it('widens the deck when the viewer switches to global', async () => {
    const nearby = await feedFor({ distanceMode: 'nearby', maxDistance: 50 });
    const global = await feedFor({ distanceMode: 'global', maxDistance: 50 });

    expect(nearby.length).toBeGreaterThan(0);
    expect(global.length).toBeGreaterThan(nearby.length);

    // Global really does mean everywhere, not just a larger radius: at least
    // someone on the other side of the planet has to appear.
    const distant = (await othersApartFromDemo())
      .filter((user) => distanceKm(AUSTIN, user.location) > 2000)
      .map((user) => user.id);
    expect(distant.length).toBeGreaterThan(0);
    for (const id of distant) {
      expect(global).toContain(id);
    }
  });

  it('shows fewer people as the radius shrinks', async () => {
    const wide = await feedFor({ distanceMode: 'nearby', maxDistance: 45 });
    const tight = await feedFor({ distanceMode: 'nearby', maxDistance: 5 });
    expect(tight.length).toBeLessThanOrEqual(wide.length);
  });

  it('keeps the same people when the radius does not change', async () => {
    // Global ignores the radius, so changing it while global must not silently
    // re-filter the deck the person is looking at.
    const first = await feedFor({ distanceMode: 'global', maxDistance: 5 });
    const second = await feedFor({ distanceMode: 'global', maxDistance: 500 });
    expect(second).toEqual(first);
  });

  it('hides someone whose own requirements exclude the viewer', async () => {
    await seedAndSignIn();
    const adapter = getAuthAdapter();
    const viewer = (await adapter.getCurrentUser())!;

    // Age is the lever here rather than gender: the demo account is
    // prefer_not_to_say, which the rules treat as "we cannot rule them out",
    // so a gender list could never actually exclude them.
    const picky = (await othersApartFromDemo())[0]!;
    expect(ageFromDateOfBirth(viewer.dateOfBirth)).toBeLessThan(40);
    await mockDb.saveUser({
      ...picky,
      preferences: { ...picky.preferences, ageRange: { min: 40, max: 55 }, distanceMode: 'global' },
    });

    await adapter.updateProfile({ preferences: { ...viewer.preferences, distanceMode: 'global' } });

    const page = await fetchFeed(1, 50);
    expect(page.items.map((user) => user.id)).not.toContain(picky.id);
  });

  it('explains an empty deck instead of showing a blank screen', async () => {
    // An age range nobody on a twenty row seed can satisfy. The feed has to say
    // this is your filter rather than leaving it to look like an empty app.
    const ids = await feedFor({ ageRange: { min: 18, max: 19 } });
    expect(ids).toEqual([]);

    await seedAndSignIn();
    const adapter = getAuthAdapter();
    const viewer = (await adapter.getCurrentUser())!;
    await adapter.updateProfile({
      preferences: { ...viewer.preferences, ageRange: { min: 18, max: 19 } },
    });

    const page = await fetchFeed(1, 50);
    expect(page.blockedReason).toContain('age range');
  });

  it('says nothing about blocking on a healthy deck', async () => {
    // Otherwise page two of a full deck would claim everyone is filtered out.
    await seedAndSignIn();
    const page = await fetchFeed(1, 10);
    expect(page.blockedReason).toBeNull();
  });

  it('blames already swiped rather than a setting when that is the cause', async () => {
    await seedAndSignIn();
    const first = await fetchFeed(1, 50);
    expect(first.items.length).toBeGreaterThan(0);

    // Recorded straight to storage rather than through sendSwipe: this is about
    // what the feed reports once everything has been seen, not about the swipe
    // service, and nineteen sequential round trips would time the test out.
    for (const user of first.items) {
      await mockDb.recordSwipe('user_demo', user.id, 'pass');
    }

    const page = await fetchFeed(1, 50);
    expect(page.items).toEqual([]);
    // Naming a setting here would send people to widen something that was never
    // the problem.
    expect(page.blockedReason).toContain('already swiped');
  });
});

describe('matches service (mock)', () => {
  it('creates a match and a conversation when a like is reciprocated', async () => {
    await seedAndSignIn();
    const page = await fetchFeed(1, 5);
    const target = page.items[0]!;

    // Force the happy path rather than relying on the 35% match chance.
    const originalRandom = Math.random;
    Math.random = () => 0.1;
    let outcome;
    try {
      outcome = await sendSwipe(target.id, 'like');
    } finally {
      Math.random = originalRandom;
    }

    expect(outcome.isMatch).toBe(true);
    expect(outcome.matchId).toBeDefined();

    const matches = await fetchMatches();
    expect(matches.some((match) => match.user.id === target.id)).toBe(true);

    const sent = await sendMessage(outcome.matchId!, 'Hello there');
    expect(sent.isMine).toBe(true);
    expect(sent.content).toBe('Hello there');

    const thread = await fetchMessages(outcome.matchId!);
    expect(thread.length).toBeGreaterThan(0);
    expect(thread[thread.length - 1]?.content).toBe('Hello there');
  });

  it('does not create a match for a pass', async () => {
    await seedAndSignIn();
    const page = await fetchFeed(1, 3);
    const target = page.items[0]!;

    const originalRandom = Math.random;
    Math.random = () => 0.9;
    let outcome;
    try {
      outcome = await sendSwipe(target.id, 'pass');
    } finally {
      Math.random = originalRandom;
    }

    expect(outcome.isMatch).toBe(false);
    expect(outcome.matchId).toBeUndefined();
  });
});
