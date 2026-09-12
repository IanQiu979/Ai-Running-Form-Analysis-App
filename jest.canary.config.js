// Read at module-load time by `expo/src/winter/runtime.native.ts`, which the `jest-expo` preset's
// setup file `require`s BEFORE any test or `setupFilesAfterEnv` runs — so this is the only place
// early enough to set it. Since SDK 57 that runtime installs `expo/fetch` as `globalThis.fetch`
// on native platforms (the preset's default haste platform is `ios`, and `testEnvironment: 'node'`
// below does not change that), and `jest-expo` stubs `expo/fetch`'s native module with no-ops. The
// effect on this config was that every `fetch()` resolved to a response with `status: undefined`
// and an empty body, without ever touching the network — and `lib/hibp.ts` correctly read that as
// `unavailable`, turning the canary red for a week from 2026-09-05 while HIBP itself was healthy.
// `EXPO_PUBLIC_USE_RN_FETCH=1` is Expo's documented opt-out ("To keep React Native's built-in
// `fetch` as the global, set `EXPO_PUBLIC_USE_RN_FETCH=1`" — docs.expo.dev/versions/v57.0.0/sdk/
// expo/, § `expo/fetch` API); under the Node test environment "built-in" means Node's own fetch,
// which is what this canary must use. The canary's first test asserts the opt-out is holding.
process.env.EXPO_PUBLIC_USE_RN_FETCH = '1';

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  // The default jest-expo environment is React Native's, which does not expose Node's global
  // fetch. This canary's entire purpose is to make a REAL network call, so it runs under the
  // plain Node environment (Node 24 provides global fetch and AbortController).
  testEnvironment: 'node',
  // Only ever runs the canary. The hermetic unit suite is `jest.config.js`'s job.
  testMatch: ['**/*.canary.test.ts'],
  // Agent worktrees carry a full copy of the test suite; without this, jest discovers those
  // copies and runs the canary several times over. Mirrors jest.config.js.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
};
