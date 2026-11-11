import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';
import { Client as PgClient } from 'pg';
import { verifyAccessToken } from '@/auth';
import { pool, type Queryable } from '@/db';
import { env } from '@/env';

/**
 * Real-time invalidation events for matches and messages.
 *
 * Postgres `LISTEN`/`NOTIFY` rather than Redis, and the reason is that it needs
 * no new infrastructure: the database is already there, already running, and
 * already the thing both sides of a conversation agree on. Redis is where
 * `fp_reviews.md` wants this to end up, and moving the fan-out to a Redis
 * channel later is a contained change -- the publish side is one function.
 *
 * `NOTIFY` carries at most 8KB, which is plenty for a pointer to a changed
 * match or conversation. The client fetches the authoritative data over HTTP,
 * so there is one source of truth for both.
 *
 * The trade with `NOTIFY` is that it is not durable: a notification is delivered
 * to whoever is listening at that moment and is gone. That is the right shape
 * for "tell the other person something happened" as long as the changed data is
 * in the database, which it is. Clients refetch on reconnect to recover events
 * missed while they were offline.
 */

/** The channel both sides listen on. */
const CHANNEL = 'match_updates';

/** A signed-in connection. */
interface Connection {
  userId: string;
  socket: WebSocket;
}

/**
 * The open connections, by user.
 *
 * A user can have more than one: a phone and a laptop, or two browser tabs.
 * That is the point of the map holding a set.
 */
const connections = new Map<string, Set<Connection>>();

/**
 * The listener connection.
 *
 * Separate from the pool, because `LISTEN` takes a connection over for as long
 * as it is listening, and the pool is for work.
 */
let listener: PgClient | null = null;

export interface MessageNotification {
  type: 'message';
  matchId: string;
  senderId: string;
  /** So a client can tell a new message from a repeat of one it already has. */
  messageId: string;
}

export interface MatchCreatedNotification {
  type: 'match_created';
  matchId: string;
}

type Notification = MessageNotification | MatchCreatedNotification;

/**
 * Queues a message notification in the same transaction as the message.
 *
 * Postgres delivers the notification only when this transaction commits, so a
 * client that reacts and fetches the message always finds it. Keeping the
 * notification in the write transaction also avoids returning an error after a
 * message has already committed just because a separate notify query failed.
 *
 * The notification is the only delivery path. An earlier version also delivered
 * straight to the sockets, in the hope of saving a few milliseconds -- and
 * delivered every message twice, because the listener delivered it again a
 * moment later. Delivering through the database is also what makes this work
 * across more than one API process, which a direct hand-off would not.
 *
 * The participants are not included, and are read from the database by the
 * listener instead: a payload that named them would be a payload a client could
 * be told to trust, and the conversation's membership is not the sender's to
 * assert.
 */
export async function publishMessage(
  client: Queryable,
  matchId: string,
  senderId: string,
  messageId: string
): Promise<void> {
  const payload: MessageNotification = { type: 'message', matchId, senderId, messageId };
  await client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]);
}

/**
 * Queues a new-match notification in the same transaction that creates it.
 *
 * Only the match id is carried. The listener looks up its participants from the
 * database, and the clients refetch the match list over the authenticated API.
 */
export async function publishMatchCreated(client: Queryable, matchId: string): Promise<void> {
  const payload: MatchCreatedNotification = { type: 'match_created', matchId };
  await client.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify(payload)]);
}

/**
 * Sends a payload to both participants in a match or conversation.
 *
 * The sender is included, so their own other tabs update too.
 */
function deliver(notification: Notification, participantIds: string[]): void {
  const body = JSON.stringify(notification);
  for (const userId of participantIds) {
    for (const client of connections.get(userId) ?? []) {
      if (client.socket.readyState === client.socket.OPEN) {
        client.socket.send(body);
      }
    }
  }
}

/**
 * Starts the WebSocket server and the database listener.
 *
 * The token goes in the query string, because a browser cannot set headers on a
 * WebSocket handshake. It is the same access token the HTTP API uses, so it
 * expires on the same clock, and it is verified before the connection is
 * accepted rather than after.
 */
export async function attachRealtime(server: Server): Promise<void> {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const token = url.searchParams.get('token');

    const payload = token ? verifyAccessToken(token) : null;
    if (!payload) {
      // Refuse rather than accept and hang up: a client that cannot
      // authenticate should know immediately.
      socket.close(4401, 'Unauthorized');
      return;
    }

    const client: Connection = { userId: payload.sub, socket };
    const forUser = connections.get(payload.sub) ?? new Set<Connection>();
    forUser.add(client);
    connections.set(payload.sub, forUser);

    socket.on('close', () => {
      forUser.delete(client);
      if (forUser.size === 0) connections.delete(payload.sub);
    });

    // A hello, so the client knows the connection is live rather than waiting
    // for the first message to prove it.
    socket.send(JSON.stringify({ type: 'ready', userId: payload.sub }));
  });

  await startListener();
}

/**
 * Listens for notifications and forwards them.
 *
 * Reconnects on failure, because a database restart should not silently end
 * real-time delivery for the life of the process.
 */
async function startListener(): Promise<void> {
  const client = new PgClient({ connectionString: env.DATABASE_URL });

  client.on('notification', (message) => {
    if (message.channel !== CHANNEL || !message.payload) return;

    const payload = parseNotification(message.payload);
    if (!payload) return;

    void forwardToParticipants(payload).catch((error: unknown) => {
      console.error('[realtime] could not forward update:', error);
    });
  });

  client.on('error', (error) => {
    console.error('[realtime] listener error:', error.message);
    listener = null;
    // Reconnect shortly. The listener is the only thing that notices a
    // notification, so a dead one means silently no delivery.
    setTimeout(() => void startListener(), 2000);
  });

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  listener = client;

  console.log('[realtime] listening for match and message updates');
}

/** Parses notifications from Postgres, ignoring malformed or unknown payloads. */
function parseNotification(raw: string): Notification | null {
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    if (
      payload.type === 'message' &&
      typeof payload.matchId === 'string' &&
      typeof payload.senderId === 'string' &&
      typeof payload.messageId === 'string'
    ) {
      return {
        type: 'message',
        matchId: payload.matchId,
        senderId: payload.senderId,
        messageId: payload.messageId,
      };
    }
    if (payload.type === 'match_created' && typeof payload.matchId === 'string') {
      return { type: 'match_created', matchId: payload.matchId };
    }
  } catch {
    // Ignore malformed database notifications.
  }
  return null;
}

/**
 * Looks up who is in a match and pushes the notification to its participants.
 *
 * The participants are read from the database rather than carried in the
 * notification, so the notification cannot be used to tell a client about a
 * conversation it is not part of.
 */
async function forwardToParticipants(payload: Notification): Promise<void> {
  const { rows } = await pool.query<{ user_a_id: string; user_b_id: string }>(
    'SELECT user_a_id, user_b_id FROM matches WHERE id = $1',
    [payload.matchId]
  );

  const match = rows[0];
  if (!match) return;

  deliver(payload, [match.user_a_id, match.user_b_id]);
}

/** Closes the listener. Used when the server shuts down. */
export async function stopRealtime(): Promise<void> {
  if (listener) {
    await listener.end();
    listener = null;
  }
}

/** How many connections are open. Used by the health route and the tests. */
export function connectionCount(): number {
  let total = 0;
  for (const forUser of connections.values()) total += forUser.size;
  return total;
}
