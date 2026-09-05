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
  //
  // `*.deno.test.ts` (issue #90) is the mirror-image exclusion: these files call the `Deno.test`
  // global and live under `supabase/functions/`, run only by `deno test` (see `npm run
  // test:edge`). Jest's default testMatch (`**/__tests__/**/*.[jt]s?(x)`) would otherwise pick
  // them up regardless of filename just for being inside a `__tests__` directory — matching them
  // by name here (not by directory) is what lets Deno-only and Jest-only test files sit
  // side-by-side in the same `_shared/__tests__/` directory without one runner choking on the
  // other's globals. See `supabase/functions/deno.json`'s `exclude` for the opposite direction
  // (Jest-only `*.test.ts` files Deno must not try to check/run).
  testPathIgnorePatterns: ['<rootDir>/.*\\.canary\\.test\\.ts$', '<rootDir>/.*\\.deno\\.test\\.ts$'],
  // react-native-worklets 0.7's native init path lives in platform-suffixed files
  // (initializers.native.ts, NativeWorklets.native.ts, ...) that RN's jest haste resolver
  // prefers over the plain .ts sibling even under Jest — so the package's own `IS_JEST`
  // bailout (in the plain, non-suffixed file) never runs and module-scope code throws
  // "Native part of Worklets doesn't seem to be initialized." Redirect the bare import to
  // the package's own self-contained jest mock, which every reanimated import of
  // react-native-worklets picks up transparently.
  moduleNameMapper: {
    '^react-native-worklets$': '<rootDir>/node_modules/react-native-worklets/src/mock.ts',
  },
  // Agent worktrees live in .claude/worktrees/ and carry their own node_modules and a full
  // copy of the test suite. Without this, `npm test` discovers those copies, resolves their
  // react-native against the wrong node_modules, and fails suites that pass in the real tree.
  modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/'],
  // Node resolves these packages as ESM; Jest needs them transformed like app code.
  // `standard-navigation` is expo-router's own dependency as of SDK 56's react-navigation
  // replacement (see `npx expo-codemod sdk-56-expo-router-react-navigation-replace`) — it
  // ships ESM and needs the same treatment the old `@react-navigation/*` entries existed for.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|standard-navigation|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|@supabase/.*|react-native-url-polyfill))',
  ],
};
