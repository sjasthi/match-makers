import { postImportSchema } from '@match-makers/shared';
import type { Post, User } from '@match-makers/shared';
import { getAuthAdapter } from '@/services/auth';
import { requestWithData } from '@/services/api/client';
import { mockDb, toPublicUser, type AdminPostSummary } from '@/services/mock/database';
import { withMockNetwork } from '@/services/mock/network';
import { isProfileComplete } from '@/services/profile';
import { ageFromDateOfBirth, DEMO_EMAIL } from '@/utils/mockData';

/**
 * What the admin routes send per account.
 *
 * `age`, `isDemo` and `isProfileComplete` are computed here rather than on the
 * server. They depend on `ageFromDateOfBirth`, `DEMO_EMAIL` and
 * `isProfileComplete`, all of which live in this app, and the last one gates the
 * feed -- so there must be exactly one definition of it. The API deliberately
 * sends only the two counts it can compute cheaply.
 */
interface AdminUserRecord {
  user: User;
  matchCount: number;
  answeredPhotos: number;
}

/**
 * Inspection of every account, and the write path that fills the photo feed.
 *
 * Works against the mock database or `apps/api`, chosen by
 * `getAuthAdapter().mode` like every other service here. In `jwt` mode the API's
 * own `requireAdmin` is what decides -- this module sends no flag and grants
 * nothing, it just calls the route and lets a 403 surface.
 *
 * Originally this existed purely so seeded and locally registered accounts could
 * be checked while testing, which is why several of these functions were
 * mock-only. The account half is
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

/**
 * Throws when the mock database cannot answer.
 *
 * Only used by the mock branches below. In `jwt` mode there is no equivalent
 * check here, because whether an admin request succeeds is the API's decision,
 * not the client's: it knows `users.is_admin` and this module does not.
 */
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
  if (getAuthAdapter().mode !== 'mock') {
    const records = await requestWithData<AdminUserRecord[]>({
      method: 'GET',
      url: '/admin/users',
    });
    return sortSummaries(
      records.map((record) => toSummary(record.user, record.matchCount, record.answeredPhotos))
    );
  }

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

    return sortSummaries(summaries);
  });
}

/** Newest first, email as the tiebreak so same-millisecond rows do not shuffle. */
function sortSummaries(summaries: AdminUserSummary[]): AdminUserSummary[] {
  return summaries.sort(
    (a, b) =>
      b.user.createdAt.localeCompare(a.user.createdAt) || a.user.email.localeCompare(b.user.email)
  );
}

/** One account in full, or null if the id is not in the database. */
export async function getAdminUser(userId: string): Promise<User | null> {
  if (getAuthAdapter().mode !== 'mock') {
    return requestWithData<User>({ method: 'GET', url: `/admin/users/${userId}` });
  }

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
 *
 * `tag` narrows the library to the photos carrying that tag. On the server that
 * is an array-containment lookup, which is what the `GIN` index on `posts.tags`
 * is for; the mock filters the list it already read, because the mock has one
 * array of posts rather than a table to query.
 */
export async function listPosts(tag?: string): Promise<AdminPostSummary[]> {
  if (getAuthAdapter().mode !== 'mock') {
    // The API already orders newest first, which is the same order the sort
    // below applies, so this is returned as it arrives rather than re-sorted.
    return requestWithData<AdminPostSummary[]>({
      method: 'GET',
      url: '/admin/posts',
      params: tag ? { tag } : undefined,
    });
  }

  assertMockMode();

  return withMockNetwork(async () => {
    const counts = await mockDb.postReactionCounts();
    const posts = [...counts.values()].sort((a, b) =>
      b.post.createdAt.localeCompare(a.post.createdAt)
    );
    return tag ? posts.filter((entry) => entry.post.tags.includes(tag)) : posts;
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
    /** The rendition ladder, widest first. */
    variants?: Array<{ width: number; uri: string }>;
  }>
): Promise<Post[]> {
  const validated = drafts.map((draft) => {
    const parsed = postImportSchema.safeParse(draft);
    if (!parsed.success) {
      throw new AdminImportError(
        parsed.error.issues[0]?.message ?? 'That photo cannot be imported'
      );
    }
    return parsed.data;
  });

  if (validated.length === 0) return [];

  if (getAuthAdapter().mode !== 'mock') {
    // The API returns the new ids, not the rows, so the drafts are echoed back
    // with their ids attached. They are what the caller has: nothing between
    // here and the server changes them.
    const { ids } = await requestWithData<{ imported: number; ids: string[] }>({
      method: 'POST',
      url: '/posts',
      data: validated,
    });

    return validated.map((draft, index) => ({
      id: ids[index] ?? '',
      imageUri: draft.imageUri,
      ...(draft.thumbUri !== undefined ? { thumbUri: draft.thumbUri } : {}),
      ...(draft.width !== undefined ? { width: draft.width } : {}),
      ...(draft.height !== undefined ? { height: draft.height } : {}),
      // The rendition ladder travels with the photo. The client picks from it by
      // display size times device pixel ratio, which is the `srcset` pattern --
      // without it every screen gets the one size the photo happened to be
      // imported at.
      ...(draft.variants !== undefined ? { variants: draft.variants } : {}),
      tags: draft.tags,
      createdAt: new Date().toISOString(),
    }));
  }

  assertMockMode();
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
  if (getAuthAdapter().mode !== 'mock') {
    // Already ordered by usage on the server.
    return requestWithData<Array<{ tag: string; count: number }>>({
      method: 'GET',
      url: '/admin/tags',
    });
  }

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
  const parsed = postImportSchema.safeParse({ imageUri: 'set', tags });
  if (!parsed.success) {
    throw new AdminImportError(parsed.error.issues[0]?.message ?? 'Those tags cannot be saved');
  }

  if (getAuthAdapter().mode !== 'mock') {
    // The route sends the edit, rather than merging it into a copy of the
    // photo the client already had and keeping that.
    //
    // That is what this used to do, and it is why the tag editor appeared not
    // to save: the new tags were shown on screen, and nothing was ever sent, so
    // the database kept the old ones until the screen was refetched.
    return requestWithData<Post>({
      method: 'PATCH',
      url: `/posts/${id}`,
      data: { tags: parsed.data.tags },
    });
  }

  assertMockMode();
  return withMockNetwork(async () => (await mockDb.updatePostTags(id, parsed.data.tags)) ?? null);
}

export async function deletePost(id: string): Promise<boolean> {
  if (getAuthAdapter().mode !== 'mock') {
    const { deleted } = await requestWithData<{ deleted: boolean }>({
      method: 'DELETE',
      url: `/posts/${id}`,
    });
    return deleted;
  }

  assertMockMode();
  return withMockNetwork(() => mockDb.deletePost(id));
}
