/**
 * The signed-in session: the token (kept in secure storage), the account it
 * belongs to, and an API client bound to both. Screens read it with
 * `useSession()`; the root layout uses `status` to decide which routes exist.
 */

import type { Account } from '@hated/api/contract';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

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
  /** Erase the account on the server, then sign out here. Throws if the server refused. */
  deleteAccount(): Promise<void>;
  /** A word for the welcome screen after signing out, e.g. that the account was deleted. */
  notice: string | null;
  /** The session token, for the live connection; null when signed out. */
  token(): string | null;
}

const SessionContext = createContext<Session | null>(null);

/** Where the token lives in memory; the API client reads it when it makes a call. */
function tokenHolder() {
  let token: string | null = null;
  return {
    get: () => token,
    set: (next: string | null) => {
      token = next;
    },
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [token] = useState(tokenHolder);
  const [status, setStatus] = useState<Status>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** Drop the session on this device only. */
  const forget = useCallback(async () => {
    token.set(null);
    forgetPushToken();
    setAccount(null);
    setStatus('signed-out');
    await clearToken();
  }, [token]);

  const api = useMemo(
    () =>
      createApiClient({
        baseUrl: apiBaseUrl(),
        token: token.get,
        // The server already says the session is gone, so only forget it here
        // (asking the server to sign out again would just be another 401).
        onUnauthorized: () => void forget(),
      }),
    [token, forget],
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
    if (token.get() === null) return null;
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
  }, [token, api]);

  const signIn = useCallback(
    async (next: string) => {
      setNotice(null);
      token.set(next);
      await writeToken(next);
      await refresh();
    },
    [token, refresh],
  );

  useEffect(() => {
    void (async () => {
      token.set(await readToken());
      if (token.get() === null) setStatus('signed-out');
      else await refresh();
    })();
  }, [token, refresh]);

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount();
    await forget();
    setNotice('Your account has been deleted, with everything in it.');
  }, [api, forget]);

  const value = useMemo(
    () => ({ status, account, api, signIn, signOut, refresh, deleteAccount, notice, token: token.get }),
    [status, account, api, signIn, signOut, refresh, deleteAccount, notice, token],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}
