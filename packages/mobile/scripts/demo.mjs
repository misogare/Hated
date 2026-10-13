// The web demo, which runs on made-up people in the browser (src/demo):
//
//   node scripts/demo.mjs          serve it with the dev server
//   node scripts/demo.mjs export   build it into dist/ for static hosting
//
// An export is served from the site's root unless HATED_BASE_URL says
// otherwise: GitHub Pages serves a project at /<repo>/ (see app.config.js).
// The env var is set here rather than in package.json so it works in every shell.
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

const exporting = process.argv[2] === 'export';
// --clear: Metro caches modules with EXPO_PUBLIC_ values inlined, so switching
// between the demo and the real app must not reuse them.
const args = exporting ? ['expo', 'export', '--platform', 'web', '--output-dir', 'dist', '--clear'] : ['expo', 'start', '--web', '--clear'];
const run = spawnSync('npx', args, {
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_DEMO: '1' },
  shell: process.platform === 'win32',
});
if (run.status !== 0) process.exit(run.status ?? 1);

// GitHub Pages answers any path it has no file for with 404.html, so a copy of
// the app there keeps deep links (and reloads) working.
if (exporting) copyFileSync('dist/index.html', 'dist/404.html');
