import type { User } from '@match-makers/shared';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { withMockNetwork } from '@/services/mock/network';
import { hasCompleteQuestionnaire, isProfileComplete } from '@/services/profile';
import { ageFromDateOfBirth, DEMO_EMAIL } from '@/utils/mockData';

/**
 * Read-only inspection of every account in the mock database.
 *
 * There is no backend yet, so this exists purely so seeded and locally
 * registered accounts can be checked while testing. It is deliberately the
 * mirror image of `services/profile.ts`: that module answers "is this person
 * ready to be shown in the feed", this one shows the answer for everybody at
 * once, which is what you cannot do from inside a single session.
 *
 * Nothing here writes. `mockDb` is the test fixture, so an admin edit would
 * quietly destroy the seeded state the next test run depends on, and "reset
 * mock data" in Settings is the only mutation path on purpose.
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

export interface AdminUserSummary {
  user: User;
  age: number;
  /** The seeded demo account, or anything registered under the demo domain. */
  isDemo: boolean;
  /** Matches what gates the feed for this account. */
  isProfileComplete: boolean;
  /** True once the questionnaire is a whole, valid answer set. */
  hasCompleteQuestionnaire: boolean;
  photoCount: number;
  promptCount: number;
  matchCount: number;
}

function toSummary(user: User, matchCount: number): AdminUserSummary {
  return {
    user,
    age: ageFromDateOfBirth(user.dateOfBirth),
    isDemo: user.email.toLowerCase() === DEMO_EMAIL,
    isProfileComplete: isProfileComplete(user),
    hasCompleteQuestionnaire: hasCompleteQuestionnaire(user),
    photoCount: user.photos.length,
    promptCount: user.questionnaire?.prompts.length ?? 0,
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
        return toSummary(user, (await mockDb.matchesForUser(user.id)).length);
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
