/**
 * The web demo: built with EXPO_PUBLIC_DEMO=1 (as for GitHub Pages), the app
 * runs on made-up people in the browser instead of talking to the API. See
 * server.ts.
 */

export const DEMO = process.env.EXPO_PUBLIC_DEMO === '1';

export { DEMO_CODE, createDemoClient, demo } from './server';
