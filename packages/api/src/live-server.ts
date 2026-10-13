/**
 * The live connection: a WebSocket at /live that the app keeps open while
 * signed in, so it hears at once when something changes for this person (see
 * `LiveEvent` in @hated/db). Events only say what changed; the app fetches the
 * rest through the API as usual.
 *
 * Signing in happens in the first message, `{ "type": "auth", "token": … }`:
 * browsers can't set headers on a WebSocket, and a token in the URL would end
 * up in logs. Every 30 seconds each connection is pinged and its session
 * checked again, so dead connections are dropped and signing out (or deleting
 * the account) closes the socket too.
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import type { LiveEvent } from '@hated/db';
import { WebSocket, WebSocketServer, type RawData } from 'ws';

/** Closed because the session is missing, wrong, or no longer valid. */
export const CLOSE_UNAUTHORIZED = 4001;
/** Closed because the first message wasn't a sign-in. */
export const CLOSE_BAD_HELLO = 4400;

export interface LiveServer {
  /** Send an event to every open connection of these people. */
  deliver(userIds: readonly string[], event: LiveEvent): void;
  /** Signed-in connections open right now. */
  connections(): number;
  close(): Promise<void>;
}

export interface LiveServerOptions {
  path?: string;
  /** The user a session token signs in, or null. */
  resolveSession(token: string): Promise<string | null>;
  /** How long a new connection has to sign in. */
  authTimeoutMs?: number;
  /** How often to ping connections and check their sessions again. */
  checkMs?: number;
  log?: (line: string) => void;
}

interface Connection {
  socket: WebSocket;
  userId: string | null;
  token: string | null;
  alive: boolean;
}

export function attachLiveServer(server: Pick<Server, 'on'>, options: LiveServerOptions): LiveServer {
  const path = options.path ?? '/live';
  const log = options.log ?? (() => undefined);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
  const connections = new Set<Connection>();
  const byUser = new Map<string, Set<Connection>>();

  function forget(connection: Connection): void {
    connections.delete(connection);
    if (connection.userId === null) return;
    const mine = byUser.get(connection.userId);
    mine?.delete(connection);
    if (mine?.size === 0) byUser.delete(connection.userId);
  }

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(request.url ?? '/', 'http://localhost');
    if (pathname !== path) {
      socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  });

  wss.on('connection', (socket: WebSocket) => {
    const connection: Connection = { socket, userId: null, token: null, alive: true };
    connections.add(connection);
    const deadline = setTimeout(() => socket.close(CLOSE_UNAUTHORIZED, 'sign in first'), options.authTimeoutMs ?? 5000);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('close', () => {
      clearTimeout(deadline);
      forget(connection);
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (data: RawData) => {
      // Only the first message matters: the sign-in. Anything after it is ignored.
      if (connection.token !== null) return;
      let token: unknown;
      try {
        const hello = JSON.parse(data.toString()) as { type?: unknown; token?: unknown };
        token = hello.type === 'auth' ? hello.token : undefined;
      } catch {
        token = undefined;
      }
      if (typeof token !== 'string' || token.length === 0) {
        socket.close(CLOSE_BAD_HELLO, 'expected { type: "auth", token }');
        return;
      }
      connection.token = token;
      options.resolveSession(token).then(
        (userId) => {
          if (socket.readyState !== WebSocket.OPEN) return;
          if (userId === null) {
            socket.close(CLOSE_UNAUTHORIZED, 'unauthorized');
            return;
          }
          clearTimeout(deadline);
          connection.userId = userId;
          const mine = byUser.get(userId) ?? new Set<Connection>();
          mine.add(connection);
          byUser.set(userId, mine);
          socket.send(JSON.stringify({ type: 'ready' }));
        },
        (error: unknown) => {
          log(`a sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
          socket.close(1011, 'try again');
        },
      );
    });
  });

  // Drop connections that stopped answering, and ones whose session ended.
  const check = setInterval(() => {
    for (const connection of connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
      if (connection.userId !== null && connection.token !== null) {
        options.resolveSession(connection.token).then(
          (userId) => {
            if (userId !== connection.userId) connection.socket.close(CLOSE_UNAUTHORIZED, 'signed out');
          },
          () => undefined,
        );
      }
    }
  }, options.checkMs ?? 30_000);
  check.unref?.();

  return {
    deliver(userIds, event) {
      const data = JSON.stringify(event);
      for (const userId of new Set(userIds)) {
        for (const connection of byUser.get(userId) ?? []) {
          if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(data);
        }
      }
    },
    connections: () => [...connections].filter((connection) => connection.userId !== null).length,
    async close() {
      clearInterval(check);
      for (const connection of connections) connection.socket.close(1001, 'server shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
