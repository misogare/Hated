/** Reviewing reports: what the HateD team reads, and marking one handled. */

import type { PrismaClient } from './generated/prisma/client.js';

export interface ReportView {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
  reason: string;
  details: string | null;
  /** Null once the person who reported has deleted their account. */
  reporter: { name: string; email: string } | null;
  reported: { name: string; email: string };
  /** How many reports (any status) there are about the same person. */
  reportsAboutThem: number;
}

/** Open reports, oldest first so nothing waits forever; all of them with `includeResolved`. */
export async function listReports(prisma: PrismaClient, options: { includeResolved?: boolean } = {}): Promise<ReportView[]> {
  const person = { select: { id: true, displayName: true, user: { select: { email: true } } } };
  const reports = await prisma.report.findMany({
    where: options.includeResolved ? {} : { resolvedAt: null },
    orderBy: { createdAt: 'asc' },
    include: { reporter: person, reported: person },
  });
  const counts = await prisma.report.groupBy({
    by: ['reportedId'],
    where: { reportedId: { in: [...new Set(reports.map((report) => report.reportedId))] } },
    _count: { _all: true },
  });
  const totals = new Map(counts.map((count) => [count.reportedId, count._count._all]));

  return reports.map((report) => ({
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    reason: report.reason,
    details: report.details,
    reporter: report.reporter === null ? null : { name: report.reporter.displayName, email: report.reporter.user.email },
    reported: { name: report.reported.displayName, email: report.reported.user.email },
    reportsAboutThem: totals.get(report.reportedId) ?? 1,
  }));
}

/** Mark a report as reviewed. False if there is no such report. */
export async function resolveReport(prisma: PrismaClient, id: string, options: { now?: Date } = {}): Promise<boolean> {
  const { count } = await prisma.report.updateMany({
    where: { id, resolvedAt: null },
    data: { resolvedAt: options.now ?? new Date() },
  });
  if (count > 0) return true;
  return (await prisma.report.count({ where: { id } })) > 0;
}
