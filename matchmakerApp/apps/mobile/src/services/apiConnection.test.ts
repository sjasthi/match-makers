/**
 * Integration: the app's own service layer against the FP2 backend and Postgres.
 *
 * This is the test that answers "is it actually connected?", and it is the only
 * one here that leaves the process. Every other suite in this workspace runs
 * against the mock database or renders a screen; this one calls
 * `services/auth`, `services/profile`, `services/posts`, `services/feed` and
 * `services/matches` exactly as a screen would, in `jwt` mode, over HTTP to
 * `apps/api` and into real tables.
 *
 * It is **skipped unless `RUN_API_TESTS=1`**, because it needs a live server and
 * a migrated database, and a test suite that fails for anyone who has not set
 * up Postgres is worse than no test at all.
 *
 *   # terminal 1
 *   npm run migrate --workspace=apps/api
 *   npm run dev --workspace=apps/api
 *   # terminal 2
 *   RUN_API_TESTS=1 npm test --workspace=apps/mobile
 *
 * It creates users with a unique suffix per run and deletes them afterwards, so
 * it is safe to re-run against a database that has real data in it. Everything
 * it creates is prefixed `itest.` and removed in `afterAll`.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const RUN = process.env.RUN_API_TESTS === '1';

/**
 * `EXPO_PUBLIC_AUTH_MODE` and `EXPO_PUBLIC_API_URL` are deliberately NOT set in
 * this file.
 *
 * `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` into the bundle at
 * *transform* time, which is how the real app gets its configuration.
 * Assigning them at the top of a test file is too late -- the modules under test
 * have already been transformed with whatever the environment held then -- so a
 * test that does that silently runs the mock branch and proves nothing. This
 * suite failed exactly that way on its first run: green assertions against the
 * AsyncStorage database.
 *
 * They come from the real process environment instead. `npm run test:api` in
 * `apps/mobile/package.json` sets both.
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const describeIfLive = RUN ? describe : describe.skip;

const RUN_ID = `itest.${Date.now().toString(36)}`;

describeIfLive('app services against apps/api + Postgres', () => {
  /* Loaded via `require` so the HTTP branch is the one under test rather than
   * the mock branch every other suite in this workspace uses. */
  /* eslint-disable @typescript-eslint/no-var-requires */
  const auth = require('@/services/auth');
  const profileService = require('@/services/profile');
  const postsService = require('@/services/posts');
  const feedService = require('@/services/feed');
  const matchesService = require('@/services/matches');

  const viewerEmail = `${RUN_ID}.viewer@test.local`;
  const candidateEmail = `${RUN_ID}.candidate@test.local`;
  /** Its own account, so the permission test does not depend on the deck test. */
  const strangerEmail = `${RUN_ID}.stranger@test.local`;

  /**
   * Makes the viewer an admin, by running the real CLI as a child process.
   *
   * The photo-library importer is admin-only, and this suite needs a post to
   * react to. There is deliberately no HTTP route that grants admin -- that is
   * the whole reason `scripts/admin.ts` exists -- so a test that wanted one
   * would have to shell out to the CLI exactly as a person does.
   *
   * Running it for real also means this exercises the grant path rather than
   * trusting the test can make itself privileged.
   */
  function grantAdmin(email: string): void {
    // `__dirname` is apps/mobile/src/services. Three levels up is the workspace
    // root (`apps`), four is the package root where node_modules lives.
    const repoRoot = join(__dirname, '../../../..');
    const apiDir = join(repoRoot, 'apps/api');

    execFileSync(join(repoRoot, 'node_modules/.bin/tsx'), ['scripts/admin.ts', 'grant', email], {
      cwd: apiDir,
      stdio: 'pipe',
    });
  }

  let viewerId = '';
  let candidateId = '';
  let strangerId = '';

  async function registerThroughTheApp(
    email: string,
    name: string,
    gender: 'female' | 'male',
    dateOfBirth: string
  ): Promise<string> {
    // `register` goes through JWTAuthAdapter, which is the code under test.
    const result = await auth
      .getAuthAdapter()
      .register({ email, password: 'Password1', name, dateOfBirth, gender });
    return result.user.id;
  }

  /**
   * A token for an account, fetched directly rather than through the adapter.
   *
   * Deliberately does not sign in, so cleanup cannot swap the stored credential
   * out from under whatever ran before it.
   */
  async function loginFor(email: string): Promise<string> {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'Password1' }),
    });
    const body = await response.json();
    return body.data?.tokens?.accessToken ?? '';
  }

  afterAll(async () => {
    // These use `fetch` rather than the app's services because they are cleanup
    // for the test itself, not app behaviour.
    //
    // `unwrap` is not optional here: raw `fetch` does not run the API client's
    // response interceptor, so the body still has its `{ data }` envelope on it.
    // Reading `.posts` off the envelope yields `undefined`, the cleanup loop
    // iterates nothing, and the test quietly leaves its posts behind for the
    // next run to trip over.
    const unwrap = async <T>(response: Response): Promise<T> => {
      const body = await response.json();
      return (body?.data ?? body) as T;
    };

    try {
      // Sign in as the viewer to delete: `DELETE /posts/:id` is admin-only, and
      // the last thing the suite did was swap to another account, so a bare
      // fetch gets a 403 and quietly leaves a post behind for the next run to
      // trip over. The viewer was granted admin earlier precisely so this suite
      // can put things in the library.
      const viewerToken = await loginFor(viewerEmail);

      const listing = await fetch(`${API_URL}/posts/feed`);
      if (listing.ok) {
        const { posts } = await unwrap<{
          posts: Array<{ id: string; tags: string[]; imageUri: string }>;
        }>(listing);
        for (const post of posts.filter(
          (p) =>
            p.tags.some((tag) => tag.startsWith(RUN_ID)) ||
            // The retag test's photo is tagged `sunset`/`beach` rather than with
            // the run id, so it is matched on its placeholder image instead.
            p.imageUri.startsWith('placeholder://itest')
        )) {
          await fetch(`${API_URL}/posts/${post.id}`, {
            method: 'DELETE',
            headers: { authorization: `Bearer ${viewerToken}` },
          });
        }
      }
    } catch {
      // A cleanup failure must not fail the suite's results.
    }

    // All three accounts, not just the two the happy path reaches. An earlier
    // version cleaned up only the ids it had captured, so a run that failed
    // partway left its account behind -- and the next run then saw a stranger in
    // its deck, which read as a bug in the eligibility query rather than as
    // leftover state.
    for (const id of [strangerId, candidateId, viewerId].filter(Boolean)) {
      try {
        await fetch(`${API_URL}/auth/dev/users/${id}`, { method: 'DELETE' });
      } catch {
        // As above.
      }
    }
  });

  beforeAll(async () => {
    // Required, and easy to miss: `bootstrapAuth` is what installs the auth
    // transport on the API client. Without it `getAuthAdapter()` still returns
    // the JWT adapter, every request still leaves the building, and no
    // `Authorization` header is ever attached -- so every authenticated call
    // comes back 401 while the adapter looks correct. `App.tsx` calls this on
    // startup; the test has to do the same.
    await auth.bootstrapAuth();
  });

  it('runs in HTTP mode, not mock', () => {
    // If this fails the whole suite is testing the mock and proving nothing.
    // This is the assertion that caught the inlined-env problem.
    expect(auth.getActiveAuthMode()).toBe('jwt');
  });

  it('registers through JWTAuthAdapter and stores a refresh token', async () => {
    viewerId = await registerThroughTheApp(viewerEmail, 'ITest Viewer', 'female', '1995-04-02');

    expect(auth.getActiveAuthMode()).toBe('jwt');
    expect(viewerId).toBeTruthy();

    // The importer is admin-only, so the viewer needs the flag before the photo
    // test below can put anything in the library.
    grantAdmin(viewerEmail);
  });

  it('refuses admin routes to an account that has not been granted admin', async () => {
    strangerId = await registerThroughTheApp(
      strangerEmail,
      'ITest Stranger',
      'female',
      '1993-03-03'
    );
    expect(strangerId).toBeTruthy();

    const token = await currentToken();
    const response = await fetch(`${API_URL}/admin/users`, {
      headers: { authorization: `Bearer ${token}` },
    });

    // 403, not 401: the token is valid and the account exists, it simply lacks
    // the role. A 401 here would mean `requireAuth` had not run before
    // `requireAdmin`.
    expect(response.status).toBe(403);

    const body = await response.json();
    expect(body.code).toBe('FORBIDDEN');
  });

  it('saves a profile through the app and reads it back from Postgres', async () => {
    // Sign in as the viewer explicitly. `register` also signs in, so whichever
    // account was created most recently currently holds the token -- and without
    // this the profile below was written to that one while the assertions still
    // passed, because they only ever look at what was just written.
    await auth.getAuthAdapter().login({ email: viewerEmail, password: 'Password1' });

    const updated = await profileService.updateProfile({
      bio: 'Integration test profile.',
      relationshipGoal: 'long_term',
      location: { latitude: 30.2672, longitude: -97.7431, city: 'Austin', country: 'US' },
      preferences: {
        ageRange: { min: 23, max: 45 },
        distanceMode: 'nearby',
        maxDistance: 50,
        genders: ['male'],
        relationshipGoals: ['long_term'],
      },
    });

    expect(updated.bio).toBe('Integration test profile.');
    expect(updated.location.city).toBe('Austin');
    expect(updated.preferences.genders).toEqual(['male']);

    // A second read, so this is the database and not the value just returned.
    const reread = await auth.getAuthAdapter().getCurrentUser();
    expect(reread?.bio).toBe('Integration test profile.');
    expect(reread?.location.city).toBe('Austin');
  });

  it('reads the photo library and records a reaction, which then survives a reload', async () => {
    // Signing back in as the viewer. The previous test registered the candidate,
    // and `register` also signs in -- so the stored token is now theirs, and they
    // were deliberately *not* granted admin. Importing needs the viewer, who was.
    await auth.getAuthAdapter().login({ email: viewerEmail, password: 'Password1' });

    const imported = await fetch(`${API_URL}/posts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await currentToken()}`,
      },
      body: JSON.stringify([
        { imageUri: 'placeholder://itest', tags: [`${RUN_ID}-pet`, `${RUN_ID}-nature`] },
      ]),
    });
    expect(imported.ok).toBe(true);

    const feed = await postsService.fetchPhotoFeed();
    expect(feed.posts.length).toBeGreaterThan(0);
    expect(feed.total).toBe(feed.posts.length);

    const target = feed.posts[0]!;
    const reaction = await postsService.reactToPost(target.id, 'like');
    expect(reaction.action).toBe('like');

    const reloaded = await postsService.fetchPhotoFeed();
    expect(reloaded.reactions[target.id]).toBe('like');

    const summary = await postsService.fetchTasteSummary();
    expect(summary.likes).toBeGreaterThan(0);

    const removed = await postsService.undoPostReaction(target.id);
    expect(removed).toBe(true);
  });

  it('hides unscored profiles and matches on reciprocal likes', async () => {
    candidateId = await registerThroughTheApp(
      candidateEmail,
      'ITest Candidate',
      'male',
      '1996-06-06'
    );

    // `register` also *signs in*, so the stored token is now the candidate's.
    // They get matching preferences of their own -- the gate is mutual, so an
    // unconfigured candidate is filtered out of everyone's deck -- and then the
    // viewer signs back in.
    await profileService.updateProfile({
      relationshipGoal: 'long_term',
      location: { latitude: 30.2672, longitude: -97.7431, city: 'Austin', country: 'US' },
      preferences: {
        ageRange: { min: 23, max: 45 },
        distanceMode: 'nearby',
        maxDistance: 50,
        genders: ['female'],
        relationshipGoals: ['long_term'],
      },
    });

    await auth.getAuthAdapter().login({ email: viewerEmail, password: 'Password1' });

    const page = await feedService.fetchFeed(1, 10);
    // The profile is eligible but has no photo-taste score, so it stays out of
    // the 80%+ deck until enough matching evidence exists.
    expect(page.items.map((item: { user: { id: string } }) => item.user.id)).not.toContain(
      candidateId
    );
    expect(page.needsTaste).toBe(true);

    const first = await feedService.sendSwipe(candidateId, 'like');
    expect(first.isMatch).toBe(false);

    // Swap to the candidate and swipe back.
    await auth.getAuthAdapter().login({ email: candidateEmail, password: 'Password1' });
    const back = await feedService.sendSwipe(viewerId, 'like');
    expect(back.isMatch).toBe(true);
    expect(back.matchId).toBeTruthy();

    const matches = await matchesService.fetchMatches();
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]!.user.email).toBe(viewerEmail);

    const sent = await matchesService.sendMessage(back.matchId!, 'hello from the integration test');
    expect(sent.content).toBe('hello from the integration test');

    const thread = await matchesService.fetchMessages(back.matchId!);
    expect(thread.length).toBeGreaterThan(0);

    await matchesService.unmatch(back.matchId!);
    expect(await matchesService.fetchMatches()).toHaveLength(0);
  });

  /*
   * CORS.
   *
   * This is the one failure mode nothing else in the repository could catch.
   * `curl` does not enforce it, and Jest's `XMLHttpRequest` is not a browser's,
   * so both talk to an API happily that a browser cannot reach. A browser
   * refuses the preflight before the request is sent -- which is why login
   * failed on web with `net::ERR_FAILED` while every automated check passed.
   *
   * So these assert response headers directly. The behaviour cannot be observed
   * from here, only its cause.
   */
  const preflight = (origin: string, headers: string) =>
    fetch(`${API_URL}/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': headers,
      },
    });

  it('saves edited tags, which used to be shown and then lost', async () => {
    // The viewer was granted admin earlier in this suite, which is what the
    // library needs.
    await auth.getAuthAdapter().login({ email: viewerEmail, password: 'Password1' });

    // A photo to retag.
    const created = await fetch(`${API_URL}/posts`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await currentToken()}`,
      },
      body: JSON.stringify([{ imageUri: 'placeholder://itest-tags', tags: ['Original'] }]),
    });
    const createdBody = await created.json();
    const postId = createdBody.data.ids[0] as string;
    expect(postId).toBeTruthy();

    const patched = await fetch(`${API_URL}/posts/${postId}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${await currentToken()}`,
      },
      body: JSON.stringify({ tags: ['Sunset', 'Beach', 'sunset'] }),
    });
    expect(patched.status).toBe(200);

    // Read it back through a different route, so this is the stored value and
    // not the one the PATCH happened to return.
    const readBack = await fetch(`${API_URL}/posts/${postId}`);
    const body = await readBack.json();

    // The edit stuck, and the tags were folded on the way in: `Sunset` and
    // `sunset` are one tag, not two.
    expect(body.data.tags).toEqual(['sunset', 'beach']);
  });

  it('answers a browser preflight from the Expo web origin', async () => {
    const response = await preflight('http://localhost:8081', 'content-type,authorization');

    expect(response.status).toBeLessThan(300);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');

    // `Authorization` is why a preflight is needed at all: it is not a
    // CORS-safelisted header, so no request carrying it is ever "simple".
    expect(response.headers.get('access-control-allow-headers')).toMatch(/authorization/i);
    expect(response.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });

  it('refuses an origin that is not on the allowlist', async () => {
    const response = await preflight('http://evil.example', 'content-type');

    // No `Access-Control-Allow-Origin` means the browser blocks it, which is the
    // intended outcome. It must not also be a 500: a policy decision arriving as
    // a server error is indistinguishable from an outage in a console.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.status).toBeLessThan(500);
  });

  it('sends CORS headers on a real response, not only on the preflight', async () => {
    const response = await fetch(`${API_URL}/health`, {
      headers: { Origin: 'http://localhost:8081' },
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
  });

  it('refuses a bad password without revealing whether the account exists', async () => {
    await expect(
      auth.getAuthAdapter().login({ email: viewerEmail, password: 'WrongPassword1' })
    ).rejects.toBeTruthy();

    await expect(
      auth.getAuthAdapter().login({ email: 'nobody@test.local', password: 'WrongPassword1' })
    ).rejects.toBeTruthy();
  });

  /** The stored access token, so the test can call the API directly too. */
  async function currentToken(): Promise<string> {
    const store = require('@/services/storage/keyValueStore').getSecretStore();
    return (await store.get('auth.access_token')) as string;
  }
});
