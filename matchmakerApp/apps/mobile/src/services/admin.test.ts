import { listAllUsers, getAdminUser, AdminUnavailableError } from './admin';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { hasCompleteQuestionnaire, isProfileComplete } from '@/services/profile';
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/utils/mockData';

jest.setTimeout(60_000);

async function seedAndSignIn(): Promise<MockAuthAdapter> {
  await mockDb.reset();
  const adapter = new MockAuthAdapter();
  await adapter.login({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  return adapter;
}

describe('admin service', () => {
  afterEach(async () => {
    await setActiveAuthMode('mock');
  });

  it('lists every seeded account', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();

    // One demo account plus the 20 seeded candidates.
    expect(users).toHaveLength(21);
  });

  it('never leaks a stored password', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();

    for (const summary of users) {
      expect(summary.user).not.toHaveProperty('password');
    }
  });

  it('flags the demo account and leaves candidates unflagged', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();
    const demos = users.filter((summary) => summary.isDemo);

    expect(demos).toHaveLength(1);
    expect(demos[0]?.user.email).toBe(DEMO_EMAIL);
  });

  it('sorts newest first', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();
    const timestamps = users.map((summary) => summary.user.createdAt);

    expect([...timestamps].sort((a, b) => b.localeCompare(a))).toEqual(timestamps);
  });

  it('derives completeness with the same predicates that gate the feed', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();

    // The panel must not reimplement these rules, or it would drift from what
    // the feed is actually willing to render.
    for (const summary of users) {
      expect(summary.isProfileComplete).toBe(isProfileComplete(summary.user));
      expect(summary.hasCompleteQuestionnaire).toBe(hasCompleteQuestionnaire(summary.user));
    }
  });

  it('includes a newly registered account', async () => {
    await seedAndSignIn();
    await new MockAuthAdapter().register({
      email: 'test.subject@example.com',
      password: 'Str0ngPass',
      name: 'Test Subject',
      dateOfBirth: '1994-02-02',
      gender: 'female' as never,
    });

    const users = await listAllUsers();

    expect(users).toHaveLength(22);
    const registered = users.find((summary) => summary.user.email === 'test.subject@example.com');
    expect(registered).toBeDefined();
    // A blank registration is exactly what the inspector exists to show.
    expect(registered?.isProfileComplete).toBe(false);
    expect(registered?.hasCompleteQuestionnaire).toBe(false);
  });

  it('reads one record in full and strips the password', async () => {
    await seedAndSignIn();

    const found = await getAdminUser('user_demo');

    expect(found?.email).toBe(DEMO_EMAIL);
    expect(found).not.toHaveProperty('password');
  });

  it('returns null for an unknown id', async () => {
    await seedAndSignIn();

    expect(await getAdminUser('user_does_not_exist')).toBeNull();
  });

  it('refuses to read anything outside mock mode', async () => {
    await seedAndSignIn();
    await setActiveAuthMode('jwt');

    await expect(listAllUsers()).rejects.toThrow(AdminUnavailableError);
    await expect(getAdminUser('user_demo')).rejects.toThrow(AdminUnavailableError);
  });
});
