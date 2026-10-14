import type { Post, PostReaction, PostReactionAction } from '@match-makers/shared';

import { tagList } from './interests';

/**
 * How a photo feed reaction turns into "these two people are a bit closer".
 *
 * The feed is site-owned content, so there is no author to be matched to. What
 * a like/dislike actually records is taste, and taste is only useful pairwise:
 * two people who liked the same picture agree on something specific, and two
 * people who liked different pictures with the same tag agree on something
 * broader. The first is the stronger signal and it saturates, because the third
 * photo somebody likes is much less informative than the first.
 *
 * This is now the primary matching signal rather than a garnish on a
 * questionnaire. `utils/matching.ts` reads the result directly, and the
 * confidence term below is what stops the score from being confident about
 * strangers who have not answered anything yet.
 *
 * Nothing here is persisted. Taste is derived from the reactions table every
 * time it is read, so there is no cache to invalidate, no field to migrate, and
 * no way for a stale copy to disagree with the reactions it claims to describe.
 */

/** Post likes needed before the tag half of the signal counts at full strength. */
const CO_LIKE_SATURATION = 2;

/**
 * How many posts both people must have liked before either half counts.
 *
 * The answer to the open question in fp_reviews.md: whether reacting to a lot
 * of posts should stop counting, so that one very active user does not look
 * compatible with everybody. Measured against the *smaller* of the two evidence
 * bases, because affinity cannot be stronger than its weakest side.
 */
const CONFIDENCE_MIN_LIKES = 5;

/** Split between the specific evidence and the broad evidence. */
const CO_LIKE_SHARE = 0.65;
const TAG_SHARE = 0.35;

/**
 * Answers before the match score is worth reading.
 *
 * Below this the deck is still open — being locked out of the app is worse than
 * a provisional number — but the score is marked as provisional, because
 * confidence has not cleared and every pair looks alike. Ten is roughly where
 * `CONFIDENCE_MIN_LIKES` starts to bite for a typical pair.
 */
export const PHOTOS_FOR_FULL_TASTE = 10;

export interface TagOpinion {
  tag: string;
  /** Net approval in (-1, 1): positive towards, negative against. */
  score: number;
  likes: number;
  dislikes: number;
}

export interface TasteSignal {
  /** 0..1. Zero when there is no shared evidence, which is most pairs. */
  affinity: number;
  /** Photos both people liked. The specific half of the signal. */
  coLikedPosts: number;
  /** Tags both people lean towards. The broad half. */
  sharedTags: string[];
  /** A sentence a person can check. Null when there is nothing to say. */
  reason: string | null;
}

const EMPTY_SIGNAL: TasteSignal = {
  affinity: 0,
  coLikedPosts: 0,
  sharedTags: [],
  reason: null,
};

/**
 * Everything needed to compare any two people, built once per load.
 *
 * The alternative is to rescan the reactions table inside a loop over every
 * candidate, which turns a linear read into a quadratic one for no reason.
 */
export interface TasteIndex {
  /** userId -> ids of the posts they liked. */
  likedByUser: Map<string, Set<string>>;
  /** userId -> how many posts they liked, for the confidence damping. */
  likeCountByUser: Map<string, number>;
  /** userId -> every tag they have an opinion on, liked or disliked. */
  opinionByUser: Map<string, Map<string, TagOpinion>>;
  /** postId -> its tags, so a co-like can name what was co-liked. */
  tagsByPost: Map<string, string[]>;
}

/**
 * Net approval for one tag, smoothed so a single tap is weak evidence.
 *
 * `(likes - dislikes) / (likes + dislikes + 1)`. The `+1` is a Laplace prior:
 * three likes and no dislikes reads 0.75 rather than a confident 1.0, and one
 * like reads 0.5 rather than claiming the user is halfway to loving cats. It
 * also gives a tag with no reactions a score of exactly 0 instead of dividing
 * by zero.
 */
function tagScore(likes: number, dislikes: number): number {
  return (likes - dislikes) / (likes + dislikes + 1);
}

export function buildTasteIndex(reactions: PostReaction[], posts: Pick<Post, 'id' | 'tags'>[]): TasteIndex {
  const tagsByPost = new Map<string, string[]>();
  for (const post of posts) tagsByPost.set(post.id, post.tags);

  const likedByUser = new Map<string, Set<string>>();
  const likeCountByUser = new Map<string, number>();
  const opinionByUser = new Map<string, Map<string, TagOpinion>>();

  for (const reaction of reactions) {
    if (reaction.action === 'like') {
      const set = likedByUser.get(reaction.userId) ?? new Set<string>();
      set.add(reaction.postId);
      likedByUser.set(reaction.userId, set);
      likeCountByUser.set(reaction.userId, (likeCountByUser.get(reaction.userId) ?? 0) + 1);
    }

    const tags = tagsByPost.get(reaction.postId) ?? [];
    if (tags.length === 0) continue;

    const opinions = opinionByUser.get(reaction.userId) ?? new Map<string, TagOpinion>();
    for (const tag of tags) {
      const current = opinions.get(tag) ?? { tag, score: 0, likes: 0, dislikes: 0 };
      if (reaction.action === 'like') current.likes += 1;
      else current.dislikes += 1;
      current.score = tagScore(current.likes, current.dislikes);
      opinions.set(tag, current);
    }
    opinionByUser.set(reaction.userId, opinions);
  }

  return { likedByUser, likeCountByUser, opinionByUser, tagsByPost };
}

export const EMPTY_TASTE_INDEX: TasteIndex = {
  likedByUser: new Map(),
  likeCountByUser: new Map(),
  opinionByUser: new Map(),
  tagsByPost: new Map(),
};

/** Photo likes before a pair's signal counts at full strength. */
function confidenceBetween(index: TasteIndex, a: string, b: string): number {
  const likes = Math.min(index.likeCountByUser.get(a) ?? 0, index.likeCountByUser.get(b) ?? 0);
  return Math.min(1, likes / CONFIDENCE_MIN_LIKES);
}

/**
 * How much of the pair's evidence was the specific kind, saturating.
 *
 * `n / (n + 2)`: no shared photos scores 0, one scores 0.33, six scores 0.75,
 * and it approaches 1 without ever reaching it. The saturation is what keeps a
 * prolific pair from running away with the score, and the fact that it never
 * reaches 1 means the tag half always has something left to contribute.
 */
function coLikeOverlap(n: number): number {
  return n / (n + CO_LIKE_SATURATION);
}

/**
 * How much the pair shares on tags, 0..1.
 *
 * Only tags both people *lean towards*. A tag one of them has actively pushed
 * away is not a shared interest, and counting it would pair two people on the
 * one subject they demonstrably disagree about.
 *
 * The denominator is `min(tagsA, tagsB)` rather than the union. Somebody who
 * likes cats and cooking has two strong opinions and should not be punished for
 * not having twelve; under a union denominator a selective user could never
 * score highly, which is exactly backwards.
 */
function tagOverlap(
  mine: Map<string, TagOpinion>,
  theirs: Map<string, TagOpinion>
): { ratio: number; shared: string[] } {
  let earned = 0;
  const shared: string[] = [];

  for (const [tag, myOpinion] of mine) {
    if (myOpinion.score <= 0) continue;
    const theirOpinion = theirs.get(tag);
    if (!theirOpinion || theirOpinion.score <= 0) continue;

    shared.push(tag);
    earned += myOpinion.score * theirOpinion.score;
  }

  if (shared.length === 0) return { ratio: 0, shared };

  const breadth = Math.min(mine.size, theirs.size);
  return { ratio: Math.min(1, earned / Math.max(1, breadth)), shared };
}

/**
 * How close two people's reactions have pulled them together, 0..1.
 *
 * Zero for almost every pair, which is the point early on: with no shared
 * evidence the score has nothing to rank on, which is why the deck says the
 * score is provisional until enough photos have been answered.
 */
export function tasteBetween(index: TasteIndex, a: string, b: string): TasteSignal {
  if (a === b) return EMPTY_SIGNAL;

  const likedByA = index.likedByUser.get(a);
  const likedByB = index.likedByUser.get(b);
  const opinionA = index.opinionByUser.get(a);
  const opinionB = index.opinionByUser.get(b);

  const coLikedPosts = likedByA && likedByB ? countIntersection(likedByA, likedByB) : 0;

  const tags = opinionA && opinionB ? tagOverlap(opinionA, opinionB) : { ratio: 0, shared: [] };

  // Nothing shared means nothing to say, so the whole thing collapses to zero
  // rather than to `confidence * 0`.
  if (coLikedPosts === 0 && tags.shared.length === 0) return EMPTY_SIGNAL;

  const raw = CO_LIKE_SHARE * coLikeOverlap(coLikedPosts) + TAG_SHARE * tags.ratio;
  const affinity = round2(raw * confidenceBetween(index, a, b));

  return {
    affinity,
    coLikedPosts,
    sharedTags: tags.shared,
    reason: describeAffinity(coLikedPosts, tags.shared),
  };
}

function countIntersection(a: Set<string>, b: Set<string>): number {
  // Iterate the smaller side so the cost is bounded by the smaller evidence.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const value of small) {
    if (large.has(value)) count += 1;
  }
  return count;
}

/**
 * The sentence that goes under the match percentage.
 *
 * Ordered strongest evidence first, because the two claims are not equivalent
 * and a reader should not have to know that. Named photos come first because
 * "you both liked this specific thing" is a checkable claim; shared tags come
 * second because it is a weaker one about a broader subject.
 */
export function describeAffinity(coLikedPosts: number, sharedTags: string[]): string | null {
  const posts =
    coLikedPosts === 1
      ? 'You both liked the same photo'
      : `You both liked ${coLikedPosts} of the same photos`;
  const tags = tagList(sharedTags);

  if (coLikedPosts > 0 && tags) {
    return `${posts}, tagged ${tags}`;
  }
  if (coLikedPosts > 0) return posts;
  if (tags) return `You both like photos tagged ${tags}`;
  return null;
}

/** Every tag a person has an opinion on, strongest positive first. */
export function opinionsFor(index: TasteIndex, userId: string): TagOpinion[] {
  const opinions = index.opinionByUser.get(userId);
  if (!opinions) return [];
  return sortOpinions([...opinions.values()]);
}

/**
 * Applies or takes back one reaction across a post's tags, optimistically.
 *
 * One function rather than an `apply` and an `unapply` pair, because the two have
 * to stay in lockstep: `score` is derived from both counters in one place, and a
 * separate undo path would be the first place that drifted.
 *
 * `undo` exists because the feed removes the reaction row entirely. There is no
 * neutral stored action — the taste index counts rows, so a marker would still
 * count as a reaction.
 */
export function adjustOpinionsForReaction(
  opinions: readonly TagOpinion[],
  tags: readonly string[],
  action: PostReactionAction,
  undo = false
): TagOpinion[] {
  if (tags.length === 0) return [...opinions];

  const byTag = new Map(opinions.map((entry) => [entry.tag, entry]));
  const step = undo ? -1 : 1;

  for (const tag of tags) {
    const current = byTag.get(tag) ?? { tag, score: 0, likes: 0, dislikes: 0 };
    const next: TagOpinion =
      action === 'like'
        ? { ...current, likes: Math.max(0, current.likes + step) }
        : { ...current, dislikes: Math.max(0, current.dislikes + step) };

    if (next.likes === 0 && next.dislikes === 0) {
      // Dropped rather than kept at zero, and that is load-bearing: once the
      // reaction row is gone the authoritative index has no entry for this tag at
      // all. Keeping a zeroed one here would make the optimistic value differ from
      // the refetched one, which is exactly the lie this function exists to avoid.
      byTag.delete(tag);
      continue;
    }

    byTag.set(tag, { ...next, score: tagScore(next.likes, next.dislikes) });
  }

  return sortOpinions([...byTag.values()]);
}

/** Strongest positive first, with a stable tiebreak so equal scores do not jitter. */
function sortOpinions(opinions: TagOpinion[]): TagOpinion[] {
  return opinions.sort((a, b) => b.score - a.score || a.tag.localeCompare(b.tag));
}

/**
 * Everyone whose reactions have pulled the viewer towards them, strongest first.
 *
 * The whole point of the feed, so it is derived on demand rather than left for
 * the caller to reverse-engineer.
 *
 * Carries the whole signal rather than just affinity and a sentence. The caller
 * has to score the pair to show a percentage, and to hand a signal to the profile
 * screen so tapping through does not land on a breakdown claiming no shared taste.
 * Recomputing any of it here would be the same `tasteBetween` call twice.
 *
 * Deliberately knows nothing about eligibility. Whether the viewer may be shown
 * this person is not a taste question, and the caller answers it with the same
 * gate the deck uses so the two cannot disagree.
 */
export function closestByTaste(
  index: TasteIndex,
  viewerId: string,
  candidates: Array<{ id: string; name: string }>,
  limit = 3
): Array<{
  userId: string;
  name: string;
  affinity: number;
  coLikedPosts: number;
  sharedTags: string[];
  reason: string;
}> {
  return candidates
    .map((candidate) => ({ candidate, signal: tasteBetween(index, viewerId, candidate.id) }))
    .filter((entry) => entry.signal.affinity > 0 && entry.signal.reason)
    .sort((a, b) => b.signal.affinity - a.signal.affinity)
    .slice(0, limit)
    .map(({ candidate, signal }) => ({
      userId: candidate.id,
      name: candidate.name,
      affinity: signal.affinity,
      coLikedPosts: signal.coLikedPosts,
      sharedTags: signal.sharedTags,
      // Non-null by the filter above, which drops any pair with no reason.
      reason: signal.reason as string,
    }));
}

/**
 * How far along somebody is towards a score worth reading.
 *
 * This is a label, not a gate. The deck opens immediately either way, because
 * locking somebody out of the app to protect them from a provisional number is a
 * worse trade than showing them one marked as provisional.
 */
export function tasteProgress(answered: number): {
  answered: number;
  target: number;
  provisional: boolean;
  /** Says plainly that a zero here means "no evidence", not "no fit". */
  message: string;
} {
  const provisional = answered < PHOTOS_FOR_FULL_TASTE;

  if (answered === 0) {
    return {
      answered,
      target: PHOTOS_FOR_FULL_TASTE,
      provisional,
      message:
        'Answer some photos and we can rank who you meet. Right now every profile looks the same to us.',
    };
  }

  return {
    answered,
    target: PHOTOS_FOR_FULL_TASTE,
    provisional,
    message: provisional
      ? `Still building up — ${answered} of ${PHOTOS_FOR_FULL_TASTE} photos. Your deck reorders as you go.`
      : `Matching on what you have told us by liking ${answered} photos.`,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
