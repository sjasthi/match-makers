import type { Post, PostReaction, PostReactionAction, SwipeAction, User } from '@match-makers/shared';
import { persistentStore, readJson, writeJson } from '@/services/storage/keyValueStore';
import { normaliseState } from './migrate';
import { DEMO_EMAIL, generateDemoUser, generateMockUsers, generateSeedPosts, seedReactionsFor } from '@/utils/mockData';

/**
 * Storage key for the mock blob.
 *
 * This was bumped to v2 when `User` gained the questionnaire. Since then the
 * questionnaire has changed shape again (interest tags became tagged prompts,
 * and kids moved out of lifestyle) and that is handled by normalising records
 * on load rather than by bumping this key again, because bumping it throws away
 * every account, swipe and message the user had.
 */
const DB_KEY = 'mock.db.v2';
const SEED_CANDIDATE_COUNT = 20;
/**
 * How many photos the seed library holds.
 *
 * Low on purpose. Every seeded post needs at least one tag to be useful and the
 * feed shows one at a time, so a large library would only make the first few
 * screens on a fresh install look identical. The admin importer is how you get
 * a real one.
 */
const SEED_POST_COUNT = 24;

export type StoredUser = User & { password: string };

export interface SwipeRecord {
  id: string;
  actorId: string;
  targetUserId: string;
  action: SwipeAction['type'];
  createdAt: string;
}

export interface MockMatch {
  id: string;
  userIds: [string, string];
  createdAt: string;
}

export interface StoredMessage {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
  readAt?: string;
}

/** A post plus the reaction counts the admin library lists. */
export interface AdminPostSummary {
  post: Post;
  likes: number;
  dislikes: number;
}

interface MockState {
  users: StoredUser[];
  currentUserId: string | null;
  swipes: SwipeRecord[];
  matches: MockMatch[];
  messages: StoredMessage[];
  /**
   * The site-owned photo library.
   *
   * Stored separately from `users` because nothing here belongs to anybody: a
   * post is content the platform owns, and a reaction is a row against a user
   * but not part of their profile record. Keeping them out of `User` means
   * liking a photo cannot dirty a profile, and it leaves `preferences` as the
   * only thing the feed can ever influence.
   */
  posts: Post[];
  postReactions: PostReaction[];
}

function createInitialState(): MockState {
  const demoUser = generateDemoUser();
  const candidates = generateMockUsers(SEED_CANDIDATE_COUNT).filter(
    (user) => user.email !== DEMO_EMAIL
  );
  const posts = generateSeedPosts(SEED_POST_COUNT);

  return {
    users: [demoUser, ...candidates],
    currentUserId: null,
    swipes: [],
    matches: [],
    messages: [],
    posts,
    /**
     * Seeded for the candidates only, never for the demo account.
     *
     * The candidates need a taste profile so that reacting to a photo has
     * somebody to pull you towards; without it every pair scores zero and the
     * feature is invisible no matter what the demo account does.
     *
     * The demo account is deliberately excluded. Seeding it too would greet
     * somebody signing in with a summary claiming a history of likes they never
     * gave, on the one screen whose entire job is telling the truth about what
     * has been learned. It would also start the landing feed already partly
     * consumed. Its taste is exactly what the person at the screen creates.
     */
    postReactions: seedReactionsFor(candidates, posts),
  };
}

/**
 * In-memory database backed by AsyncStorage, standing in for the FP2
 * Postgres + Redis backend. Everything is seeded on first launch so the
 * prototype has content to show without a server.
 */
export class MockDatabase {
  private state: MockState | null = null;
  private ready: Promise<MockState> | null = null;

  private load(): Promise<MockState> {
    if (this.ready) return this.ready;
    this.ready = readJson<MockState>(persistentStore, DB_KEY, createInitialState()).then(
      (state) => {
        // A schema change or a wiped install can leave the array shape stale.
        const needsReseed = !Array.isArray(state.users) || state.users.length === 0;
        const loaded = needsReseed ? createInitialState() : state;

        // Upgrade stored records written by an older build. A record whose
        // questionnaire predates the current shape otherwise reaches the
        // scoring code with fields missing and crashes on `.length` or `.map`.
        const normaliseResult = normaliseState(loaded);
        this.state = normaliseResult.state as MockState;

        if (needsReseed || normaliseResult.changed) void this.persist();
        return this.state;
      }
    );
    return this.ready;
  }

  private async persist(): Promise<void> {
    if (this.state) await writeJson(persistentStore, DB_KEY, this.state);
  }

  async getState(): Promise<MockState> {
    if (this.state) return this.state;
    return this.load();
  }

  async allUsers(): Promise<StoredUser[]> {
    return (await this.getState()).users;
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    return (await this.getState()).users.find((user) => user.id === id);
  }

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const normalized = email.trim().toLowerCase();
    return (await this.getState()).users.find((user) => user.email.toLowerCase() === normalized);
  }

  async saveUser(user: StoredUser): Promise<StoredUser> {
    const state = await this.getState();
    const index = state.users.findIndex((candidate) => candidate.id === user.id);
    const record = { ...user, updatedAt: new Date().toISOString() };
    if (index >= 0) {
      state.users[index] = record;
    } else {
      state.users.push(record);
    }
    await this.persist();
    return record;
  }

  async setCurrentUserId(id: string | null): Promise<void> {
    const state = await this.getState();
    state.currentUserId = id;
    await this.persist();
  }

  async recordSwipe(
    actorId: string,
    targetUserId: string,
    action: SwipeAction['type']
  ): Promise<SwipeRecord> {
    const state = await this.getState();
    const record: SwipeRecord = {
      id: `swipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actorId,
      targetUserId,
      action,
      createdAt: new Date().toISOString(),
    };
    state.swipes.push(record);
    await this.persist();
    return record;
  }

  async swipedUserIds(actorId: string): Promise<Set<string>> {
    const state = await this.getState();
    return new Set(
      state.swipes.filter((swipe) => swipe.actorId === actorId).map((swipe) => swipe.targetUserId)
    );
  }

  async createMatch(userIds: [string, string]): Promise<MockMatch> {
    const state = await this.getState();
    const existing = state.matches.find(
      (match) =>
        match.userIds.includes(userIds[0]) &&
        match.userIds.includes(userIds[1]) &&
        match.userIds.length === 2
    );
    if (existing) return existing;

    const record: MockMatch = {
      id: `match_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userIds,
      createdAt: new Date().toISOString(),
    };
    state.matches.push(record);
    await this.persist();
    return record;
  }

  async matchesForUser(userId: string): Promise<MockMatch[]> {
    const state = await this.getState();
    return state.matches.filter((match) => match.userIds.includes(userId));
  }

  async addMessage(message: Omit<StoredMessage, 'id'>): Promise<StoredMessage> {
    const state = await this.getState();
    const record: StoredMessage = {
      ...message,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    };
    state.messages.push(record);
    await this.persist();
    return record;
  }

  async messagesForMatch(matchId: string): Promise<StoredMessage[]> {
    const state = await this.getState();
    return state.messages
      .filter((message) => message.matchId === matchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async markMatchRead(matchId: string, readerId: string): Promise<void> {
    const state = await this.getState();
    const now = new Date().toISOString();
    state.messages.forEach((message) => {
      if (message.matchId === matchId && message.senderId !== readerId && !message.readAt) {
        message.readAt = now;
      }
    });
    await this.persist();
  }

  /** Wipes the database and re-seeds. Backs the "reset mock data" dev action. */
  async reset(): Promise<void> {
    this.state = createInitialState();
    this.ready = Promise.resolve(this.state);
    await this.persist();
  }

  /* ------------------------------------------------------------------ */
  /* Photo library                                                       */
  /* ------------------------------------------------------------------ */

  async allPosts(): Promise<Post[]> {
    return (await this.getState()).posts;
  }

  async findPostById(id: string): Promise<Post | undefined> {
    return (await this.getState()).posts.find((post) => post.id === id);
  }

  /** Adds site-owned posts. The ids are assigned here so callers cannot collide. */
  async addPosts(
    drafts: Array<Pick<Post, 'imageUri' | 'tags'> & Partial<Pick<Post, 'thumbUri' | 'width' | 'height'>>>
  ): Promise<Post[]> {
    const state = await this.getState();
    const now = new Date().toISOString();
    // thumbUri/width/height are spread rather than assigned so a draft without
    // them stores no keys at all. An absent key and an empty string mean
    // different things to the grid, which falls back to imageUri only for the
    // former.
    const records = drafts.map((draft, index) => ({
      id: `post_${Date.now().toString(36)}_${index}`,
      ...draft,
      createdAt: now,
    }));
    state.posts.push(...records);
    await this.persist();
    return records;
  }

  /**
   * Replaces a post's tags.
   *
   * `tags` is stored whole rather than patched because order carries meaning:
   * the first entry is the primary tag, and the co-like reason is named from it.
   * Reordering is therefore a normal edit, not a special case.
   */
  async updatePostTags(id: string, tags: string[]): Promise<Post | undefined> {
    const state = await this.getState();
    const post = state.posts.find((candidate) => candidate.id === id);
    if (!post) return undefined;
    post.tags = tags;
    await this.persist();
    return post;
  }

  /**
   * Removes a post and every reaction to it.
   *
   * Reactions are dropped rather than left dangling: a reaction whose post no
   * longer exists contributes an opinion on a tag nobody can see, which would
   * quietly keep weighting somebody's taste.
   */
  async deletePost(id: string): Promise<boolean> {
    const state = await this.getState();
    const index = state.posts.findIndex((post) => post.id === id);
    if (index < 0) return false;
    state.posts.splice(index, 1);
    state.postReactions = state.postReactions.filter((reaction) => reaction.postId !== id);
    await this.persist();
    return true;
  }

  /**
   * Records somebody's answer to a post, replacing any earlier one.
   *
   * Upsert rather than append: reacting to the same photo twice has to end in
   * the latest answer, or a like followed by a dislike would count as both and
   * a post could never be un-liked.
   */
  async recordPostReaction(
    userId: string,
    postId: string,
    action: PostReactionAction
  ): Promise<PostReaction> {
    const state = await this.getState();
    const existing = state.postReactions.find(
      (reaction) => reaction.userId === userId && reaction.postId === postId
    );

    if (existing) {
      existing.action = action;
      existing.createdAt = new Date().toISOString();
      await this.persist();
      return existing;
    }

    const record: PostReaction = {
      id: `reaction_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      userId,
      postId,
      action,
      createdAt: new Date().toISOString(),
    };
    state.postReactions.push(record);
    await this.persist();
    return record;
  }

  /**
   * Takes back one person's answer to a post, leaving the post itself alone.
   *
   * Deleting the row rather than writing a neutral one is the point: "default"
   * has to mean no row at all, because the taste index counts rows. A stored
   * `undo` marker would still be a reaction and would still be counted.
   *
   * Returns whether there was anything to remove, so a caller can tell a real
   * undo from one that raced a previous tap.
   */
  async removePostReaction(userId: string, postId: string): Promise<boolean> {
    const state = await this.getState();
    const before = state.postReactions.length;
    state.postReactions = state.postReactions.filter(
      (reaction) => !(reaction.userId === userId && reaction.postId === postId)
    );
    const removed = state.postReactions.length !== before;
    if (removed) await this.persist();
    return removed;
  }

  async allPostReactions(): Promise<PostReaction[]> {
    return (await this.getState()).postReactions;
  }

  /** Post ids this person has already answered, so the feed can count progress. */
  async reactedPostIds(userId: string): Promise<Set<string>> {
    const state = await this.getState();
    return new Set(
      state.postReactions
        .filter((reaction) => reaction.userId === userId)
        .map((reaction) => reaction.postId)
    );
  }

  /** Reaction counts per post, for the admin library. */
  async postReactionCounts(): Promise<Map<string, AdminPostSummary>> {
    const state = await this.getState();
    const counts = new Map<string, AdminPostSummary>();
    for (const post of state.posts) {
      counts.set(post.id, { post, likes: 0, dislikes: 0 });
    }
    for (const reaction of state.postReactions) {
      const entry = counts.get(reaction.postId);
      if (!entry) continue;
      if (reaction.action === 'like') entry.likes += 1;
      else entry.dislikes += 1;
    }
    return counts;
  }
}

export const mockDb = new MockDatabase();

/** Strips the password before a stored record crosses the service boundary. */
export function toPublicUser(user: StoredUser): User {
  const { password: _password, ...rest } = user;
  return rest;
}
