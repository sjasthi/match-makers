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
| Testing      | Jest + `@testing-library/react-native`                     |

## Layout

```
match-makers-fp3/
├── apps/
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
for the FP2 Postgres + Redis setup. It seeds 20 profiles and 24 tagged photos,
and supports login, registration, profile edits, swipes, matches, messaging, and
photo reactions.

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
- Any moderation or admin role over the photo library. It is mock-mode only and
  gated on nothing but being signed in in mock mode.
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
- Editing taste after answering a photo. **Profile → Taste profile** explains
  what was inferred and why, but a person cannot correct the inference directly;
  changing a like on a photo they already answered is the only lever
- Scoring the free-text notes on a prompt answer
- Admin tooling for the manual review flow FP1 proposed. There is a read-only
  account inspector (**Profile → Settings → Developer → Admin: all users**) that
  lists every seeded and locally registered user and opens the full stored
  record, but it only reads the mock database and is gated to mock mode. There is
  no reporting, no review queue and no real admin role yet.
