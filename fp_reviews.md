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
