/**
 * The signed-in session: the token (kept in secure storage), the account it
 * belongs to, and an API client bound to both. Screens read it with
 * `useSession()`; the root layout uses `status` to decide which routes exist.
 */

import type { Account } from '@hated/api/contract';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ApiError, apiBaseUrl, createApiClient, type ApiClient } from '@/api/client';
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
  signOut(): Promise<void>;
  /** Reload the account, e.g. after editing the profile. */
  refresh(): Promise<Account | null>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const tokenRef = useRef<string | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<Account | null>(null);

  const signOut = useCallback(async () => {
    tokenRef.current = null;
    setAccount(null);
    setStatus('signed-out');
    await clearToken();
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        token: () => tokenRef.current,
        onUnauthorized: () => void signOut(),
      }),
    [signOut],
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
