import type { NavigatorScreenParams } from '@react-navigation/native';
import type { User } from '@match-makers/shared';

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
};

export type OnboardingStackParamList = {
  Welcome: undefined;
  Basics: undefined;
  Photos: undefined;
  Preferences: undefined;
  Location: undefined;
  OnboardingDone: undefined;
};

export type MainTabParamList = {
  Feed: undefined;
  Matches: undefined;
  Messages: undefined;
  Profile: undefined;
};

export type ProfileStackParamList = {
  ProfileHome: undefined;
  EditProfile: undefined;
  Preferences: undefined;
  Settings: undefined;
  Verification: undefined;
  ProfileDetail: { userId: string; user?: User };
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
