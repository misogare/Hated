/**
 * app.json, plus where the web build is served from. The web demo on GitHub
 * Pages lives under the repository's name (https://<user>.github.io/<repo>/),
 * so its export sets HATED_BASE_URL=/<repo>; everywhere else serves the root.
 * Expo applies baseUrl to exports only, never to the dev server.
 */
module.exports = ({ config }) => {
  const baseUrl = process.env.HATED_BASE_URL?.trim();
  return baseUrl ? { ...config, experiments: { ...config.experiments, baseUrl } } : config;
};
