# Match Makers — FP3

Frontend prototype for the dating app described in FP2. This is a **skeleton**:
every screen, service and store exists and is wired together, but there is no
backend yet. Data comes from an in-app mock database, so the whole product can be
clicked through before the Express/Postgres/Redis API is built.

## Stack

| Concern      | Choice                                                     |
| ------------ | ---------------------------------------------------------- |
| Client       | React Native (Expo SDK 50) + React Navigation 6            |
| Language     | TypeScript, strict mode with `noUncheckedIndexedAccess`    |
| State        | Zustand (session, feed, matches)                           |
| Server state | Plain async service functions behind the auth transport    |
| Forms        | react-hook-form + Zod, with schemas shared with the server |
| UI           | react-native-paper (MD3)                                   |
| Testing      | Jest + `@testing-library/react-native`                     |

## Layout

```
match-makers-fp3/
├── apps/
│   ├── mobile/            Expo app
│   │   ├── App.tsx        Providers: SafeArea, Paper, Navigation
│   │   ├── assets/        Placeholder icons
│   │   └── src/
│   │       ├── components/   SwipeCard, SwipeActions, FormField, Avatar...
│   │       ├── constants/     Colours, spacing, env config
│   │       ├── hooks/        Store selectors, useAsync
│   │       ├── navigation/   Root, Auth, Onboarding, MainTabs, Profile, Chat
│   │       ├── screens/      auth / onboarding / main / profile / chat
│   │       ├── services/     auth adapters, api client, mock backend
│   │       ├── stores/       Zustand stores
│   │       ├── types/        App-level view types
│   │       └── utils/        mock data, compatibility scoring
│   └── shared/            Types + Zod schemas used by client and server
└── tools/
    └── eslint-config/     Shared lint rules
```

`@match-makers/shared` holds the domain model and validation schemas. It exists
so the FP2 backend can import the exact same types and validation the app uses,
rather than letting the two drift apart.

## Getting started

```bash
npm install
npm run dev          # or: npm start --workspace=apps/mobile
```

Then press `w` for web, `a` for Android, or `i` for iOS. No server is required.

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
| `EXPO_PUBLIC_AUTH_MODE`         | `mock`                      | Which auth strategy to use: `mock`, `jwt`, `session` |
| `EXPO_PUBLIC_API_URL`           | `http://localhost:3000/api` | FP2 backend base URL                                 |
| `EXPO_PUBLIC_MOCK_LATENCY`      | `350`                       | Simulated round-trip time in ms                      |
| `EXPO_PUBLIC_MOCK_JITTER`       | `250`                       | Extra random delay in ms                             |
| `EXPO_PUBLIC_MOCK_FAILURE_RATE` | `0`                         | 0–1; raise it to exercise error and retry states     |

## Configurable auth

FP2 left the auth strategy open, so the three plausible options are all
implemented behind one interface and switchable **at runtime** from
Settings → Developer, or from the switcher on the login screen. No code changes
and no rebuild required.

| Mode      | Credentials                           | Storage                                              |
| --------- | ------------------------------------- | ---------------------------------------------------- |
| `mock`    | None; local database                  | AsyncStorage                                         |
| `jwt`     | `Authorization: Bearer <accessToken>` | Access + refresh token in Keychain/Keystore          |
| `session` | HttpOnly cookie, `withCredentials`    | Session id only (the cookie is unreadable by design) |

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
for the FP2 Postgres + Redis setup. It seeds 20 profiles and supports login,
registration, profile edits, swipes, matches and messaging.

Domain services (`services/feed.ts`, `services/matches.ts`, `services/profile.ts`)
each have a mock branch and an HTTP branch, chosen by
`getAuthAdapter().mode`. So the same screen code exercises both paths.

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

## The questionnaire and the match score

Signup is Welcome, Basics, Intent, Photos, Location. Nothing about the
questionnaire is asked there.

**Nobody is matched until the questionnaire is answered.** The feed opens onto
the questionnaire instead of a deck, because a percentage over an empty answer
set would imply a match we have no basis for. Once every step is answered the
deck appears, ranked by score, with the reason for each score.

### The session

`screens/prompts/MatchSetup.tsx` runs the whole questionnaire as one continuous
session that takes the place of the deck. Answering a step advances immediately
with no navigation, because it is not a route you enter and leave.

| Step | Asks                                                                                |
| ---- | ----------------------------------------------------------------------------------- |
| 1    | What matters to you — pick up to 5 values, grade each 1 to 5, optional deal breaker |
| 2    | Day to day — schedule, exercise, smoking, drinking, pets                            |
| 3-10 | One tagged prompt each                                                              |

Cancel throws away the answer you just gave, stores nothing for that step, and
moves to the next question. Skipped steps are listed at the end and stay
answerable, so nothing is lost and the session is never a trap.

`src/prompts.ts` holds the registry. The eight tagged prompts are real questions
carrying a `PromptTag`, and each accepts the same four answers
(`PromptChoice`):

| Prompt                                              | Tag         |
| --------------------------------------------------- | ----------- |
| I want kids                                         | `family`    |
| My ideal weekend is spent outside                   | `leisure`   |
| I'd rather cook than eat out                        | `food`      |
| Music matters more to me than film                  | `music`     |
| I'd rather be learning something than resting       | `learning`  |
| I want to travel far rather than often              | `travel`    |
| Sundays are for doing nothing                       | `recovery`  |
| Doing what you said you would is how I earn respect | `character` |

Tagged prompts replaced a flat list of 24 interest tags, which we scored and then
measured: almost no two seeded people picked the same set, so the signal never
moved off zero (median Jaccard 0.11). Answering the same question is comparable;
independently picking from a long list is not.

Lifestyle is offered once rather than required. It ships with valid defaults, so
blocking on it would invent work, but leaving it unreachable would mean those
defaults were never actually chosen.

### Scoring

`utils/matching.ts` scores a candidate out of 100 from what both people answered
plus the basic eligibility signals. The card shows the percentage and a label.

| Signal             | Points |
| ------------------ | ------ |
| Value alignment    | 30     |
| Relationship goal  | 20     |
| Mutual orientation | 10     |
| Age fit            | 10     |
| Gender preference  | 10     |
| Lifestyle          | 10     |
| Prompt overlap     | 5      |
| Verified           | 5      |

`valueAlignment` is how much of what one person cares about the other covers,
weighted by their own 1-5 ratings, averaged over both directions so neither side
can inflate it by listing more. Deal breakers are a **veto, not a deduction**:
if either person named something non-negotiable and the other lacks it, the
score is capped at 24.

The swipe card names the prompts you share and shows one as an icebreaker. The
profile screen breaks the score into named signals with the points each earned,
including the ones that earned nothing.

This still runs on the device. FP2 wants it server-side so the weights can be
tuned without an app update.

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

`UserQuestionnaire` in `apps/shared` holds `values` + `importance` +
`dealBreakers`, `prompts`, and `lifestyle`. `questionnaireSchema` enforces the
invariants: every picked value is graded, a deal breaker is one of the values,
and no two prompts share a tag.

`hasCompleteQuestionnaire` gates the deck. Account creation does not gate on it,
because the questionnaire is answered in the feed.

Partial answers are written through `services/mock/migrate.ts`, the same code
that upgrades records written by older builds. A half-answered questionnaire
cannot satisfy the full schema on the way out, so it is normalised instead, and
whatever lands in storage is always well formed even while incomplete.

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

## Not built yet

Deliberately out of scope for a skeleton, and the natural next pieces of work:

- Real image upload. Picked photos are referenced as local file URIs, which
  iOS and Android can evict from cache; `ProfileImage` falls back to the avatar
  if the file disappears. Copying into the document directory is the fix.
- Push notifications and the Redis-backed swipe rate limiting
- Offline caching and optimistic updates
- Localisation (only English strings exist)
- Moving the score server-side, so the weights can be tuned without an app update
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
- Distance-bounded database queries. The rules run in the client over the whole
  candidate set, which is fine for 20 rows and wrong for a real pool. That wants
  a spatial index, which is the same reason the score wants to move server-side
- Editing the questionnaire once it is answered. Cancelled steps can be picked
  up from the session's own summary, and **Profile → Match profile** shows
  everything read-only, but there is no editor for changing an answer
- Scoring the free-text notes on a prompt answer
- Admin tooling for the manual review flow FP1 proposed. There is a read-only
  account inspector (**Profile → Settings → Developer → Admin: all users**) that
  lists every seeded and locally registered user and opens the full stored
  record, but it only reads the mock database and is gated to mock mode. There is
  no reporting, no review queue and no real admin role yet.
