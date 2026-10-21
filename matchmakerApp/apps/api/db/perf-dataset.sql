-- A synthetic dataset with the same shape as the real one, for measuring the
-- rescore and the feed read at a scale the live database does not have.
--
-- This is a *worst case*, and deliberately so: every user holds 200 of a
-- 400-tag vocabulary, so any two users share about 100 tags. Real people hold
-- far fewer and share far fewer, which makes the shared-tag join in the
-- ranking ten times smaller than it is here. A number measured on this
-- dataset is an upper bound, not a typical case.
--
--   psql $DATABASE_URL -f db/perf-dataset.sql
--   npm run perf --workspace=apps/api
--
-- The scripts run against the `perf` schema by setting `search_path`, so the
-- ranking SQL under test is the *same* SQL the real database runs -- only the
-- table names resolve differently.
\set ON_ERROR_STOP on

DROP SCHEMA IF EXISTS perf CASCADE;
CREATE SCHEMA perf;

CREATE TABLE perf.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  date_of_birth date NOT NULL,
  gender text NOT NULL,
  sexual_orientation text NOT NULL DEFAULT 'prefer_not_to_say',
  relationship_goal text NOT NULL DEFAULT 'not_sure',
  bio text NOT NULL DEFAULT '',
  latitude double precision,
  longitude double precision,
  city text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  is_verified boolean NOT NULL DEFAULT false,
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE perf.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES perf.users ON DELETE CASCADE,
  age_min integer, age_max integer,
  distance_mode text NOT NULL DEFAULT 'global',
  max_distance integer,
  genders text[] NOT NULL DEFAULT '{}',
  relationship_goals text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE perf.posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  image_uri text NOT NULL DEFAULT '',
  thumb_uri text, width integer, height integer,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE perf.post_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES perf.users ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES perf.posts ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);

CREATE TABLE perf.user_tag_affinity (
  user_id uuid NOT NULL REFERENCES perf.users ON DELETE CASCADE,
  tag text NOT NULL,
  likes integer NOT NULL DEFAULT 0,
  dislikes integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tag)
);
CREATE INDEX perf_uta_tag_idx ON perf.user_tag_affinity (tag, last_activity_at DESC);

CREATE TABLE perf.user_taste_summary (
  user_id uuid PRIMARY KEY REFERENCES perf.users ON DELETE CASCADE,
  positive_tags integer NOT NULL DEFAULT 0,
  likes integer NOT NULL DEFAULT 0
);

CREATE TABLE perf.match_scores (
  viewer_id uuid NOT NULL REFERENCES perf.users ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES perf.users ON DELETE CASCADE,
  score integer NOT NULL,
  taste_affinity numeric NOT NULL DEFAULT 0,
  co_liked_count integer NOT NULL DEFAULT 0,
  shared_tags text[] NOT NULL DEFAULT '{}',
  band text NOT NULL DEFAULT 'below-50',
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_id, candidate_id)
);
CREATE INDEX perf_ms_ranking_idx ON perf.match_scores (viewer_id, score DESC, candidate_id);

-- 2,000 users.
INSERT INTO perf.users (email, name, date_of_birth, gender, relationship_goal, latitude, longitude)
SELECT 'user' || n || '@perf.local', 'User ' || n, DATE '1990-01-01' + (n % 9000), 'female',
       'long_term', 30.2672, -97.7431
  FROM generate_series(1, 2000) AS n;

INSERT INTO perf.user_preferences (user_id, age_min, age_max, distance_mode, max_distance, genders, relationship_goals)
SELECT id, 23, 45, 'global', 500, '{female,male}', '{long_term,casual}' FROM perf.users;

-- 20,000 photos over 200 tags.
INSERT INTO perf.posts (image_uri, tags)
SELECT 'perf://' || n,
       (SELECT array_agg(DISTINCT 'tag' || (1 + (n * k) % 200))
          FROM generate_series(1, 3 + (n % 5)) AS k)
  FROM generate_series(1, 20000) AS n;

-- 100,000 reactions: each user likes 50 photos.
INSERT INTO perf.post_reactions (user_id, post_id, action, created_at)
SELECT u.id, p.id, 'like', now() - (random() * 200) * interval '1 day'
  FROM perf.users u
  CROSS JOIN LATERAL (
    SELECT id FROM perf.posts ORDER BY random() LIMIT 50
  ) p;

-- 400,000 affinity rows: 200 of a 400-tag vocabulary each, with an offset so
-- the sets overlap without every user holding every tag.
INSERT INTO perf.user_tag_affinity (user_id, tag, likes, last_activity_at)
SELECT u.id, 'tag' || (1 + ((u.row_number + k) % 400)), 1 + (k % 3),
       now() - (random() * 200) * interval '1 day'
  FROM (SELECT id, row_number() OVER () AS row_number FROM perf.users) u
  CROSS JOIN LATERAL generate_series(1, 200) AS k;

INSERT INTO perf.user_taste_summary (user_id, positive_tags, likes)
SELECT a.user_id, count(*) FILTER (WHERE a.likes > a.dislikes),
       (SELECT count(*) FROM perf.post_reactions r WHERE r.user_id = a.user_id AND r.action = 'like')
  FROM perf.user_tag_affinity a GROUP BY a.user_id;

ANALYZE perf.users;
ANALYZE perf.posts;
ANALYZE perf.post_reactions;
ANALYZE perf.user_tag_affinity;
ANALYZE perf.user_taste_summary;

\echo ''
\echo '=== the dataset ==='
SELECT (SELECT count(*) FROM perf.users) AS users,
       (SELECT count(*) FROM perf.posts) AS posts,
       (SELECT count(*) FROM perf.post_reactions) AS reactions,
       (SELECT count(*) FROM perf.user_tag_affinity) AS affinity_rows;
