/**
 * Live updates: telling open apps, the moment it happens, that something
 * changed for the person using them. Both said hello, a new message, a match
 * ended, a round published. The API keeps a WebSocket open to each app and
 * forwards these to it.
 *
 * Events travel through Postgres: NOTIFY on one channel, and a LISTEN in each
 * API server. So they reach every API process, and a round published from the
 * CLI reaches open apps too. An event only says what changed and where (never
 * a message's text); the app then fetches what it needs through the API, which
 * decides what this person may see, as always.
 */

import pg from 'pg';

import type { PrismaClient } from './generated/prisma/client.js';
import type { Notifier } from './notify.js';

export type LiveEvent =
  | { type: 'mutual'; matchId: string }
  | { type: 'message'; matchId: string }
  | { type: 'ended'; matchId: string }
  | { type: 'round'; roundId: string };

export const LIVE_CHANNEL = 'hated_live';

/** Postgres caps a NOTIFY payload at 8000 bytes; this many user ids per notification stays well under it. */
const IDS_PER_NOTIFY = 100;

type Log = (line: string) => void;

function isLiveEvent(value: unknown): value is LiveEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (event.type === 'round') return typeof event.roundId === 'string';
  return (event.type === 'mutual' || event.type === 'message' || event.type === 'ended') && typeof event.matchId === 'string';
}

/** Announce an event to these people, wherever their apps are connected. */
export async function publishLive(prisma: PrismaClient, userIds: readonly string[], event: LiveEvent): Promise<void> {
  const to = [...new Set(userIds)];
  for (let start = 0; start < to.length; start += IDS_PER_NOTIFY) {
    const payload = JSON.stringify({ to: to.slice(start, start + IDS_PER_NOTIFY), event });
    await prisma.$executeRaw`SELECT pg_notify(${LIVE_CHANNEL}, ${payload})`;
  }
}

/**
 * A notifier that announces live events rather than pushes: the same moments,
 * to everyone involved (both people in a match, everyone in a round). Never
 * throws; a missed live event only means an app catches up a little later.
 */
export function createLiveNotifier(prisma: PrismaClient, options: { log?: Log } = {}): Notifier {
  const log = options.log ?? ((line: string) => console.error(line));

  async function toMatch(matchId: string, type: 'mutual' | 'message' | 'ended'): Promise<void> {
    try {
      const match = await prisma.match.findUnique({
        where: { id: matchId },
        select: { profileA: { select: { userId: true } }, profileB: { select: { userId: true } } },
      });
      if (match !== null) await publishLive(prisma, [match.profileA.userId, match.profileB.userId], { type, matchId });
    } catch (error) {
      log(`live: ${type} for ${matchId} not announced, ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    messageSent: (matchId) => toMatch(matchId, 'message'),
    becameMutual: (matchId) => toMatch(matchId, 'mutual'),
    matchEnded: (matchId) => toMatch(matchId, 'ended'),
    async roundPublished(roundId) {
      try {
        const participants = await prisma.matchRoundParticipant.findMany({
          where: { roundId },
          select: { profile: { select: { userId: true } } },
        });
        await publishLive(prisma, participants.map((participant) => participant.profile.userId), { type: 'round', roundId });
      } catch (error) {
        log(`live: round ${roundId} not announced, ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    // A reminder changes nothing on screen, so open apps have nothing to hear.
    helloReminder: async () => undefined,
  };
}

export interface LiveListener {
  stop(): Promise<void>;
}

/**
 * Hear every live event published anywhere, with the people it is for. Uses
 * one dedicated connection, and reconnects (and listens again) if it drops.
 */
export function listenLive(
  connectionString: string,
  onEvent: (userIds: string[], event: LiveEvent) => void,
  options: { log?: Log; retryMs?: number; /** Called each time the listener is (again) listening. */ onListening?: () => void } = {},
): LiveListener {
  const log = options.log ?? ((line: string) => console.error(line));
  const retryMs = options.retryMs ?? 2000;
  let client: pg.Client | null = null;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  function scheduleReconnect(): void {
    if (stopped || retry !== undefined) return;
    retry = setTimeout(() => {
      retry = undefined;
      void connect();
    }, retryMs);
  }

  async function connect(): Promise<void> {
    const previous = client;
    const next = new pg.Client({ connectionString });
    client = next;
    await previous?.end().catch(() => undefined);
    next.on('notification', (message) => {
      if (message.channel !== LIVE_CHANNEL || message.payload === undefined) return;
      try {
        const { to, event } = JSON.parse(message.payload) as { to?: unknown; event?: unknown };
        if (Array.isArray(to) && to.every((id) => typeof id === 'string') && isLiveEvent(event)) onEvent(to, event);
      } catch {
        // Not one of ours.
      }
    });
    next.on('error', (error) => {
      log(`live: listener connection failed, ${error.message}; reconnecting`);
      scheduleReconnect();
    });
    next.on('end', () => {
      if (client === next) scheduleReconnect();
    });
    try {
      await next.connect();
      await next.query(`LISTEN ${LIVE_CHANNEL}`);
      options.onListening?.();
    } catch (error) {
      log(`live: could not listen, ${error instanceof Error ? error.message : String(error)}; retrying`);
      await next.end().catch(() => undefined);
      scheduleReconnect();
    }
  }

  void connect();
  return {
    async stop() {
      stopped = true;
      clearTimeout(retry);
      const current = client;
      client = null;
      await current?.end().catch(() => undefined);
    },
  };
}

/** One notifier that tells each of these, e.g. push notifications and live events. */
export function combineNotifiers(...notifiers: Notifier[]): Notifier {
  return {
    messageSent: async (matchId, userId) => {
      await Promise.all(notifiers.map((notifier) => notifier.messageSent(matchId, userId)));
    },
    becameMutual: async (matchId, userId) => {
      await Promise.all(notifiers.map((notifier) => notifier.becameMutual(matchId, userId)));
    },
    matchEnded: async (matchId, userId) => {
      await Promise.all(notifiers.map((notifier) => notifier.matchEnded(matchId, userId)));
    },
    roundPublished: async (roundId) => {
      await Promise.all(notifiers.map((notifier) => notifier.roundPublished(roundId)));
    },
    helloReminder: async (matchId, userId) => {
      await Promise.all(notifiers.map((notifier) => notifier.helloReminder(matchId, userId)));
    },
  };
}
