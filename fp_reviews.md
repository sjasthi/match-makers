[FP1] 9/15/2026
Try to come up with success criteria project.
Do research about 'what is out there in the market'
We also need to emphasize  honesty and proof. How do we weed out the liars from the website?

# Success Critera
- *Research and understand why people go to use those application*
- *Know what architecture we are going to follow for our project*
- *Have dates where the each task shall be done by*
- *Have the project be presentation and convient*
- *Be able to solve multiple problems with simplicity*

# Current Market for Dating Applications
1. Hinge | Focuses on serious relationship by forcing a person to like or make a comment on the profile before proceeding (Creating effort and meaningful)
2. Bumble | Women first, Also offers a choice to finding friends only mode and professional networking.
3. Tinder | Convience, easy for user to use where it can cover multiple area of intent
4. Grindr | Focuses on a specific group of audience.

Core takeaway: In these applications, there are the concept of focusing either on the Broad-audiance of any sex/gender focused or a Niche-audience with specific preference.
This can affect the way someone wants to use your application or not. There isn't one exact applcation that can solve every single preference. So in this case, we would have to decide
what kind we want to focus on. There is also specific ways each application match people, such as Tinder has high volume level of matches vs Hinge where the person has to actually interact with 
someone's profile in order to initiate a conversation (Limiting the amount of likes per day).

# How do we emphasize honesty/proof
- One way to utilize that is allow a limited amount of ways to interact such as hinge, this can allow for a way to weed out the bots prevents spamming.
- Having to verify specific information such as ID/Puzzle/Some sort of biometric check (A way that is not intrusive also)
- Connected accounts from other verfied applications
- Manual confirmation
- Allow other users to manually report and have manual admins review

[FP2] 9/22/2026
### Determine what architecture we want run and what is the tech stack that we will be utilizing.
    [Client Application] -> [API Gateway / Reverse Proxy (Nginx)]  
    [API Gateway / Reverse Proxy (Nginx)] -> [Backend Application]  
    
    #Inside backend contains  
    [Auth] [Matching and Feed engine] [Profile] 

    [Auth] -> [PostgreSQL DB]
    [Matching and Feed engine] -> Our own calculation
    [Profile] -> Redis

Why this architecture?
1. Identity module for auth, simple for now can implement later on
2. Profile to allow for a person to create their own account and upload picture/bios, more information about themselves for another person
3. Matching, we will add custom calculator of matching, this allows the person to match with another based on the information
4. Client application is to allow the user to easily interact with the application.

What is our tech stack for this project?
1. React Native - This is the frontend for the client application
2. Node.js with Express.js - Backend API helps manage asynchronous operations and handling swipe workload, also helps with rendering
3. PostgreSQL - The primary relational database which will be used for profile data, interactions and matches.
4. Redis - In-memory caching and session management, this helps keep the real time swipe fast and prevent bot spam

[FP3] 9/29/2026
### This assignment focuses on account creation.
When a person creates an account we will ask them a questionnaire, the answers from that questionnaire will
eventually be used in a future implementation of a match-match system that matches people through a percentage.

Questionnaire outline (first pass):
- Basics: name, date of birth, gender
- Intent: sexual orientation, relationship goal
- Values and interests: what actually matters to them in a partner
- Lifestyle: schedule, habits, kids, smoking/drinking
- Location: city/coordinates plus the age range and distance they are looking for
- Photos: at least one photo, connects to the honesty/verification work from FP1

How this connects to the match percentage
- The feed already shows a percentage today, it comes from scoreCompatibility in
  matchmakerApp/apps/mobile/src/utils/matching.ts, we are keeping those weights for now and not changing them
- The questionnaire is the data we will need later, the real scoring stays in the Matching and Feed engine
  from FP2 so weights can be tuned without shipping an app update
- This assignment is only about collecting the answers, the percentage math is future work

[FP4] 10/6/2026
### This assignment focuses on making the match interactive instead of static.
So far a user swipes a card and the percentage is derived only from what two people
already told us about themselves in the questionnaire. Nothing in that score says
anything about how two people actually behave, and nothing on the card gives the
user a reason to care about the person on it. For this iteration we want to add a
photo feed people can post into, tag, and react to, so that liking the same content
becomes an actual signal the matcher can read.

What we built is the same idea with the post authorship removed, and that turned
out to be the part that mattered. Posts belong to the site, not to a profile, so
there is no "this is Priya's cat" to react to; what a reaction records is taste,
and taste is only useful pairwise. If Priya liked the cat photo and you liked it
too, that is a specific shared choice, and it moves your match percentage for
each other. If she liked the dog photo and you liked the cat photo, and both are
tagged `animals`, you have still found each other, just more weakly. Three people
who all liked the cat photo are all pulled towards each other, pairwise. When that
happens we tell them why, in words, instead of showing a bare number.

Shared feed outline (first pass):
- Post: one image belonging to the site, with tags somebody types
- Tag: we went back and forth on this one and got it wrong the first time. We built
  a closed set of ten, on exactly the reasoning we used for the questionnaire tags:
  the matcher has to compare two people and free text gives it nothing to compare.
  That reasoning turned out to be aimed at the wrong problem. A ten word vocabulary
  is a hard limit on what a photo library can describe, and "nothing to compare"
  is solvable by folding spelling instead of by forbidding words. Tags are now
  typed and committed with enter, capped at eight, ordered, and the first one is
  the primary tag a co-like is credited to in the match reason
- The fold: trim, collapse spaces, lowercase, and drop a plural "s" only when the
  word is longer than three characters and does not end in ss, us or is. That guard
  exists because the naive version turns `fitness` into `fitnes` and `bus` into `bu`,
  and those would still match each other consistently so nothing would visibly
  break, the chip would just be misspelled on the screen the admin is using to check
  their work. The known cost is that `news` folds to `new` and those two connect
  when they should not. We accepted that rather than take a dictionary dependency
  or build an alias table, and we are writing it down so it is a decision on the
  record rather than a bug someone finds later
- Suggestions: typing shows the tags already in the library, ordered by how often
  they are used. Nothing is blocked. Free text means everyone invents their own
  vocabulary and the drift is silent, two people typing `dog` and `kitty` simply
  never connect and nothing reports it, so suggesting is what keeps the signal from
  fraying without taking the choice away
- Reaction: a like and a dislike. Only the like is evidence, because two people
  disliking the same photo have not agreed on anything; a dislike only steers the feed
- Not attached to a profile. We tried this and it made the signal weaker, not
  stronger. Once a post has an author, "you both liked it" reads as two people
  being interested in the same person, which is a different and much more
  sensitive claim than "you two like the same sort of thing", and it is one the
  prototype has no way to make honestly. Posts are site-owned content and the feed
  is an input device rather than a social surface
- Feed: one full-screen photo at a time, and it is now the **landing tab**. The deck
  moved to a second tab. That was not the original plan, but the deck cannot be shown
  before the questionnaire is answered and the feed can, so leaving the feed as a
  separate destination meant a new account landed on a form and we had not fixed
  the problem we set out to

Pairwise taste as a match signal
- Two people liking the same photo is a shared-interest hit we can score the way we
  score shared questionnaire answers, and it is harder to fake than a tag on a profile
  because it cost an action on a specific image
- A reaction is directional and behavioural rather than a stated preference, which is
  the same honesty problem FP1 flagged
- The percentage moves when two people like the same photo, and to a lesser extent
  when they like different photos that share a tag. Co-liking is weighted 0.65 and the
  tag overlap 0.35, both saturating, and the whole thing is damped by the weaker side's
  evidence so one very active user cannot look compatible with everyone. That last
  part answers the open question we left at the bottom of this section

The reason, in words
- This is the Hinge idea from our FP1 market research, the person has to interact with
  something before they can proceed
- A match should come with a sentence the user can check, "you both like posts tagged
  pet/cat", and the profile screen already breaks the score into named signals so
  there is a place to put it
- A reason is also the thing that makes a low percentage acceptable, if the number is
  62 and the sentence underneath says why, the user has something to do with it

How this connects to the match percentage
- scoreCompatibility in matchmakerApp/apps/mobile/src/utils/matching.ts stays the
  source of the percentage and keeps its FP3 weights. The reaction signal is added
  alongside them: TASTE_WEIGHT = 10, additive, with the total still capped at 100, so
  taste can break a tie between two people the engine already likes but cannot promote
  a weak pair on its own
- The real scoring still belongs in the Matching and Feed engine from FP2, the posts
  and reactions are the new data it reads
- The old open question is answered and the weights are still open. A shared reaction
  is worth up to 10 of 100, and it saturates on both halves: `n / (n + 2)` for co-likes
  and a containment ratio for tags, so the tenth photo somebody likes is worth a
  fraction of the first. Confidence is `min(1, min(likesA, likesB) / 5)`, measured
  against the smaller evidence base, so one person's 500 likes cannot make a stranger
  compatible. What we do not have is real data to tune any of those numbers against

Where it landed
---------------
- Landing tab is `PhotoFeedScreen`: one site-owned photo, like or dislike, plus a
  summary of what has been learned and who it has moved. The deck is `LikesScreen`,
  the second tab, still gated on the questionnaire.
- `utils/taste.ts` holds the affinity maths, derived from the reactions table on every
  read so there is no cache to invalidate and no field to migrate. `utils/taste.test.ts`
  pins it, including the case that motivated the design: no photo in common, one tag
  in common, non-zero.
- Tags are free text. `normaliseTag` in apps/shared/src/tags.ts is the one rule
  that makes them comparable, and `postTagSchema` applies it at the storage gate so
  nothing un-canonical reaches the database even if a caller forgets. De-duplication
  lives there too, for the same reason: folding is what makes `Dogs` and `dog` one
  tag, and a stored duplicate would double-count a reaction in the taste index and
  inflate that person's affinity with everyone who liked the photo
- `TagInput` in components, shared by the importer and the retag editor so the two
  behave identically. Enter commits without dismissing the keyboard because three
  tags in a row is the common case; backspace on an empty field steps back through
  the chips; the chip shows the folded form so the admin sees the exact spelling that
  will be compared against everybody else's
- Settings -> Admin: photo library is the only write path in the app. This was not in
  the outline. The outline assumed users would upload their own posts, but posts have
  no author here, so somebody has to fill the library and an import screen is what
  that looks like in a prototype with no backend.
- Not built: the comment reaction. FP1's argument was that effort separates people from
  bots and a one-tap like is the spam surface, so the spam surface is still open.

[FP5] 10/13/2026
### This assignment removes the FP3 questionnaire.
FP3 put a questionnaire in front of the deck and locked it, on the premise that ranking
needs a stated answer set. FP4 built a photo feed that produces a better answer set from
behaviour, so the gate was the last thing standing in the way. The questionnaire is gone
and taste is the ranking signal.

What was removed
----------------
- The questionnaire domain out of `apps/shared`: `UserQuestionnaire`, `PromptAnswer`,
  `PartnerValue`, `LifestyleAnswers`, their enums, the `questionnaireSchema` invariants,
  and the `questionnaire` field on `User` and `ProfileSetupPayload`.
  `screens/prompts/MatchSetup.tsx`, `prompts.ts`, `ImportanceScale.tsx` and
  `MatchProfileScreen.tsx` are deleted.
- Deal breakers. They were a veto on a score, and there is nothing left on a profile to
  declare as non-negotiable now that taste is inferred.
- `hasCompleteQuestionnaire` and every gate that called it.

Preferences became the hard gate
--------------------------------
Relationship goals were collected, validated and stored for three releases without ever
being compared to anything. They are now a requirement, not a scoring signal, and the
gate runs in both directions in `utils/eligibility.ts`, which owns `mutualGate`: you are
shown only people whose accept-list you are on and who have you on theirs. A pair who
fail a preference is not fixed by a perfect 100% taste match, so taste only ranks people
the gate has already cleared. An empty goal list means "no stated preference", not
"everyone is acceptable", so an abandoned signup is unranked rather than invisible to
everybody.

Scoring is now taste-dominant
-----------------------------
| Signal              | Points |
| ------------------- | ------ |
| Shared taste        | 80     |
| Relationship goal   | 10     |
| Mutual orientation  | 6      |
| Verified            | 4      |

Nothing is gated behind taste any more, so there is a **STILL BUILDING UP** strip under
`PHOTOS_FOR_FULL_TASTE = 10` answers instead of a lock.

Where it landed
---------------
- `Profile -> Match profile` is now `Taste profile`, built from `postReactions` rather
  than stored answers. Admin accounts report `answeredPhotos` instead of questionnaire
  completion.
- Records written by older builds still carry a `questionnaire` key.
  `services/mock/migrate.ts` tolerates the unknown field rather than deleting it, pinned
  by a test. It is inert, and a migration that rewrites data nothing reads is how
  migrations lose data.
- Not built: an editor for the taste signal itself. A person can change a like on a photo
  they already answered, but there is no way to say "this is wrong" about what was
  inferred.

### Two reversals after watching somebody use it

**1. The deck no longer opens on a card ranked on nothing.**

Removing the gate left a brand new account on one full-screen "11% match, not enough to
go on" card — a number built entirely from goal affinity, orientation and a verified
badge, with no reason sentence. It taught everybody who looked that the percentage meant
nothing.

Zero likes now returns an empty deck with `needsTaste` set, and the empty state says in
those words that liking a photo or two is what unlocks it. One **like**, specifically, not
one answer: dislikes never become shared evidence, they only steer the feed, so a history
of pure passes leaves exactly as much to rank on as no history at all. This is
deliberately not the questionnaire gate coming back — that demanded ten curated answers,
this asks for one tap. Between one and nine likes the STILL BUILDING UP strip still
renders alongside a working deck.

**2. The deck is a grid of people, not a stack of cards.**

One card at a time hid the shape of the pool, and being handed a single profile read as
being told who to like. The Likes tab now shows everybody the matcher is offering at
once — avatar, name, the deck's own percentage, the reason — and deciding is still one
person at a time: tapping a card opens them full screen with the like/pass buttons, as a
modal, closing back to the grid rather than advancing to anybody the person did not
choose.

`feedStore.swipe` now takes a userId rather than deciding about whoever happened to be on
top of the stack, which is what `activeIndex` was. The tile itself is `PersonTile`,
shared with the Taste Profile grid, because a person should look like a person wherever
the app shows them one.

[FP6] 10/20/2026
### Put the database we planned in FP2 in front of us instead of sketching around it.
FP2 committed to Node/Express + PostgreSQL + Redis and every layer since has simulated
it. `MockDatabase` is one AsyncStorage blob rewritten in full on every mutation, with
passwords stored verbatim and its invariants enforced in application code one
`Array.find` at a time. `apps/api/db/schema.sql` is that schema as real Postgres
tables, and the demo is the thing the blob cannot do: the constraints hold whether or
not anybody remembered to check.

- 8 tables, 6 enums, no ORM. The model in `apps/shared` stays the source of truth and
  Zod validates at the API boundary.
- The rules moved from code into the database: a `Set` became
  `UNIQUE (actor_id, target_user_id)`, a load-search-rewrite cycle became
  `UNIQUE (user_id, post_id)` with `ON CONFLICT DO UPDATE`, a "my side" of a match row
  became `CHECK (user_a_id < user_b_id)`, and a hand-written cascade became
  `ON DELETE CASCADE`.
- A minimal Express API on the paths the app already calls, scrypt passwords via
  `node:crypto`, and the eligibility gate as one SQL statement applied in both
  directions instead of a scan over every user in the client.
- Still outstanding, and said so in the README: Redis, PostGIS, the client-side
  compatibility score, and the fact that the API has no tests.

### Then the app was pointed at it, and this is where most of the time went.
- `EXPO_PUBLIC_AUTH_MODE=jwt`. Every screen runs its HTTP branch against `apps/api`
  and Postgres; the mock is one variable away and the 461 tests still run on it.
  `apiConnection.test.ts` drives the app's own services against a live server --
  register, react, build a deck, match, message -- which answers "is it actually
  connected?", a question that otherwise has no answer.
- **The API moved to the app, not the other way round.** The HTTP branches had never
  been executed and did not match the contract they were written against: the wrong
  route for messages, `RegisterData` rather than `registerSchema`, `FeedPage` rather
  than `Paginated<T>`. Twenty-odd call sites in working code outrank a route table
  nobody had run, and one interceptor now unwraps the envelope so those sites keep
  working.
- Refresh tokens exist now, because `AuthTokens` has always required one. They rotate
  on use and a replay revokes the whole family.
- A trap worth recording: `babel-preset-expo` inlines `process.env.EXPO_PUBLIC_*` at
  transform time, so pointing the app at the API silently turned all 28 screen suites
  into tests trying to reach a real server. `jest.setup.ts` now pins the mock unless
  `RUN_API_TESTS=1`.

### Admin, because `DELETE /posts/:postId` had no authentication whatsoever
Any anonymous request that knew the URL could delete a photo and cascade away its
reactions, and no test caught it, because every test exercised the paths the app
happened to call.

- `users.is_admin`, set by a CLI (`npm run admin -- grant <email>`) rather than a
  route: a `POST /admin/grant` would be reachable by anyone who could authenticate.
- `requireAdmin` reads the flag per request, so revoking it takes effect immediately.
  Anonymous gets 401, signed-in non-admin gets 403.
- Two bugs found by tests written after the fact: `requireAdmin` was `async` and
  unwrapped, so the first anonymous request to any `/admin` path killed the server; and
  `GET /feed` dropped any candidate whose distance expression was NULL, so a viewer
  who had not chosen a city became invisible to everyone who had.

### The matching engine was not on the server at all
`GET /feed` returned `tasteAffinity: 0` for every candidate and ordered by
`created_at` -- registration order, not affinity.

- The client's `scoreCompatibility` is transcribed into SQL, constants and all,
  because a deck ordered one way and explained by another is a lie with two authors.
  `user_tag_affinity` holds one row per person per tag, so changing your mind takes the
  old opinion back rather than counting both.
- **Recency:** `effective = (likes - dislikes) * exp(-age * ln(2) / half_life)`, 30-day
  half-life, applied at read time rather than write time. A unit test caught that the
  `ln(2)` was missing -- without it the stated 30 days was an e-folding, 0.37 rather
  than 0.5.
- **The ranking is a stored result.** Computing affinity live measured 569ms over
  400,000 rows, paid on every feed request to answer a question that only changes when
  somebody reacts. `npm run rescore` computes it into `match_scores`: 20ms over 2,000
  candidates and 4,000,000 stored scores.
- **Bands** 50 / 75 / 90, computed server-side. Aged evidence moves a pair across one:
  fresh evidence scored 66, and at 60 days the same pair was 42.

### Real-time messaging did not exist
It is now a WebSocket at `/ws` over Postgres `LISTEN`/`NOTIFY`, which needs no new
infrastructure, and the payload is a pointer rather than the message so there is still
one source of truth. The first version delivered every message twice, because it both
notified the database and handed the payload straight to the sockets.

### The three gaps that were left, all of which were real
- **The GIN index on `posts.tags` did nothing.** An index nothing uses is a write cost
  with no benefit, so it needed a query or a deletion. It got the query -- a tag filter
  on the photo library -- using `@>`, whose operands are not interchangeable. 0.38ms
  with the index, 8.45ms without.
- **The app did not consume the socket.** The client now owns one socket for the whole
  app, with the access token in the query string because a browser cannot set headers
  on a handshake. It is an optimisation and never the only way a message arrives: when
  it is not connected the chat polls every five seconds and says so.
- **The similarity measure was not cosine or Jaccard.** It divided the shared weight by
  the smaller tag count, which said that somebody with two strong opinions and somebody
  with two hundred were equally matched. It is now a cosine, in the server's SQL *and*
  the client's `taste.ts`. Two people with the same taste now score 80 rather than 70,
  which puts the 75% band within reach for the first time, and the curve is what the
  spec asked for: 25, 38, 51, 66, 81, 83, 85, 86, 86, 87.

### Image quality, which looked like "the upload lost its quality"
The importer defaulted to 1200px, but the viewer renders at the full viewport width, so
the photo was being *upscaled*. It is now sized from the display under a byte budget,
up to 2880px, and profile photos go through the same path -- they used to be stored
verbatim, and two of them were eighteen megabytes of the database.

The real fix was a `srcset` problem, not a resizing one: one image cannot serve a 342px
grid tile and a full-width viewer on a 2x display. `post_images` now holds a ladder of
renditions (640 / 1280 / 2560 / full) and the app picks the smallest that is not
smaller than display width times device pixel ratio. Writing the test for that rule
caught the first implementation taking the *first* big-enough rung, which is the
*largest* one and makes the ladder pointless. The honest limit: a 2720px photo is still
soft on a 2560-point window at 2x. Only a higher-resolution source adds more pixels.

[FP7]
### This iteration fixes the matching weights and the logic behind them.
FP5 made taste the ranking signal and left the other three signals worth 20 points
between them. FP6 moved the same formula into SQL so the server could rank by it.
Both are right about the ranking and neither fixed what the number means, so this
iteration rewrites the rule itself rather than the code that implements it.

The one-line version: **out of 100 points, 90 come from shared photo taste and 10
from mutual orientation. Everything else decides who is in the deck at all, and the
verified badge is a badge.**

What is wrong with the weights today
------------------------------------
- **Goals are counted twice.** FP5 made relationship goals a hard gate in
  `utils/eligibility.ts` and left 10 points for "how alike your goals are" in
  `utils/matching.ts`. A pair that fails the goal gate never appears in the deck,
  and a pair that passes it still gets partial credit for disagreeing about it. Age
  and gender were taken out of the score in FP5 for exactly this reason -- "filtered
  out *and* worth 20 points between them" -- and goals are still both. The ladder
  itself (`long_term` 3, `short_term` 2, `casual` 1, `friendship` 1, `not_sure` 0)
  is transcribed four times: client scorer, API rescore, API feed fallback, SQL goal
  rank. That is why it never got simpler.
- **Verified is worth 4 points and nobody has been verified.** `isVerified` is
  self-declared: `POST /profile/verification` flips the flag and records the method
  without checking a document. So the score pays 4 points for a badge the person
  awarded themselves, one-directionally -- a verified stranger outranks an
  unverified one with identical taste. It is a trust badge, not a measure of
  compatibility, and it should not be worth points.
- **Two band systems that disagree.** The card reads "Strong match" from 80
  (`compatibilityLabel` in the app), the server badge reads `50+` / `75+` / `90+`, so
  49 is "Worth a look" to the app and "below-50" to the server. The spec asked for
  50 / 75 / 90, and there should be one table of thresholds somewhere.
- **The API invents a score on a different scale.** The feed falls back to "the
  stated facts" for anyone the rescore has not reached: 10 goal + 6 orientation + 4
  verified, out of 20, shown in the same UI as a score out of 100. That is the
  "11% match" card FP5 deleted from the app, rebuilt on the server.
- **The deck order is stale.** `match_scores` only changes when `npm run rescore`
  runs, so the app's own promise -- "your deck reorders as you go" -- is true in
  mock mode and false against the API, where the client recomputes and the server
  does not.

The rule we are moving to
-------------------------
- **Taste 90, mutual orientation 10, nothing else.** Goals, age, gender and distance
  are gates and stay gates: a pair that fails one is not in the deck, so scoring it
  as well would pay twice for the same rule. Orientation keeps some points because it
  is not a preference anybody gets to impose on a stranger, and 10 keeps it visible
  without letting it outvote shared taste.
- **One definition, in `apps/shared`.** The weights, the bands (50 / 75 / 90) and the
  words on the card live in the shared package and are imported by the app and by the
  API. The taste constants (`CO_LIKE_SHARE`, `TAG_SHARE`, `CONFIDENCE_MIN_LIKES`,
  `CO_LIKE_SATURATION`, `PHOTOS_FOR_FULL_TASTE`) are transcribed on both sides today,
  and the goal ladder is transcribed four times. The ladder is deleted rather than
  centralised, because a gate does not need a ladder.
- **No evidence, no number.** A pair with nothing shared scores 0 and says so, and a
  candidate nobody has rescored shows "not scored yet" rather than a number out of 20.
- **One ordering, and it is fresh.** The deck is ordered by the same function the
  card explains, and reacting re-ranks you there and then rather than waiting for a
  batch.

Where it lands
--------------
- `apps/shared/src/matching.ts` holds `MATCH_WEIGHTS`, `MATCH_BANDS` and the label for
  a score. The app's `utils/matching.ts` and the API's `src/matching.ts` import them,
  and their own copies go away.
- `utils/eligibility.ts` does not change. It already does the gating, and this leaves
  it alone rather than moving it.
- `apps/api/src/routes/feed.ts` loses the fallback score. `match_scores` is the only
  source of a percentage, and a candidate with no row is "not scored yet".
- A reaction rescores the person who reacted, so "your deck reorders as you go" is
  true against the API and not only in mock mode.
- One table-driven test pins the client scorer and the server SQL to the same numbers
  for the same inputs. That is the drift check this has been missing since FP6
  copied the formula rather than sharing it.
- Not built: real verification, so the badge still means nothing and now only says
  it; a background worker, so other people's decks still wait for the next batch; and
  any tuning of the numbers against real data, because there is none yet.

[FP8] 11/03/2026
### Admin-reviewed photo verification.
The previous verification endpoint let users award themselves the badge. FP8 replaces
that with a small manual-review workflow suitable for the capstone demonstration.

Brief:
- A user submits one photo from their profile. For the demo, any photo is accepted
  as an upload; there is no selfie match, ID check, or automated identity check.
- The submission is `pending` until an administrator accepts or declines it from the
  verification review queue. An accepted request sets the existing profile badge;
  a declined request remains unverified and can be resubmitted.
- Review uses the existing `requireAdmin` middleware. The submitted image is kept
  separate from public profile photos and is only returned by admin-protected routes.
- The badge remains visual only. FP7 removed verification from match scoring, and
  this workflow does not restore it.
- Since an arbitrary photo cannot prove identity, the demo describes the badge as
  admin-reviewed rather than a guarantee that the account represents a real person.

[FP9]
### Real-time match and message updates.
This iteration fixes stale match and conversation screens. It does not try to
broadcast every database change; profile, photo-library and verification updates
remain out of scope.

Process:
- A newly created mutual match notifies both participants, so their Matches and
  Messages lists refetch without a manual refresh. Repeated likes do not announce
  the existing match as new.
- A saved message notifies the conversation participants. Notifications are
  invalidation pointers; clients refetch the message or list from the API.
- Queue Postgres `NOTIFY` in the same transaction as the match or message write.
  The listener resolves recipients from the stored match, not from client-chosen
  recipients.
- Since `NOTIFY` is not durable, connected clients refetch when the WebSocket
  becomes ready after reconnecting. Focused Matches and Messages lists poll the
  API every five seconds while the socket is unavailable; Chat keeps its existing
  polling fallback.
- Test two connected participants and an unrelated account, duplicate match
  creation, event-driven refetch, and reconnect recovery.

[FP10] 11/11/2026
### Bundle account setup, matching, verification and messaging into one demonstration.
FP10 is the end-to-end capstone walkthrough, not a new matching rule. The demo
starts with newly created accounts and follows them through profile setup, a mutual
match, verification review and a conversation. It uses the profile photos and shared
photo library already in the app.

Demonstration flow
------------------
1. **Create accounts and profiles.** Register two user accounts, complete their
   profiles and discovery preferences, and add profile photos. Those photos identify
   people in the candidate, match and conversation screens.
2. **Show how matching works.** Each account reacts to photos in the shared,
   site-owned photo feed. The matcher uses those reactions to rank eligible profiles
   and explain shared taste. Profile photos are for recognizing a person; they are not
   the taste evidence. Like each other from the two accounts to create a mutual match.
3. **Show verification.** Submit a photo from one profile and show its `pending`
   status. Sign in separately as an administrator to accept or decline it, then show
   the resulting status and badge to the applicant. The review photo stays separate
   from public profile photos. Explain that this is an admin-reviewed photo, not proof
   of identity, and does not affect the match score.
4. **Show messaging.** Open the new match from both user accounts, send a message,
   and show it arrive in the other conversation. Match and message updates refresh the
   relevant screens; if the real-time connection is unavailable, the app refetches
   when it reconnects and uses polling as a fallback.

Success criteria
----------------
- The complete walkthrough works with two regular accounts and a separately
  authenticated admin reviewer, without editing database records by hand.
- Profile photos appear on people cards, while shared-feed reactions provide the
  matching evidence and an understandable reason for the ranking.
- A mutual like creates one match and makes the conversation available to both people.
- The verification submission, admin decision and user-visible result are clear, with
  the demo's identity-proof limitation stated honestly.
- A message is saved and visible to both participants, including after a reconnect or
  polling fallback.

[FP11] 11/18/2026
### Handoff: connect your database to Match Makers.
From the `matchmakerApp` folder:
- **Connect PostgreSQL:** Copy `apps/api/.env.example` to `apps/api/.env`, set
  `DATABASE_URL`, then run `npm run migrate --workspace=apps/api` and
  `npm run dev --workspace=apps/api`. The migration creates the tables; it does not
  import existing records.
- **Import existing data:** Back it up, then map records into the tables in
  `apps/api/db/schema.sql`, keeping IDs and relationships intact. Test with a separate
  database first; there is no automatic data importer.
- **Connect the app:** Set `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AUTH_MODE=jwt` in
  `apps/mobile/.env`. The app talks to the API, not directly to PostgreSQL.
