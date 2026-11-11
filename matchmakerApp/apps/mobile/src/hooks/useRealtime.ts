import { useEffect, useRef, useState } from 'react';

import {
  onRealtimeStatus,
  realtimeStatus,
  subscribeToUpdates,
  type MessageNotification,
  type RealtimeNotification,
  type RealtimeStatus,
} from '@/services/realtime';
import { useAuthStore } from '@/stores/authStore';

/**
 * Watches for match and message invalidations arriving over the socket.
 *
 * `matchId` narrows the watch to one conversation or match. Leave it undefined
 * to watch all updates relevant to the signed-in user.
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
 * Returns the connection status, so a screen can fall back to API polling
 * rather than silently showing stale data.
 */
export function useRealtimeUpdates(
  onUpdate: (notification: RealtimeNotification) => void,
  matchId?: string
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>(realtimeStatus);
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  const authMode = useAuthStore((store) => store.authMode);

  useEffect(() => {
    const off = onRealtimeStatus(setStatus);
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (authMode !== 'jwt') return undefined;
    return subscribeToUpdates((notification) => handler.current(notification), matchId);
  }, [authMode, matchId]);

  return status;
}

/** Watches only for message notifications, optionally narrowed to one chat. */
export function useRealtimeMessages(
  matchId: string | undefined,
  onMessage: (notification: MessageNotification) => void
): RealtimeStatus {
  return useRealtimeUpdates((notification) => {
    if (notification.type === 'message') onMessage(notification);
  }, matchId);
}
