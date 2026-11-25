# Match Makers

This document describes the implementation currently in this repository. It is
based on the source, package manifests, SQL schema, and scripts—not on an
assumption that every optional test or a production deployment has been run.
Items labelled **Known gaps** are behaviours or limitations visible in the
current code.

The app's Expo display name is **Match Makers**. The workspace package is still
named `match-makers-fp3`; this README avoids assigning a project-phase number
because the existing documentation uses both FP3 and FP4.

## What the system is

Match Makers is an Expo/React Native app with a TypeScript Express API and a
PostgreSQL database. The app uses the API for normal runtime authentication,
profiles, discovery, photo reactions, matches, messages, and admin operations.
The API stores relational data and computes/caches the match scores used to order
the Likes deck.

```text
Expo app (iOS, Android, web)
       │ HTTP + signed bearer access token
       │ WebSocket invalidations for matches/messages
       ▼
Express API ─────── PostgreSQL
                     ├── profiles and preferences
                     ├── photo library and reactions
                     ├── swipes, matches, and messages
                     └── taste vectors and cached match scores
```

There is no mock backend mode in the normal app runtime: the app selects the
API-backed adapter outside tests. The repository retains an AsyncStorage-backed
mock adapter/database and mock service branches for Jest fixtures.

## Stack

| Concern              | Current implementation                                                                  |
| -------------------- | --------------------------------------------------------------------------------------- |
| Client               | React Native 0.73.6, Expo SDK 50, React 18.2                                            |
| Navigation           | React Navigation 6                                                                      |
| Language             | TypeScript 5; strict mode and `noUncheckedIndexedAccess`                              |
| UI                   | React Native Paper 5 with an MD3 theme; safe-area support                               |
| Client state         | Zustand stores for auth/session, discovery feed, matches, and photo feed                |
| Forms and validation | react-hook-form, Zod, and `@hookform/resolvers`                                       |
| Client networking    | Axios client plus async service modules; no server-state query library                  |
| API                  | Express 4, TypeScript executed with `tsx`, `pg`, and hand-written SQL               |
| Realtime             | `ws` WebSockets, with PostgreSQL `LISTEN`/`NOTIFY` as the event source            |
| Database             | PostgreSQL with plain SQL DDL; no ORM                                                   |
| Shared package       | `@match-makers/shared`: domain types, Zod schemas, API types, and tag rules           |
| Tests                | Jest/Jest Expo for mobile and shared code; Node's test runner via `tsx` for API tests |

The selected Expo, React Native, React, React Navigation, and Jest Expo versions
are a compatible generation. Expo SDK 50 is an older SDK, however; upgrading it
should be a coordinated Expo/RN/dependency upgrade rather than changing React
Native independently.

**Runtime version caveat:** the root `package.json` advertises Node `>=18`, but
the documented local API setup loads `apps/api/.env` with
`process.loadEnvFile`, which is available starting in Node 20.12. Use Node
20.12+ for that setup, or update the loader and the engine declaration together.

**PostgreSQL version caveat:** the code uses PostgreSQL-specific SQL, but this
repository does not pin a PostgreSQL server major version or provision one with
Docker Compose. The README should not be read as proof that a particular local
server is PostgreSQL 18.

## Repository layout

```text
matchmakerApp/
├── apps/
│   ├── api/
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── migrate.ts
│   │   │   └── perf-dataset.sql
│   │   ├── scripts/
│   │   │   ├── admin.ts
│   │   │   ├── backfill-affinity.ts
│   │   │   ├── rescore.ts
│   │   │   └── perf*.ts
│   │   └── src/
│   │       ├── db/                 Row mapping and user queries
│   │       ├── routes/             Express route handlers
│   │       ├── auth.ts             Access/refresh tokens and auth middleware
│   │       ├── affinity.ts         Stored per-user photo-tag vectors
│   │       ├── matching.ts         SQL scoring and score-cache maintenance
│   │       ├── eligibility.ts      SQL discovery requirements
│   │       ├── realtime.ts         WebSocket notifications
│   │       ├── env.ts              API environment loading and validation
│   │       └── server.ts           Express application and startup
│   ├── mobile/
│   │   ├── App.tsx
│   │   ├── assets/
│   │   └── src/
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── navigation/
│   │       ├── screens/
│   │       ├── services/
│   │       ├── stores/
│   │       ├── types/
│   │       └── utils/
│   └── shared/
│       └── src/                    Shared types, validation, and tag helpers
└── tools/
    └── eslint-config/
```

The message and match routers are both defined in
`apps/api/src/routes/matches.ts`; there is not a separate `routes/messages.ts`.
The admin CLI is `apps/api/scripts/admin.ts` (not under `apps/api/db`).

## App behaviour

The signed-in app has five main tabs:

1. **Photos** — a paged, tag-filterable masonry grid over the platform photo
   library, with a full-screen viewer. Likes and passes can be undone.
2. **Likes** — a grid of high-scoring, mutually eligible profiles; tapping a
   person opens the like/pass/super-like decision view.
3. **Matches** — reciprocal likes and match details.
4. **Messages** — conversations with unread counts and read state.
5. **Profile** — profile editing, discovery preferences, taste profile, settings,
   and verification submission.

Onboarding collects the account's profile and discovery inputs, including
relationship goal, sexual orientation, location, photos, and preferences. The
client navigator sends incomplete sessions through onboarding; the API validates
profile updates and applies discovery eligibility to feed requests.

### Authentication

- The normal app selects `JWTAuthAdapter`; the mock adapter is selectable only
  in tests.
- Login and registration return a one-hour HMAC-signed access token and a
  30-day opaque refresh token.
- The app sends access tokens as `Authorization: Bearer ...`. Its Axios response
  interceptor refreshes an expired access token and retries the request.
- Refresh tokens are stored hashed in PostgreSQL and rotated on refresh. Passwords
  are hashed with Node's `scrypt`; `PASSWORD_PEPPER` is an optional additional
  server-side secret.
- Logout revokes refresh tokens, but an already-issued stateless access token
  remains valid until its one-hour expiry.
- On iOS and Android, tokens use Expo SecureStore. On web, the current fallback
  is AsyncStorage, which is not encrypted and is not suitable as a production
  secrets store.

`EXPO_PUBLIC_AUTH_MODE` is a test control, not a production authentication
switch. Jest setup forces mock mode unless `RUN_API_TESTS=1`; the integration
test uses JWT mode and the live API.

**Token-format note:** `JWTAuthAdapter` is the adapter's class name, but the API
currently issues a project-specific two-part `payload.signature` HMAC token. It
does not include the JWT header segment and should not be assumed to be a
standards-compliant JWT or interchangeable with JWT tooling.

### Discovery eligibility

The API's `eligibilitySql` applies requirements in both directions. A candidate
must satisfy the viewer's preferences, and the viewer must satisfy the
candidate's preferences. The current API checks:

- age range;
- selected genders;
- relationship goals;
- distance mode/radius when applicable; and
- mutual sexual-orientation compatibility.

The profile goal `not_sure` is a distinct goal, not a wildcard. A person who
wants to see unsure profiles must select `not_sure` or choose `Any goal`.
`Any gender` and `Any goal` are stored as the full set of available values. The
UI requires an explicit choice; empty preference lists are reserved for
unconfigured/legacy data, which the eligibility query treats as unrestricted.

These rules are **eligibility gates**, not points in the match score. A good
photo-taste score cannot override a failed gate. The API computes distance with a
Haversine expression in SQL; it does not use PostGIS or a spatial index.
Location comes from GPS or a client-side centroid lookup in the hand-maintained
`cityCatalog`; there is no server geocoder. An unrecognized city can be saved
with the `0,0` placeholder. The current API treats an unset location on either
side as bypassing the distance comparison, which can allow an unlocated profile
through a nearby filter; the test mock handles a target with no coordinates
differently.

### Photo taste and match scoring

Photo reactions are the matching signal. The API stores each user's tag counts
in `user_tag_affinity`, a summary in `user_taste_summary`, and pair scores in
`match_scores`. The score is computed in SQL and read by the Likes deck; it is
not recomputed over every candidate on each feed request.

For a pair:

```text
co_like_overlap = shared_liked_photos / (shared_liked_photos + 2)

tag_weight(user, tag) =
  max(0, likes - dislikes) × ln(1 + total_library_photos / photos_with_tag)

tag_similarity = cosine similarity of the two positive tag-weight vectors

confidence = min(1, min(user_A_likes, user_B_likes) / 5)

affinity = confidence × (0.65 × co_like_overlap + 0.35 × tag_similarity)
score    = round(100 × affinity)
```

The API rounds the affinity and score in its SQL ranking query. A dislike lowers
that user's net opinion of the photo's tags; two people disliking the same photo
does not count as a shared like. A pair with no useful taste evidence does not
qualify for the Likes deck.

Deck admission uses two thresholds to prevent a card from flickering in and
out:

- a pair enters at **80**;
- after it has been revealed, it remains while its score is at least **75**;
- the score bands are `90+`, `75+`, `50+`, and `below-50`.

The API's `needsTaste` flag stays true until the viewer has at least ten likes.
The Likes-screen progress strip and Taste Profile screen instead count all
liked **and passed** photos as “answered,” so those progress displays and the
API flag use different counts.

Reaction writes update the actor's tag vector and rescore both stored directions
for pairs involving that user in the same transaction. Retagging a photo and
deleting a photo rebuild vectors and scores for users who reacted to that photo;
see cache maintenance below for the broader invalidation those operations
require.

## API

Successful responses are wrapped as `{ "data": ... }`; the mobile client unwraps
that envelope centrally. Errors use the shared API error shape. Request bodies
are validated with Zod, using shared schemas where their shape matches the
request; several request-specific schemas remain local to the API.

| Method and path                                    | Purpose                                                                  | Access                    |
| -------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------- |
| `GET /health`                                    | Checks API and database with `SELECT 1`                                | Public                    |
| `POST /auth/register`                            | Create account and issue tokens                                          | Public                    |
| `POST /auth/login`                               | Sign in                                                                  | Public                    |
| `POST /auth/refresh`                             | Rotate refresh token                                                     | Public                    |
| `POST /auth/logout`                              | Revoke refresh token(s)                                                  | Authenticated             |
| `GET /auth/me`                                   | Read current user                                                        | Authenticated             |
| `DELETE /auth/dev/users/:userId`                 | Integration-test cleanup                                                 | Non-production only       |
| `PATCH /profile`                                 | Update profile, preferences, and profile photos                          | Authenticated             |
| `GET /profile/verification`                      | Read current verification state                                          | Authenticated             |
| `POST /profile/verification`                     | Submit an image for manual review                                        | Authenticated             |
| `GET /feed`                                      | Read the Likes discovery deck                                            | Authenticated             |
| `POST /swipes`                                   | Record a like, pass, or super-like; only reciprocal likes create a match | Authenticated             |
| `GET /matches`                                   | List matches, latest message preview, unread counts                      | Authenticated             |
| `DELETE /matches/:matchId`                       | Unmatch                                                                  | Authenticated participant |
| `GET /messages/:matchId`                         | Read conversation                                                        | Authenticated participant |
| `POST /messages/:matchId`                        | Send a text message (up to 4,000 characters)                             | Authenticated participant |
| `POST /messages/:matchId/read`                   | Mark incoming messages read                                              | Authenticated participant |
| `GET /posts/feed`                                | Read platform photo library and caller's reactions                       | Optional auth             |
| `GET /posts/taste`                               | Read caller's taste summary                                              | Authenticated             |
| `GET /posts`                                     | Read photo-library count                                                 | Public                    |
| `GET /posts/:postId`                             | Read one library photo                                                   | Public                    |
| `POST /posts/reactions`                          | Like or dislike a library photo                                          | Authenticated             |
| `DELETE /posts/reactions/:postId`                | Undo a reaction                                                          | Authenticated             |
| `POST /posts`                                    | Import photos into the library                                           | Admin                     |
| `PATCH /posts/:postId`                           | Edit a photo's tags                                                      | Admin                     |
| `DELETE /posts/:postId`                          | Delete a photo and its reactions                                         | Admin                     |
| `GET /admin/users`, `GET /admin/users/:userId` | Inspect accounts                                                         | Admin                     |
| `GET /admin/posts`, `GET /admin/tags`          | Inspect photo library and tags                                           | Admin                     |
| `GET /admin/verifications/pending`               | Review queue                                                             | Admin                     |
| `POST /admin/verifications/accept`               | Approve a submission                                                     | Admin                     |
| `POST /admin/verifications/decline`              | Reject a submission with a reason                                        | Admin                     |

Admin access is a boolean `users.is_admin`. The API's admin routes require both
authentication and that flag. The flag is changed by the database-backed CLI,
not by an HTTP grant route.

## Database

`apps/api/db/schema.sql` defines PostgreSQL enums, tables, indexes, constraints,
and foreign keys. The main tables are:

| Tables                                                          | Data                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| `users`, `user_preferences`, `photos`                     | Accounts, discovery preferences, profile photos   |
| `posts`, `post_images`, `post_reactions`                  | Platform photo library, renditions, and reactions |
| `user_tag_affinity`, `user_taste_summary`, `match_scores` | Derived taste data and cached rankings            |
| `swipes`, `matches`, `messages`                           | Discovery decisions and conversations             |
| `refresh_tokens`                                              | Hashed, revocable refresh tokens                  |
| `verification_submissions`                                    | Submitted images and admin review state           |

Important constraints include one reaction per user/photo, one swipe per
ordered pair, and a canonical ordering for the two user IDs in a match. SQL
transactions are used for multi-statement operations such as profile changes,
reaction updates, and message creation.

`posts` is the platform-owned photo library and has no `user_id`; users' answers
to those photos are stored separately in `post_reactions`.

`apps/api/db/migrate.ts` applies the current `schema.sql` in a transaction using
the `pg` driver. It does not require the `psql` client. The schema is designed to
be rerunnable for its guarded types/tables/indexes; this is **not** a versioned
migration framework. Changing enum labels or making a non-idempotent schema
change needs a deliberate migration.

## Realtime updates

The API serves WebSockets on the same HTTP server at `/ws`. A connection
authenticates with the same short-lived access token used by HTTP; because a
browser WebSocket handshake cannot set authorization headers, the client sends
the token in the URL query string. Avoid logging full WebSocket URLs. The server
currently emits:

- `match_created` when a reciprocal like creates a match;
- `message` when a conversation message is saved; and
- `ready` after a socket is authenticated.

PostgreSQL `LISTEN`/`NOTIFY` carries the invalidation to the API process; clients
then refetch authoritative data over HTTP. The notification is not durable, so
clients refetch after reconnecting. The mobile client retries connections and
the focused Matches, Messages, and Chat screens poll when realtime is
unavailable. This is not push notification delivery to a closed app.

## Photos, tags, and verification

### Photo storage

`expo-image-picker` and `expo-image-manipulator` prepare profile and library
images. The admin library importer offers Auto (up to 4096 pixels), Grid (640),
Feed (1200), and Large (2048) targets. It writes JPEG at quality 0.9. Auto mode
targets a 1.5 MB raw-byte budget where the code can measure bytes (web); native
file sizes are not measured. Profile photos are resized separately to 1200
pixels, and profiles allow at most six photos.

The mobile admin importer limits a batch to 12 photos. The API request body is
limited to 12 MB, but the API import schema does not independently enforce the
same 12-item batch limit.

Library imports can include a 640-pixel thumbnail and smaller renditions (640,
1280, and 2560 pixels); a rendition is omitted when it would not be smaller than
the full image. The client selects a rendition based on display width and pixel
ratio.

This is image processing, **not hosted image storage**:

- On native platforms the stored URI is a `file://` path in the app's media
  cache. The API stores the URI string; it does not upload the file to shared
  object storage.
- On web, image data can be stored as a data URI. This increases database and
  request sizes; the API JSON body limit is 12 MB.
- A native file URI is local to the device and is not a durable URL another
  user's device can fetch.

### Tags and reactions

Tags are free text. The mobile admin service validates and normalizes them with
`@match-makers/shared`: trim, collapse whitespace, lowercase, and apply a
guarded trailing-`s` fold. The fold is a heuristic, not a stemmer; for example,
`news` folds to `new`. Posts require 1–8 tags, with a 24-character tag limit in
the shared schema. A user's answer is one `like` or `dislike` per photo; undo
deletes the reaction rather than storing a neutral value.
The current photo feed has no comments or comment-reaction model/route.

The API's tag-edit endpoint uses that shared normalization schema, but its
photo-import route uses a local schema that only checks for 1–8 non-empty tag
strings. The normal mobile path sends normalized tags; a direct API caller can
currently bypass the canonicalization and length limit.

### Verification

A user submits an image and receives `pending` status. An admin can accept or
decline it; only acceptance sets the verified badge. The image is stored in
`verification_submissions` as data, not in an image-hosting service. A reviewed
photo is not proof of legal identity.

## Local development

Run commands from the `matchmakerApp` workspace root.

### 1. Install dependencies

Use Node 20.12+ for the API's `.env` loading path, then install the npm
workspaces:

```bash
npm install
```

### 2. Configure the API

Copy the tracked example and set `DATABASE_URL` to a PostgreSQL database you
control:

```bash
cp apps/api/.env.example apps/api/.env
```

The example uses a local database at `127.0.0.1:5432/matchmakers`. Create the
role/database if needed, for example:

```bash
sudo -u postgres psql -c "CREATE ROLE matchmakers WITH LOGIN PASSWORD 'choose-a-local-password';"
sudo -u postgres psql -c "CREATE DATABASE matchmakers OWNER matchmakers;"
```

Set `AUTH_SECRET` to a unique, non-empty secret. The example leaves it blank;
that blank is accepted as an empty string rather than activating the code's
default, so do not leave it blank. One way to generate a local value is:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

The production guard rejects the built-in development secret, but setting a
secret yourself is still required. `PASSWORD_PEPPER` is optional.
`CORS_ORIGINS` is a comma-separated allowlist for browser origins.

### 3. Configure the mobile app

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

`EXPO_PUBLIC_API_URL` is the API base URL and defaults to
`http://localhost:3001`. Expo embeds `EXPO_PUBLIC_*` values into the app bundle:
they are public configuration, not secrets. When running on a physical phone,
replace `localhost` with an address reachable from that phone.

The mobile and API `.env` files are separate. `.env` files are gitignored;
`.env.example` files are tracked.

### Environment variables

| Variable                          | Where                                    | Meaning                                                                    |
| --------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`           | `apps/mobile/.env`                     | API base URL; defaults in app code to `http://localhost:3001`            |
| `EXPO_PUBLIC_AUTH_MODE`         | Tests only                               | Jest may select `mock` or `jwt`; normal app runtime always selects JWT |
| `EXPO_PUBLIC_MOCK_LATENCY`      | Jest/mock fixture                        | Mock request base latency in milliseconds; code default `350`            |
| `EXPO_PUBLIC_MOCK_JITTER`       | Jest/mock fixture                        | Mock request jitter in milliseconds; code default `250`                  |
| `EXPO_PUBLIC_MOCK_FAILURE_RATE` | Jest/mock fixture                        | Mock request failure probability from `0` to `1`; code default `0`   |
| `DATABASE_URL`                  | `apps/api/.env` or process environment | Required PostgreSQL connection string                                      |
| `PORT`                          | API                                      | Listen port; default `3001`                                              |
| `NODE_ENV`                      | API                                      | `development`, `test`, or `production`; default `development`      |
| `AUTH_SECRET`                   | API                                      | Signs access tokens; set a unique, non-empty value in production           |
| `PASSWORD_PEPPER`               | API                                      | Optional additional input to password hashing                              |
| `CORS_ORIGINS`                  | API                                      | Comma-separated browser-origin allowlist                                   |

Expo values with the `EXPO_PUBLIC_` prefix are embedded in the client bundle.
Never put database credentials, signing secrets, or other server-only secrets
there.

### 4. Apply the schema and start both services

In one terminal:

```bash
npm run migrate --workspace=apps/api
npm run dev --workspace=apps/api
```

The API defaults to port `3001`. In another terminal:

```bash
npm run dev
```

Press `w` for web, `a` for Android, or `i` for iOS in Expo. The database starts
empty: register accounts through the app and import photos as an admin.

For web, the browser enforces CORS. The API's default allowlist includes common
Expo development origins; add the actual origin to `CORS_ORIGINS` if Expo picks
a different port. Native iOS/Android requests are not subject to browser CORS.

### Admin access

Register the intended account in the app first, then grant it from the API
workspace:

```bash
npm run admin --workspace=apps/api -- list
npm run admin --workspace=apps/api -- grant you@example.com
npm run admin --workspace=apps/api -- revoke you@example.com
```

The admin UI can manage the photo library and review verification submissions.
There is no seed/demo admin account in the PostgreSQL setup.

## Scripts and tests

| Command                                                     | What it does                                              |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                                             | Start Expo mobile/web development server                  |
| `npm run dev --workspace=apps/api`                        | Start API on `PORT` (default `3001`)                  |
| `npm run build`                                           | Export the mobile app for web; not a native release build |
| `npm run typecheck`                                       | Run workspace TypeScript checks                           |
| `npm run lint`                                            | Run workspace ESLint scripts                              |
| `npm test`                                                | Run workspace test scripts                                |
| `npm run format`                                          | Run Prettier write over matching workspace source/docs    |
| `npm run test --workspace=apps/api`                       | API tests with Node's test runner via `tsx`             |
| `npm run test:api --workspace=apps/mobile`                | App service integration test against live API/PostgreSQL  |
| `npm run migrate --workspace=apps/api`                    | Apply `apps/api/db/schema.sql`                          |
| `npm run admin:backfill --workspace=apps/api`             | Rebuild tag vectors from reaction rows                    |
| `npm run rescore --workspace=apps/api`                    | Rebuild stored scores for all accounts                    |
| `npm run rescore --workspace=apps/api -- you@example.com` | Rebuild scores for one account                            |
| `npm run perf --workspace=apps/api`                       | Run the API performance check                             |
| `npm run perf:compare --workspace=apps/api`               | Compare ranking query plans/timings                       |

The API test script uses `tsx --test`; it is not a Jest suite. Its realtime
integration tests skip when the database cannot be reached, but API modules
still require a valid `DATABASE_URL` at startup. The mobile `test:api` suite is
opt-in: it needs a migrated database and a running API on the configured URL.
It creates uniquely named test accounts and removes them afterward. The
ordinary Jest setup pins the app to mock mode.

No test result is asserted by this document; run the relevant command in your
environment to verify it.

## Cache maintenance and operational details

`match_scores` is a derived cache. Reactions and changes to eligibility-affecting
profile fields (date of birth, gender, orientation, relationship goal, location,
or discovery preferences) rescore the acting user's pair scores in both
directions. Photo imports do not rescore anyone; retagging and deleting a photo
rebuild vectors and scores only for users who reacted to that photo.

After a change to the eligibility rules themselves, run a full `rescore` once so
existing accounts receive scores under the new rules.

That targeted work does not refresh every score affected by a photo-library
change: tag weights use the library-wide photo count and per-tag frequencies,
so importing, retagging, or deleting a photo can change scores for users who did
not react to that particular photo. After any photo-library mutation, run a full
rescore to reflect the current corpus:

```bash
# A photo-library change, or after rebuilding affinity vectors:
npm run rescore --workspace=apps/api
```

`npm run admin:backfill --workspace=apps/api` rebuilds tag vectors from
`post_reactions`; it does not rebuild `match_scores`. Run the full rescore after
a backfill as well.

## Test fixture behavior

The mock adapter/database are still in the repository for Jest tests; they are
not selected by normal app runtime. Some test-fixture behavior intentionally
differs from the live API:

- the mock computes a `closest` list in taste summaries; the live API currently
  returns `closest: []` from `/posts/taste`;
- the mock provides more detailed empty-deck blocker explanations than the API;
- for a nearby viewer, the mock excludes a target with no usable coordinates,
  while the API SQL bypasses the distance comparison if either side has no
  coordinates; and
- the mock can simulate a match, while the live API creates one only after
  reciprocal likes.

These are test-double differences, not alternate runtime product modes.

## Known gaps and production cautions

These points are intentionally explicit so the README does not imply more than
the current code provides:

1. **The live taste summary does not populate “closest” people.** The API's
   `/posts/taste` currently returns an empty `closest` list (and does not
   calculate the mock's `closestBlockedByFilters`). The corresponding UI can
   show tag/count summaries but not those server-backed recommendations.
2. **The live empty-deck explanation is coarse.** It distinguishes no other
   accounts, eligible accounts without a strong score, and no currently eligible
   accounts; it does not identify which specific filter blocked the candidates.
3. **Photo-library score-cache invalidation is incomplete.** Post imports do not
   rescore, and post retag/delete routes only rescore direct reactors even though
   corpus-wide tag weights change. Run a full `rescore` after photo-library
   changes to refresh all accounts.
4. **Nearby filtering has an unlocated-profile gap.** The city catalog is
   incomplete, and unknown cities are stored as `0,0`. The API treats that
   sentinel as no location and bypasses distance comparison, so it may show an
   unlocated profile in a nearby deck despite the onboarding copy suggesting
   otherwise.
5. **The API does not enforce all client workflow gates.** The client navigator
   routes incomplete users through onboarding, but `GET /feed` requires
   authentication and does not check profile completeness. `POST /swipes`
   validates the target and reciprocal-like rule but does not re-check discovery
   eligibility; direct API callers can swipe on off-filter profiles.
6. **Password reset is only a UI placeholder.** The forgot-password screen
   validates an email and displays a success state, but there is no API route or
   mail transport to send a reset link.
7. **No daily swipe limit is enforced by the API.** `SWIPE_LIMIT_DAILY` exists
   as a mobile constant, but no current server route or middleware applies it.
8. **Registration validation differs at the API boundary.** The mobile form
   applies the shared password-strength and age-range rules, but the API's
   registration schema currently accepts any non-empty password and date string
   (subject to PostgreSQL parsing the date). Direct API callers can bypass the
   stricter form validation.
9. **Image hosting is not implemented.** Native photo paths are local cache
   URIs, and web data URIs can make database rows and requests large. There is
   no object store, CDN, or durable cross-device media URL.
10. **Email exposure needs review before a real launch.** The current discovery
    candidate mapping and match-list response include full `User` records,
    including email addresses. The API should expose a restricted public-user
    shape before handling real user data.
11. **Web token storage is not encrypted.** The web `getSecretStore()` fallback
    is AsyncStorage. Treat it as a development/prototype implementation.
12. **The development cleanup route is unauthenticated outside production.**
    `DELETE /auth/dev/users/:userId` is hidden only when `NODE_ENV=production`;
    never expose a non-production API to untrusted callers.
13. **Realtime is transient, not push.** PostgreSQL notifications are not
    durable, WebSockets require a running/open client, and there is no push
    notification service. Clients recover by refetching/polling.
14. **No spatial database or spatial index.** Distance checks use a Haversine
    expression over ordinary latitude/longitude columns. There is an ordinary
    B-tree index on those columns, but it is not a spatial index.
15. **Request schemas are not fully aligned across client and API.** `photoSchema`
    describes a picker result while the persisted `Photo` type is different;
    `postReactionSchema` describes a stored reaction rather than the
    `{ postId, action }` request. The API uses local schemas for those cases.
    Also, the API photo-import schema does not canonicalize direct tag input.
    Mobile forms/services apply stricter shared validation, but direct API
    callers can bypass some of those rules.
16. **The schema is not a migration history.** `schema.sql` is a repeatable
    initial-schema script for guarded objects; changes to existing enums and
    production data need explicit migration planning.
17. **Server environment metadata needs alignment.** Root `engines` says Node
    `>=18`, while local `.env` loading needs Node 20.12+.

These are implementation limitations, not incompatibilities between the main
technologies. They do mean the current system is a working capstone/prototype,
not a production-hardened dating service.
