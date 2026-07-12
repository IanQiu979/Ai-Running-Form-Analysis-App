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
