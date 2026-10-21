import { useEffect, useRef, useState } from 'react';

import {
  onRealtimeStatus,
  realtimeStatus,
  subscribeToMessages,
  type MessageNotification,
  type RealtimeStatus,
} from '@/services/realtime';
import { useAuthStore } from '@/stores/authStore';

/**
 * Watches for messages arriving over the socket.
 *
 * `matchId` narrows the watch to one conversation. Leave it undefined to watch
 * all of them, which is what the conversation list wants -- it does not know
 * which conversation a message belongs to until the server says so.
 *
 * The handler is held in a ref so that a caller can pass an inline function
 * without resubscribing on every render. Resubscribing is not free: it closes
 * and reopens the socket, and the notification that prompted the re-render
 * would arrive at a socket that is no longer listening for it.
 *
 * In mock mode nothing is subscribed. There is no server to connect to, and a
 * socket that could never deliver would sit there claiming to be connected --
 * which is worse than not having one, because the fallback that would cover for
 * it would be switched off.
 *
 * Returns the connection status, so a screen can show that delivery is
 * degraded rather than silently showing stale messages.
 */
export function useRealtimeMessages(
  matchId: string | undefined,
  onMessage: (notification: MessageNotification) => void
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(realtimeStatus);
  const handler = useRef(onMessage);
  handler.current = onMessage;

  const authMode = useAuthStore((store) => store.authMode);

  useEffect(() => {
    const off = onRealtimeStatus(setStatus);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (authMode !== 'jwt') return undefined;
    return subscribeToMessages((notification) => handler.current(notification), matchId);
  }, [authMode, matchId]);

  return status;
}
