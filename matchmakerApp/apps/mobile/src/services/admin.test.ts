import { listAllUsers, getAdminUser, AdminUnavailableError } from './admin';
import { mockDb } from '@/services/mock/database';
import { MockAuthAdapter } from '@/services/auth/MockAuthAdapter';
import { setActiveAuthMode } from '@/services/auth';
import { isProfileComplete } from '@/services/profile';
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

  it('does not add demo-specific metadata to accounts', async () => {
    await seedAndSignIn();

    const users = await listAllUsers();
    expect(users.every((summary) => !('isDemo' in summary))).toBe(true);
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
    // A freshly registered account has answered no photos, so the matcher has
    // nothing from it yet.
    expect(registered?.answeredPhotos).toBe(0);
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

  /*
   * In `jwt` mode these go to the API, which is what the HTTP branches in
   * `admin.ts` now do.
   *
   * There is no server in this suite, so the calls fail with a network error --
   * and that is precisely the thing worth asserting. The previous version of
   * this file asserted the opposite: that the service *refused* outside mock
   * mode. It used to throw `AdminUnavailableError`, which was correct while the
   * admin routes did not exist, and stopped being correct the moment they did.
   *
   * What matters is that it tries the network rather than quietly answering from
   * the mock database. Reading 20 seeded profiles when the caller asked for the
   * real accounts would be the failure that looks like success.
   */
  it('asks the API rather than the mock database in jwt mode', async () => {
    await seedAndSignIn();
    await setActiveAuthMode('jwt');

    // Mock mode returned the 21 seeded accounts. A jwt-mode call that somehow
    // still read the mock database would resolve rather than reject.
    await expect(listAllUsers()).rejects.toThrow();
    await expect(getAdminUser('user_demo')).rejects.toThrow();

    // And it must not be the old "only works in mock mode" refusal either --
    // that would mean the HTTP branch was never reached.
    await expect(listAllUsers()).rejects.not.toThrow(AdminUnavailableError);
  });

  it('still answers from the mock database in mock mode', async () => {
    await seedAndSignIn();

    // The guard against the test above silently passing: mock mode is untouched
    // by the HTTP branches.
    expect(await listAllUsers()).toHaveLength(21);
  });
});
