// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      // Copy is full of apostrophes ("You're in this round"). In React Native
      // text they are just characters, so escaping them would only hurt reading.
      'react/no-unescaped-entities': 'off',
    },
  },
]);
