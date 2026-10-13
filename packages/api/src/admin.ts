/**
 * The admin page, for whoever runs HateD: photos waiting for a review, open
 * reports, and how recent rounds went. It's served at /admin only when
 * ADMIN_PASSWORD is set, behind HTTP Basic auth (user name "admin"); use it
 * over HTTPS anywhere but your own machine.
 *
 * Plain HTML forms and redirects, no script. Every value that came from a
 * person is escaped (hono/html), a post must come from this page itself
 * (hono/csrf), and the page can't be framed by another site.
 */

import type { PhotoToReview, ReportView, RoundSummary } from '@hated/db';
import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { csrf } from 'hono/csrf';
import { html } from 'hono/html';
import { secureHeaders } from 'hono/secure-headers';

export interface AdminServices {
  photosToReview(): Promise<PhotoToReview[]>;
  /** False when there's no such photo. */
  reviewPhoto(photoId: string, decision: 'approve' | 'reject'): Promise<boolean>;
  /** The full photo, whatever its review; null when there's no such photo. */
  photoForReview(photoId: string): Promise<Buffer | null>;
  openReports(): Promise<ReportView[]>;
  /** False when there's no such report. */
  resolveReport(reportId: string): Promise<boolean>;
  recentRounds(): Promise<RoundSummary[]>;
}

export interface AdminOptions {
  services: AdminServices;
  password: string;
}

const day = (iso: string) => new Date(iso).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export function createAdmin({ services, password }: AdminOptions): Hono {
  const admin = new Hono();

  admin.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        imgSrc: ["'self'"],
        styleSrc: ["'unsafe-inline'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    }),
  );
  admin.use('*', basicAuth({ username: 'admin', password, realm: 'HateD admin' }));
  admin.use('*', csrf());
  // Nothing here belongs in a cache: it's people's photos and reports.
  admin.use('*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
  });

  admin.get('/', async (c) => {
    const [photos, reports, rounds] = await Promise.all([services.photosToReview(), services.openReports(), services.recentRounds()]);
    return c.html(page(photos, reports, rounds));
  });

  admin.get('/photos/:photoId', async (c) => {
    const bytes = await services.photoForReview(c.req.param('photoId'));
    if (bytes === null) return c.notFound();
    return c.body(new Uint8Array(bytes), 200, { 'Content-Type': 'image/jpeg' });
  });

  for (const decision of ['approve', 'reject'] as const) {
    admin.post(`/photos/:photoId/${decision}`, async (c) => {
      if (!(await services.reviewPhoto(c.req.param('photoId'), decision))) return c.notFound();
      return c.redirect('/admin', 303);
    });
  }

  admin.post('/reports/:reportId/resolve', async (c) => {
    if (!(await services.resolveReport(c.req.param('reportId')))) return c.notFound();
    return c.redirect('/admin', 303);
  });

  return admin;
}

function page(photos: PhotoToReview[], reports: ReportView[], rounds: RoundSummary[]) {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>HateD admin</title>
    <style>
      :root { color-scheme: light; --ink: #3a1e2a; --muted: #7a6470; --line: #ead8cf; --card: #fff; --bg: #fbf3ee; --accent: #b83a5e; --ok: #2f6b4a; }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px 20px 64px; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
      main { max-width: 1040px; margin: 0 auto; }
      h1 { margin: 0 0 4px; font-size: 26px; }
      h2 { margin: 36px 0 12px; font-size: 19px; }
      .muted { color: var(--muted); }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px; }
      .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px; }
      .card img { display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover; border-radius: 10px; background: var(--line); }
      .row { display: flex; gap: 8px; margin-top: 10px; }
      form { margin: 0; }
      button { font: inherit; font-weight: 600; padding: 7px 14px; border-radius: 999px; border: 1px solid var(--line); background: #fff; color: var(--ink); cursor: pointer; }
      button.approve { background: var(--ok); border-color: var(--ok); color: #fff; }
      button.reject { color: var(--accent); }
      .report { display: grid; gap: 4px; }
      .reason { font-weight: 600; text-transform: capitalize; }
      table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
      th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--line); }
      th { font-size: 13px; color: var(--muted); font-weight: 600; }
      .empty { padding: 16px; background: var(--card); border: 1px dashed var(--line); border-radius: 14px; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <h1>HateD admin</h1>
      <p class="muted">Photos reach matches only once approved here. Reports end the match at once; resolving one just marks it read.</p>

      <h2>Photos waiting for a review (${photos.length})</h2>
      ${photos.length === 0
        ? html`<p class="empty">Nothing waiting.</p>`
        : html`<div class="grid">
            ${photos.map(
              (photo) => html`<div class="card">
                <img src="/admin/photos/${encodeURIComponent(photo.id)}" alt="A photo of ${photo.ownerName}" loading="lazy" />
                <div><strong>${photo.ownerName}</strong></div>
                <div class="muted">${day(photo.uploadedAt)}</div>
                <div class="row">
                  <form method="post" action="/admin/photos/${encodeURIComponent(photo.id)}/approve"><button class="approve">Approve</button></form>
                  <form method="post" action="/admin/photos/${encodeURIComponent(photo.id)}/reject"><button class="reject">Reject</button></form>
                </div>
              </div>`,
            )}
          </div>`}

      <h2>Open reports (${reports.length})</h2>
      ${reports.length === 0
        ? html`<p class="empty">No open reports.</p>`
        : html`<div class="grid">
            ${reports.map(
              (report) => html`<div class="card report">
                <div class="reason">${report.reason}</div>
                ${report.details === null ? '' : html`<div>“${report.details}”</div>`}
                <div class="muted">About ${report.reported.name} (${report.reported.email}), reported ${report.reportsAboutThem === 1 ? 'once' : `${report.reportsAboutThem} times`} in all</div>
                <div class="muted">By ${report.reporter === null ? 'a deleted account' : `${report.reporter.name} (${report.reporter.email})`}, ${day(report.createdAt)}</div>
                <form method="post" action="/admin/reports/${encodeURIComponent(report.id)}/resolve" class="row"><button>Resolved</button></form>
              </div>`,
            )}
          </div>`}

      <h2>Recent rounds</h2>
      ${rounds.length === 0
        ? html`<p class="empty">No published rounds yet.</p>`
        : html`<table>
            <thead>
              <tr><th>Published</th><th>People</th><th>Matched</th><th>Really well</th><th>Okay</th><th>Not for me</th><th>Rather not say</th></tr>
            </thead>
            <tbody>
              ${rounds.map(
                (round) => html`<tr>
                  <td>${day(round.publishedAt)}</td><td>${round.population}</td><td>${round.matched}</td>
                  <td>${round.feedback.well}</td><td>${round.feedback.okay}</td><td>${round.feedback.notForMe}</td><td>${round.feedback.skipped}</td>
                </tr>`,
              )}
            </tbody>
          </table>`}
    </main>
  </body>
</html>`;
}
