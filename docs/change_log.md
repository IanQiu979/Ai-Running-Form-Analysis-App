# Change Log

Running history of behavior-changing work, newest first. Each entry is a dated `## YYYY-MM-DD`
heading followed by a bulleted list of what changed (and why, where it's not obvious). When you
make a behavior-changing commit, add a bullet under today's date — create a new heading at the
**top** of the file if there isn't one yet for today. Don't rewrite or delete past entries.

## 2026-07-10

- Added `typecheck` (`tsc --noEmit`) and `test` (`jest`) npm scripts alongside the existing
  `start`/`ios`/`android`/`web`/`lint`.
- Added `jest.config.js` (jest-expo preset, mirrors the transform-ignore setup needed for
  `@supabase` and `react-native-url-polyfill`, `passWithNoTests: true` since the repo has no
  test files yet) and `jest.setup.js` (AsyncStorage mock).
- Ignored `.superpowers/` in `.gitignore`.
- Rewrote `CLAUDE.md` from a bare `@AGENTS.md` include into the full project doc: what this is,
  architecture at a glance, commands, secrets & env, git etiquette, code conventions, testing,
  and keep-these-docs-updated.
- Extended `AGENTS.md` with the pinned-SDK note (Expo SDK 54, `expo ~54.0.34`) and the rule
  that an SDK upgrade must update the versioned-docs link in the same commit.
- Added `docs/change_log.md`, `docs/status.md`, and `docs/architecture.md` to give future
  sessions persistent, accurate project memory — using V2.3's own milestones (M1–M7, from
  `planning/02-product-requirements.md`), not V2.2's.
