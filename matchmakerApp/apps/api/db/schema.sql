/*
 * Match Makers -- Postgres schema.
 *
 * This is the FP2 storage layer described in `fp_reviews.md`: PostgreSQL as the
 * primary relational store for profile data, interactions and matches. It
 * replaces the JSON blob the app currently keeps in AsyncStorage under
 * `mock.db.v2` (see `apps/mobile/src/services/mock/database.ts`), which is a
 * single document rewritten in full on every mutation and enforces its own
 * invariants in application code.
 *
 * Plain DDL on purpose. The model in `apps/shared/src/types` stays the single
 * source of truth for shapes and is validated with zod at the API boundary;
 * this file is the storage that has to survive somebody skipping the API.
 *
 * Naming: columns are snake_case, the shared types are camelCase, and
 * `src/db/rows.ts` maps between them. Enum labels are copied verbatim from the
 * TypeScript enums they mirror, so `gender` here and `Gender` there cannot
 * drift apart without a type error on either side.
 *
 * Apply with:  psql "$DATABASE_URL" -f db/schema.sql
 * Re-apply with: psql "$DATABASE_URL" -f db/schema.sql   (idempotent)
 */

BEGIN;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
-- Every one of these has a counterpart in `apps/shared/src/types/index.ts`.
-- Adding a label here without adding it there (or the reverse) is the kind of
-- drift that only shows up in production, so keep them edited together.
--
-- Guarded in a DO block because Postgres has no `CREATE TYPE IF NOT EXISTS`,
-- and the rest of this file is written to be safely re-runnable. Note that this
-- only makes the *existence* check safe: if you edit the labels inside an
-- existing type, Postgres will not apply the edit, because `ALTER TYPE ... ADD
-- VALUE` cannot run inside a transaction on older servers. Changing labels is a
-- migration, not a schema edit -- see the README.

DO $$
BEGIN
  -- Mirrors `Gender`.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender') THEN
    CREATE TYPE gender AS ENUM (
      'male',
      'female',
      'non_binary',
      'prefer_not_to_say'
    );
  END IF;

  -- Mirrors `SexualOrientation`.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sexual_orientation') THEN
    CREATE TYPE sexual_orientation AS ENUM (
      'straight',
      'gay',
      'lesbian',
      'bisexual',
      'pansexual',
      'asexual',
      'queer',
      'other',
      'prefer_not_to_say'
    );
  END IF;

  -- Mirrors `RelationshipGoal`.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'relationship_goal') THEN
    CREATE TYPE relationship_goal AS ENUM (
      'long_term',
      'short_term',
      'casual',
      'friendship',
      'not_sure'
    );
  END IF;

  -- Mirrors the `DistanceMode` union. A discriminated mode rather than a nullable
  -- radius, for the reason given on the type: "no limit" and "50 km" are different
  -- questions and the UI asks them as a pair.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'distance_mode') THEN
    CREATE TYPE distance_mode AS ENUM ('nearby', 'global');
  END IF;

  -- Mirrors `SwipeAction['type']`.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'swipe_action') THEN
    CREATE TYPE swipe_action AS ENUM ('like', 'pass', 'super_like');
  END IF;

  -- Mirrors `PostReactionAction`.
  --
  -- `like` is evidence and `dislike` is not: a like is a positive statement about
  -- what somebody wants and counts towards affinity, while a dislike only steers
  -- the feed. Two people disliking the same photo have not agreed on anything.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'post_reaction_action') THEN
    CREATE TYPE post_reaction_action AS ENUM ('like', 'dislike');
  END IF;

  -- Mirrors `Message['type']`.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_type') THEN
    CREATE TYPE message_type AS ENUM ('text', 'image', 'system');
  END IF;

  -- Mirrors `VerificationStatus['status']`.
  --
  -- FP1's "honesty and proof" work wanted ID, puzzle and biometric checks plus
  -- manual admin review. None of that is built; `unverified` is the only status
  -- anyone can reach today, and the column exists so the later work does not have
  -- to retrofit one.
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'verification_status') THEN
    CREATE TYPE verification_status AS ENUM ('unverified', 'pending', 'verified', 'rejected');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
-- Was `users[]` in the mock blob, where `photos` and `location` were embedded
-- objects and the password sat in plaintext.

CREATE TABLE IF NOT EXISTS users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Mirrors the mock's `email.trim().toLowerCase()` on register. Enforced as a
  -- CHECK rather than with `citext` so the uniqueness rule below is a real
  -- case-insensitive uniqueness and not a convention every writer has to remember.
  email               text NOT NULL
                        CHECK (email = lower(btrim(email))),
  -- `salt:hash`, both hex, produced by `scrypt` in `src/password.ts`.
  --
  -- The mock stores the password verbatim and compares it with `!==`
  -- (`MockAuthAdapter.ts`). That is the single worst thing about the mock
  -- storage and the clearest reason to move to a real database.
  password_hash       text NOT NULL,

  name                text NOT NULL CHECK (btrim(name) <> ''),

  -- `date` not `timestamptz`: a birthday is a calendar date, and storing an
  -- instant invites both a timezone bug and a leap-year question nobody asked.
  date_of_birth       date NOT NULL,
  gender              gender NOT NULL,
  sexual_orientation  sexual_orientation NOT NULL DEFAULT 'prefer_not_to_say',
  relationship_goal   relationship_goal NOT NULL DEFAULT 'not_sure',
  bio                 text NOT NULL DEFAULT '',

  -- Was the embedded `Location`. Nullable coordinates because "no location
  -- yet" is the normal state during onboarding, and `cityCatalog.normaliseLocation`
  -- already treats `0,0` as "unset". `global` distance mode ignores these.
  latitude            double precision
                        CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude           double precision
                        CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  city                text NOT NULL DEFAULT '',
  country             text NOT NULL DEFAULT '',

  is_verified         boolean NOT NULL DEFAULT false,
  verification_status verification_status NOT NULL DEFAULT 'unverified',

  /*
   * Grants access to the admin routes and the photo-library importer.
   *
   * A boolean rather than a `role` enum on purpose: it is one column, and there
   * is no way to put an account into a role value that does not exist. If this
   * ever needs `moderator` or `reviewer` it becomes an enum plus a migration,
   * which is a strictly larger change than the reverse.
   *
   * Set by `npm run admin -- grant <email>` in `apps/api/scripts/admin.ts`, not
   * by the app: there is deliberately no HTTP route that grants this, because a
   * "make me an admin" endpoint is a privilege-escalation surface. The CLI
   * requires `DATABASE_URL`, so whoever can run it already has more than this
   * flag is worth.
   *
   * See the `ALTER TABLE` below -- new columns are added that way, not here.
   */
  is_admin            boolean NOT NULL DEFAULT false,

  -- `timestamptz` rather than the ISO strings the mock stores. The mock has to
  -- compare them as text; Postgres can order, index and window them properly.
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (email);

-- The README asks for distance-bounded feed queries and notes that they want a
-- spatial index. This btree is the honest first step and is not that index:
-- it narrows a city's worth of rows so a bounding-box test on
-- (latitude, longitude) has something to run against. PostGIS, or at minimum
-- `cube` + `earthdistance`, is still outstanding.
CREATE INDEX IF NOT EXISTS users_city_idx ON users (city);
CREATE INDEX IF NOT EXISTS users_location_idx ON users (latitude, longitude);

/*
 * Adding a column to a table that may already exist.
 *
 * `CREATE TABLE IF NOT EXISTS` is a no-op on a table that already exists, so a
 * new column added to the definition above would never reach a database created
 * before it was written. Every new column therefore also needs one of these.
 * `ADD COLUMN IF NOT EXISTS` covers both cases: it applies on an old database
 * and does nothing on a fresh one.
 *
 * `users.is_admin` is the first one to need this, so it is also the example.
 */
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- `preferences` was embedded in the mock user. Pulled into its own table
-- because it is the most frequently written and most selectively read part of a
-- profile -- every deck build reads it and nothing else about the row matters
-- there -- and because keeping it separate gives it a foreign key and a cascade
-- instead of leaving it to application code to keep in step.
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id            uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,

  -- The 18 floor and the min < max rule mirror `preferencesSchema`.
  age_min            integer NOT NULL DEFAULT 24 CHECK (age_min BETWEEN 18 AND 99),
  age_max            integer NOT NULL DEFAULT 38 CHECK (age_max BETWEEN 19 AND 100),
  CHECK (age_min < age_max),

  distance_mode      distance_mode NOT NULL DEFAULT 'nearby',
  -- Kept populated even in `global` mode, deliberately: switching back to
  -- `nearby` should restore the radius you had rather than reset it.
  max_distance       integer NOT NULL DEFAULT 50 CHECK (max_distance BETWEEN 1 AND 500),

  -- `Gender[]` and `RelationshipGoal[]` as Postgres arrays.
  --
  -- Arrays rather than a join table because these are always read whole, never
  -- queried into, and never shared between users -- so they gain nothing from
  -- being separately addressable rows.
  genders            gender[] NOT NULL DEFAULT '{}',
  relationship_goals relationship_goal[] NOT NULL DEFAULT '{}'
);

-- ---------------------------------------------------------------------------
-- photos
-- ---------------------------------------------------------------------------
-- Was `User.photos[]`, an embedded array. Now its own table so a profile with
-- six photos is six rows the database can constrain instead of an array the
-- application has to keep unique by hand.

CREATE TABLE IF NOT EXISTS photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  url         text NOT NULL,

  is_primary  boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0 CHECK (position >= 0),

  created_at  timestamptz NOT NULL DEFAULT now(),

  UNIQUE (user_id, position)
);

-- At most one primary photo per person.
--
-- A partial unique index rather than a boolean-plus-application-check, because
-- "exactly one of these six is primary" is precisely the kind of rule that gets
-- violated by a concurrent tap on two different photos, which no amount of
-- checking in the client can prevent.
CREATE UNIQUE INDEX IF NOT EXISTS photos_one_primary_per_user
  ON photos (user_id) WHERE is_primary;

-- ---------------------------------------------------------------------------
-- posts
-- ---------------------------------------------------------------------------
-- Was the site-owned `posts[]`. Deliberately has no `user_id`: posts belong to
-- the platform, not to a profile. The feed is an input device for working out
-- what somebody likes, and the matching that comes out of it happens between
-- people, so a post has no author to point at.

CREATE TABLE IF NOT EXISTS posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Empty means "draw the generated tile instead", the same fallback the mock
  -- uses and the reason `generateSeedPosts` can produce rows with no image.
  image_uri   text NOT NULL DEFAULT '',

  -- Optional rather than empty string, because absence is meaningful: a post
  -- imported before the grid existed has one image and must keep rendering.
  -- Consumers fall back to `image_uri` when this is NULL.
  thumb_uri   text,

  width       integer CHECK (width IS NULL OR width > 0),
  height      integer CHECK (height IS NULL OR height > 0),

  -- Free text in the canonical form `normaliseTag` produces, ordered, never
  -- empty, first entry is the primary tag.
  --
  -- The bounds mirror `MIN_POST_TAGS` and `MAX_POST_TAGS` in
  -- `apps/shared/src/validation/schemas.ts`. Folding and de-duplicating happen
  -- in the zod schema, which every write goes through; Postgres checks the
  -- count only, because a tag is just a string here and re-implementing the
  -- folder in SQL would be a second implementation to keep in step.
  tags        text[] NOT NULL CHECK (cardinality(tags) BETWEEN 1 AND 8),

  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Tag co-occurrence is the whole point of the feed, so this is the one index
-- here that serves a query rather than a lookup.
CREATE INDEX IF NOT EXISTS posts_tags_idx ON posts USING gin (tags);

-- ---------------------------------------------------------------------------
-- post_images
-- ---------------------------------------------------------------------------
-- A ladder of renditions of the same photo, at different widths.
--
-- This is the `srcset` of the web, stored. On the web a browser picks the right
-- rendition itself from a `srcset` attribute, using the display width
-- multiplied by the device pixel ratio, and never upscales: a photo shown at
-- 2500 CSS pixels on a 2x screen gets a 5000px rendition, and one shown at 340
-- gets a 640px one.
--
-- React Native's `Image` has no `srcset` attribute, so the app has to make
-- that choice itself -- see `pickVariant` in `apps/mobile/src/utils/images.ts`.
-- It needs the alternatives to exist, which is what this table is.
--
-- `posts.image_uri` is the largest rendition and stays where it is, so a client
-- that knows nothing about variants still gets the best available image rather
-- than the smallest. This table holds the rungs below it.
--
-- Storage roughly doubles for a photo, which is the trade the ladder buys: the
-- bytes are paid once at import instead of being stretched at display time. The
-- permanent answer is object storage with on-demand resizing, where the ladder
-- is generated at the CDN rather than stored. That is still open.
CREATE TABLE IF NOT EXISTS post_images (
  post_id     uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  -- Pixel width of the rendition.
  width       integer NOT NULL CHECK (width > 0),
  uri         text NOT NULL,
  -- One rendition per width, so re-importing cannot produce a duplicate rung.
  PRIMARY KEY (post_id, width)
);

-- The lookup is "every rendition of this post, widest first", which the
-- primary key already answers.

-- ---------------------------------------------------------------------------
-- user_tag_affinity
-- ---------------------------------------------------------------------------
-- One row per person per tag they have an opinion on, written when they react
-- to a photo.
--
-- This is the persistent tag-weight vector the matcher ranks on. Before it
-- existed, taste was derived in the client from the whole reactions table on
-- every read: correct, but un-persisted, un-indexed, and invisible to the
-- server, which therefore ordered the deck by registration date.
--
-- `likes` and `dislikes` are raw counts, deliberately. The decayed weight --
-- what a like is worth given how long ago it happened -- is computed when the
-- vector is read, from `last_activity_at`:
--
--     effective = (likes - dislikes) * exp(-age * ln(2) / half_life)
--
-- The `ln(2)` is what makes it a half-life rather than an e-folding. Without
-- it the weight would be 1/e -- about 37% -- at the stated half-life, so the
-- decay would be a good deal weaker than the number says.
--
-- Read-time decay rather than a write-time moving average, on purpose. A
-- write-time EWMA drifts: the stored value is only correct the instant it is
-- written and disagrees with what should be shown a day later. Read-time decay
-- is deterministic, needs no background job to age rows out, and a test can fix
-- a timestamp and assert the number.
--
-- Tags are the canonical folded form already stored on `posts.tags`, so there
-- is one row for `dog` and not two for `Dogs` and `dog`.
CREATE TABLE IF NOT EXISTS user_tag_affinity (
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tag              text NOT NULL,
  likes            integer NOT NULL DEFAULT 0 CHECK (likes >= 0),
  dislikes         integer NOT NULL DEFAULT 0 CHECK (dislikes >= 0),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag)
);

-- The composite index the ranking walks: everyone leaning towards a tag,
-- freshest first. The primary key already covers "one person's whole vector".
CREATE INDEX IF NOT EXISTS user_tag_affinity_tag_idx
  ON user_tag_affinity (tag, last_activity_at DESC);

-- ---------------------------------------------------------------------------
-- match_scores
-- ---------------------------------------------------------------------------
-- The computed ranking, one row per (viewer, candidate) pair.
--
-- Computing the affinity for a whole candidate pool is expensive: the overlap
-- join reads every candidate's row for every tag the viewer leans towards, which
-- measured at 569ms over 400,000 rows -- and it is a cost paid on *every* feed
-- request to answer a question that changes only when somebody reacts.
--
-- So it is computed ahead of time, by `npm run rescore`, and the feed reads the
-- result. This table is that result: a stored ranking, the same shape the
-- spec calls "background workers or database functions properly rescore candidate
-- pools".
--
-- `computed_at` is what makes a stale score visible rather than silently wrong.
-- A score older than the viewer's most recent reaction describes a taste they no
-- longer have.
CREATE TABLE IF NOT EXISTS match_scores (
  viewer_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  candidate_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  score          integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  taste_affinity numeric NOT NULL DEFAULT 0,
  co_liked_count integer NOT NULL DEFAULT 0,
  shared_tags    text[] NOT NULL DEFAULT '{}',
  band           text NOT NULL DEFAULT 'below-50',
  computed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, candidate_id)
);

-- The feed reads one viewer's ranking in score order. The composite index is
-- what turns that read into a range scan rather than a sort of every row.
CREATE INDEX IF NOT EXISTS match_scores_ranking_idx
  ON match_scores (viewer_id, score DESC, candidate_id);

-- ---------------------------------------------------------------------------
-- user_taste_summary
-- ---------------------------------------------------------------------------
-- One row per person: how many tags they lean towards, and how many photos
-- they have liked.
--
-- Purely a denormalisation of counts the ranking needs for every candidate at
-- once. Without it, "how many positive tags does each candidate have" is a
-- GROUP BY over the whole affinity table -- measured at 2.4 seconds over
-- 400,000 rows -- and "how many photos have they liked" is another over the
-- reactions. Both are maintained by the same write path that touches the row
-- anyway, so the counts cannot drift from the rows they describe.
CREATE TABLE IF NOT EXISTS user_taste_summary (
  user_id       uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Tags with net positive approval. The breadth half of the tag ratio.
  positive_tags integer NOT NULL DEFAULT 0 CHECK (positive_tags >= 0),
  -- Photos liked. The confidence half of the signal.
  likes         integer NOT NULL DEFAULT 0 CHECK (likes >= 0)
);

-- ---------------------------------------------------------------------------
-- post_reactions
-- ---------------------------------------------------------------------------
-- Was `postReactions[]`, where "one row per person per photo" was enforced by
-- an upsert in application code that scanned for the existing row first.

CREATE TABLE IF NOT EXISTS post_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id     uuid NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  action      post_reaction_action NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- The rule the mock could only ask politely. A second reaction now replaces
  -- the first (`ON CONFLICT ... DO UPDATE` in `routes/posts.ts`), so a dislike
  -- after a like means dislike and never both.
  UNIQUE (user_id, post_id)
);

-- Serves `reactedPostIds(userId)` and the per-post totals in the admin view.
-- The reverse direction, "everyone who reacted to this post", is what the
-- affinity scoring walks, and the unique index above only leads with user_id.
CREATE INDEX IF NOT EXISTS post_reactions_post_idx ON post_reactions (post_id);

-- ---------------------------------------------------------------------------
-- swipes
-- ---------------------------------------------------------------------------
-- Was `swipes[]`, de-duplicated in memory by building a `Set` of the target ids
-- the viewer had already seen.

CREATE TABLE IF NOT EXISTS swipes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  target_user_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  action          swipe_action NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- One decision per ordered pair. Re-swiping someone updates the existing row.
  UNIQUE (actor_id, target_user_id),

  -- Swiping yourself is meaningless, and the mock never checked.
  CHECK (actor_id <> target_user_id)
);

-- Covered by the unique index's leading column, and named here so the feed's
-- "who have I already seen" query has a predictable index to be explained by.

-- ---------------------------------------------------------------------------
-- matches
-- ---------------------------------------------------------------------------
-- Was `matches[]` with `userIds: [string, string]` and an O(n) scan in
-- `createMatch` to avoid duplicating a pair.

CREATE TABLE IF NOT EXISTS matches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Always stored smallest-first, so a pair has exactly one representation
  -- regardless of who swiped last. Enforced below.
  user_a_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_b_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  created_at  timestamptz NOT NULL DEFAULT now(),

  -- The interesting constraint in this schema.
  --
  -- `user_a_id < user_b_id` canonicalises the pair: (alice, bob) and
  -- (bob, alice) cannot both exist, so `UNIQUE (user_a_id, user_b_id)` below is
  -- all it takes to guarantee one match per pair of people. The mock got the
  -- same guarantee by filtering an array on every insert, which is exactly the
  -- kind of invariant a database should be holding instead.
  CHECK (user_a_id < user_b_id),

  UNIQUE (user_a_id, user_b_id)
);

-- The unique index leads with `user_a_id`, so finding every match for the
-- larger id of a pair needs its own index.
CREATE INDEX IF NOT EXISTS matches_user_b_idx ON matches (user_b_id);

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- Was `StoredMessage[]`, with `markMatchRead` updating every row of a match in
-- one pass.

CREATE TABLE IF NOT EXISTS messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id    uuid NOT NULL REFERENCES matches (id) ON DELETE CASCADE,
  sender_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  content     text NOT NULL CHECK (btrim(content) <> ''),
  type        message_type NOT NULL DEFAULT 'text',
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);

-- `messagesForMatch` reads ordered by time, and the "newest message in each of
-- my conversations" query in `routes/matches.ts` reads a bounded slice of the
-- same. One index serves both.
CREATE INDEX IF NOT EXISTS messages_match_created_idx ON messages (match_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- ---------------------------------------------------------------------------
-- Added when the app was pointed at this API. `AuthTokens` in
-- `@match-makers/shared` has always required a `refreshToken`, and
-- `JWTAuthAdapter.refresh()` posts the stored one to `/auth/refresh` when the
-- access token expires -- so without this the app signed people out every hour.
--
-- This is the store `fp_reviews.md` wants Redis to hold. It is a table instead
-- because Redis is not built yet, and because the alternative is worse: the
-- access tokens are stateless and unrevokable, so without *some* record of
-- refresh tokens there is no logout that actually ends a session. When Redis
-- lands this moves to a key per `jti` with a TTL, and this table goes away.

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Only the hash is stored. A dump of this table must not be enough to
  -- impersonate anybody, which is the same reason `users.password_hash` is a
  -- hash; the same scrypt helper does both.
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  -- Set on logout and on rotation, and never cleared otherwise, so "was this
  -- token revoked" stays answerable after the fact.
  revoked_at  timestamptz
);

-- Refresh walks every live token for one user, so this leads with user_id.
-- Partial, because revoked tokens are only ever filtered out.
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx
  ON refresh_tokens (user_id) WHERE revoked_at IS NULL;

COMMIT;