export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  NON_BINARY = 'non_binary',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum SexualOrientation {
  STRAIGHT = 'straight',
  GAY = 'gay',
  LESBIAN = 'lesbian',
  BISEXUAL = 'bisexual',
  PANSEXUAL = 'pansexual',
  ASEXUAL = 'asexual',
  QUEER = 'queer',
  OTHER = 'other',
  PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum RelationshipGoal {
  LONG_TERM = 'long_term',
  SHORT_TERM = 'short_term',
  CASUAL = 'casual',
  FRIENDSHIP = 'friendship',
  NOT_SURE = 'not_sure',
}

export interface User {
  id: string;
  email: string;
  name: string;
  dateOfBirth: string; // ISO date string
  gender: Gender;
  sexualOrientation: SexualOrientation;
  relationshipGoal: RelationshipGoal;
  bio: string;
  photos: Photo[];
  location: Location;
  preferences: UserPreferences;
  isVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Photo {
  id: string;
  url: string;
  isPrimary: boolean;
  order: number;
}

export interface Location {
  latitude: number;
  longitude: number;
  city: string;
  country: string;
}

export interface UserPreferences {
  ageRange: { min: number; max: number };
  maxDistance: number; // in kilometers
  genders: Gender[];
  relationshipGoals: RelationshipGoal[];
}

export interface ProfileSetupData {
  name: string;
  dateOfBirth: string;
  gender: Gender;
  sexualOrientation: SexualOrientation;
  relationshipGoal: RelationshipGoal;
  bio: string;
  photos: File[];
  location: Location;
  preferences: UserPreferences;
}

export interface SwipeAction {
  type: 'like' | 'pass' | 'super_like';
  targetUserId: string;
}

export interface Match {
  id: string;
  users: [User, User];
  createdAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
}

export interface Message {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  type: 'text' | 'image' | 'system';
  createdAt: string;
  readAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResult {
  user: User;
  tokens?: AuthTokens;
  sessionId?: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface RegisterData {
  email: string;
  password: string;
  name: string;
  dateOfBirth: string;
  gender: Gender;
}
