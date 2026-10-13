/**
 * The live connection: a WebSocket to the API, open while signed in, that says
 * the moment something changes for this person (both said hello, a new
 * message, a match ended, a round published). Screens listen with `useLive`
 * and then load what changed the usual way, so a missed event only costs a
 * short delay: the slower polling the screens keep catches up.
 *
 * It reconnects after a drop (waiting longer each time, up to 30 seconds) and
 * straight away when the app comes back to the foreground. A refused sign-in
 * isn't retried: the session is gone, and the next API call signs out.
 */

import type { LiveEvent } from '@hated/api/contract';
import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { apiBaseUrl } from '@/api/client';
import { DEMO, demo } from '@/demo';
import { useSession } from '@/session';

type Listener = (event: LiveEvent) => void;

interface Live {
  connected: boolean;
  subscribe(listener: Listener): () => void;
}

const LiveContext = createContext<Live | null>(null);

/** The API refused this session. */
const CLOSE_UNAUTHORIZED = 4001;

function isLiveEvent(value: unknown): value is LiveEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'round') return typeof event.roundId === 'string';
  return (event.type === 'mutual' || event.type === 'message' || event.type === 'ended' || event.type === 'typing') && typeof event.matchId === 'string';
}

export function LiveProvider({ children }: { children: ReactNode }) {
  const { status, token } = useSession();
  const [listeners] = useState(() => new Set<Listener>());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (status !== 'signed-in') return;
    // The web demo's events happen in the browser, so there's no socket to open.
    if (DEMO) {
      return demo.subscribe((event) => {
        for (const listener of listeners) listener(event);
      });
    }
    let socket: WebSocket | null = null;
    let stopped = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      const session = token();
      if (session === null || stopped) return;
      const next = new WebSocket(`${apiBaseUrl().replace(/^http/, 'ws')}/live`);
      socket = next;
      next.onopen = () => next.send(JSON.stringify({ type: 'auth', token: session }));
      next.onmessage = (message) => {
        let data: unknown;
        try {
          data = JSON.parse(String(message.data));
        } catch {
          return;
        }
        if ((data as { type?: unknown }).type === 'ready') {
          attempt = 0;
          setConnected(true);
        } else if (isLiveEvent(data)) {
          for (const listener of listeners) listener(data);
        }
      };
      next.onclose = (event) => {
        if (socket !== next) return;
        socket = null;
        setConnected(false);
        if (stopped || event.code === CLOSE_UNAUTHORIZED) return;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempt));
        attempt += 1;
      };
    }

    connect();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || socket !== null || stopped) return;
      clearTimeout(retry);
      attempt = 0;
      connect();
    });
    return () => {
      stopped = true;
      clearTimeout(retry);
      foreground.remove();
      socket?.close();
      setConnected(false);
    };
  }, [status, token, listeners]);

  const subscribe = useCallback(
    (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [listeners],
  );
  const value = useMemo(() => ({ connected: DEMO ? status === 'signed-in' : connected, subscribe }), [connected, status, subscribe]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/** Run `handler` on every live event while this component is on screen. */
export function useLive(handler: (event: LiveEvent) => void): void {
  const subscribe = useContext(LiveContext)?.subscribe;
  const onEvent = useEffectEvent(handler);
  useEffect(() => subscribe?.((event) => onEvent(event)), [subscribe]);
}

/** Whether the live connection is up, so screens can poll less while it is. */
export function useLiveConnected(): boolean {
  return useContext(LiveContext)?.connected ?? false;
}
