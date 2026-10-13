import { describe, expect, it } from 'vitest';

import type { AdminServices } from '../src/admin.js';
import { createApp, type ApiServices } from '../src/app.js';
import { parseSchedule } from '../src/schedule.js';

const PASSWORD = 'correct horse battery staple';
const SCHEDULE = parseSchedule('SUN', '20:00', 'Australia/Melbourne');

const basic = (password = PASSWORD) => ({ Authorization: `Basic ${Buffer.from(`admin:${password}`).toString('base64')}` });

/** A form post from the admin page itself (same origin as the test requests). */
const post = (origin = 'http://localhost') => ({
  method: 'POST',
  headers: { ...basic(), Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' },
  body: '',
});

function app(overrides: Partial<AdminServices> = {}, password: string | null = PASSWORD) {
  const services: AdminServices = {
    photosToReview: async () => [],
    reviewPhoto: async () => true,
    photoForReview: async () => null,
    openReports: async () => [],
    resolveReport: async () => true,
    recentRounds: async () => [],
    ...overrides,
  };
  return createApp({
    services: { resolveSession: async () => null } as unknown as ApiServices,
    schedule: SCHEDULE,
    ...(password === null ? {} : { admin: { services, password } }),
  });
}

describe('the admin page', () => {
  it('is not there without a password, and asks for it when there is one', async () => {
    expect((await app({}, null).request('/admin', { headers: basic() })).status).toBe(404);

    const res = await app().request('/admin');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('Basic');
    expect((await app().request('/admin', { headers: basic('a guess at the password') })).status).toBe(401);
  });

  it('lists photos waiting, open reports and recent rounds, escaping what people wrote', async () => {
    const res = await app({
      photosToReview: async () => [{ id: 'p1', ownerName: '<script>alert(1)</script>Sam', uploadedAt: '2026-10-13T09:00:00.000Z', width: 600, height: 750 }],
      openReports: async () => [
        {
          id: 'r1',
          createdAt: '2026-10-12T09:00:00.000Z',
          resolvedAt: null,
          reason: 'harassment',
          details: '<img src=x onerror=alert(1)>',
          reporter: { name: 'Maya', email: 'maya@vu.edu.au' },
          reported: { name: 'Zed', email: 'zed@vu.edu.au' },
          reportsAboutThem: 2,
        },
      ],
      recentRounds: async () => [
        { id: 'round-1', publishedAt: '2026-10-11T09:00:00.000Z', population: 24, matched: 22, feedback: { well: 5, okay: 2, notForMe: 1, skipped: 3 } },
      ],
    }).request('/admin', { headers: basic() });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const page = await res.text();
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;Sam');
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page).toContain('action="/admin/photos/p1/approve"');
    expect(page).toContain('reported 2 times in all');
    expect(page).toContain('<td>24</td><td>22</td>');

    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('approves and rejects photos and resolves reports, but only from its own page', async () => {
    const calls: string[] = [];
    const a = app({
      reviewPhoto: async (photoId, decision) => {
        calls.push(`${decision} ${photoId}`);
        return photoId !== 'gone';
      },
      resolveReport: async (reportId) => {
        calls.push(`resolve ${reportId}`);
        return true;
      },
    });

    const approved = await a.request('/admin/photos/p1/approve', post());
    expect(approved.status).toBe(303);
    expect(approved.headers.get('Location')).toBe('/admin');
    expect((await a.request('/admin/photos/p2/reject', post())).status).toBe(303);
    expect((await a.request('/admin/reports/r1/resolve', post())).status).toBe(303);
    expect((await a.request('/admin/photos/gone/approve', post())).status).toBe(404);

    expect((await a.request('/admin/photos/p3/approve', post('https://elsewhere.example'))).status).toBe(403);
    expect(calls).toEqual(['approve p1', 'reject p2', 'resolve r1', 'approve gone']);
  });

  it('shows the reviewer a photo in full, and nothing for a photo that is not there', async () => {
    const a = app({ photoForReview: async (photoId) => (photoId === 'p1' ? Buffer.from([0xff, 0xd8, 0xff]) : null) });

    const photo = await a.request('/admin/photos/p1', { headers: basic() });
    expect(photo.status).toBe(200);
    expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await photo.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect((await a.request('/admin/photos/p2', { headers: basic() })).status).toBe(404);
  });

  it("keeps the API's open CORS away from it", async () => {
    const a = app();
    const page = await a.request('/admin', { headers: { ...basic(), Origin: 'https://elsewhere.example' } });
    expect(page.headers.get('Access-Control-Allow-Origin')).toBeNull();
    const health = await a.request('/health', { headers: { Origin: 'https://elsewhere.example' } });
    expect(health.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
