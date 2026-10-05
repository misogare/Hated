/**
 * The signed-in session: the token (kept in secure storage), the account it
 * belongs to, and an API client bound to both. Screens read it with
 * `useSession()`; the root layout uses `status` to decide which routes exist.
 */

import type { Account } from '@hated/api/contract';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, apiBaseUrl, createApiClient, type ApiClient } from '@/api/client';
import { currentPushToken, forgetPushToken } from '@/notifications';
import { clearToken, readToken, writeToken } from '@/storage';

type Status =
  /** Reading the stored token and loading the account. */
  | 'loading'
  | 'signed-out'
  | 'signed-in'
  /** A token exists but the API could not be reached to confirm it. */
  | 'offline';

interface Session {
  status: Status;
  account: Account | null;
  api: ApiClient;
  signIn(token: string): Promise<void>;
  /**
   * End the session on the server (every device with `everywhere`) and stop
   * this device's notifications, then forget it here.
   */
  signOut(options?: { everywhere?: boolean }): Promise<void>;
  /** Reload the account, e.g. after editing the profile. */
  refresh(): Promise<Account | null>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<Account | null>(null);

  /** Drop the session on this device only. */
  const forget = useCallback(async () => {
    tokenRef.current = null;
    forgetPushToken();
    setAccount(null);
    setStatus('signed-out');
    await clearToken();
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        token: () => tokenRef.current,
        // The server already says the session is gone, so only forget it here
        // (asking the server to sign out again would just be another 401).
        onUnauthorized: () => void forget(),
      }),
    [forget],
  );

  const signOut = useCallback(
    async (options: { everywhere?: boolean } = {}) => {
      try {
        const pushToken = currentPushToken();
        await api.signOut({ everywhere: options.everywhere ?? false, ...(pushToken === null ? {} : { pushToken }) });
      } catch {
        // Offline or already ended: signing out on this device must still work.
      }
      await forget();
    },
    [api, forget],
  );

  const refresh = useCallback(async () => {
    if (tokenRef.current === null) return null;
    try {
      const next = await api.me();
      setAccount(next);
      setStatus('signed-in');
      return next;
    } catch (error) {
      // A 401 already signed us out; anything else means we could not check.
      if (!(error instanceof ApiError && error.status === 401)) setStatus('offline');
      return null;
    }
  }, [api]);

  const signIn = useCallback(
    async (token: string) => {
      tokenRef.current = token;
      await writeToken(token);
      await refresh();
    },
    [refresh],
  );

  useEffect(() => {
    void (async () => {
      tokenRef.current = await readToken();
      if (tokenRef.current === null) setStatus('signed-out');
      else await refresh();
    })();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, account, api, signIn, signOut, refresh }),
    [status, account, api, signIn, signOut, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
