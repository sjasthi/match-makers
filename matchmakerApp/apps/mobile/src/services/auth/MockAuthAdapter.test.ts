import { MockAuthAdapter } from './MockAuthAdapter';
import { mockDb } from '@/services/mock/database';
import { fetchFeed, sendSwipe } from '@/services/feed';
import { fetchMatches, sendMessage, fetchMessages } from '@/services/matches';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';
import { Gender } from '@match-makers/shared';

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
