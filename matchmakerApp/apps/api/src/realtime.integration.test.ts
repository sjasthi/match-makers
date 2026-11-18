import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import express from 'express';
import WebSocket from 'ws';
import { applyReactionToAffinity } from './affinity';
import { issueAccessToken } from './auth';
import { eligibilitySql } from './eligibility';
import { pool } from './db';
import { rescoreForViewer } from './matching';
import { matchesRouter, messagesRouter } from './routes/matches';
import { postsRouter } from './routes/posts';
import { swipesRouter } from './routes/swipes';
import { attachRealtime, stopRealtime } from './realtime';

type Frame = Record<string, unknown>;

interface RealtimeClient {
  socket: WebSocket;
  frames: Frame[];
}

const createdUserIds: string[] = [];
const createdPostIds: string[] = [];
const clients: RealtimeClient[] = [];
let databaseAvailable = false;
let server: Server | null = null;
let httpBase = '';
let wsBase = '';

async function createUser(name: string): Promise<string> {
  const suffix = randomUUID();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, name, date_of_birth, gender)
          VALUES ($1, 'test-password-hash', $2, '1995-01-01', 'female')
       RETURNING id`,
    [`realtime.${suffix}@test.local`, name]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('could not create realtime test user');
  createdUserIds.push(id);
  return id;
}

async function createPost(tags: string[]): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO posts (image_uri, tags) VALUES ('test://automatic-rescore', $1) RETURNING id`,
    [tags]
  );
  const id = rows[0]?.id;
  if (!id) throw new Error('could not create automatic-rescore test post');
  createdPostIds.push(id);
  return id;
}

async function givePreferences(userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_preferences
       (user_id, age_min, age_max, distance_mode, genders, relationship_goals)
     VALUES ($1, 18, 100, 'global', '{}'::gender[], '{}'::relationship_goal[])`,
    [userId]
  );
}

async function storedScore(viewerId: string, candidateId: string): Promise<number> {
  const { rows } = await pool.query<{ score: number }>(
    'SELECT score FROM match_scores WHERE viewer_id = $1 AND candidate_id = $2',
    [viewerId, candidateId]
  );
  const score = rows[0]?.score;
  if (score === undefined) throw new Error('rescore did not store the candidate score');
  return score;
}

async function remove(path: string, userId: string): Promise<Response> {
  return fetch(`${httpBase}${path}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${issueAccessToken(userId)}` },
  });
}

function waitForFrame(
  client: RealtimeClient,
  type: string,
  fromIndex = 0
): Promise<Frame> {
  const existing = client.frames.slice(fromIndex).find((frame) => frame.type === type);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      client.socket.off('message', onMessage);
      client.socket.off('close', onClose);
    };
    const onMessage = (data: WebSocket.RawData) => {
      let frame: Frame;
      try {
        frame = JSON.parse(data.toString()) as Frame;
      } catch {
        return;
      }
      if (frame.type !== type) return;
      cleanup();
      resolve(frame);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`socket closed before receiving ${type}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timed out waiting for ${type}`));
    }, 5000);

    client.socket.on('message', onMessage);
    client.socket.once('close', onClose);
  });
}

async function connect(userId: string): Promise<RealtimeClient> {
  const socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(issueAccessToken(userId))}`);
  const client: RealtimeClient = { socket, frames: [] };
  clients.push(client);
  socket.on('message', (data) => {
    try {
      client.frames.push(JSON.parse(data.toString()) as Frame);
    } catch {
      // The test only records valid server frames.
    }
  });

  const ready = waitForFrame(client, 'ready');
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  await Promise.all([opened, ready]);
  return client;
}

async function post(path: string, userId: string, body: unknown): Promise<Response> {
  return fetch(`${httpBase}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${issueAccessToken(userId)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('match and message websocket updates', () => {
  before(async () => {
    try {
      await pool.query('SELECT 1');
      databaseAvailable = true;
    } catch {
      databaseAvailable = false;
      return;
    }

    const app = express();
    app.use(express.json());
    app.use('/swipes', swipesRouter);
    app.use('/matches', matchesRouter);
    app.use('/messages', messagesRouter);
    app.use('/posts', postsRouter);

    server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server?.once('error', reject);
      server?.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server has no TCP address');
    httpBase = `http://127.0.0.1:${address.port}`;
    wsBase = `ws://127.0.0.1:${address.port}`;
    await attachRealtime(server);
  });

  after(async () => {
    for (const client of clients) {
      if (client.socket.readyState !== WebSocket.CLOSED) client.socket.terminate();
    }
    await stopRealtime();

    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    if (createdUserIds.length > 0) {
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
    }
    if (createdPostIds.length > 0) {
      await pool.query('DELETE FROM posts WHERE id = ANY($1::uuid[])', [createdPostIds]);
    }
    await pool.end();
  });

  test('refreshes both match participants and conversation clients, not strangers', async (t) => {
    if (!databaseAvailable) {
      t.skip('no database available');
      return;
    }

    const firstUser = await createUser('Realtime first');
    const secondUser = await createUser('Realtime second');
    const stranger = await createUser('Realtime stranger');

    // The second user's swipe will complete this reciprocal pair.
    await pool.query(
      `INSERT INTO swipes (actor_id, target_user_id, action)
       VALUES ($1, $2, 'like')`,
      [firstUser, secondUser]
    );

    const firstClient = await connect(firstUser);
    const secondClient = await connect(secondUser);
    const strangerClient = await connect(stranger);

    const firstMatchIndex = firstClient.frames.length;
    const secondMatchIndex = secondClient.frames.length;
    const matchForFirst = waitForFrame(firstClient, 'match_created', firstMatchIndex);
    const matchForSecond = waitForFrame(secondClient, 'match_created', secondMatchIndex);

    const matchResponse = await post('/swipes', secondUser, {
      targetUserId: firstUser,
      action: 'like',
    });
    assert.equal(matchResponse.status, 201);
    const matchBody = (await matchResponse.json()) as {
      data: { isMatch: boolean; match: { id: string } };
    };
    assert.equal(matchBody.data.isMatch, true);

    const [firstMatchEvent, secondMatchEvent] = await Promise.all([matchForFirst, matchForSecond]);
    assert.deepEqual(firstMatchEvent, {
      type: 'match_created',
      matchId: matchBody.data.match.id,
    });
    assert.deepEqual(secondMatchEvent, firstMatchEvent);
    assert.equal(
      strangerClient.frames.some(
        (frame) => frame.type === 'match_created' && frame.matchId === matchBody.data.match.id
      ),
      false,
      'a user outside the match must not receive its notification'
    );

    // Repeating the reciprocal swipe returns the existing match but must not
    // claim that a second match was created.
    const repeatedMatchIndex = firstClient.frames.length;
    const repeated = await post('/swipes', secondUser, {
      targetUserId: firstUser,
      action: 'like',
    });
    assert.equal(repeated.status, 201);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(
      firstClient.frames.slice(repeatedMatchIndex).some((frame) => frame.type === 'match_created'),
      false
    );

    const firstMessageIndex = firstClient.frames.length;
    const secondMessageIndex = secondClient.frames.length;
    const messageForFirst = waitForFrame(firstClient, 'message', firstMessageIndex);
    const messageForSecond = waitForFrame(secondClient, 'message', secondMessageIndex);
    const messageResponse = await post(
      `/messages/${matchBody.data.match.id}`,
      firstUser,
      { content: 'hello from realtime integration' }
    );
    assert.equal(messageResponse.status, 201);
    const messageBody = (await messageResponse.json()) as { data: { id: string } };

    const [firstMessageEvent, secondMessageEvent] = await Promise.all([
      messageForFirst,
      messageForSecond,
    ]);
    assert.equal(firstMessageEvent.messageId, messageBody.data.id);
    assert.deepEqual(secondMessageEvent, firstMessageEvent);
    assert.equal(
      strangerClient.frames.some(
        (frame) => frame.type === 'message' && frame.messageId === messageBody.data.id
      ),
      false,
      'a user outside the conversation must not receive its notification'
    );
  });

  test('automatically rescales both pair directions after a like and an undo', async (t) => {
    if (!databaseAvailable) {
      t.skip('no database available');
      return;
    }

    const viewerId = await createUser('Automatic rescore viewer');
    const candidateId = await createUser('Automatic rescore candidate');
    await givePreferences(viewerId);
    await givePreferences(candidateId);
    await pool.query(
      `INSERT INTO swipes (actor_id, target_user_id, action)
       VALUES ($1, $2, 'like')`,
      [viewerId, candidateId]
    );

    const postIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const tag = `rescore-${randomUUID()}-${index}`;
      const postId = await createPost([tag]);
      postIds.push(postId);

      for (const userId of [viewerId, candidateId]) {
        await pool.query(
          `INSERT INTO post_reactions (user_id, post_id, action)
           VALUES ($1, $2, 'like')`,
          [userId, postId]
        );
        await applyReactionToAffinity(pool, userId, [tag], 'like');
      }
    }

    // Establish the saved baseline, then exercise the same mutation routes the
    // app uses. The route must maintain the same pair score in both directions
    // without the CLI.
    await rescoreForViewer(pool, viewerId, eligibilitySql({ excludeSwiped: false }));
    const beforeUndo = await storedScore(viewerId, candidateId);
    assert.equal(await storedScore(candidateId, viewerId), beforeUndo);

    const removed = await remove(`/posts/reactions/${postIds[4]}`, viewerId);
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), { data: { removed: true } });
    const afterUndo = await storedScore(viewerId, candidateId);
    assert.equal(await storedScore(candidateId, viewerId), afterUndo);
    assert.ok(afterUndo < beforeUndo, `undo should lower the stored score (${beforeUndo} -> ${afterUndo})`);

    const restored = await post('/posts/reactions', viewerId, {
      postId: postIds[4],
      action: 'like',
    });
    assert.equal(restored.status, 201);
    const afterLike = await storedScore(viewerId, candidateId);
    assert.equal(await storedScore(candidateId, viewerId), afterLike);
    assert.ok(afterLike > afterUndo, `a new shared like should raise the score (${afterUndo} -> ${afterLike})`);
  });
});
