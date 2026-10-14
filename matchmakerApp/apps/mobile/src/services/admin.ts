import { postImportSchema } from '@match-makers/shared';
import type { Post, User } from '@match-makers/shared';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser, type AdminPostSummary } from '@/services/mock/database';
import { withMockNetwork } from '@/services/mock/network';
import { isProfileComplete } from '@/services/profile';
import { ageFromDateOfBirth, DEMO_EMAIL } from '@/utils/mockData';

/**
 * Inspection of the mock database, and the write path that fills the photo feed.
 *
 * There is no backend yet, so this exists purely so seeded and locally
 * registered accounts can be checked while testing. The account half is
 * deliberately the mirror image of `services/profile.ts`: that module answers
 * "is this person ready to be shown in the feed", this one shows the answer for
 * everybody at once, which is what you cannot do from inside a single session.
 *
 * `listAllUsers`, `getAdminUser` and the post read paths write nothing.
 * `mockDb` is the test fixture, so an admin edit would quietly destroy the
 * seeded state the next test run depends on.
 *
 * The photo library is the one deliberate exception. A feed with nothing in it
 * is not a prototype of anything, and there is no other way to get content into
 * it, so the import and tag paths below write on purpose. The blast radius is
 * limited: they touch `posts` and `postReactions` only, never `users`, and the
 * "reset mock data" action in Settings is still the only thing that can undo
 * them.
 */

export class AdminUnavailableError extends Error {
  constructor() {
    super('The admin inspector only works in mock mode.');
    this.name = 'AdminUnavailableError';
  }
}

/** Throws unless the app is in mock mode, where the accounts are actually reachable. */
function assertMockMode(): void {
  if (getAuthAdapter().mode !== 'mock') {
    throw new AdminUnavailableError();
  }
}

/** An import the library refuses, with the reason already phrased for a human. */
export class AdminImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminImportError';
  }
}

export interface AdminUserSummary {
  user: User;
  age: number;
  /** The seeded demo account, or anything registered under the demo domain. */
  isDemo: boolean;
  /** Matches what gates the feed for this account. */
  isProfileComplete: boolean;
  /** Photos this account has answered, which is what the matcher now ranks on. */
  answeredPhotos: number;
  photoCount: number;
  matchCount: number;
}

function toSummary(user: User, matchCount: number, answeredPhotos: number): AdminUserSummary {
  return {
    user,
    age: ageFromDateOfBirth(user.dateOfBirth),
    isDemo: user.email.toLowerCase() === DEMO_EMAIL,
    isProfileComplete: isProfileComplete(user),
    answeredPhotos,
    photoCount: user.photos.length,
    matchCount,
  };
}

/**
 * Every account, newest first.
 *
 * Newest first because that is how you find the account you just registered
 * while testing. The email tiebreak is there so accounts seeded inside the same
 * millisecond do not shuffle between renders.
 */
export async function listAllUsers(): Promise<AdminUserSummary[]> {
  assertMockMode();

  return withMockNetwork(async () => {
    const stored = await mockDb.allUsers();
    const summaries = await Promise.all(
      stored.map(async (record) => {
        const user = toPublicUser(record);
        return toSummary(
          user,
          (await mockDb.matchesForUser(user.id)).length,
          (await mockDb.reactedPostIds(user.id)).size
        );
      })
    );

    return summaries.sort(
      (a, b) =>
        b.user.createdAt.localeCompare(a.user.createdAt) || a.user.email.localeCompare(b.user.email)
    );
  });
}

/** One account in full, or null if the id is not in the database. */
export async function getAdminUser(userId: string): Promise<User | null> {
  assertMockMode();

  return withMockNetwork(async () => {
    const found = await mockDb.findUserById(userId);
    return found ? toPublicUser(found) : null;
  });
}

/* -------------------------------------------------------------------------- */
/* Photo library                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every post in the site library, newest first, with its reaction counts.
 *
 * The counts are what make this a curation tool rather than a file browser: a
 * photo nobody reacted to and a photo thirty people liked are both sitting in
 * the feed, and only one of them is doing anything.
 */
export async function listPosts(): Promise<AdminPostSummary[]> {
  assertMockMode();

  return withMockNetwork(async () => {
    const counts = await mockDb.postReactionCounts();
    return [...counts.values()].sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt));
  });
}

/**
 * Adds photos to the library.
 *
 * Validated here rather than trusted from the screen, because the importer is
 * the only way into this table and an untagged post would land in the feed
 * unable to contribute to anything. Rejecting the whole batch rather than
 * skipping bad rows: an import is one deliberate act, and silently importing
 * three of five photos is a worse outcome than importing none.
 */
export async function importPosts(
  drafts: Array<{
    imageUri: string;
    tags: string[];
    thumbUri?: string;
    width?: number;
    height?: number;
  }>
): Promise<Post[]> {
  assertMockMode();

  const validated = drafts.map((draft) => {
    const parsed = postImportSchema.safeParse(draft);
    if (!parsed.success) {
      throw new AdminImportError(parsed.error.issues[0]?.message ?? 'That photo cannot be imported');
    }
    return parsed.data;
  });

  if (validated.length === 0) return [];

  return withMockNetwork(() => mockDb.addPosts(validated));
}

/**
 * Every tag in use across the library, with how many photos carry it.
 *
 * Feeds the suggestion strip in the importer and the tag editor. Ordered by
 * usage rather than alphabetically so the word most likely to be useful is the
 * first one offered: on an empty input the most-used tags are what somebody
 * tagging a batch of photos actually wants, and once they have typed something
 * the filtering is a substring match anyway.
 *
 * Counted from the canonical form already stored, so `Dogs` typed as `dog` and
 * seeded as `dog` are one entry with two photos rather than two entries nobody
 * can tell apart.
 */
export async function listAllTags(): Promise<Array<{ tag: string; count: number }>> {
  assertMockMode();

  return withMockNetwork(async () => {
    const counts = await mockDb.postReactionCounts();
    const byTag = new Map<string, number>();

    for (const { post } of counts.values()) {
      for (const tag of post.tags) {
        byTag.set(tag, (byTag.get(tag) ?? 0) + 1);
      }
    }

    return [...byTag.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  });
}

/** Replaces a post's tags. Order is meaningful; the first tag is the primary. */
export async function updatePostTags(id: string, tags: string[]): Promise<Post | null> {
  assertMockMode();

  const parsed = postImportSchema.safeParse({ imageUri: 'set', tags });
  if (!parsed.success) {
    throw new AdminImportError(parsed.error.issues[0]?.message ?? 'Those tags cannot be saved');
  }

  return withMockNetwork(async () => (await mockDb.updatePostTags(id, parsed.data.tags)) ?? null);
}

export async function deletePost(id: string): Promise<boolean> {
  assertMockMode();
  return withMockNetwork(() => mockDb.deletePost(id));
}
