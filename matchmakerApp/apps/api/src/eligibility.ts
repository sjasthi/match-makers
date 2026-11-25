/**
 * The eligibility gate: who the viewer is allowed to be shown.
 *
 * Shared between the feed and the score rescore. The feed excludes people the
 * viewer has already swiped on. The rescore does not: it stores one symmetric
 * score in both directions, and the other person's feed may still show the
 * viewer if they have not swiped yet.
 *
 * The rules, in the order they bite:
 *
 *  - You are not shown yourself.
 *  - When `excludeSwiped` is true, you are not shown somebody you have already
 *    swiped on.
 *  - Your own filters apply: who you want to see, by gender, goal and age.
 *  - Their filters apply, pointed back at you. Eligibility is mutual, and a
 *    candidate whose own rules exclude you is somebody who will never see you
 *    back.
 *  - Distance, when either side is using `nearby`.
 *  - Sexual orientation compatibility: both people must be able to be attracted
 *    to each other's gender. Wildcard orientations (bi, pan, asexual, queer,
 *    other, prefer_not_to_say) never block.
 *
 * The distance clause is the fiddly one. The expression returns NULL when
 * *either* side has no coordinates, and `NULL <= 50` is NULL, which is not true
 * -- so a viewer who had not chosen a city would silently become invisible to
 * every candidate who had one. Both sides' coordinates are therefore checked
 * before the comparison, and a missing coordinate means "no distance limit
 * applies", not "too far".
 *
 * `$1` is the viewer's id. `excludeSwiped` defaults to true for feed reads; the
 * score rescore passes false so it can keep both directions current.
 */
export function eligibilitySql(options: { excludeSwiped?: boolean } = {}): string {
  const swipedClause =
    options.excludeSwiped === false
      ? ''
      : `
       -- Already decided on: the deck never shows somebody twice. The score
       -- matrix omits this gate so the other person's reverse score stays fresh.
       AND NOT EXISTS (
         SELECT 1 FROM swipes s
          WHERE s.actor_id = v.id AND s.target_user_id = c.id
       )`;

  return `
    WITH viewer AS (
      SELECT u.id, u.gender, u.date_of_birth, u.latitude, u.longitude,
             u.relationship_goal, u.sexual_orientation,
             pr.age_min, pr.age_max, pr.distance_mode, pr.max_distance,
             pr.genders            AS wants_genders,
             pr.relationship_goals AS wants_goals
        FROM users u
        LEFT JOIN user_preferences pr ON pr.user_id = u.id
       WHERE u.id = $1
    )
    SELECT
      c.id, c.email, c.name, c.date_of_birth, c.gender, c.sexual_orientation,
      c.relationship_goal, c.bio, c.latitude, c.longitude, c.city, c.country,
      c.is_verified, c.created_at, c.updated_at,
      ${HAVERSINE} AS distance_km,
      COUNT(*) OVER () AS total_count,
      COALESCE(
        (SELECT json_agg(json_build_object(
                 'id', ph.id, 'user_id', ph.user_id, 'url', ph.url,
                 'is_primary', ph.is_primary, 'position', ph.position
               ) ORDER BY ph.position)
           FROM photos ph WHERE ph.user_id = c.id),
        '[]'::json
      ) AS photos
    FROM users c
    CROSS JOIN viewer v
    LEFT JOIN user_preferences cp ON cp.user_id = c.id
    WHERE c.id <> v.id
      ${swipedClause}

      /* --- the caller's own filters --- */
      AND (cardinality(v.wants_genders) = 0 OR c.gender = ANY (v.wants_genders))
      AND (cardinality(v.wants_goals) = 0 OR c.relationship_goal = ANY (v.wants_goals))
      AND (v.age_min IS NULL OR extract(year FROM age(c.date_of_birth)) BETWEEN v.age_min AND v.age_max)
      AND (
        v.distance_mode = 'global' OR v.max_distance IS NULL
        OR ${noLocation('v')} OR ${noLocation('c')}
        OR (${HAVERSINE}) <= v.max_distance
      )

      /* --- sexual orientation compatibility (mutual) --- */
      -- Wildcard orientations never block: bi, pan, asexual, queer, other, prefer_not_to_say
      -- A candidate/viewer with prefer_not_to_say gender is never excluded by strict orientations
      AND (
        v.sexual_orientation IN ('bisexual','pansexual','asexual','queer','other','prefer_not_to_say')
        OR c.sexual_orientation IN ('bisexual','pansexual','asexual','queer','other','prefer_not_to_say')
        OR c.gender = 'prefer_not_to_say'
        OR (
          v.sexual_orientation = 'straight' AND (
            (v.gender = 'male' AND c.gender = 'female')
            OR (v.gender = 'female' AND c.gender = 'male')
            OR v.gender = 'non_binary'
          )
        )
        OR (v.sexual_orientation = 'gay' AND v.gender = 'male' AND c.gender = 'male')
        OR (v.sexual_orientation = 'lesbian' AND v.gender = 'female' AND c.gender = 'female')
      )
      -- Candidate's orientation pointed back at viewer
      AND (
        c.sexual_orientation IN ('bisexual','pansexual','asexual','queer','other','prefer_not_to_say')
        OR v.sexual_orientation IN ('bisexual','pansexual','asexual','queer','other','prefer_not_to_say')
        OR v.gender = 'prefer_not_to_say'
        OR (
          c.sexual_orientation = 'straight' AND (
            (c.gender = 'male' AND v.gender = 'female')
            OR (c.gender = 'female' AND v.gender = 'male')
            OR c.gender = 'non_binary'
          )
        )
        OR (c.sexual_orientation = 'gay' AND c.gender = 'male' AND v.gender = 'male')
        OR (c.sexual_orientation = 'lesbian' AND c.gender = 'female' AND v.gender = 'female')
      )

      /* --- and the candidate's, pointed back at the caller --- */
      -- Skipped when the candidate has no preferences row at all: a profile that
      -- has not finished onboarding has not expressed a preference, and hiding it
      -- would penalise somebody for not having finished signing up.
      AND (
        cp.user_id IS NULL OR cardinality(cp.genders) = 0
        OR v.gender = ANY (cp.genders)
      )
      AND (
        cp.user_id IS NULL OR cardinality(cp.relationship_goals) = 0
        OR v.relationship_goal = ANY (cp.relationship_goals)
      )
      AND (
        cp.user_id IS NULL OR cp.age_min IS NULL OR cp.max_distance IS NULL
        OR cp.distance_mode = 'global'
        OR ${noLocation('v')} OR ${noLocation('c')}
        OR (${HAVERSINE}) <= cp.max_distance
      )
      AND (
        cp.user_id IS NULL OR cp.age_min IS NULL
        OR extract(year FROM age(v.date_of_birth)) BETWEEN cp.age_min AND cp.age_max
      )
  `;
}

/**
 * Great-circle distance in kilometres.
 *
 * Inlined rather than using `earthdistance`, which would need
 * `postgresql-contrib` and a `CREATE EXTENSION` -- one more moving part, and
 * still on the list for the real spatial work. The haversine is accurate to a
 * few metres against a radius of 6371 km, which is far tighter than the 1 km
 * precision anyone is shown.
 *
 * Declared as a SQL fragment and interpolated, never as a parameterised value:
 * `$n` placeholders cannot hold an expression. It contains no user input.
 */
const HAVERSINE = `
  CASE
    WHEN ${noLocation('c')} OR ${noLocation('v')}
    THEN NULL
    ELSE 6371 * 2 * asin(sqrt(
      power(sin(radians(c.latitude - v.latitude) / 2), 2) +
      cos(radians(v.latitude)) * cos(radians(c.latitude)) *
      power(sin(radians(c.longitude - v.longitude) / 2), 2)
    ))
  END`;

/**
 * Whether a column pair means "no location yet".
 *
 * Both NULL and the coordinates zero count as unset, because the app has always
 * treated zero as unset: `hasLocation` in `utils/distance.ts` is
 * `latitude !== 0 || longitude !== 0`, and `normaliseLocation` in the mock
 * resolves 0,0 to 0,0.
 *
 * The server only checked for NULL, which meant a profile with 0,0 -- a
 * perfectly ordinary profile that has chosen a city but not a point on the map
 * -- was treated as being off the coast of Africa. The distance to anywhere real
 * is about 10,000 km, so a viewer with zeroed coordinates saw an empty deck and
 * no explanation. The rules here and the app's have to agree, because the app
 * says "you have a location" and the server says "you are on the other side of
 * the world".
 */
function noLocation(alias: string): string {
  return `(${alias}.latitude IS NULL OR ${alias}.longitude IS NULL OR (${alias}.latitude = 0 AND ${alias}.longitude = 0))`;
}
