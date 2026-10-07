import type { SwipeAction, User } from '@match-makers/shared';
import { persistentStore, readJson, writeJson } from '@/services/storage/keyValueStore';
import { normaliseStateUsers } from './migrate';
import { DEMO_EMAIL, generateDemoUser, generateMockUsers } from '@/utils/mockData';

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

interface MockState {
  users: StoredUser[];
  currentUserId: string | null;
  swipes: SwipeRecord[];
  matches: MockMatch[];
  messages: StoredMessage[];
}

function createInitialState(): MockState {
  const demoUser = generateDemoUser();
  const candidates = generateMockUsers(SEED_CANDIDATE_COUNT).filter(
    (user) => user.email !== DEMO_EMAIL
  );
  return {
    users: [demoUser, ...candidates],
    currentUserId: null,
    swipes: [],
    matches: [],
    messages: [],
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
        const { users, changed } = normaliseStateUsers(loaded.users);
        this.state = { ...loaded, users: users as StoredUser[] };

        if (needsReseed || changed) void this.persist();
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
}

export const mockDb = new MockDatabase();

/** Strips the password before a stored record crosses the service boundary. */
export function toPublicUser(user: StoredUser): User {
  const { password: _password, ...rest } = user;
  return rest;
}
