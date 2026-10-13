import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

import { CLOSE_BAD_HELLO, CLOSE_UNAUTHORIZED, attachLiveServer, type LiveServer } from '../src/live-server.js';

const SESSIONS = new Map([
  ['token-sam', 'user-sam'],
  ['token-sam-laptop', 'user-sam'],
  ['token-maya', 'user-maya'],
]);

let server: Server | undefined;
let live: LiveServer | undefined;
const sockets: WebSocket[] = [];

/** An HTTP server with the live endpoint on a free port. */
async function start(options: { checkMs?: number; authTimeoutMs?: number; sessions?: Map<string, string> } = {}): Promise<string> {
  const sessions = options.sessions ?? SESSIONS;
  server = createServer((_request, response) => response.end('ok'));
  live = attachLiveServer(server, {
    resolveSession: async (token) => sessions.get(token) ?? null,
    checkMs: options.checkMs,
    authTimeoutMs: options.authTimeoutMs,
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Open a connection, keeping what arrives and how it closed. */
function open(url: string) {
  const socket = new WebSocket(url);
  sockets.push(socket);
  const received: unknown[] = [];
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  const opened = new Promise<void>((resolve, reject) => {
    socket.on('open', () => resolve());
    socket.on('error', reject);
  });
  socket.on('message', (data) => received.push(JSON.parse(data.toString())));
  return { socket, received, closed, opened };
}

/** Connect and sign in; resolves once the server says ready. */
async function signIn(base: string, token: string) {
  const connection = open(`${base}/live`);
  await connection.opened;
  connection.socket.send(JSON.stringify({ type: 'auth', token }));
  await until(() => connection.received.some((message) => (message as { type?: string }).type === 'ready'));
  return connection;
}

async function until(condition: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await live?.close();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
  live = undefined;
});

describe('the live connection', () => {
  it('signs in with the first message, then delivers each person only their own events, on every device', async () => {
    const base = await start();
    const phone = await signIn(base, 'token-sam');
    const laptop = await signIn(base, 'token-sam-laptop');
    const maya = await signIn(base, 'token-maya');
    expect(live!.connections()).toBe(3);

    live!.deliver(['user-sam'], { type: 'mutual', matchId: 'm1' });
    live!.deliver(['user-maya', 'user-nobody'], { type: 'message', matchId: 'm2' });
    await until(() => phone.received.length === 2 && laptop.received.length === 2 && maya.received.length === 2);

    expect(phone.received).toEqual([{ type: 'ready' }, { type: 'mutual', matchId: 'm1' }]);
    expect(laptop.received).toEqual([{ type: 'ready' }, { type: 'mutual', matchId: 'm1' }]);
    expect(maya.received).toEqual([{ type: 'ready' }, { type: 'message', matchId: 'm2' }]);
  });

  it('closes a connection that signs in with a bad token, sends something else first, or never signs in', async () => {
    const base = await start({ authTimeoutMs: 150 });

    const wrong = open(`${base}/live`);
    await wrong.opened;
    wrong.socket.send(JSON.stringify({ type: 'auth', token: 'stolen' }));
    expect(await wrong.closed).toBe(CLOSE_UNAUTHORIZED);

    const rude = open(`${base}/live`);
    await rude.opened;
    rude.socket.send('hello?');
    expect(await rude.closed).toBe(CLOSE_BAD_HELLO);

    const silent = open(`${base}/live`);
    await silent.opened;
    expect(await silent.closed).toBe(CLOSE_UNAUTHORIZED);
    expect(live!.connections()).toBe(0);
  });

  it('closes the connection once its session has ended', async () => {
    const sessions = new Map(SESSIONS);
    const base = await start({ checkMs: 50, sessions });
    const phone = await signIn(base, 'token-sam');

    sessions.delete('token-sam');
    expect(await phone.closed).toBe(CLOSE_UNAUTHORIZED);
  });

  it('only upgrades at /live', async () => {
    const base = await start();
    const elsewhere = open(`${base}/somewhere`);
    await expect(elsewhere.opened).rejects.toThrow();
  });
});
