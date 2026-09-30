# Match Makers — FP3

Frontend prototype for the dating app described in FP2. This is a **skeleton**:
every screen, service and store exists and is wired together, but there is no
backend yet. Data comes from an in-app mock database, so the whole product can be
clicked through before the Express/Postgres/Redis API is built.

## Stack

| Concern | Choice |
| --- | --- |
| Client | React Native (Expo SDK 50) + React Navigation 6 |
| Language | TypeScript, strict mode with `noUncheckedIndexedAccess` |
| State | Zustand (session, feed, matches) |
| Server state | Plain async service functions behind the auth transport |
| Forms | react-hook-form + Zod, with schemas shared with the server |
| UI | react-native-paper (MD3) |
| Testing | Jest + `@testing-library/react-native` |

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

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXPO_PUBLIC_AUTH_MODE` | `mock` | Which auth strategy to use: `mock`, `jwt`, `session` |
| `EXPO_PUBLIC_API_URL` | `http://localhost:3000/api` | FP2 backend base URL |
| `EXPO_PUBLIC_MOCK_LATENCY` | `350` | Simulated round-trip time in ms |
| `EXPO_PUBLIC_MOCK_JITTER` | `250` | Extra random delay in ms |
| `EXPO_PUBLIC_MOCK_FAILURE_RATE` | `0` | 0–1; raise it to exercise error and retry states |

## Configurable auth

FP2 left the auth strategy open, so the three plausible options are all
implemented behind one interface and switchable **at runtime** from
Settings → Developer, or from the switcher on the login screen. No code changes
and no rebuild required.

| Mode | Credentials | Storage |
| --- | --- | --- |
| `mock` | None; local database | AsyncStorage |
| `jwt` | `Authorization: Bearer <accessToken>` | Access + refresh token in Keychain/Keystore |
| `session` | HttpOnly cookie, `withCredentials` | Session id only (the cookie is unreadable by design) |

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

## Matching

`apps/mobile/src/utils/matching.ts` scores a candidate out of 100 from shared
relationship goals, mutual orientation, age-range fit and whether the viewer
selects that gender. The card shows the percentage and a label.

This is a placeholder for the matching engine in FP2. The real scoring belongs
on the backend, where it can be tuned without shipping an app update — the
weights live in one function so they are easy to move.

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

| Action | Gesture |
| --- | --- |
| Add from library | tap the dashed `+` tile |
| Take a photo | "Take a photo" |
| Make primary | tap a photo |
| Delete | long-press a photo |

The last remaining photo cannot be deleted, because `isProfileComplete()`
requires at least one and removing it would drop you back into onboarding
mid-edit.

## Verification

FP1 called out honesty and proof as a core concern, so a verification flow is
scaffolded (`screens/profile/VerificationScreen.tsx`): selfie check, document
upload, or phone confirmation. The prototype marks you verified immediately so
the rest of the app can be exercised; the capture step is not implemented.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Expo dev server |
| `npm run build` | Export the web bundle |
| `npm run typecheck` | `tsc --noEmit` across all packages |
| `npm run lint` | ESLint across all packages |
| `npm test` | Jest across all packages |
| `npm run format` | Prettier write |

## Not built yet

Deliberately out of scope for a skeleton, and the natural next pieces of work:

- Real image upload. Picked photos are referenced as local file URIs, which
  iOS and Android can evict from cache; `ProfileImage` falls back to the avatar
  if the file disappears. Copying into the document directory is the fix.
- Push notifications and the Redis-backed swipe rate limiting
- Offline caching and optimistic updates
- Localisation (only English strings exist)
- Real matching algorithm, and re-ranking
- Admin tooling for the manual review flow FP1 proposed
