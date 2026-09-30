import type { Conversation, MatchedUserSummary, MessageSummary, User } from '@match-makers/shared';
import { getApiClient } from '@/services/api/client';
import { getAuthAdapter } from '@/services/auth';
import { mockDb, toPublicUser } from '@/services/mock/database';
import { simulateLatency, maybeSimulateFailure } from '@/services/mock/network';
import { generateConversationOpeners } from '@/utils/mockData';

export interface MatchSummary {
  id: string;
  user: User;
  createdAt: string;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

async function buildMockMatches(): Promise<MatchSummary[]> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) return [];

  const matches = await mockDb.matchesForUser(viewer.id);
  const summaries: MatchSummary[] = [];

  for (const match of matches) {
    const partnerId = match.userIds.find((id) => id !== viewer.id);
    if (!partnerId) continue;
    const partner = await mockDb.findUserById(partnerId);
    if (!partner) continue;

    const messages = await mockDb.messagesForMatch(match.id);
    const last = messages[messages.length - 1];

    summaries.push({
      id: match.id,
      user: toPublicUser(partner),
      createdAt: match.createdAt,
      lastMessagePreview: last?.content,
      lastMessageAt: last?.createdAt,
      unreadCount: messages.filter((message) => message.senderId === partnerId && !message.readAt)
        .length,
    });
  }

  return summaries.sort((a, b) =>
    (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt)
  );
}

export async function fetchMatches(): Promise<MatchSummary[]> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    maybeSimulateFailure();
    return buildMockMatches();
  }
  const response = await getApiClient().get<MatchSummary[]>('/matches');
  return response.data;
}

export async function unmatch(matchId: string): Promise<void> {
  if (getAuthAdapter().mode === 'mock') {
    await simulateLatency();
    return;
  }
  await getApiClient().delete(`/matches/${matchId}`);
}

function toSummary(user: User): MatchedUserSummary {
  return {
    id: user.id,
    name: user.name,
    primaryPhotoUrl:
      user.photos.find((photo) => photo.isPrimary)?.url ?? user.photos[0]?.url ?? null,
    isVerified: user.isVerified,
  };
}

export async function fetchConversations(): Promise<Conversation[]> {
  const matches = await fetchMatches();
  return matches.map((match) => {
    const conversation: Conversation = {
      matchId: match.id,
      user: toSummary(match.user),
      lastMessage: match.lastMessagePreview
        ? {
            id: `preview_${match.id}`,
            senderId: match.id,
            content: match.lastMessagePreview,
            sentAt: match.lastMessageAt ?? match.createdAt,
          }
        : null,
      unreadCount: match.unreadCount,
      updatedAt: match.lastMessageAt ?? match.createdAt,
    };
    return conversation;
  });
}

export interface ChatMessage extends MessageSummary {
  isMine: boolean;
}

/**
 * Loads a conversation, seeding a couple of messages the first time a match is
 * opened so the chat screen is not an empty box in the prototype.
 */
export async function fetchMessages(matchId: string): Promise<ChatMessage[]> {
  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) return [];

  if (adapter.mode === 'mock') {
    await simulateLatency();
    const existing = await mockDb.messagesForMatch(matchId);
    if (existing.length === 0) {
      const matches = await mockDb.matchesForUser(viewer.id);
      const match = matches.find((candidate) => candidate.id === matchId);
      const partnerId = match?.userIds.find((id) => id !== viewer.id);
      if (partnerId) {
        const openers = generateConversationOpeners();
        await mockDb.addMessage({
          matchId,
          senderId: partnerId,
          content: openers[0] ?? 'Hey there!',
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
        });
        await mockDb.addMessage({
          matchId,
          senderId: viewer.id,
          content: 'Ha, I will defend the take. Give me a minute.',
          createdAt: new Date(Date.now() - 1_800_000).toISOString(),
        });
      }
    }

    const messages = await mockDb.messagesForMatch(matchId);
    return messages.map((message) => ({
      id: message.id,
      senderId: message.senderId,
      content: message.content,
      sentAt: message.createdAt,
      isMine: message.senderId === viewer.id,
    }));
  }

  const response = await getApiClient().get<{ items: MessageSummary[] }>(`/messages/${matchId}`);
  return response.data.items.map((message) => ({
    ...message,
    isMine: message.senderId === viewer.id,
  }));
}

export async function sendMessage(matchId: string, content: string): Promise<ChatMessage> {
  const trimmed = content.trim();
  if (!trimmed) throw new Error('Message cannot be empty');

  const adapter = getAuthAdapter();
  const viewer = await adapter.getCurrentUser();
  if (!viewer) throw new Error('You need to be signed in to send messages');

  const sentAt = new Date().toISOString();

  if (adapter.mode === 'mock') {
    await simulateLatency();
    const message = await mockDb.addMessage({
      matchId,
      senderId: viewer.id,
      content: trimmed,
      createdAt: sentAt,
      readAt: sentAt,
    });
    return {
      id: message.id,
      senderId: message.senderId,
      content: message.content,
      sentAt: message.createdAt,
      isMine: true,
    };
  }

  const response = await getApiClient().post<MessageSummary>(`/messages/${matchId}`, {
    content: trimmed,
  });
  return { ...response.data, isMine: true };
}

export async function markConversationRead(matchId: string): Promise<void> {
  const adapter = getAuthAdapter();
  if (adapter.mode !== 'mock') {
    await getApiClient().post(`/messages/${matchId}/read`);
    return;
  }
  const viewer = await adapter.getCurrentUser();
  if (!viewer) return;
  await mockDb.markMatchRead(matchId, viewer.id);
}
