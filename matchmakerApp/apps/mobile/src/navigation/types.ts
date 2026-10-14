import type { NavigatorScreenParams } from '@react-navigation/native';
import type { User } from '@match-makers/shared';
import type { TasteSignal } from '@/utils/matching';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type OnboardingStackParamList = {
  Welcome: undefined;
  Basics: undefined;
  Intent: undefined;
  Photos: undefined;
  Location: undefined;
  OnboardingDone: undefined;
};

/**
 * The five tabs, in landing order.
 *
 * `Feed` and `Likes` are two different jobs and are deliberately separate.
 * `Feed` is the site-owned photo feed you answer to tell the app what you like;
 * `Likes` is the deck of people that answer produces. They were one screen
 * until the feed existed, which meant the first thing a signed-in account saw
 * was either a deck with percentages it had no basis for, or the questionnaire
 * needed to justify them.
 */
export type MainTabParamList = {
  /** The photo feed. First tab, so it is what a signed-in account lands on. */
  Feed: undefined;
  /** The swipe deck of people. Gated on a complete questionnaire. */
  Likes: undefined;
  Matches: undefined;
  Messages: undefined;
  Profile: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  EditProfile: undefined;
  Preferences: undefined;
  /** What the matcher has learned about you from your photo answers. */
  TasteProfile: undefined;
  Settings: undefined;
  Verification: undefined;
  /**
   * `taste` is the photo feed's contribution to this pair, carried from the deck
   * rather than recomputed. The detail screen cannot derive it on its own: the
   * taste signal is a function of the whole reactions table, and this route is
   * reachable from places that never loaded it.
   */
  ProfileDetail: { userId: string; user?: User; taste?: TasteSignal };
  /** Mock-mode dev tool. Not part of the real product navigation. */
  AdminUsers: undefined;
  AdminUserDetail: { userId: string };
  /**
   * The site-owned photo library. Mock-mode dev tool like the two above, but
   * this one is a write path: it is how the feed is filled.
   */
  AdminPosts: undefined;
  AdminPostImport: undefined;
};

export type ChatStackParamList = {
  Chat: { matchId: string; title?: string; avatarUri?: string | null };
};

export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  Main: NavigatorScreenParams<MainTabParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
  Chat: NavigatorScreenParams<ChatStackParamList>;
};
