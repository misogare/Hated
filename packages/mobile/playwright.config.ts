import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests of the web demo, built first with `npm run demo:export`
 * and served the way GitHub Pages serves it (scripts/serve-demo.mjs), under
 * HATED_BASE_URL when that is set.
 *
 * They run in a phone-sized Chromium. `npx playwright install chromium` fetches
 * it once; or set PLAYWRIGHT_CHANNEL=chrome to use an installed Chrome.
 */
const base = (process.env.HATED_BASE_URL ?? '').trim().replace(/\/+$/, '');
const port = 4173;
const url = `http://localhost:${port}${base}/`;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: url,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
  },
  webServer: {
    command: 'node scripts/serve-demo.mjs',
    url,
    reuseExistingServer: !process.env.CI,
  },
});
