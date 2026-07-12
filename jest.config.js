/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./jest.setup.js'],
  // This repo has no test files yet; without this, `jest` exits 1 with
  // "no tests found" and `npm test` would fail on a clean checkout.
  passWithNoTests: true,
  // The live-network canary (`*.canary.test.ts`) must never run in the commit gate: it would
  // make `npm test` depend on a third party's uptime and on having a network connection. It
  // runs only under `jest.canary.config.js`, on a cron. See docs/superpowers/specs/
  // 2026-07-12-hibp-canary-design.md.
  testPathIgnorePatterns: ['<rootDir>/.*\\.canary\\.test\\.ts$'],
  // Agent worktrees live in .claude/worktrees/ and carry their own node_modules and a full
  // copy of the test suite. Without this, `npm test` discovers those copies, resolves their
  // react-native against the wrong node_modules, and fails suites that pass in the real tree.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  // Node resolves these packages as ESM; Jest needs them transformed like app code.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|react-native-url-polyfill))',
  ],
};
