import { API_CONFIG, AUTH_STORAGE_KEYS } from '@/constants';
import { getAuthTransport } from '@/services/api/client';
import { getSecretStore } from '@/services/storage/keyValueStore';

/**
 * Real-time match and message invalidations, client side.
 *
 * The server pushes a notification over a WebSocket when a message lands in a
 * conversation or a match is created, and the client fetches the affected data
 * over HTTP. Notifications are pointers, not domain data, so HTTP remains the
 * source of truth.
 *
 * The socket is a *latency* optimisation, never the only way to see a message.
 * Everything here has a fallback -- polling, and the normal refetch on screen
 * focus -- because a socket that silently stops delivering is far worse than
 * one that never connected. A connection that dies must be visible, not
 * invisible.
 */

/** The server's push notification. */
export interface MessageNotification {
  type: 'message';
  matchId: string;
  senderId: string;
  /** So a client can tell a new message from a repeat of one it already has. */
  messageId: string;
}

/** A new match was created. The client refetches its match list over HTTP. */
export interface MatchCreatedNotification {
  type: 'match_created';
  matchId: string;
}

/** The server's hello, sent as soon as the socket is accepted. */
export interface ReadyEvent {
  type: 'ready';
  userId: string;
}

export type RealtimeNotification = MessageNotification | MatchCreatedNotification;
export type RealtimeEvent = RealtimeNotification | ReadyEvent;

/**
 * How the connection is doing.
 *
 * `idle`    - nobody is listening, or there is no server to listen to
 * `connecting` - a connection is being made or re-made
 * `open`    - the socket is live and the server has said hello
 * `closed`  - the socket has dropped and a retry is scheduled
 */
export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'closed';

type Subscriber = (event: RealtimeNotification) => void;

interface Subscription {
  /** The conversation being watched, or undefined for all of them. */
  matchId: string | undefined;
  handler: Subscriber;
}

/** The open socket, if any. */
let socket: WebSocket | null = null;

/** Who is listening. */
let subscribers: Subscription[] = [];

/** Where the connection is, for the UI. */
let status: RealtimeStatus = 'idle';

/** Notified when the status changes. */
const statusListeners = new Set<(status: RealtimeStatus) => void>();

/** The retry timer, so a second failure does not stack a second timer. */
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** How many times we have retried, for the backoff. */
let attempt = 0;

/**
 * How long to wait before the next retry, doubling up to half a minute.
 *
 * Without the cap, a server that is down is hit every second for as long as the
 * app is open. With it, the app settles into one request a minute and stops
 * caring.
 */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;

/**
 * How long to wait after the last subscriber leaves before closing the socket.
 *
 * Navigating from the conversation list into a chat unmounts one screen and
 * mounts another, and closing the socket in between would mean a fresh
 * handshake every time. The grace period keeps it open across that.
 */
const CLOSE_GRACE_MS = 5000;

/** The websocket URL, with the access token in the query string. */
function socketUrl(token: string): string {
  // A browser cannot set headers on a WebSocket handshake, so the token goes in
  // the query string. It is the same short-lived access token the HTTP API
  // uses, so it expires on the same clock.
  const base = API_CONFIG.BASE_URL.replace(/\/+$/, '').replace(/\/api$/, '');
  return `${base.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`;
}

/** Publishes a status change. */
function setStatus(next: RealtimeStatus): void {
  if (status === next) return;
  status = next;
  for (const listener of statusListeners) listener(next);
}

export function realtimeStatus(): RealtimeStatus {
  return status;
}

/** Watches the connection status. Returns an unsubscribe function. */
export function onRealtimeStatus(listener: (status: RealtimeStatus) => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

/** The fallback cadence used by focused data screens when live updates are down. */
export const REALTIME_POLL_INTERVAL_MS = 5000;

/**
 * Watches for match and message updates.
 *
 * `matchId` narrows the watch to one conversation or match; leave it out to
 * watch all of the signed-in user's updates, as the match and message lists do.
 *
 * Returns an unsubscribe function. The socket is shared, so the last
 * unsubscribe is what closes it.
 *
 * The caller decides whether to subscribe. Keeping the decision at the call
 * site stops this module knowing about the auth layer, which would otherwise
 * pull it into a cycle with the adapter that disconnects it.
 */
export function subscribeToUpdates(handler: Subscriber, matchId?: string): () => void {
  const subscription: Subscription = { matchId, handler };
  subscribers = [...subscribers, subscription];

  void ensureConnected();

  return () => {
    subscribers = subscribers.filter((entry) => entry !== subscription);
    if (subscribers.length === 0) scheduleClose();
  };
}

/** Watches for messages, optionally narrowed to one conversation. */
export function subscribeToMessages(
  handler: (event: MessageNotification) => void,
  matchId?: string
): () => void {
  return subscribeToUpdates((event) => {
    if (event.type === 'message') handler(event);
  }, matchId);
}

/**
 * Hands a notification to whoever is watching for it.
 *
 * A subscriber watching one conversation only hears about that conversation.
 * A subscriber watching all of them hears about all of them, which is the
 * conversation list's need: it does not know which conversation a message
 * belongs to until the server says so.
 */
function dispatch(event: RealtimeNotification): void {
  for (const subscriber of subscribers) {
    if (subscriber.matchId !== undefined && subscriber.matchId !== event.matchId) continue;
    try {
      subscriber.handler(event);
    } catch {
      // One bad subscriber must not stop the others from hearing about it.
    }
  }
}

/**
 * Opens the socket if it is not already open.
 *
 * The token is read fresh each time, because it is short-lived and the socket
 * outlives several access tokens when it stays connected.
 */
async function ensureConnected(): Promise<void> {
  if (
    socket &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const token = await getSecretStore().get(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
  if (!token) {
    setStatus('idle');
    return;
  }

  setStatus('connecting');

  let next: WebSocket;
  try {
    next = new WebSocket(socketUrl(token));
  } catch {
    scheduleRetry();
    return;
  }
  socket = next;

  next.onopen = () => {
    attempt = 0;
    // The status stays `connecting` until the server's hello arrives, because
    // an open socket is not yet an authenticated one -- the server closes
    // unauthorised handshakes immediately.
  };

  next.onmessage = (event: WebSocketMessageEvent) => {
    const parsed = parseEvent(event.data);
    if (!parsed) return;

    if (parsed.type === 'ready') {
      setStatus('open');
      return;
    }

    dispatch(parsed);
  };

  next.onerror = () => {
    // `onclose` always follows, and it is where the retry is scheduled.
  };

  next.onclose = (event: WebSocketCloseEvent) => {
    socket = null;
    setStatus('closed');

    // The server refuses a socket whose token has expired. Renewing and
    // reconnecting is better than waiting for the user to notice that messages
    // have stopped arriving.
    if (event.code === 4401) {
      void getAuthTransport()
        ?.refresh()
        .catch(() => undefined);
    }

    scheduleRetry();
  };
}

/** Parses a frame, ignoring anything that is not one of ours. */
function parseEvent(raw: unknown): RealtimeEvent | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'ready' && typeof value.userId === 'string') {
      return { type: 'ready', userId: value.userId };
    }
    if (
      value.type === 'message' &&
      typeof value.matchId === 'string' &&
      typeof value.messageId === 'string' &&
      typeof value.senderId === 'string'
    ) {
      return {
        type: 'message',
        matchId: value.matchId,
        messageId: value.messageId,
        senderId: value.senderId,
      };
    }
    if (value.type === 'match_created' && typeof value.matchId === 'string') {
      return { type: 'match_created', matchId: value.matchId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Schedules a reconnect, with a backoff.
 *
 * Nothing is scheduled when nobody is listening: an app in the background with
 * no message screen open has no reason to hold a socket open, and holding one
 * would keep a database connection and a socket alive for a screen nobody is
 * looking at.
 */
function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (subscribers.length === 0) return;

  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  attempt += 1;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureConnected();
  }, delay);
}

/**
 * Closes the socket once the last subscriber has gone.
 *
 * Delayed, so moving between the conversation list and a chat does not close
 * and reopen it.
 */
function scheduleClose(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  setTimeout(() => {
    if (subscribers.length > 0) return;
    socket?.close();
    socket = null;
    attempt = 0;
    setStatus('idle');
  }, CLOSE_GRACE_MS);
}

/**
 * Drops the connection.
 *
 * Called when the user signs out: a socket left open would keep delivering
 * somebody else's messages to a device that is no longer signed in as them.
 */
export function disconnectRealtime(): void {
  subscribers = [];
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  socket?.close();
  socket = null;
  attempt = 0;
  setStatus('idle');
}

/**
 * Whether the socket is currently live.
 *
 * Focused list screens and Chat use this to avoid API polling while push
 * delivery is healthy. When it is not, they fall back to regular API reads.
 */
export function isRealtimeConnected(): boolean {
  return status === 'open';
}
