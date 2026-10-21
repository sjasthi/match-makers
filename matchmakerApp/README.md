# Match Makers — FP4

Frontend prototype for the dating app described in FP2. This is a **skeleton**:
every screen, service and store exists and is wired together, but there is no
backend yet. Data comes from an in-app mock database, so the whole product can be
clicked through before the Express/Postgres/Redis API is built.

## Stack

| Concern      | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| Client       | React Native (Expo SDK 50) + React Navigation 6            |
| Language     | TypeScript, strict mode with `noUncheckedIndexedAccess`    |
| State        | Zustand (session, deck, photo feed, matches)                |
| Server state | Plain async service functions behind the auth transport    |
| Forms        | react-hook-form + Zod, with schemas shared with the server |
| UI           | react-native-paper (MD3)                                   |
| Database     | PostgreSQL 18, plain SQL DDL, no ORM                       |
| API          | Express 4 + `pg`, sharing `@match-makers/shared` types     |
| Testing      | Jest + `@testing-library/react-native`                     |

## Layout

```
match-makers-fp3/
├── apps/
│   ├── api/               Express API + PostgreSQL (FP2 backend)
│   │   ├── db/
│   │   │   ├── schema.sql The schema: enums, tables, indexes, constraints
│   │   │   ├── migrate.ts Applies schema.sql, reading the same .env
│   │   │   └── scripts/admin.ts   Grant/revoke/list admin from the CLI
│   │   └── src/
│   │       ├── admin.ts     requireAdmin, reading users.is_admin
│   │       ├── auth.ts      Access and refresh tokens
│   │       ├── cors.ts      Browser CORS, mounted first
│   │       ├── db.ts        Pool, transactions, `pg` type parsers
│   │       ├── errors.ts    ApiError + Postgres error-code mapping
│   │       ├── password.ts  scrypt hashing and verification
│   │       ├── db/          Row -> domain type mapping, user queries
│   │       └── routes/      health, auth, profile, feed, swipes, matches, messages, posts
│   ├── mobile/            Expo app
│   │   ├── App.tsx        Providers: SafeArea, Paper, Navigation
│   │   ├── assets/        Placeholder icons
│   │   └── src/
│   │       ├── components/   SwipeCard, PhotoPostCard, PostActions, Avatar...
│   │       ├── constants/     Colours, spacing, env config
│   │       ├── hooks/        Store selectors, useAsync
│   │       ├── navigation/   Root, Auth, Onboarding, MainTabs, Profile, Chat
│   │       ├── screens/      auth / onboarding / main / profile / admin / chat
│   │       ├── services/     auth adapters, api client, posts, mock backend
│   │       ├── stores/       Zustand stores
│   │       ├── types/        App-level view types
│   │       └── utils/        mock data, compatibility scoring, taste affinity
│   └── shared/            Types + Zod schemas used by client and server
└── tools/
    └── eslint-config/     Shared lint rules
```

`@match-makers/shared` holds the domain model and validation schemas. It exists
so the FP2 backend can import the exact same types and validation the app uses,
rather than letting the two drift apart.

`apps/api` is the FP2 backend that package was written for. It is now wired up:
`apps/mobile/.env` points the app at it, and `npm run test:api` proves the app's
own services drive it end to end.

## Getting started

```bash
npm install
npm run dev          # or: npm start --workspace=apps/mobile
```

Then press `w` for web, `a` for Android, or `i` for iOS.

`apps/mobile/.env` currently points the app at `apps/api`, so start the backend
too or the app has nothing to talk to:

```bash
npm run migrate --workspace=apps/api
npm run dev --workspace=apps/api     # http://localhost:3001
```

The photo-library importer is admin-only, so grant the account you are signing in
as before you expect it to work:

```bash
npm run admin --workspace=apps/api -- grant you@example.com
```

If the API reports `Port 3001 is already in use`, something already holds it --
usually a second copy. `lsof -ti tcp:3001 | xargs kill`, or set `PORT=3002` and
repoint `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to match. Two servers on
different ports will not serve the app unless the app is told which one to use.

To go back to the offline prototype, set `EXPO_PUBLIC_AUTH_MODE=mock` in that
file and restart Expo. See **The Postgres database** below.

If Expo starts on a different port because 8081 was taken, add it to
`CORS_ORIGINS` in `apps/api/.env` -- a browser blocks the request otherwise, and
the error reads like a network fault rather than a policy decision.

### Demo account

```
demo@matchmakers.dev
Password1
```

The login screen has a shortcut that fills these in. 20 seeded profiles are
waiting in the feed.

## Config

Copy `apps/mobile/.env.example` to `apps/mobile/.env`:

| Variable                        | Default                     | Purpose                                              |
| ------------------------------- | --------------------------- | ---------------------------------------------------- |
| `EXPO_PUBLIC_AUTH_MODE`         | `mock`                      | Which auth strategy to use: `mock` or `jwt`          |
| `EXPO_PUBLIC_API_URL`           | `http://localhost:3000/api` | FP2 backend base URL                                 |
| `EXPO_PUBLIC_MOCK_LATENCY`      | `350`                       | Simulated round-trip time in ms                      |
| `EXPO_PUBLIC_MOCK_JITTER`       | `250`                       | Extra random delay in ms                             |
| `EXPO_PUBLIC_MOCK_FAILURE_RATE` | `0`                         | 0–1; raise it to exercise error and retry states     |

## Configurable auth

Two strategies, behind one interface, switchable **at runtime** from
Settings → Developer or from the switcher on the login screen. No code changes
and no rebuild required.

| Mode   | Credentials                           | Storage                                     |
| ------ | ------------------------------------- | ------------------------------------------- |
| `mock` | None; local database                  | AsyncStorage                                |
| `jwt`  | `Authorization: Bearer <accessToken>` | Access + refresh token in Keychain/Keystore |

A third mode, `session` (HttpOnly cookie), used to be listed here. It has been
removed: the API never implemented cookies, so choosing it could only ever
produce a login that failed with no explanation, and a permanently broken option
on a switch is worse than no option. `AuthMode` no longer includes it, so it
cannot come back at a call site.

That removal also **self-heals anyone stuck in `session`**: the mode is persisted
to AsyncStorage and takes precedence over `.env`, so a device left on it by an
older build would keep failing with nothing on screen to explain why. An
unrecognised persisted value is now ignored and the environment wins.

**Both modes are development affordances**, and the switcher lives in a section
that is compiled away outside a dev build — see `__DEV__` in `SettingsScreen`.

The split that makes this work:

- `AuthTransport` (`applyToRequest`, `refresh`, `clear`) is all the HTTP layer
  knows. `apps/mobile/src/services/api/client.ts` depends on this interface
  only, so it never imports a concrete adapter.
- `AuthAdapter` extends it with `login` / `register` / `getCurrentUser`, which
  is all the UI knows.

Adding a real backend means writing one adapter and pointing
`EXPO_PUBLIC_AUTH_MODE` at it. Screens, stores and the API client are untouched.

## The mock backend

`apps/mobile/src/services/mock/database.ts` is an AsyncStorage-backed stand-in
for the FP2 Postgres + Redis setup. It seeds 20 profiles and 24 tagged photos,
and supports login, registration, profile edits, swipes, matches, messaging, and
photo reactions.

It is no longer the default: `apps/mobile/.env` sets `EXPO_PUBLIC_AUTH_MODE=jwt`,
so the app runs its HTTP branch against `apps/api` and real Postgres. The mock is
still there, still seeded, and the whole test suite runs on it.

The Settings rows that reach it ("Admin: all users", "Admin: photo library") live
in a **Developer** section that only exists under `__DEV__`, and both stay disabled
unless the mode is `mock` -- `services/admin.ts` reads the mock database directly
and never calls the API. So in JWT mode the admin inspector is unreachable by
design: it would show the 20 seeded profiles rather than anything in Postgres.

Domain services (`services/feed.ts`, `services/posts.ts`, `services/matches.ts`,
`services/profile.ts`) each have a mock branch and an HTTP branch, chosen by
`getAuthAdapter().mode`. So the same screen code exercises both paths.

`posts` and `postReactions` are separate collections from `users`, not fields on
a user. A post belongs to the platform, and a reaction is a row against a user
but not part of their profile record — keeping them apart means liking a photo
cannot dirty a profile, and leaves `preferences` as the only thing the feed can
ever influence.

Seeded reactions cover the **candidates only, never the demo account.** The
candidates need a taste profile so reacting has somebody to pull you towards;
without it every pair scores zero and the feature is invisible. The demo account
is excluded deliberately: seeding it too would greet somebody signing in with a
summary claiming a history of likes they never gave, on the one screen whose
whole job is telling the truth about what has been learned.

Reset the seeded data any time from **Settings → Reset mock data**.

The seed places candidates in three location tiers — within ~45 km of the demo
account's own city, ~90-320 km away in the same region, and on the other side of
the planet. That is what makes the nearby/global split observable rather than
asserted. It replaced a version that drew latitude and longitude uniformly from
the globe and attached them to whichever city name the same random stream
produced, so a profile labelled "Austin" could sit at latitude -70. No correct
distance calculation returns a non-empty deck against that.

Seeded candidates also get deliberately permissive preferences and a `global`
distance mode. Since eligibility is mutual, a narrow radius on the seed would
bind before the viewer's and the demo would demonstrate nothing about the
viewer's own settings.

## The Postgres database

`apps/api` is the FP2 backend described in `fp_reviews.md`, and `db/schema.sql`
is the storage that was being stubbed at with an AsyncStorage blob.

**The app is now pointed at it.** `apps/mobile/.env` sets
`EXPO_PUBLIC_AUTH_MODE=jwt` and `EXPO_PUBLIC_API_URL=http://localhost:3001`, so
every screen runs its HTTP branch against real Postgres instead of the mock
database. Both modes still exist — the mock is one env var away, and the whole
test suite still runs on it.

```bash
# once, to create the role and database
sudo -u postgres psql -c "CREATE ROLE matchmakers WITH LOGIN PASSWORD '...';"
sudo -u postgres psql -c "CREATE DATABASE matchmakers OWNER matchmakers;"

cp apps/api/.env.example apps/api/.env   # then fill in DATABASE_URL
npm run migrate --workspace=apps/api    # applies db/schema.sql
npm run dev --workspace=apps/api        # http://localhost:3001

npm run dev                              # the app, in a second terminal
```

`migrate` is a Node script rather than a `psql` one-liner, so it reads
`apps/api/.env` the same way the server does and needs no client binary on
`PATH`. It is safe to re-run.

The database ships **empty**. There is no seed script: the data is yours to
enter, so what you demonstrate is what you put in.

### CORS, and why web needs it

`apps/mobile` web is served from `http://localhost:8081`; this API listens on
`http://localhost:3001`. A browser treats those as different origins, sends an
`OPTIONS` preflight, and refuses the real request if the response lacks
`Access-Control-Allow-*`. So `apps/api/src/cors.ts` answers it, mounted before
every route — a preflight that reaches `requireAuth` or the 404 handler comes
back without the headers and is rejected again.

**This is web-only.** Native (iOS/Android) has no browser enforcing origins, so
the same bundle works on a phone with none of it.

Origins come from `CORS_ORIGINS`, defaulting to the Expo dev ports. An allowlist
rather than `*`: any page in the browser could otherwise call a local API
holding real profiles, and `*` is illegal alongside credentials — so the day
cookie sessions replace the bearer token, `*` would break everything. **If Expo
picks a different port because 8081 is taken, add it there.**

This is worth knowing because **no other check in the repo could catch it**.
`curl` does not enforce CORS and Jest's `XMLHttpRequest` is not a browser's, so
the entire suite passed against an API a browser could not reach. The three
`cors` tests in `apiConnection.test.ts` assert the headers directly for exactly
that reason; with the middleware commented out they fail while every functional
test still passes.

### Proving it is connected

`apps/mobile/src/services/apiConnection.test.ts` is the answer to "is it really
using Postgres?". It calls the app's own `services/auth`, `services/profile`,
`services/posts`, `services/feed` and `services/matches` — the same functions a
screen calls — in `jwt` mode, over HTTP, against a live server and real tables.
Register, save a profile, read it back, import photos, react, build a deck,
match, message, unmatch.

```bash
npm run migrate --workspace=apps/api
npm run dev --workspace=apps/api
npm run test:api --workspace=apps/mobile   # 10 passed
```

It is skipped by `npm test` because it needs a live server. It creates users
prefixed `itest.` and deletes them afterwards, so it is safe to run against a
database that has real data in it.

### Why the schema, and not the blob

The mock is one JSON document rewritten in full on every mutation, which works
for 20 seeded profiles and stops working for anything else. But the interesting
part was never the storage format — it was that the mock enforces its own
invariants in application code, one `Array.find` at a time:

| Mock, in code                              | Schema, as a constraint                                 |
| ------------------------------------------ | ------------------------------------------------------- |
| `swipedUserIds` builds a `Set`             | `UNIQUE (actor_id, target_user_id)` on `swipes`         |
| `recordPostReaction` scans to dedupe       | `UNIQUE (user_id, post_id)` on `post_reactions`         |
| `createMatch` filters the array for a pair | `CHECK (user_a_id < user_b_id)` + `UNIQUE` on `matches` |
| `deletePost` deletes reactions by hand     | `ON DELETE CASCADE` from `post_reactions.post_id`       |
| `updateProfile` merges `{...old, ...new}`  | Column-level `UPDATE`, and zod per field                |
| password stored verbatim                   | `password_hash`, scrypt, never returned by any query    |

That `CHECK (user_a_id < user_b_id)` is the one worth knowing. Storing the pair
smallest-first makes `(alice, bob)` and `(bob, alice)` the same row by
construction, so "one match per pair" is a single unique index instead of a scan
on every insert. It also means there is no "my side" of a match row, so every
query about _your_ conversations has to check both columns — which is a cost the
constraint bought back several times over.

The unique constraints are also what make the writes one statement each. A
reaction is `INSERT ... ON CONFLICT (user_id, post_id) DO UPDATE`: the mock
loaded every reaction, searched for one with the same pair, and rewrote the
whole database to replace a single row.

### Layout

`db/schema.sql` is the whole schema and is safe to re-run. Enums are guarded in
a `DO` block because Postgres has no `CREATE TYPE IF NOT EXISTS`; tables and
indexes use `IF NOT EXISTS`. **Editing the labels of an existing enum is a
migration, not a schema edit** — `ALTER TYPE ... ADD VALUE` cannot run inside a
transaction, so re-running the file will not pick up the change.

| Table              | Holds                                    | Notes                                        |
| ------------------ | ---------------------------------------- | -------------------------------------------- |
| `users`            | Identity and profile                     | Email unique and lower-cased by `CHECK`      |
| `user_preferences` | Age range, distance mode, genders, goals | 1:1, cascades with the user                  |
| `photos`           | Profile photos                           | Partial unique index: one primary per person |
| `posts`            | The site-owned photo library             | Deliberately has no `user_id`                |
| `post_images`       | The rendition ladder for each photo     | The `srcset` of the web, stored              |
| `post_reactions`   | One answer per person per photo          | Upsert on conflict                           |
| `swipes`           | One decision per ordered pair            | Cannot swipe yourself                        |
| `matches`          | Canonical pairs                          | See above                                    |
| `messages`         | Conversation contents                    | Indexed `(match_id, created_at DESC)`        |

Two decisions that look odd and are not:

- **`posts` has no `user_id`.** Posts belong to the platform. The feed is an
  input device for working out what somebody likes; the matching that comes out
  of it happens between people, so a post has no author to point at.
- **Location lives on `users`, not `user_preferences`.** Preferences came out as
  their own table because they are the most-read part of a profile and deserve a
  foreign key. Coordinates did not, and keeping them on `users` is what lets the
  feed query join one way instead of two.

### The API

Routes are mounted where the app's existing HTTP branches already call them, so
the paths are not negotiable.

| Method   | Path                       | Notes                                                       |
| -------- | -------------------------- | ----------------------------------------------------------- |
| `GET`    | `/health`                  | Runs `SELECT 1`; 500s if the database is down               |
| `POST`   | `/auth/register`           | Accepts `RegisterData`; user + preferences, one transaction |
| `POST`   | `/auth/login`              | scrypt; identical cost for unknown accounts                 |
| `POST`   | `/auth/refresh`            | Rotates the refresh token                                   |
| `POST`   | `/auth/logout`             | Revokes refresh tokens                                      |
| `GET`    | `/auth/me`                 |                                                             |
| `PATCH`  | `/profile`                 | Every field optional, as the app sends it                   |
| `GET`    | `/profile/verification`    |                                                             |
| `POST`   | `/profile/verification`    | Marks verified, with no actual check                        |
| `GET`    | `/feed`                    | The mutual eligibility gate, as one query                   |
| `POST`   | `/swipes`                  | Creates a match on two reciprocal likes                     |
| `GET`    | `/matches`                 | Conversations, with unread counts                           |
| `DELETE` | `/matches/:id`             | Unmatch; cascades to messages                               |
| `GET`    | `/messages/:matchId`       | `{ items }`                                                 |
| `POST`   | `/messages/:matchId`       |                                                             |
| `POST`   | `/messages/:matchId/read`  | Set-based update, idempotent                                |
| `GET`    | `/posts/feed`              | Library plus this caller's reactions                        |
| `GET`    | `/posts`                   | `{ total }`, for the feed's empty states                    |
| `GET`    | `/posts/taste`             | `{ summary }` on its own                                    |
| `POST`   | `/posts/reactions`         | Upsert on conflict                                          |
| `DELETE` | `/posts/reactions/:postId` | `{ removed }`                                               |
| `POST`   | `/posts`                   | Import into the library                                     |
| `DELETE` | `/posts/:postId`           | Cascades to reactions                                       |
| `GET`    | `/admin/users`            | Every account; `requireAdmin`                               |
| `GET`    | `/admin/users/:id`        | One account in full                                         |
| `GET`    | `/admin/posts`            | The library with reaction counts                            |
| `GET`    | `/admin/tags`             | Every tag in use, by frequency                              |

These paths are not negotiable: they are the ones `services/*.ts` and the two HTTP
auth adapters already call. Several were written against a contract and never
executed, and they did not all agree -- `/messages/:matchId` rather than
`/matches/:matchId/messages` was one. **The API moved to the app, not the other
way round**, on the grounds that twenty-odd call sites in working code outrank a
route table nobody had run.

Responses are `ApiEnvelope<T>` and errors are `ApiErrorBody`, both from
`@match-makers/shared`. The client unwraps the envelope in a single interceptor
in `services/api/client.ts` rather than at each call site: every service and
adapter reads `response.data.x` directly, so `requestWithData` had no callers and
the envelope would have broken all of them at once. Validation is the same Zod
schemas the forms use; a failure comes back as `fieldErrors` keyed by dotted field
path.

The eligibility gate is the part that actually moved. `utils/eligibility.ts` ran a
`mutualGate` over every user in the database in the client; `GET /feed` now does
it in one statement, in both directions, with a haversine distance for the
`nearby` mode.

### Image quality and sizing

Photos are sized **automatically** on import. The importer keeps as much of the
original as fits a byte budget, up to 2880px wide, and only shrinks further if
the encoded file would be too large to store. The grid thumbnail is always
generated separately at 640px.

This replaced a fixed menu of sizes defaulting to 1200px, and the reason was a
visible one: the full-screen viewer renders a photo at the **full viewport
width**, so a 1200px source was being *upscaled* on any laptop — anything
wider than 1200 CSS pixels. The grid looked sharp (it uses the 640px thumbnail)
and the opened photo looked soft, which read as "the upload lost its quality".

2880 is not a round number because it is what a 1440-point display at 2x needs
in device pixels. Below that, the viewer is scaling up again.

The fixed sizes remain as explicit caps, for somebody who would rather have the
storage back than the pixels.

**Profile photos go through the same resizer.** They used to bypass it entirely
and store the picker's URI verbatim, which on web meant the original file as a
base64 data URI — a 12-megapixel photo became a **nine-megabyte PNG in a text
column**. They are now JPEG at 1200px, which covers the deck card, and about
forty-five times smaller.

### Real-time messages

Messaging is plain HTTP: you send over `POST`, the other person sees it when they
next fetch. On top of that there is now a WebSocket at `/ws`, and a message
arriving is pushed to whoever is connected.

The transport is **Postgres `LISTEN`/`NOTIFY`**, not Redis, and the reason is
that it needs no new infrastructure: the database is already there, already
running, and already the thing both sides of a conversation agree on. `NOTIFY`
carries at most 8KB, so the payload is a pointer — "a message arrived in
conversation X" — and the client fetches the message over HTTP as it does today.
One source of truth for what a message is.

Redis is where `fp_reviews.md` wants this to end up, and moving the fan-out to a
Redis channel later is a contained change: the publish side is one function.

```bash
# the client connects with the access token it already has
ws://localhost:3001/ws?token=<accessToken>
```

Verified with two concurrent clients against a live server: both received the
message, **exactly once** each; a third account not in the conversation received
nothing; and a socket with a bad token was refused with `4401` rather than
accepted and hung up on.

An earlier version delivered every message **twice** — it both notified the
database and handed the payload straight to the sockets, and the listener
delivered it again a moment later. Delivering only through the database is also
what makes this work across more than one API process, which a direct hand-off
would not.

**The app consumes it.** `services/realtime.ts` owns one socket for the whole
app, opened when the first screen wants a message and closed when the last one
stops caring. The access token goes in the query string, because a browser
cannot set headers on a WebSocket handshake; it is the same short-lived token
the HTTP API uses, so it expires on the same clock, and a socket the server
refuses for being expired is renewed and reconnected rather than left dead.

**The socket is an optimisation, never the only way a message arrives.** If it
is not connected, the chat screen polls every five seconds instead, and says so
— "Reconnecting — messages will still arrive." A dropped connection costs
latency, not messages, and it is visible rather than silent. Silently showing
stale messages is worse than showing nothing.

Verified end to end in a browser: one person signed in with the chat open, a
second person sending a message over plain HTTP, and the message appearing in
the first browser **without a reload**.

### Looking at photos, editing them, and taking them away

Three things that were missing, and which turned out to be one theme: a photo
was something you could only ever see small.

**Editing a photo's tags did not save.** The tag editor merged the new tags into
the copy of the photo the client already had and sent **nothing** — there was no
route to send it to. The screen showed the new tags, and the database kept the
old ones until the screen was refetched. `PATCH /posts/:id` now carries the
edit, and the tags are folded with the same schema the editor uses, so `Dogs`
and `dogs` cannot end up stored as two different tags.

**The import screen had no way to check a photo, and no way to back out.** The
batch was a strip of 90-point thumbnails. Tapping one now opens it full size,
with the way out of the batch on the same screen as the picture, and there is a
cross on each thumbnail for the same thing without opening it. A photo that can
only be seen as a thumbnail is a photo nobody can check.

**Your own profile photos could not be looked at properly either.** They were a
strip of squares where a tap silently promoted one to be the main photo and a
long press deleted it — so a photo could not be seen before being promoted, and
deletion sat behind a gesture nobody discovers, on a destructive action, where a
mis-swipe would trigger it. Both now happen in a full-size view, where what is
about to happen is visible before it happens. Somebody else's photos open
read-only; your own open with **Make main photo** and **Remove**.

### Matching: the tag vector, the decay, and the ranking

The score is the client's algorithm, run in SQL. It was previously client-only,
which meant the server could not rank by it and ordered the deck by registration
date.

**The vector.** `user_tag_affinity` holds one row per person per tag they have
an opinion on, written the moment a reaction lands. A like increments the tag's
count and touches the row; a dislike increments the other; changing your mind
takes the old one back and applies the new one, so the vector never counts both
opinions at once. The first tag of the photo is the vector's unit, so liking one
photo moves every tag it carries.

**The decay.** A like is worth less the longer ago it was:

```
effective = (likes - dislikes) x exp(-age x ln(2) / half_life)
```

with a **30-day half-life** — half the weight after 30 days, a quarter after 60.
Decay is applied at *read* time from `last_activity_at`, not written into the
row: a write-time moving average drifts, because the stored value is only right
the instant it is written and disagrees with what should be shown a day later.
Read-time decay is deterministic, needs no job to age rows out, and a test can
fix a timestamp and assert the number.

Both halves of the taste signal decay. The co-like half — photos you have both
liked — is weighted by how recently *you* liked yours, because leaving it a raw
count would make the decay almost invisible in the total, and it is 65% of the
signal.

**The similarity** is a **cosine** between the two people's tag vectors: the
shared weight divided by the length of each vector.

```
cosine = (sum over shared tags of viewer_weight x candidate_weight)
         / (length of the viewer's vector x length of the candidate's vector)
```

It replaced a normalisation that divided the shared weight by the *smaller* of
the two tag counts, which said that somebody with two strong opinions and
somebody with two hundred were equally well matched on the two they had in
common. Cosine is the standard measure, it is bounded in [0, 1] without a clamp,
and it prices a broad taste against a narrow one honestly.

The length of a vector is the square root of the sum of its squared tag
weights, over the person's **whole** positive vector rather than just the tags
they happen to share. That last part cannot be skipped: truncating it to the
shared tags would make every pair score 1.0, which is a number that means
nothing.

**The ranking** is computed by `npm run rescore` and stored in `match_scores`,
and the feed reads that instead of computing it per request. This is the
"background workers or database functions properly rescore candidate pools" the
spec asks for, and it is also the only way the feed is fast: computing the
affinity for a whole pool measured at **1.2 seconds over 400,000 rows**, paid on
every request to answer a question that only changes when somebody reacts. The
feed read is **under 2ms** over 2,000 candidates and 4,000,000 stored scores.

The rescore is a batch, and it is the one thing here that is slow: about 1.8
seconds per viewer on the synthetic dataset, because a cosine has to read every
candidate's whole vector rather than only the tags they share. That is the
trade — a batch that runs when somebody reacts, in exchange for a read that
costs nothing. `npm run perf` measures it, and `db/perf-dataset.sql` builds the
dataset it measures against.

**The bands.** A percentage falls into `90+`, `75+`, `50+` or `below-50`, on
the floors the spec names. The server returns the band with the score; the card
shows a badge for the two strong ones, because `50+` next to a `50%` is saying
it twice.

Aged evidence moves a pair across a band, which is the point:

| Age of the shared evidence | Affinity | Score | Band |
| --- | --- | --- | --- |
| fresh | 0.63 | 66 | 50+ |
| 30 days | 0.47 | 54 | 50+ |
| 60 days | 0.32 | 42 | below-50 |
| 120 days | 0.11 | 25 | below-50 |

And the score rises smoothly as the shared evidence accumulates, which is what
the formula is supposed to do — measured through the real API, two people
liking the same photos one at a time:

| Photos in common | Affinity | Score | Band |
| --- | --- | --- | --- |
| 1 | 0.11 | 25 | below-50 |
| 2 | 0.27 | 38 | below-50 |
| 3 | 0.44 | 51 | 50+ |
| 4 | 0.63 | 66 | 50+ |
| 5 | 0.81 | 81 | 75+ |
| 6 | 0.84 | 83 | 75+ |
| 10 | 0.89 | 87 | 75+ |

The increments shrink: 13, 13, 15, 15, 2, 2, 1, 0, 1. A score that jumped
would be a score nobody could reason about.

### The rendition ladder

Photos are stored at several widths, and the app picks one per screen.

This is the `srcset` pattern from the web, done by hand. A browser is given a
`srcset` and a `sizes` hint, and it chooses: it works out the display width,
multiplies by the device pixel ratio, and loads **the smallest rendition that is
not smaller than the display needs**. It never upscales, and it never downloads
more than it is going to show.

React Native's `Image` has no `srcset` attribute, so the app makes the same
choice itself — `pickVariant` in `apps/mobile/src/utils/images.ts` — and
`post_images` holds the alternatives it chooses between. The rungs are 640, 1280
and 2560; the full image is the top of the ladder and lives in
`posts.image_uri`.

Measured in a browser, against a 1440-point window:

| | DPR 1 | DPR 2 |
| --- | --- | --- |
| Grid tile (342pt) | 640px | 1280px |
| Full-screen viewer (1392pt) | 2560px | 2720px (the full) |

So the grid downloads a 640px image to draw into a 342px box, and the viewer
downloads the full one — which is the point. Before this there was a single
image per photo, and every screen got it: a 342px tile was handed a 2720px
photo, and on a 2x display the viewer stretched it to 2784 device pixels.

**Storage roughly doubles.** A 2720px photo becomes about 1.9MB of data URI
across its ladder instead of 0.9MB. The bytes are paid once at import rather
than being stretched at display time, and the permanent answer is object storage
with on-demand resizing, where the ladder is generated at the CDN instead of
being stored. That is still open.

**The source is the ceiling.** A ladder cannot invent pixels. A photo imported at
2720px is soft on a 2560-point window at 2x no matter what, because the display
wants 5120 device pixels and only 2720 exist. Importing a higher-resolution
source is the only fix; the ladder makes sure the app uses every pixel it has.

### Admin accounts

```bash
npm run admin -- list                 # who is an admin
npm run admin -- grant you@example.com
npm run admin -- revoke you@example.com
```

`users.is_admin` is a plain boolean, and this CLI is the only thing that can set
it. There is **no HTTP route that grants admin**, on purpose: such a route would
be reachable by anyone who could authenticate, and "it worked in dev" is a long
way from "it is disabled in production". A CLI needs `DATABASE_URL`, so whoever
runs it already holds more than the flag is worth.

It is a CLI rather than a seeded admin because *which* account should be an admin
is a decision. Seeding picks one before anybody has registered, and the mock
adapter's demo account has no equivalent here. Register normally, then name it.

The output names the account it acted on rather than just succeeding, because
picking the right person out of a few similar addresses is the whole task:

```
$ npm run admin -- grant dem0@hotmail.com

  No account with the email "dem0@hotmail.com".

  Did you mean:
    demo@hotmail.com

  Register the account first, then grant it.
```

Once granted, `apps/mobile` shows the admin screens in **both** modes: mock reads
the mock database, JWT calls `/admin/*`. The client cannot tell whether an
account is an admin -- `User` has no such field -- so it does not pretend either
way; the API answers `403` and the screen shows that.

### What this does not do

Stated plainly, because the README's "Not built yet" section used to cover all of
it and no longer can:

- **Scoring did not move.** `GET /feed` applies eligibility and orders by
  `created_at`; the 80 points of shared taste are scored as zero, and the route
  hard-codes `needsTaste: true` so the app keeps labelling the number
  provisional instead of showing an out-of-20 score as a match. Porting
  `tasteBetween` from `utils/taste.ts` is the same work as "move the score
  server-side", which is why the deck's ordering still means nothing.
- **`blockedReason` is a guess.** The app wants the server to explain an empty
  deck per filter. This one can only tell "nobody has signed up" from "nobody
  matches"; `summariseBlockers` in `utils/eligibility.ts` still does the real
  version.
- **No spatial index.** Latitude and longitude are plain columns with a btree,
  and distance is computed per row. PostGIS, or at minimum `cube` +
  `earthdistance`, is still the fix for a real candidate pool.
- **Sessions are a table, not Redis.** Access tokens are signed and stateless.
  Refresh tokens are opaque, stored hashed in `refresh_tokens`, and rotated on
  every use, so logout really does revoke. A refresh token presented twice
  revokes the whole family, because that is either a replay or a leaked dump.
  An already-issued _access_ token still lives out its hour, which is the
  standard trade for a two-tier scheme.
- **No admin *system*.** `users.is_admin` is a single boolean, checked by
  `requireAdmin` on the `/admin` routes and on the photo-library writes. There are
  no roles, no permissions table, and no audit trail -- a grant or revoke leaves
  no trace beyond the column itself. FP1 asked for manual admin review of user
  reports, which is a considerably larger piece of work and is not this.
- **Tests.** `npm run test:api --workspace=apps/mobile` drives the app's own
  services against a live API and Postgres — 10 tests, opt-in, needs the server
  running. The API has no unit tests of its own, so the schema and the SQL are
  only as verified as that one suite and by hand.
- **A dev-only delete route.** `DELETE /auth/dev/users/:id` exists so that
  integration test can clean up after itself. It refuses to run when
  `NODE_ENV=production`, and it is not a permission system.
- **Timestamps.** `created_at`/`updated_at` are set by Postgres, and nothing
  propagates `updated_at` to the `users` row when a photo or preference changes.

### A bug this found in `@match-makers/shared`

Two schemas do not describe what their own types say, and both are pre-existing:

- `photoSchema` validates `{ uri, type, name }` — the `expo-image-picker` result
  _before_ `services/imageImport.ts` has written a storable URI.
  `profileSetupSchema` composes it into the field documented as "the contract for
  a single setup call", but `ProfileSetupPayload.photos` is `Photo[]`, i.e.
  `{ id, url, isPrimary, order }`.
- `postReactionSchema` validates the whole stored record (`id`, `userId`,
  `createdAt`), but the request type `PostReactionRequest` is `{ postId, action }`
  — the caller does not choose their own user id or the timestamp.

`routes/profile.ts` and `routes/posts.ts` declare the correct request shapes
locally, with comments pointing here, rather than changing shared schemas on the
picker's path in a commit that is about the database.

## Taste and the match score

Signup is Welcome, Basics, Intent, Photos, Location. Nothing about taste is
asked there.

**Nobody fills in a taste questionnaire any more.** Taste is inferred from the
photos they answer on the feed, which is what the deck is ranked by.

The deck has exactly one requirement left: **one liked photo.** With zero likes
the only points anything can be ranked on are the twenty of stated fact — goal,
orientation, verified — and the deck used to open with an "11% match, not enough
to go on" card built on exactly those, which taught anybody who looked at it that
the percentage meant nothing. A brand new account now gets an empty deck that
says *why* in those words and links to the photos, rather than a weak card
dressed up as a match.

One **like**, specifically, not one answer: dislikes never become shared
evidence, they only steer the feed, so a history of nothing but passes leaves
the matcher with exactly as much to rank on as no history at all.

### Where taste comes from

Every like or dislike on a photo adjusts the viewer's opinions about that photo's
tags, and `utils/taste.ts` turns those opinions into an affinity against
everybody else's. The signal is deliberately coarse — it compares tag
opinions and counts photos both people liked — because a signal built from
one person's list against another person's list does not separate anybody
(median Jaccard 0.11 on a 24-item list).

`PHOTOS_FOR_FULL_TASTE = 10` is how much taste is needed before the score stops
being provisional. Between one and nine the deck renders with a **STILL BUILDING
UP** strip that says so and links back to the feed, alongside a working deck: a
weak number labelled as weak is more honest, and more useful, than a locked app.
That is the distinction from the questionnaire gate this replaced — the
questionnaire demanded ten curated answers before the app did anything, while
this asks for one tap and then shows real people.

**Profile → Taste profile** is where this is explained in full: how much is
known, what you lean towards, what you are drifting away from, and who the
matcher thinks you are closest to and why.

Those people are a **grid of three cards**, not a ranked list, and each card
carries the deck's own percentage. Both choices are load-bearing:

- **A grid has no first place.** The panel used to be a ranked list ordered by
  taste alone, while the deck orders by the full score — taste plus the stated
  facts, where a `not_sure` account hands a `long_term` seeker zero goal points.
  So the panel would routinely show someone first whom the deck placed lower, with
  nothing on screen to explain the gap. That made the panel's central claim
  unverifiable from the UI, and an explanation you cannot check is worse than none.
- **One number for "match".** The card shows the deck's score, not the taste
  affinity it used to show. Two different percentages under the same word, on two
  screens a swipe apart, is how "who is closest" became unanswerable.

Tapping a card opens that person's profile carrying the signal they were chosen
for, so the breakdown there agrees with the card that sent you.

### One rule for who you can be shown

`utils/eligibility.ts` has `checkEligibility` (one direction) and `mutualGate`
(both, with the reasons kept apart so the deck's empty state can name the right
one). **Everything that decides whether the viewer may see somebody goes through
`mutualGate`** — the deck in `services/feed.ts`, and the taste summary in
`services/posts.ts`.

That is not tidiness. The two originally reimplemented the rule separately, and
they drifted: the deck filtered its candidates and the summary did not. The
result was a summary panel titled *who your answers pulled you towards* naming
people the deck would never show — the app promising a consequence it had already
ruled out, on the one panel whose entire job is to make the feed legible.

`buildSummary` also reports `closestBlockedByFilters`, so the panel can
distinguish "you have not answered enough photos" from "everyone you share photos
with is outside your filters". Telling somebody to answer more photos when the
answer is a setting they can widen is the same mistake the deck's empty state was
already fixed for, and it does not get reintroduced here.

`fetchTasteSummary` had no test at all before this, which is how it shipped. It
has one now, and the regression it guards is named in it.

### Scoring

`utils/matching.ts` scores a candidate out of 100 from what both people answered
plus the basic eligibility signals. The card shows the percentage and a label.

| Signal              | Points |
| ------------------- | ------ |
| Shared taste        | 80     |
| Relationship goal   | 10     |
| Mutual orientation  | 6      |
| Verified            | 4      |

Shared taste dominates deliberately. Everything it is derived from is something
the person actually did rather than something they said they wanted, and the
alternative — grading a list of values somebody picked from a menu — produced a
score that never separated anybody.

Deal breakers are gone. The whole concept was a veto on a score, and once taste
is inferred from behaviour there is nothing on the profile for a user to declare
as non-negotiable.

The total is still capped at 100, which
means taste can break a tie between two people the rest of the engine already
scores highly but cannot promote a weak pair on its own. A taste signal is the
weakest evidence in the product, because a like is one tap and a declared value
is a considered answer.

The swipe card names the prompts you share and shows one as an icebreaker. The
profile screen breaks the score into named signals with the points each earned,
including the ones that earned nothing.

The breakdown that sorts the deck travels with the card rather than being
recomputed at render time. `scoreCompatibility` takes a taste signal that only
the feed layer can supply, so a card that scored itself would show a different
percentage from the one that put it in that position. `tasteSignalFrom` converts
one back into the other when a score has to be carried somewhere.

This still runs on the device. FP2 wants it server-side so the weights can be
tuned without an app update.

## The photo feed

The landing tab. A masonry grid of the photo library, ten to a page, and a
full-screen viewer where you answer them.

**The photos belong to the app, not to a profile.** There is no author, no
follow, no comment, and nothing to tap through to. The feed is not a social
feature — it is an input device. Reacting to a picture builds a taste vector,
and taste is only useful *pairwise*: it says which other people have been pulled
towards you, and that is what changes the deck in the next tab.

That is why `Post` has no `userId` and why a post can never be matched to
somebody. It is also why `preferences` stays untouched: nothing the feed does
edits a stated preference, because a photo cannot honestly carry an opinion about
someone's age range.

### The signal

`utils/taste.ts`, derived from the reactions table on every read:

```
tagScore(u, tag)  = (likes - dislikes) / (likes + dislikes + 1)      // -1..1

coLike            = n / (n + 2)              // n = photos both liked
tagOverlap        = Σ tagScore(A,t)·tagScore(B,t)   over tags both lean towards
                    ÷ max(1, min(tagsA, tagsB))
confidence        = min(1, min(likesA, likesB) / 5)

tasteAffinity(A,B) = confidence × (0.65·coLike + 0.35·tagOverlap)
```

Three decisions worth defending:

- **Co-liking one photo beats sharing a tag**, and saturates. Two strangers who
  both liked the same specific image agreed on something checkable; two who liked
  different images both tagged `pets` agreed on something broader. `n / (n + 2)`
  never reaches 1, so the tag half always has room to contribute and the third
  photo somebody likes matters much less than the first.
- **Containment, not union.** The denominator is `min(tagsA, tagsB)`. Somebody
  who likes cats and cooking has two strong opinions and should not be punished
  for not having twelve; under a union denominator a selective user could never
  score highly, which is backwards.
- **Confidence is the weaker side's.** This is the answer to the open question in
  `fp_reviews.md`: affinity cannot be stronger than its weakest evidence, so one
  person's 500 likes cannot make a stranger compatible.

Only tags both people *lean towards* count. A tag one of them has pushed away is
not a shared interest, and counting it would pair two people on the one subject
they demonstrably disagree about.

### Like and dislike are not the same kind of thing

A **like** is evidence and a **dislike** is not. Two people disliking the same
photo have not agreed on anything, and counting it would pair them for the one
thing they do not share. A dislike counts only against *your own* taste vector,
and never as shared evidence between two people.

**A dislike no longer steers anything.** It used to: photos were filtered out of
the feed as you answered them, so passing on something meant fewer things like it
appearing again. Now that answered photos stay on screen so they can be undone,
there is nothing left to suppress, and a dislike's only effect is on the match
percentage. That is arguably more honest — the dislike is recorded as data rather
than as a disappearance trick — but it is a real loss of function, and per-tag
suppression of *future* photos would be the way to get it back. Not built.

### The grid, and why deciding happens somewhere else

`PhotoFeedScreen` composes a header, the collapsible summary panel, a `PhotoGrid`
and a `PostViewer`. The grid browses; the viewer decides.

**Masonry layout in React Native.** `FlatList` with `numColumns` gives
equal-height rows, which is a grid and not a masonry. Two `FlatList`s side by side
is a masonry and two independent scrolls. What works is one vertical `FlatList`
with `numColumns`, each item a tile, and `columnWrapperStyle: { alignItems:
'flex-start' }` — which is what stops a short tile being stretched to match the
tallest beside it. The stagger then comes from the *data order*, produced by
`toMasonryOrder`, which deals posts into columns weighted by their height and
interleaves them back out. Columns: 2 on a phone, 3 at ≥480, 4 at ≥768.

**Tile height** comes from `hashString(post.id)` mapped into a 0.90–1.60 ratio —
the same trick the avatar colours already use. Measuring the image would mean
`Image.getSize`, which resolves after first paint, so the grid would visibly
re-flow as photos loaded, and the generated tag tiles have no intrinsic ratio to
measure at all. Because height follows the post and not its position, **a tile
keeps its height when a filter brings it back**, so filtering does not reshuffle
the grid under your finger.

**No exit animation.** Answering removes the tile from the data, which makes the
columns re-deal immediately; a fade would animate a tile out of a slot that is no
longer where it was going.

**Two surfaces on purpose.** A like is only meaningful as taste if you can see
what you are liking, and at tile size you cannot read a tag. So the tile carries
its primary tag as a tappable pill — that pill is also the only way to browse
categories, since there is no chip row — and tapping the tile body opens the
viewer, where one photo is big enough to judge and the tags are legible. The tile
also shows your answer (a heart, or a dimmed cross) but is not a reaction
control: liking straight off a thumbnail would mean answering pictures you never
looked at.

### Like, and take it back

Pressing the button you are already holding down **undoes**. The same control
that made the answer removes it, so there is no second control to learn and no
state you cannot see your way out of — the buttons swap between filled and
outlined (`heart` / `heart-outline`, `close` / `close-circle-outline`) so you can
tell which is set before you press it.

Undo **deletes the reaction row** rather than writing a neutral one. "Default"
has to mean no row at all, because the taste index counts rows; a stored marker
would still be counted as a reaction.

**Answered photos stay in the grid.** They used to be filtered out, which made the
feed a shrinking work queue — and left no way to change your mind, because the
photo you wanted to un-answer had already left the screen. Returning everything
and reporting the answers separately is what makes undo possible. Answering also
no longer advances the viewer: stepping away the moment you answer turns a change
of mind into a round trip through the grid.

Page order is stable, so answering never re-sorts anything. Sinking answered
photos towards the bottom would read as a work queue, but it would rearrange the
grid on every tap and lose your place in it. Progress comes from the badges and
an `N of M` count in the header.

### Pagination

`APP_CONFIG.FEED_PAGE_SIZE = 10`, cut from the *filtered* list so paging and
filtering compose (filter to `dog`, get ten dogs, next page, next ten dogs). The
seed of 24 is three pages.

- Footer carries `‹ Prev · PAGE 2 OF 3 · Next ›`. Page indicator rather than a
  scrollbar, because it is the only clue how much library is behind you.
- Page changes scroll to top. Without it you press "next page" at the bottom of
  one page and land mid-grid on the next, among photos you have not looked at.
- `setActiveTag` resets to page one. Otherwise a tag with three photos leaves you
  on a page two that does not exist, showing an empty grid with no explanation.
- The page is clamped to the filtered page count, so a filter that shrinks the
  list cannot strand you past the end.

The cut happens in `usePhotoFeed`, on the mock's in-memory list. `fetchPhotoFeed`
returns the whole library rather than a page: the summary already reads every post
and every reaction, so a paged post contract would be inconsistent with a
complete reactions contract for no benefit at this scale. When a backend lands,
the slice moves into the service and the client stops holding everything — the
slice is already one function of `visible` and `page`.

### Two empty states, not three

| State | Shown |
| ----- | ----- |
| Library empty | "No photos yet" → points at the admin importer |
| Everything answered | a footer strip: "All 24 answered — tap any photo to review or change your answer." |

There used to be a third, "that category is done". It is unreachable rather than
merely rare: filters are built from the tags on visible tiles, so a filter can
never match nothing. It was deleted rather than left as dead code.

"You have seen them all" also stopped being an empty state. The grid always has
photos now, so it is a strip in the footer — and it invites the thing that
replaced it, undoing.

A single dismissible line (`Showing dog ✕`) appears under the header while a
filter is on. Not a chip row, but without it a filtered grid is indistinguishable
from a small library.

### Cost: the summary is coalesced

After *every* reaction the obvious implementation re-reads all posts, all
reactions and all users, rebuilds the taste index and re-scores every candidate.
Trivial at 20 users; not free once the library is hundreds and the viewer is
answering twenty photos in a row.

So the panel is bumped optimistically from the reaction just made, and one
authoritative refetch happens 800 ms after you stop tapping. A burst of twenty
answers costs one recompute instead of twenty. The optimistic path calls
`applyReactionToOpinions`, which reuses the same `tagScore` the authoritative path
uses — computing it separately is how a panel ends up claiming 13 likes that turn
into 12 on reload.

The same applies in reverse. Undoing decrements the tallies and calls
`adjustOpinionsForReaction` with the undo flag, which also **drops any tag that
falls back to zero likes and zero dislikes** — once the reaction row is deleted the
authoritative index has no entry for that tag at all, so keeping a zeroed one would
make the optimistic value differ from the refetched one.

**The `closest` list lags by design.** It depends on everybody else's reactions
and on the whole index, so there is nothing local to bump; the tallies and tag
chips update instantly and the named "who it moved" lines settle a beat later.

That timer is held at module scope, and `reset()` bumps a generation counter so a
refresh queued for a session that has ended cannot resolve into the next one.
Cancelling the timer alone is not enough, because a reaction whose write is still
in flight queues a *fresh* timer after the reset has run — which is exactly what
signing out and back in would do.

### Why the feed is the landing page

The deck asks for a decision about a person, and FP3 tried to make that
decision safe by putting a questionnaire in front of it. That was a gate, and a
gate in front of the main screen is the thing this feed was built to remove — the
feed is worth doing before anybody knows anything about you, and what it produces
is exactly the input the deck was missing.

So the deck ranks on taste directly, with one liked photo as the only thing it
asks for first. The photo feed stays the landing page and the five tabs are:

| Tab       | What it is                                          |
| --------- | --------------------------------------------------- |
| **Photos** | The landing page. One photo, like or pass.          |
| **Likes**  | The deck: a grid of people, tap one to decide.      |
| Matches   | Your matches.                                        |
| Messages  | Conversations.                                       |
| Profile   | Your profile.                                        |

### The deck is a grid, not a stack

The **Likes** tab shows everybody the matcher is offering at once, as a grid of
cards — avatar, name, the deck's own percentage, and the reason when there is
one. It was one full-screen card at a time, which hid the shape of the pool and
handed a single profile to somebody who had answered nothing, which read as being
told who to like rather than being shown a choice.

Deciding is still one person at a time. Tapping a card opens them full screen
with the like/pass/superlike buttons under them, as a modal rather than a route
for the same reason the photo viewer is one: it is a mode of this screen, not a
place. Deciding closes the modal back to the grid, and does not advance to
anybody else — you chose this person from a grid, and being bounced into
deciding about somebody you did not choose is the deck deciding for you.

`Feed` and `Likes` take deliberately different icons. The first is content and
the second is people, and somebody who has just liked a photo needs to be able to
tell at a glance that they have not also liked a person.

### Tags are typed, not chosen

An admin types a word and presses enter, and that word is a tag. There is no list
to pick from and nothing is forbidden. `apps/shared/src/tags.ts` holds the one
rule that makes free text comparable:

```
trim → collapse internal whitespace → lowercase → fold a plural "s"
```

So `Dogs`, `  DOGS ` and `dog` are all stored as `dog`. That fold is the whole
comparison story, and it is worth being honest about how far it goes.

**It is a heuristic, not a stemmer.** A naive trailing-`s` strip mangles real
words, so the fold only fires when the word is longer than three characters and
does not end in `ss`, `us` or `is`. That keeps `fitness`, `glass`, `bus` and
`iris` intact. The cost is a known false positive: **`news` folds to `new`**, so
somebody who types `news` and somebody who types `new` will connect when they
arguably should not. That is a rare pairing for a photo tag, and the alternatives
are a dictionary dependency or an admin alias table, so it is accepted and stated
rather than hidden.

`normaliseTag` is also idempotent, which matters because tags are folded on write
*and* on load: re-folding a stored tag must be a no-op or a tag would drift every
time the database was read.

**This reversed an earlier decision.** This started as an `InterestTag` enum of
ten closed-set values, on the argument that "the matcher has to compare two people
and free text gives it nothing to compare". That argument was about matching and
it was not wrong, but it was solved with the wrong tool: a ten-word vocabulary is
a hard limit on what a photo library can describe, and folding spelling gets most
of the comparability without forbidding anything. The enum has been deleted rather
than left as dead weight, so nobody reintroduces the constraint half-way.

The remaining risk is real and worth naming: **free text means everybody invents
their own vocabulary, and drift is silent.** Two people typing `dog` and `kitty`
just never connect, and nothing reports that. The mitigation is suggestions —
see below — rather than a constraint.

`postSchema` caps a photo at 8 tags, up from 3 under the closed set. The cap still
exists so the *first* tag stays meaningful: it is what a co-like is credited to.
The sentence under a match percentage caps itself separately, at three tags and
then "and N more", because eight tags in a sentence is not a sentence.

De-duplication is enforced at the schema, not only in the UI. Folding is what makes
it necessary — `Dogs` and `dog` are two strings and one tag — and a stored
duplicate would make the taste index count a reaction twice for a tag somebody
expressed once, inflating their affinity with everyone who liked that photo.

### Suggestions, not a list

`listAllTags()` returns every tag in the library with its usage count, and
`TagInput` filters it by substring as you type. Nothing is blocked; the words
already in use are simply offered.

This is the mitigation for the drift above, and it is the reason free text is
safe here rather than a mistake. Suggesting is enough to pull a vocabulary back
together — the common case is somebody typing `dog` and discovering half the
library already says `dog` — and it does it without taking the choice away.

Prefix matches sort before substring matches, so the word most likely to be meant
is the first one under the finger. Tags already on the photo are never suggested,
because the input rejects duplicates and offering one would be offering something
that cannot be used.

### Showing its working

A matching engine that reads a reactions table nobody can see is a signal nobody
believes. `TasteSummary` sits between the header and the grid, showing what it has
worked out — which tags you lean towards, and **which people that has moved and
why**, in a sentence. It is the part that makes the next tap worth making.

It is open by default, because the legibility argument only works if the panel is
actually visible. Collapsed it is one line (`♥ 12 liked · ✕ 2 passed · Animal,
Music`); expanded it earns its height by naming people. Openness is stored, so it
survives switching tabs.

The `closest` names come from the same `tasteBetween` the deck uses **and are
filtered by the same `mutualGate` the deck filters by**, so the promise on the
feed and the effect on the deck cannot disagree about who somebody is. They used
to disagree, and the fix is the reason `mutualGate` exists — see
[one rule for who you can be shown](#one-rule-for-who-you-can-be-shown).

### The photo library (admin)

**The tag filter.** The library can be narrowed to the photos carrying one tag,
which is the one query in the product that wants "every photo with this tag on
it" — and the reason `posts.tags` has a `GIN` index. The operator is `@>`,
array containment, and the order of the operands is not interchangeable: the
photo's tags must contain the one being looked for, and the wrong way round
silently returns everything.

Measured against a 20,000-photo library:

| | Plan | Time |
| --- | --- | --- |
| with the GIN index | Bitmap Index Scan | **0.38ms** |
| without it | Seq Scan, 19,800 rows filtered out | 8.45ms |

An index that no query uses is a write cost with no benefit, so this is the
query that earns it. The tag *list* above the filter is a different shape — it
wants every tag and every count, so there is no single tag to look up and the
index has nothing to do there.

**Settings → Admin: photo library** is the only write path in the app. It lists
the library with reaction counts per photo, and imports new photos from the
device's library with tags you type (Settings → Admin: photo library → *Import*).

Tags are typed and committed with enter, capped at 8, and **ordered: the first is
the primary tag**, which is what a co-like is attributed to in the match reason.
The importer applies one set of tags to the whole batch, because a curation task
is usually "add these six photos of my dog".

`TagInput` is shared by the importer and the retag editor, so the behaviour is
identical in both: enter commits without dismissing the keyboard, backspace on an
empty field steps back through the chips, the chip shows the canonical folded form
so the admin can see the spelling that will be compared, and at the cap the field
disables and says so rather than rejecting a ninth tag with an error.

Every image goes through `expo-image-manipulator` before it is stored. The admin
is a curator working off a camera, so the sources are 12–48 megapixel files of
several megabytes each, and storing them verbatim does not work: on web the bytes
are inlined into AsyncStorage where a single unresized photo can exceed the whole
quota, and on device it makes the feed decode enormous bitmaps for tiles two
hundred pixels wide.

### Two copies of every photo

The grid and the full-screen viewer want genuinely different files, so every
import writes both:

| Copy   | Width | Used by                                |
| ------ | ----- | -------------------------------------- |
| Thumb  | 640   | `PhotoTile`, and the admin list's thumb |
| Full   | preset| `PhotoPostCard`, the full-screen viewer |

A masonry tile is about 160 points wide and the viewer about 330, so one stored
image means either the grid decodes full-size bitmaps ten at a time or the viewer
upscales a thumbnail. On a 3x phone that is the difference between a soft
full-screen photo and a sharp one. The grid copy is derived from the **full**
image rather than from the original: a second encode of the source would pay the
JPEG generation loss twice.

The thumb is skipped entirely when the full image is already no wider than a tile
needs — an import at **Grid** produces one file, and a small source produces one
file. A second file that is not meaningfully smaller is not a thumbnail, it is the
same pixels stored twice.

`Post` carries `thumbUri`, `width` and `height` as **optional**. Absence is
meaningful: a post written before this change has one copy and keeps rendering
with the full image as its grid source. `migrate.ts` deliberately does not
derive a missing thumb — backfilling would rewrite every stored photo on load,
which is the behaviour that function exists to avoid. Re-import is the
migration path.

### Import size

The importer offers three target widths, chosen because they are the sizes the
app actually renders at rather than because they are quality steps. A masonry tile
is roughly two hundred points wide and the full-screen card roughly four hundred,
so 640 covers the grid at 3x and 1200 covers the card at 3x.

| Preset | Width      | For                                     |
| ------ | ---------- | --------------------------------------- |
| Grid   | 640 px     | Bulk imports, grid only                 |
| Feed   | 1200 px    | The default. Grid and full-screen card  |
| Large  | 2048 px    | Tablets, or spending the space willingly |

Every image is scaled to the chosen width and re-encoded to JPEG at a fixed
compression. The picker is asked for `quality: 1` and does no compression of its
own, because compressing first would throw away detail at full size and then
scale up the damage — the point of resizing is to discard those pixels, so it has
to happen before they are lost.

Two behaviours here are deliberate and are pinned by tests:

- **It never upscales.** The resampler scales to whatever width it is handed
  without checking, so an image already smaller than the target is passed through
  at its own size rather than blown up into a larger, blurrier file. A picker
  that reports no width is treated as small, because an oversized file is
  recoverable and an upscaled one is not.
- **The batch converts one at a time.** On web each image is decoded into a
  canvas at full source resolution before being scaled, so a twelve megapixel
  photo costs about fifty megabytes inside that single pass. Running a whole
  batch concurrently is how an import tab runs out of memory and dies with no
  explanation, which is also why the screen reports "Resizing 3 of 12" rather
  than spinning indefinitely.

After a pick, the screen reports what the batch actually cost: the width stored,
how many were scaled down, and an approximate size. On device the byte count is
omitted rather than shown as zero, because the resampler writes a file and
reading its length back just to fill in a label would mean opening every image a
second time.

Changing the size once photos are picked says so, rather than silently doing
nothing: the already-imported images cannot be un-resized in place, and a library
that quietly ended up at two resolutions is worse than one that asks.

The full-screen viewer sizes its card to the stored `width`/`height` and uses
`resizeMode="contain"`, so it shows the whole photo. It used to fill its box with
`"cover"`, which meant a landscape photo in a tall card was cropped top and
bottom — "full view" was full *screen*, not full *image`. The ratio is read from
storage rather than measured with `Image.getSize`, which resolves after first
paint and would re-flow the card as photos loaded. Posts with no dimensions (the
seed, and anything imported before this) fill the box exactly as before.

Import paths are stored per platform, and this is a real limitation:

- **Device.** `expo-image-picker` returns a `file://` path into the app's media
  cache, and the resampler writes its output there. Survives a reload. Does
  **not** survive the OS clearing its cache or a reinstall.
- **Web.** The resampler returns a `data:` URI, which is exactly what has to be
  stored: the picker's `blob:` URL dies with the document and AsyncStorage has
  nothing to reload it from. This is why imported photos still render after a
  browser refresh, at the cost of about a third more space and the AsyncStorage
  quota. An image that still busts the quota after being scaled to the largest
  preset is rejected with a message rather than silently dropped.

JPEG rather than PNG, because these are photographs and a PNG of one is an order
of magnitude larger. That does mean an uploaded image with an alpha channel loses
it, which is the right trade for a photo feed but is a real edge case.

Seed posts have an empty `imageUri` and render a generated tile keyed to the
primary tag, for the same reason seeded profiles have an empty photo url: the
prototype ships no photographs of strangers. The seed library uses the ten words
`pet` · `animal` · `outdoor` · `food` · `travel` · `music` · `fitness` · `art` ·
`home` · `nightlife`, written in canonical form so they need no folding.

Tile colour is hashed from the tag into those same ten swatches, so a typed tag
and a seeded one are stylistically identical and no new colours enter the design.
Glyphs are the one thing that cannot be hashed — there is no meaningful way to
derive an emoji from a string — so the seed vocabulary has glyphs and anything
typed falls back to a camera. Both are placeholders either way.

**Reset mock data** in Settings clears the library along with everything else.

### Who gets shown: eligibility

`utils/eligibility.ts` decides who appears at all. It is a separate module from
the score on purpose, because the two answer different questions and merging them
lets a good score pull someone back into a deck their own stated requirements
exclude them from.

A pair has to clear **both** people's requirements. A one-way filter shows you
people who filtered you out, and telling someone to widen a setting that was
already fine is worse than showing them nothing.

| Requirement        | Enforced    | Notes                                                  |
| ------------------ | ----------- | ------------------------------------------------------ |
| Age range          | mutual      |                                                        |
| Gender             | mutual      | `prefer_not_to_say` is never excluded — see below      |
| Distance           | mutual      | `nearby` at a radius, or `global` with no limit at all |
| Relationship goal  | scored only |                                                        |
| Sexual orientation | scored only |                                                        |

Goals and orientation stay scoring-only. Both are the answer to "what are you
open to", and gating on them removes people whose only disagreement is a word
they picked from a list. Distance, age and gender answer a different question:
could this work at all.

**Distance is a requirement, never a ranking signal.** It is not in
`MATCH_WEIGHTS`, on purpose: a genuinely good match 200 km away should still be
the top card. The weights are unchanged and still total 100.

`distanceMode` is a discriminant on `UserPreferences`, not a nullable radius.
`'global'` ignores `maxDistance`, and the radius is carried through it so
switching back restores what you had instead of resetting it. The setting lives
in `components/DiscoveryPreferences.tsx`, shared by the onboarding location step
and the profile preferences screen — it used to be written out twice, and two
copies of a filter that decides who you may see is not a style problem.

### Missing data, and which way it fails

The rules fail closed on the other person's data and open on your own. That
asymmetry is deliberate in each case:

- **A candidate with no coordinates** is excluded from nearby decks. There is no
  way to show they are in range. The alternative is quietly widening everyone's
  radius to accommodate whoever never set a location.
- **A viewer with no coordinates** is treated as global. Excluding them would
  empty their own deck, and the emptiness would read as "nobody matches you"
  rather than "we cannot tell where you are".
- **A candidate whose gender is `prefer_not_to_say`** is never excluded. Distance
  is a fact you cannot check at all; an unstated gender is a range of
  possibilities that very often includes what you asked for. Making answering
  honestly a reason to be hidden is the wrong trade.

Handing over GPS is a real cost, so a typed city is looked up in
`utils/cityCatalog.ts` — a centroid, not an address, which is coarse on purpose.
A miss does **not** block signup: `cityCatalog` is a hand-maintained table of about
forty cities and not a geocoder, so refusing to save would mean anyone outside it
could not finish registering at all. Instead the city is kept as typed, the
location step says the lookup missed, and the profile completes.

An unplaced profile sits at `0,0`, which makes it invisible to _other_ people's
nearby decks. That is the honest cost, and it is why the location step says so
rather than pretending. Its owner is unaffected: the "seeker's own coordinates
missing" rule above treats them as global, so their deck still loads in full.
Blocking the save instead would have been strictly worse — a profile that
exists and is visible to its owner, versus no profile at all.

### Empty decks say why

`FeedPage.blockedReason` names the dominant blocker, so the feed distinguishes
"your filters exclude everyone" from "there is nobody here yet". Blocker codes
are kept separate for the cases with different fixes: `already_swiped` is the
single most common real reason for an empty deck, and `their_requirements` means
somebody filtered you out. Both used to be reported as if a setting were wrong.

### Data model

`User` carries no questionnaire. Taste lives in `postReactions` instead, one row
per person per photo, and `utils/taste.ts` derives opinions from it. There is no
`taste complete` flag because there is nothing to complete before the deck works.

Records written by older builds still carry a `questionnaire` key.
`services/mock/migrate.ts` leaves it alone rather than deleting it: it is inert
now, and a migration that rewrites data nothing reads is how migrations lose
data.

`normaliseState` also brings up the whole stored blob. A database written before
the photo feed existed has no `posts` or `postReactions` keys at all, and reading
`.filter` off undefined would crash the landing page on first open. They are
defaulted to empty and the result is **reported as changed without triggering a
reseed** — reseeding is what throws away every account, swipe and message
somebody has, and the collections are append-only, so a pre-feed account loses
its (empty) feed history and nothing else. Posts with no usable tag are dropped
rather than surfaced, since they could neither render nor be scored on.

It also upgrades `preferences` and `location`. A record written before
`distanceMode` existed has a radius but no way of saying whether it was ever
live, so it is read as `nearby` — guessing `global` would double everyone's
radius on upgrade without telling anyone. And a `0,0` location is resolved from
its city label, because shipping the distance rules without that repair would
have quietly emptied every existing account's feed. An unresolvable city is left
at `0,0` rather than invented, and stays reachable on global.

## Profile photos

`components/ProfileImage.tsx` is the single place that decides between a real
photo and a generated avatar. A user with no upload, or one whose image fails to
load, gets initials on a colour derived deterministically from their id. Every
surface (swipe card, avatar, profile hero, match celebration) degrades the same
way.

Seeded profiles have exactly one photo with an **empty `url`**, which is what
triggers the avatar. Nothing is fetched over the network, so the app works fully
offline and the prototype ships no photographs of strangers.

Photos are editable from **Profile → Edit profile** as well as during onboarding,
via the shared `components/PhotoManager.tsx`:

| Action           | Gesture                 |
| ---------------- | ----------------------- |
| Add from library | tap the dashed `+` tile |
| Take a photo     | "Take a photo"          |
| Make primary     | tap a photo             |
| Delete           | long-press a photo      |

The last remaining photo cannot be deleted, because `isProfileComplete()`
requires at least one and removing it would drop you back into onboarding
mid-edit.

## Verification

FP1 called out honesty and proof as a core concern, so a verification flow is
scaffolded (`screens/profile/VerificationScreen.tsx`): selfie check, document
upload, or phone confirmation. The prototype marks you verified immediately so
the rest of the app can be exercised; the capture step is not implemented.

## Scripts

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Start the Expo dev server          |
| `npm run build`     | Export the web bundle              |
| `npm run typecheck` | `tsc --noEmit` across all packages |
| `npm run lint`      | ESLint across all packages         |
| `npm test`          | Jest across all packages           |
| `npm run format`    | Prettier write                     |
| `npm run dev --workspace=apps/api`         | Start the API on `:3001`      |
| `npm run migrate --workspace=apps/api`     | Apply `db/schema.sql`         |
| `npm run test:api --workspace=apps/mobile` | App services vs the live API   |
| `npm run admin --workspace=apps/api -- grant <email>` | Give an account admin      |
| `npm run rescore --workspace=apps/api`            | Recompute and store every ranking |
| `npm run admin:backfill --workspace=apps/api`     | Rebuild the tag vectors from the reactions |
| `npm run perf --workspace=apps/api`               | Time the rescore and the feed read   |
| `npm run perf:compare --workspace=apps/api`       | Time the cosine against the measure it replaced |

## Not built yet

Deliberately out of scope for a skeleton, and the natural next pieces of work:

- Real image upload, and real image hosting. Profile photos and imported feed
  photos are referenced as local file URIs, which iOS and Android can evict from
  cache; `ProfileImage` falls back to the avatar and `PhotoPostCard` falls back
  to a generated tile if the file disappears. Copying into the document
  directory is the fix. On web both are inlined as data URIs instead, which works
  across a reload but is bounded by the AsyncStorage quota rather than by a disk.
- A comment reaction on posts. `fp_reviews.md` asks for like *and* comment, on
  the argument that effort is what separates real users from bots. Only the like
  is built; the single-tap spam surface FP1 flagged is therefore still open.
- ~~Any moderation or admin role over the photo library~~ — **done in
  `apps/api`.** `users.is_admin` gates the library routes, and only
  `npm run admin -- grant <email>` can set it: there is deliberately no HTTP
  route that grants admin, because a "make me an admin" endpoint is a
  privilege-escalation surface. In mock mode the library is still open to
  anybody signed in, because the mock has no users table to check
- Push notifications, and the Redis-backed swipe rate limiting. **Real-time
  delivery is done** — a WebSocket at `/ws` over Postgres `LISTEN`/`NOTIFY` — but
  that is delivery to an open app, not a push to a closed one, and Redis (where
  `fp_reviews.md` wants the fan-out to live) is not built
- Offline caching and optimistic updates
- Localisation (only English strings exist)
- ~~Moving the score server-side~~ — **done.** The score is computed in SQL
  over a persistent tag vector, with a 30-day half-life on the evidence, and
  the ranking is stored by `npm run rescore` so the feed reads it in under 2ms
  rather than recomputing 1.2 seconds of affinity per request. The similarity
  measure is a cosine in both places now — server and client — so the deck is
  ordered by one measure and explained by the same one. The *weights* are still
  the client's constants, transcribed into `apps/api/src/matching.ts`, and the
  server's decay is not in the client's: the mock's tag weight has no half-life
  in it, so mock mode and the real app will not show identical numbers for
  identical evidence. Tuning the weights still means changing both
- Re-ranking the feed over time, rather than sorting purely by score
- Gating on sexual orientation and relationship goal. Both are scoring-only
  signals today, deliberately, and making them hard requirements is a product
  decision rather than a missing feature. Note that `mutualOrientation` is
  currently strict equality between two enum values, which is not how
  orientation compatibility actually works
- A real geocoder. `utils/cityCatalog.ts` is a hand-maintained table of city
  centroids standing in for one. A miss today costs a profile its visibility to
  other people's nearby decks, not their signup. FP2 would resolve city names
  against a gazetteer, server-side, and that closes the gap properly
- Distance-bounded database queries at any real scale. **Partly addressed by
  `apps/api`**, which runs the whole mutual eligibility gate in one SQL statement
  with a haversine distance instead of filtering 20 rows in the client. Still
  missing is the spatial index that makes it cheap — latitude/longitude are plain
  columns, so the distance is computed per row. PostGIS, or `cube` +
  `earthdistance`, is the fix
- Editing taste after answering a photo. **Profile → Taste profile** explains
  what was inferred and why, but a person cannot correct the inference directly;
  changing a like on a photo they already answered is the only lever
- Scoring the free-text notes on a prompt answer
- Admin tooling for the manual review flow FP1 proposed. There is a read-only
  account inspector (**Profile → Settings → Developer → Admin: all users**) that
  lists every seeded and locally registered user and opens the full stored
  record, but it only reads the mock database and is gated to mock mode. There is
  no reporting, no review queue and no real admin role yet.
