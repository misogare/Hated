import type { PrismaClient } from './generated/prisma/client.js';

/** Messages the partner sent after `readAt` (all of them if never read). */
export function countUnread(prisma: PrismaClient, matchId: string, partnerId: string, readAt: Date | null): Promise<number> {
  return prisma.message.count({
    where: { matchId, senderId: partnerId, ...(readAt === null ? {} : { createdAt: { gt: readAt } }) },
  });
}
