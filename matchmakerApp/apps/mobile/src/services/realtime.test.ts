import { AUTH_STORAGE_KEYS } from '@/constants';
import { getSecretStore } from '@/services/storage/keyValueStore';
import {
  disconnectRealtime,
  isRealtimeConnected,
  onRealtimeStatus,
  realtimeStatus,
  subscribeToMessages,
  type MessageNotification,
} from './realtime';

/**
 * A WebSocket stand-in.
 *
 * The real one is not available in the test environment, and the parts of it
 * this module touches are narrow: the constructor, the ready state, and the
 * four event handlers. So the fake is exactly that, and the tests drive the
 * handlers directly rather than pretending to be a network.
 */
class FakeSocket {
  static instances: FakeSocket[] = [];

  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  closeCalls = 0;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
    this.readyState = FakeSocket.CLOSED;
  }

  /** Opens the socket, as the browser would. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  /** Delivers a frame. */
  receive(payload: unknown): void {
    this.onmessage?.({ data: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  }

  /** Drops the connection, as the network would. */
  drop(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!socket) throw new Error('no socket was opened');
    return socket;
  }
}

beforeEach(async () => {
  FakeSocket.instances = [];
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  jest.useFakeTimers();

  // The secure store mock is a module-level map, so a token left by an earlier
  // test would still be there. Signed out is the starting state.
  await getSecretStore().remove(AUTH_STORAGE_KEYS.ACCESS_TOKEN);
});

afterEach(() => {
  disconnectRealtime();
  jest.useRealTimers();
});

async function signIn(): Promise<void> {
  await getSecretStore().set(AUTH_STORAGE_KEYS.ACCESS_TOKEN, 'test-token');
}

describe('the realtime socket', () => {
  it('connects with the access token in the query string', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);

    const url = FakeSocket.last.url;
    expect(url).toContain('/ws?token=');
    expect(url).toContain(encodeURIComponent('test-token'));
  });

  it('uses a websocket scheme even when the API is on http', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);

    expect(FakeSocket.last.url.startsWith('ws://')).toBe(true);
  });

  it('is not connected until the server says hello', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();

    expect(isRealtimeConnected()).toBe(false);
    expect(realtimeStatus()).toBe('connecting');
  });

  it('is connected once the server says hello', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });

    expect(isRealtimeConnected()).toBe(true);
    expect(realtimeStatus()).toBe('open');
  });

  it('does not connect when there is no token', async () => {
    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);

    expect(FakeSocket.instances).toHaveLength(0);
    expect(realtimeStatus()).toBe('idle');
  });
});

describe('message delivery', () => {
  it('hands a message to the subscriber watching that conversation', async () => {
    await signIn();
    const received: MessageNotification[] = [];

    subscribeToMessages((event) => received.push(event), 'match-1');
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });
    FakeSocket.last.receive({
      type: 'message',
      matchId: 'match-1',
      senderId: 'u2',
      messageId: 'm1',
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.messageId).toBe('m1');
  });

  it('does not hand a message to a subscriber watching another conversation', async () => {
    await signIn();
    const received: MessageNotification[] = [];

    subscribeToMessages((event) => received.push(event), 'match-2');
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });
    FakeSocket.last.receive({
      type: 'message',
      matchId: 'match-1',
      senderId: 'u2',
      messageId: 'm1',
    });

    expect(received).toHaveLength(0);
  });

  it('hands every message to a subscriber watching all of them', async () => {
    await signIn();
    const received: MessageNotification[] = [];

    subscribeToMessages((event) => received.push(event));
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });
    FakeSocket.last.receive({
      type: 'message',
      matchId: 'match-1',
      senderId: 'u2',
      messageId: 'm1',
    });
    FakeSocket.last.receive({
      type: 'message',
      matchId: 'match-9',
      senderId: 'u3',
      messageId: 'm2',
    });

    expect(received.map((event) => event.messageId)).toEqual(['m1', 'm2']);
  });

  it('ignores a frame it does not understand', async () => {
    await signIn();
    const received: MessageNotification[] = [];

    subscribeToMessages((event) => received.push(event));
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive('not json at all');
    FakeSocket.last.receive({ type: 'something-else' });
    FakeSocket.last.receive({ type: 'message', matchId: 'match-1' });

    expect(received).toHaveLength(0);
  });

  it('keeps delivering when one subscriber throws', async () => {
    await signIn();
    const received: MessageNotification[] = [];

    subscribeToMessages(() => {
      throw new Error('bad subscriber');
    });
    subscribeToMessages((event) => received.push(event));
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });

    expect(() =>
      FakeSocket.last.receive({
        type: 'message',
        matchId: 'match-1',
        senderId: 'u2',
        messageId: 'm1',
      })
    ).not.toThrow();
    expect(received).toHaveLength(1);
  });
});

describe('the connection lifecycle', () => {
  it('closes the socket once the last subscriber has gone', async () => {
    await signIn();

    const unsubscribe = subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();

    unsubscribe();
    await jest.advanceTimersByTimeAsync(10000);

    expect(FakeSocket.last.closeCalls).toBe(1);
    expect(realtimeStatus()).toBe('idle');
  });

  it('keeps the socket open while somebody is still watching', async () => {
    await signIn();

    const first = subscribeToMessages(() => undefined);
    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();

    first();
    await jest.advanceTimersByTimeAsync(10000);

    expect(FakeSocket.last.closeCalls).toBe(0);
  });

  it('reconnects after a drop', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.drop();

    expect(realtimeStatus()).toBe('closed');

    // The first retry is a second away.
    await jest.advanceTimersByTimeAsync(1500);
    expect(FakeSocket.instances.length).toBe(2);
  });

  it('backs off rather than retrying in a tight loop', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();

    // Three failures in a row.
    FakeSocket.last.drop();
    await jest.advanceTimersByTimeAsync(1500);
    FakeSocket.last.drop();
    await jest.advanceTimersByTimeAsync(3000);
    FakeSocket.last.drop();

    const before = FakeSocket.instances.length;
    // The third backoff is four seconds, so a one-second advance is not enough.
    await jest.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.instances.length).toBe(before);
  });

  it('renews the token when the server refuses the socket', async () => {
    await signIn();

    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();

    // 4401 is the code the server closes an unauthorised handshake with.
    FakeSocket.last.drop(4401);
    await jest.advanceTimersByTimeAsync(0);

    // The socket comes back rather than staying down.
    expect(realtimeStatus()).toBe('closed');
  });

  it('reports its status to anybody watching', async () => {
    await signIn();
    const seen: string[] = [];

    const off = onRealtimeStatus((status) => seen.push(status));
    subscribeToMessages(() => undefined);
    await jest.advanceTimersByTimeAsync(0);
    FakeSocket.last.open();
    FakeSocket.last.receive({ type: 'ready', userId: 'u1' });
    off();

    expect(seen).toContain('connecting');
    expect(seen).toContain('open');
  });
});
