import type { SwipeAction } from './index';

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Field-level messages keyed by form field name. */
  fieldErrors?: Record<string, string>;
}

export interface ApiEnvelope<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface Paginated<T> {
  items: T[];
  meta: PaginationMeta;
}

export interface FeedQuery {
  page?: number;
  pageSize?: number;
  maxDistance?: number;
  minAge?: number;
  maxAge?: number;
  excludeIds?: string[];
}

export interface SwipeRequest {
  targetUserId: string;
  action: SwipeAction['type'];
}

export interface SwipeResponse {
  swipeId: string;
  isMatch: boolean;
  match?: MatchPair;
}

export interface MatchPair {
  id: string;
  matchedAt: string;
  user: MatchedUserSummary;
}

export interface MatchedUserSummary {
  id: string;
  name: string;
  primaryPhotoUrl: string | null;
  isVerified: boolean;
}

export interface Conversation {
  matchId: string;
  user: MatchedUserSummary;
  lastMessage: MessageSummary | null;
  unreadCount: number;
  updatedAt: string;
}

export interface MessageSummary {
  id: string;
  senderId: string;
  content: string;
  sentAt: string;
}

export interface VerificationStatus {
  status: 'unverified' | 'pending' | 'verified' | 'rejected';
  method?: 'document' | 'selfie' | 'phone' | 'email';
  submittedAt?: string;
  rejectionReason?: string;
}
