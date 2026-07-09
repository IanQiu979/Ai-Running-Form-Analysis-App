/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  // This repo has no test files yet; without this, `jest` exits 1 with
  // "no tests found" and `npm test` would fail on a clean checkout.
  passWithNoTests: true,
  // Node resolves these packages as ESM; Jest needs them transformed like app code.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|react-native-url-polyfill))',
  ],
};
