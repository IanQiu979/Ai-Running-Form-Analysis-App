# Architecture

System design for V2.3 — Photo/Video Running Analysis. Current state and planned state are
kept in clearly separate sections below; nothing in a "planned" section is built yet. See also
[`CLAUDE.md`](../CLAUDE.md), [`docs/status.md`](status.md), and the source spec,
[`planning/03-engineering-requirements.md`](../planning/03-engineering-requirements.md).

**No `src/` in this project** — unlike V2.2, code lives directly at the repo root. The
`@/*` path alias maps to `./*` (see `tsconfig.json`), not `./src/*`.

## Current — what exists in the repo

M1 (the spine) is **done** — built and reviewed on `feat/m1-spine`, gate passed 2026-07-11 with
Ian's on-phone test (sign-up → account → empty Home), merged to `main` via PR — real, applied
code and a live DB, not a plan.

```
app/
  _layout.tsx            # root layout: SessionProvider + font loading + splash gate, then
                          # Stack.Protected routes to (tabs) or (auth) on `session`
  (auth)/_layout.tsx      # unprotected stack, one screen
  (auth)/sign-in.tsx      # combined sign-in/sign-up per design-brief screen 1 (email + Google;
                          # no Apple yet, gate #7)
  (tabs)/_layout.tsx      # protected stack; single Home tab for M1 (template Explore removed)
  (tabs)/index.tsx        # M1 empty Home per screen 2 — RLS-scoped, display-only quota caption,
                          # disabled Analyze stub, temporary sign-out
components/              # haptic-tab and ui/icon-symbol (used by (tabs)/_layout.tsx), plus
                          # consent-gate.tsx and result-disclaimer.tsx (2026-07-12, issue #68) —
                          # real, tested components; see "Current — consent record & disclaimer".
                          # The unreferenced create-expo-app template UI (external-link,
                          # hello-wave, parallax-scroll-view, themed-text, themed-view,
                          # ui/collapsible) and hooks/use-theme-color.ts were deleted 2026-07-12
                          # (#33) — themed-text carried the last hardcoded color in the repo.
                          # Everything new is built against constants/theme.ts tokens.
constants/theme.ts        # design brief §2 tokens (done 2026-07-11): light+dark, score-band
                          # palette, spacing/radii/type scales; M1 added
                          # ControlHeight/ControlWidth/HitTarget/Opacity
constants/copy.ts         # strings lifted verbatim from docs/design/copy-deck.md — sign-in and
                          # Home's copy live here first (M1); more screens' copy lands with them
constants/contrast.ts     # contrast-ratio helper backing the AA proof below
constants/__tests__/theme-contrast.test.ts  # 69-assertion Jest proof every text/surface and
                          # band pair clears WCAG AA (9 brief-§2 intent values were darkened/
                          # lightened minimally to pass — each old → new value is a comment in
                          # theme.ts next to the token it changed)
hooks/                    # use-color-scheme, use-theme-color
lib/
  supabase.ts             # the Supabase client — see "Current — auth flow" below
  auth.ts
  session-provider.tsx
  crypto-polyfill.ts
  hibp.ts                 # client-side UX pre-check + defense-in-depth (issue #70) — server-side
                          # HIBP is now the enforcement point, see "Current — Supabase config"
                          # below
  auth-errors.ts           # mapAuthError, extracted from sign-in.tsx (issue #70) — maps the
                          # server's typed leaked-password rejection to copy; see "Current —
                          # Supabase config" below
  consent.ts               # fail-closed read/write of the consent record (issue #68) — see
                          # "Current — consent record & disclaimer" below
supabase/
  config.toml              # local mirror of live auth config — see "Current — Supabase config"
  functions/.env.example   # committed placeholder; the real ANTHROPIC_API_KEY is in the
                          # gitignored functions/.env locally and in production secrets
  functions/deno.json       # Deno runner config (2026-07-12, issue #90), scoped to
                          # supabase/functions/ — wired as `npm run typecheck:edge` / `npm run
                          # test:edge`; see "Current — Deno build/test contract..." below.
  functions/deno.lock       # Deno's dependency lockfile (npm:@supabase/supabase-js's integrity
                          # hashes) — committed, same role as package-lock.json.
  functions/_shared/       # ai-pricing.ts, ai-guard.ts, ai-guard-client.ts (2026-07-12, issue
                          # #91) — the AI spend gate `analyze-form` (#44) will be forced through;
                          # see "Current — AI spend guardrails substrate" below. Also (issue #90,
                          # 2026-07-12): pace.ts (moved from lib/, the single source of truth for
                          # the app + edge function) and knowledge-guard.ts +
                          # knowledge.generated.ts (the certified knowledge/*.md files, bundled
                          # so a deployed function can actually read them) — see "Current — Deno
                          # build/test contract, pace.ts location & knowledge bundling" below.
                          # Still no edge function itself (no Deno.serve entrypoint anywhere yet).
  migrations/               # 13 migrations, all applied live as of 2026-07-12 (see "Current —
                          # DB schema" below) — including #2 (quota soft-delete), #88
                          # (frame-upload ordering), and #91's guardrails
```

The template's `(tabs)/explore.tsx` and `modal.tsx` are deleted, not left as dead scaffolding.
Still absent: `supabase/functions/analyze-form` (or any edge function entrypoint — `_shared/`
has no `Deno.serve` in it), `lib/frames.ts`, `lib/subscription.ts`, and every
route beyond sign-in + empty Home (capture, result, paywall, settings, history).
`supabase/functions/_shared/pace.ts` now exists (#43; moved here from `lib/pace.ts` by #90,
2026-07-12, which settled the Deno bundling mechanism) — the shared PACE types, result shape,
and structural validator, imported by the app (via the new `@shared/*` tsconfig alias) and,
once it exists, the edge functions.

## Route tree — current (M1) vs planned

```
app/
  (auth)/sign-in         # current — sign-up folds into the same screen, no separate route
  (tabs)/index           # current — Home / Analyze (pick source is still a disabled stub)
  (tabs)/history         # planned — past analyses (M6)
  capture/                # planned — record or pick, framing guide (stack) (M2)
  result/[id]             # planned — analysis result view (M4/M6)
  paywall, settings       # planned (M5)
```

## `lib/` layout — current (M1) vs planned

```
lib/
  supabase.ts             # current — the Supabase client; see "Current — auth flow" below
  auth.ts                 # current — browser OAuth (Google), PKCE code exchange
  session-provider.tsx    # current — session state + Stack.Protected guard source of truth
  crypto-polyfill.ts      # current — WebCrypto shim; see "Current — auth flow" below
  hibp.ts                 # current (issue #70) — client-side HaveIBeenPwned leaked-password
                          # check via HIBP's keyless range API (only a 5-char hash prefix ever
                          # leaves the device); runs in sign-in.tsx's sign-up branch only, before
                          # signUp. NOT the enforcement point since 2026-07-12 — server-side HIBP
                          # is now enabled and is the authority. Kept deliberately (Ian's call) as
                          # a fast UX pre-check plus defense-in-depth; still bypassable and fails
                          # open, same as before — see "Current — Supabase config" below.
  auth-errors.ts           # current (issue #70) — `mapAuthError`, extracted from sign-in.tsx so
                          # this security-relevant mapping gets unit-test coverage (screens
                          # aren't unit-tested by convention). Maps the server's typed
                          # `AuthWeakPasswordError` to `Copy.auth.error.passwordBreached` /
                          # `.passwordTooShort` — see "Current — Supabase config" below for the
                          # `reasons` accumulation subtlety this depends on.
  consent.ts               # current (issue #68) — hasConsented/grantConsent/withdrawConsent
                          # against public.consents; fails closed (throws) on any query error
                          # rather than defaulting either way — see "Current — consent record &
                          # disclaimer" below. `analyze-form` (M4) must run the equivalent check
                          # server-side; the client call here is not the enforcement point.
  frames.ts               # planned (M2) — extract and downscale N frames from a video
                          # (client-side). It does NOT upload: since #88, frames ride in the
                          # analyze-form request body as base64 and the edge function writes
                          # them to the bucket itself, after the model call.
  # pace.ts is NOT here — moved to supabase/functions/_shared/pace.ts by issue #90 (2026-07-12),
  # the single source of truth for the app + edge function (no copy/codegen/symlink). The app
  # imports it via the `@shared/*` tsconfig alias (`@shared/pace`). See "Current — Deno
  # build/test contract, pace.ts location & knowledge bundling" below.
  subscription.ts         # planned (M5) — tier read + dummy purchase (adapted from Echo V1 /
                          # V2.2) — cosmetic only; tier/quota are never authoritative on the
                          # client (the live reserve_analysis RPC is already the sole
                          # enforcement point — see "Current — DB schema" below)
```

## Current — auth flow (M1)

- **PKCE browser OAuth (Google).** `signInWithOAuth({ skipBrowserRedirect: true })` gets the
  provider URL, then `WebBrowser.openAuthSessionAsync` (with `preferEphemeralSession: true`, so
  a stale silent Google session can't complete against an already-consumed PKCE verifier)
  intercepts the redirect at the browser layer and resolves with the final URL directly — no app
  route has to exist at the redirect path. `lib/auth.ts`'s `createSessionFromUrl` then exchanges
  the `code` param for a session via `supabase.auth.exchangeCodeForSession`. Redirect URI:
  `paceanalysisai://oauth-callback` (matches `app.json`'s `scheme`).
- **`lib/session-provider.tsx`'s `Linking` listener is a defensive second path**, not the
  primary one — if the browser sheet gets dismissed before `openAuthSessionAsync`'s promise
  resolves (e.g. the app was backgrounded mid-flow), the OS may still deliver the redirect as a
  plain deep link; a module-level `Set` of already-exchanged codes stops the two listeners from
  racing to redeem the same code twice (a real Android double-delivery case, fixed in the M1
  code-review pass).
- **`lib/crypto-polyfill.ts` exists because Hermes has no WebCrypto.** Without it,
  `@supabase/auth-js`'s PKCE helper silently falls back from `S256` to the weaker `plain`
  challenge method (a `console.warn`, never a thrown error) — this was Echo V1's real root cause
  for "invalid flow state, no valid flow state found" failures. The shim backs
  `crypto.getRandomValues` and `crypto.subtle.digest('SHA-256', ...)` with `expo-crypto` and
  must be imported before `@supabase/supabase-js` ever touches `crypto` (`lib/supabase.ts`
  imports it first, before creating the client).
- **`Stack.Protected` guards, not manual redirects.** `app/_layout.tsx` wraps two
  `Stack.Protected` groups — `guard={!!session}` for `(tabs)`, `guard={!session}` for `(auth)` —
  so a signed-out user's navigator has no `(tabs)` route to go to at all (and vice versa).
  `onAuthStateChange` flipping `session` in `SessionProvider` is what moves the user between
  them; no screen calls `router.replace()` after sign-in or sign-out.
- Session storage is **AsyncStorage today, plaintext** — tracked as a known issue to move to a
  SecureStore-backed adapter at M2 (`docs/status.md` Known Issue #13).

## Current — `knowledge/` (done 2026-07-10)

The certified files exist already — 4 Echo source files map to **3** targets, not a 1:1 copy:

```
knowledge/
  pace_framework.md      # from Echo V1's ECHO_Framework_CORRECTED.md, rewritten around PACE;
                          # Elasticity authored fresh from peer-reviewed sources (citations in
                          # the file), pending Ian's certification
  injury_flags.md         # carried over for injury-risk flagging
  drills.md               # the certified drills/cues, extracted from
                          # ECHO_Framework_CORRECTED.md itself (five cadence drills ~lines
                          # 153–229; posture/arm-swing cues ~453–478) — training_zones.md and
                          # workout_library.md contain zero drills and were never a valid source
```

These files are meant to be bundled into the `analyze-form` edge function and injected as
system context, so every analysis is grounded in certified biomechanics rather than the model's
general knowledge. Echo V1 stays frozen — copy from it, never into it. **The bundling mechanism
itself landed 2026-07-12, issue #90** — see the next section.

## Current — Deno build/test contract, `pace.ts` location & knowledge bundling (issue #90, done 2026-07-12)

Found by the full-repo audit the same day: three mechanics that #41/#43/#44/#49/#59 all silently
assumed existed, but nothing owned. All three are closed now.

**1. A Deno runner exists.** `jest-expo` (`jest.config.js`) is a React Native runner and cannot
execute Deno edge-function code — until this issue there was no way to run or typecheck anything
under `supabase/functions/` at all. `supabase/functions/deno.json` (scoped to that directory,
`compilerOptions.strict: true`) plus two npm scripts:

```
npm run typecheck:edge   # deno check --config supabase/functions/deno.json supabase/functions
npm run test:edge        # npm run verify:knowledge && deno test --config supabase/functions/deno.json --allow-read supabase/functions
```

— folded into the existing commands rather than left as a second gate someone has to remember:
`npm run typecheck` is now `tsc --noEmit && npm run typecheck:edge`, and `npm run test` is now
`jest && npm run test:edge`. CLAUDE.md's mandated `npm run typecheck && npm run lint && npm test`
therefore covers edge code for the first time, with no change to the commands anyone actually
types. Running `deno check` for the first time immediately caught a real, previously-invisible
bug in `ai-guard-client.ts` (issue #91): `@supabase/supabase-js`'s `.rpc()` returns a
`PostgrestFilterBuilder` — thenable, but not structurally a `Promise` (missing `catch`/`finally`/
`Symbol.toStringTag`) — which didn't satisfy `RpcClient.rpc()`'s declared `Promise<...>` return
type. Fixed by wrapping the call in an `async` function, which always returns a genuine `Promise`
with no behavior change. `supabase/functions/deno.lock` (committed, same role as
`package-lock.json`) pins `npm:@supabase/supabase-js@2.110.2`'s resolved dependency tree.

**Jest/Deno split, decided deliberately.** The pre-existing `_shared/__tests__/ai-guard.test.ts`
and `ai-pricing.test.ts` (issue #91) stay Jest-only: they use `jest.fn()` for RPC mocking, and
their subjects (`ai-guard.ts`, `ai-pricing.ts`) are deliberately Deno-agnostic pure logic with no
`npm:`/Deno-only syntax, so nothing is lost by not also running them under Deno. Both are listed
in `deno.json`'s `exclude` so `deno check`/`deno test` don't choke on the undefined `jest`/
`describe`/`it` globals. The moved `pace.test.ts` (see point 2) joins them for the same reason,
plus one more: it imports `constants/theme.ts` to prove `pace.ts`'s `ScoreBand` hasn't drifted,
and only Jest can resolve that module at all. New Deno-only tests (the knowledge-bundle suite,
point 3) use a `.deno.test.ts` filename suffix, excluded from Jest via a new
`testPathIgnorePatterns` entry in `jest.config.js` (`'<rootDir>/.*\\.deno\\.test\\.ts$'`,
mirroring the pre-existing `*.canary.test.ts` exclusion) — Jest's default `testMatch` would
otherwise pick up any `.ts` file inside `_shared/__tests__/` regardless of name, so filename,
not directory, is what separates the two runners' territory within one shared test directory.

**2. `lib/pace.ts` now satisfies both consumers — by moving, not copying.** It lives at
`supabase/functions/_shared/pace.ts`: the single source of truth, with no copy, codegen, or
symlink anywhere else, so drift is structurally impossible (`supabase functions deploy` only
bundles `supabase/functions/`, so a `lib/`-resident copy could never have reached the deployed
function regardless). The app imports it through a new tsconfig path alias, `@shared/*` →
`./supabase/functions/_shared/*` (`tsconfig.json`); `jest-expo`'s preset derives its Jest
`moduleNameMapper` from the same `tsconfig.json` `paths` automatically (`node_modules/jest-expo/
src/preset/withTypescriptMapping.js`), so the alias resolves identically under Metro and Jest
with zero extra config, the same mechanism that already makes the pre-existing `@/*` alias work
in Jest. The one import `pace.ts` used to need — `import type { ScoreBand } from
'../constants/theme'` — is gone: Deno resolves neither the `@/*` alias nor an extensionless
specifier, and `theme.ts` pulls in `react-native` regardless of the `import type` erasure. In its
place, `pace.ts` now declares its own `ScoreBand` union plus a runtime companion,
`SCORE_BAND_VALUES` (added solely because a type has no runtime representation to diff against).
The moved `supabase/functions/_shared/__tests__/pace.test.ts` gained a "ScoreBand parity" suite
that imports `constants/theme.ts`'s real `ScoreBandOrder` and asserts the two arrays are exactly
equal — verified to actually fail, not just pass vacuously, by temporarily adding a duplicate
entry to `SCORE_BAND_VALUES` and confirming the test caught it before reverting.
`npm run typecheck` (`tsc --noEmit`) still passes with `pace.ts` in its new location: `include`d
app code imports it, which pulls it back into the TS program despite `tsconfig.json`'s
`supabase/functions/**` exclude (`exclude` blocks *automatic* inclusion, not reachability via the
import graph) — confirmed clean, and safe only because `pace.ts` has zero Deno-only syntax, which
it's structurally guaranteed to keep (see its own header comment).

**3. The knowledge files are bundled, and an empty bundle now fails loud.** The danger this half
of the issue exists to close: a deploy that ships an empty knowledge string doesn't crash, it
produces confident, fluent, ungrounded biomechanics advice — the one thing this product must
never do. `scripts/generate-knowledge-bundle.js` (`npm run generate:knowledge`) reads the three
`knowledge/*.md` files and codegens `supabase/functions/_shared/knowledge.generated.ts`
(checked in — the deploy needs it, not just the source), exporting `PACE_FRAMEWORK_MD`,
`INJURY_FLAGS_MD`, and `DRILLS_MD` as string constants via `JSON.stringify` (safe against any
backtick/`${...}` content in the source markdown). Every constant is wrapped in
`assertNonEmptyKnowledge()` (`supabase/functions/_shared/knowledge-guard.ts` — hand-written, not
generated, so the codegen script only ever emits data, never logic), which throws the moment the
module is loaded if any bundle is empty or whitespace-only. **Verified live, not just written**:
deliberately emptied `DRILLS_MD`'s content and confirmed `deno test` failed immediately with an
uncaught error at import time, before a single test assertion ran; reverted and confirmed clean.
`npm run verify:knowledge` (part of `test:edge`, hence part of `npm test`) regenerates the bundle
and runs `git diff --exit-code` against the checked-in file — **also verified live**: edited
`knowledge/drills.md` without regenerating, confirmed the check failed with the exact diff;
reverted, confirmed it passed. New Deno-only tests (`knowledge-guard.deno.test.ts`,
`knowledge.deno.test.ts`) assert `assertNonEmptyKnowledge`'s throw behavior directly, and that
each bundled constant is non-empty, contains an anchor heading from its source file, and matches
the file on disk byte-for-byte (catching a codegen escaping bug that "contains an anchor string"
alone would miss).

## Current — design layer (Phase 0.5, done 2026-07-11)

- [`docs/design/frontend-design-brief.md`](design/frontend-design-brief.md) — the single
  basic-MVP design brief: the "Gait Plate" visual direction (distinct-but-related to V2.2), the
  0–100 + band score display, all 11 screens with their states, motion, and the a11y floor.
- [`docs/design/copy-deck.md`](design/copy-deck.md) — every string the brief's screens/states
  need: permission rationales, the consent line, error/empty/offline states, framing guidance,
  quota captions (Free is always "1 lifetime," never "this month"), paywall copy, the disclaimer
  + stop-running language, and tier labels.
- [`docs/design/motion-consult.md`](design/motion-consult.md) — the motion-feasibility
  addendum to brief §6; binding for `frontend-builder` alongside it (confirms every motion is
  implementable on the already-installed Reanimated/gesture-handler stack, no new deps).
- [`docs/privacy-checklist-m7.md`](privacy-checklist-m7.md) — the ranked privacy/
  compliance checklist gating M7 (App Store privacy labels, consent upgrade, data inventory,
  retention limits), plus two conflicts surfaced for Ian (see `docs/status.md`).
- `constants/theme.ts` + `constants/contrast.ts` — the brief's §2 tokens as light+dark theme
  values, spacing/radii/type scales, and the score-band palette, with a 69-assertion Jest test
  (`constants/__tests__/theme-contrast.test.ts`) proving every text/surface and band pair clears
  WCAG AA. Font families (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`) installed via
  `npx expo install`; `expo-font` added to `app.json`'s plugins.

UI work builds from these rather than re-deriving the direction. Still open from Phase 0.5:
Ian's certification review of the drafted Elasticity content (`knowledge/pace_framework.md`).

## Current — app icon & splash assets (done 2026-07-12, closes GitHub issue #26)

Real app icon + splash art, replacing the Expo template defaults. Design is "The Gait Plate"
per `docs/design/frontend-design-brief.md` §1: a ground rule, a posture line leaning off it, a
short detached arc marking the lean angle (drawn like a goniometer/biomechanics annotation), and
a filled landing marker at the vertex — the one point of color, `score.strong` (`#2E7D5B`),
deliberately **not** `accent` (`#2F6BEB`), which the brief reserves for the primary CTA alone.

```
assets/
  source/
    mark-light.svg      # the icon / light-mode splash mark, field + mark layers
    mark-dark.svg        # dark-mode splash mark (mark only, drawn for the graphite field)
    mark-mono.svg         # Android adaptive-icon monochrome layer (alpha only, no color)
    mark-favicon.svg       # web favicon, keeps its own bone field
  images/                   # BUILD OUTPUT — generated by `npm run assets`, never hand-edited
    icon.png, android-icon-foreground.png, android-icon-monochrome.png, splash-icon.png,
    splash-icon-dark.png, favicon.png
scripts/
  generate-app-assets.js   # rasterizes assets/source/*.svg -> assets/images/*.png via `sharp`
```

- The SVGs in `assets/source/` are the source of truth. `npm run assets`
  (`scripts/generate-app-assets.js`, `sharp` devDependency) rasterizes them into the six PNGs
  `app.json` points at. Edit a source SVG and re-run `npm run assets`; the PNGs in
  `assets/images/` are regenerated, not hand-edited.
- `icon.png` is deliberately flattened onto the bone field (`#F4F1EA`) with **no alpha
  channel**: iOS applies its own corner mask, and App Store Connect rejects an icon that carries
  transparency. The generator script hard-fails if alpha ever reappears on that file.
- A dedicated dark-mode splash mark (`splash-icon-dark.png`, wired via `app.json`'s
  `expo-splash-screen` plugin `dark.image` key) exists because the mark is dark ink drawn for a
  light field — on the dark graphite background it would be near-invisible. This matters because
  `app/_layout.tsx` deliberately **holds** the splash screen (`SplashScreen.preventAutoHideAsync`
  in `_layout.tsx`, hidden only once fonts and the initial session check both resolve), so it is
  on screen for a real, visible duration rather than a flash.
- `assets/images/android-icon-background.png` is deleted — the Android adaptive icon's
  background is now a flat theme-token color (`app.json`'s `android.adaptiveIcon.backgroundColor`),
  so the PNG that used to hold a solid field was dead weight.
- Closes GitHub issue #26: splash `backgroundColor` `#ffffff` → `#F4F1EA`, dark `#000000` →
  `#1A1712`; Android `adaptiveIcon.backgroundColor` `#E6F4FE` (Expo template pale blue) →
  `#F4F1EA`. All three are `constants/theme.ts` tokens now, not template defaults.

## Current — EAS build & release config (groundwork only; the pipeline half is Apple-blocked)

`eas init` created the EAS project `@ianbeatingpros/pace-analysis-ai`
(`d19968ff-22b8-4851-8e74-087aeb9846b0`, in `app.json`'s `extra.eas.projectId`). `app.json` also
carries a top-level `owner: "ianbeatingpros"` — deliberate, not a default: without it EAS
resolves the project by slug against whoever is currently logged in, which silently breaks the
same `eas build` command on another machine or in CI.

`eas.json` (new, committed) has four build profiles. The file is parsed with a strict Joi schema
via plain `JSON.parse` and cannot hold comments, so the reasoning behind each profile lives here
and in `docs/change_log.md` (2026-07-12), not in the file itself:

| Profile | Distribution | iOS | Android | Notes |
|---|---|---|---|---|
| `development` | internal, dev client | `simulator: true` | APK | The only iOS build possible today — there's no Apple Developer account, so a real-device build has nowhere to get a provisioning profile from. |
| `development-device` | extends `development` | `simulator: false` | — | Written but unusable: blocked on the Apple Developer account (needs an ad-hoc provisioning profile). |
| `preview` | internal | — | APK | |
| `production` | — | — | app-bundle, `autoIncrement` | |
| `submit.production` | — | — | — | Empty placeholder; the App Store Connect app ID and Apple team ID land once Apple exists. |

EAS project-scoped server env vars exist for `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in all three environments (development/preview/
production), at visibility **`sensitive`, deliberately not `secret`**: `EXPO_PUBLIC_*` is
inlined in plain text into the compiled bundle regardless of how EAS stores it, so the key's
real protection is Supabase RLS, not secrecy — `secret` visibility is write-only (unreadable via
the dashboard, `env:list`, *and* `env:pull`), which would buy no security while blocking
`eas env:pull` onto a new machine. `ANTHROPIC_API_KEY` is confirmed absent from all three EAS
environments and must stay that way (it belongs only in `supabase secrets`, per `CLAUDE.md` §
Secrets & env). A build missing these vars does not degrade — `lib/supabase.ts` throws at module
import, so the app hard-crashes on the splash screen.

**Still blocked**: there is no Apple Developer account, so there are no iOS credentials, no
`eas build` for a device or the store, no `eas submit`, and no TestFlight pipeline. Sign in with
Apple (`docs/status.md` Known Issue #3) is the same dependency. Both are tracked in
[`docs/blocked-on-apple.md`](blocked-on-apple.md), not as GitHub issues — the tracker deliberately
holds only work that is actionable without the Apple account.

Removing `exp://**` from the Supabase redirect allowlist (issue #69, see "Current — Supabase
config" below) is a required pre-first-dev-build cleanup, not yet done. It is **not** Apple-blocked:
the `development` profile's `ios.simulator: true` build needs no Apple account and is enough to
retire Expo Go. See `docs/status.md` Known Issue #7.

## Current — CI (added 2026-07-12, the repo's first workflow)

The repo previously had **no CI at all**. `.github/workflows/hibp-canary.yml` is the first one,
and it is deliberately narrow: a **daily scheduled cron, not a PR gate** — a live-network check
required on every PR would make unrelated PRs flaky against a third party's uptime.

- **What it watches**: `lib/hibp.ts`'s `checkPasswordBreached` fails open and deliberately never
  logs (see its header comment), which made the leaked-password check silently unobservable in
  production — if HIBP's endpoint rotted, every sign-up would pass the check forever with
  nothing to show for it (issue #74). The workflow runs `lib/__tests__/hibp.canary.test.ts`
  (via `jest.canary.config.js` / `npm run test:canary`) against the real, live Pwned Passwords
  range API — the same endpoint `lib/hibp.ts` calls in production — asserting a known-breached
  password still returns `breached` and a random one still returns `safe`.
- **Retry then alarm, not alarm-on-first-blip**: 3 attempts with backoff inside one run (a live
  third-party API blips occasionally; a canary that cries wolf gets muted, which lands right
  back at an unobservable control). Only sustained failure across all 3 attempts opens or
  updates a labelled `hibp-canary` + `security` GitHub issue; recovery auto-closes it. See the
  design rationale in `docs/superpowers/specs/2026-07-12-hibp-canary-design.md`.
- **Also asserts the server-side setting, not just the client-side check (added 2026-07-12, issue
  #70).** A second, read-only step GETs the hosted project's auth config via the Management API
  and asserts `password_hibp_enabled === true`, filing a distinct `security`-labelled issue
  (self-healing on recovery, same as the canary above) if it ever reverts. It deliberately does
  **not** probe by attempting a real signup with a known-breached password — in the exact
  scenario it exists to catch (protection off), that probe would succeed and create a real
  account on the production project. Rationale: the setting is Pro-plan-gated, so a billing lapse
  or a stray Dashboard toggle silently disables it, and `lib/hibp.ts` fails open, so it would not
  catch that on its own — nothing else in the repo can even observe this setting, since the
  Supabase CLI has no `config.toml` key for it. **This step needs a `SUPABASE_ACCESS_TOKEN` repo
  secret, which does not exist yet** — until it's added, the step deliberately fails the job
  rather than passing green, so an unarmed monitor can't be mistaken for real coverage.
- **Collects no user data**: the only two strings ever hashed are the public test vector
  `password` and a fresh random UUID, run from a GitHub runner, not a user's device. It adds no
  SDK to the app bundle, so it does not change any App Store privacy-label answer (see
  `docs/privacy-checklist-m7.md`).
- **Narrowed, did not close, issue #74**: the canary covers the endpoint-side failure modes
  (content-type change, Cloudflare challenge, egress rate-limit, response-shape change) but runs
  from a GitHub runner — different IP, different user-agent, no captive portal — so it cannot
  see genuinely device-side failures (a captive portal on a user's Wi-Fi, or Cloudflare
  challenging React Native's user-agent specifically). That residue still needs per-user
  telemetry, and **Sentry (or any crash SDK) is actively contraindicated for it**: every HIBP
  request URL carries the 5-char SHA-1 prefix of the candidate password, and a crash SDK
  captures outbound request URLs as breadcrumbs — without `denyUrls`/`beforeBreadcrumb`
  configured to drop `api.pwnedpasswords.com`, adding one would turn crash reports into a
  durable, identity-linked fingerprint of every user's password.

## Current — consent record & disclaimer (done 2026-07-12, issue #68)

The client-side half of #68's two blocked checklist items — a durable consent **record**, not
just a checkbox, and the "not medical advice" footer. Both ship as components, not screens: M2/
M4/M5 own where they get hosted, and the three #68 checkboxes stay unticked until then (see
`docs/status.md` Known Issue #14 and `docs/privacy-checklist-m7.md`).

- **`public.consents`** (8th migration, `20260712020729_consents.sql`) — an append-only log of
  consent events: `id`, `user_id` (defaults to `auth.uid()`, FK to `profiles` on delete cascade,
  so `delete-account` purges it with no code change needed), `consent_key`, `granted`,
  `created_at`. RLS has owner-scoped SELECT and INSERT policies and deliberately **no UPDATE and
  no DELETE policy** — RLS default-denies anything it has no policy for, so that absence, not a
  convention, is what makes the log immutable. A withdrawal is a new row with `granted = false`,
  never a mutation of the original grant. Verified live against the real database with an
  `authenticated` JWT.
- **`lib/consent.ts`** — `UPLOAD_HEALTH_CONSENT` (`'upload.health.v1'`), `hasConsented`,
  `grantConsent`, `withdrawConsent`. Versioning lives in the key, not a column: rewording the
  consent copy mints a `v2` key, and `hasConsented` is automatically false for every existing
  user until they re-tick — no migration, no version-column check at each call site. **Fails
  closed**: `hasConsented` throws on any query error (offline, RLS misconfigured, network flake)
  rather than defaulting either way — a silent `false` would be indistinguishable from a real
  non-consent, and a silent `true` would process Art. 9 health data with no legal basis. 10 tests.
- **`components/consent-gate.tsx`** — the Art. 9 modal content: checkbox unticked by default, the
  primary CTA disabled until it's ticked (the affirmative, unbundled act that separates real
  consent from a "by continuing" notice), and a fail-closed error state if the write to
  `public.consents` fails (the gate stays up, nothing is uploaded). 6 tests.
- **`components/result-disclaimer.tsx`** — the "not medical advice" footer, rendering
  `result.disclaimer.footer` from the copy deck. 2 tests.
- **`constants/copy.ts`** gained the `consent.upload.*` keys plus one genuinely new one,
  `consent.upload.error.record` (the consent-write-failed message); `docs/design/copy-deck.md`
  documents both.
- **`@testing-library/react-native`** added as a devDependency — a deliberate, narrow exception
  to `CLAUDE.md`'s "screens are not unit-tested for now": these are components, not screens, and
  the disabled-until-ticked gate is a compliance control that must not be able to regress
  silently.
- **Server-side enforcement does not exist yet.** `analyze-form` (M4) must refuse to run for a
  user with no recorded consent — the `<ConsentGate />` above is UX only and can be bypassed by
  anyone calling the function directly. See `docs/status.md` Known Issue #14 for the exact
  required check.

**Correction to issue #68**: the issue claims the disclaimer content "is already in
`knowledge/injury_flags.md`." That file's disclaimer is prompt content for the model and its
wording differs (it adds a "never run through sharp or worsening pain" sentence, among other
changes). The shipped string, `result.disclaimer.footer`, is sourced from `knowledge/
pace_framework.md` via `docs/design/copy-deck.md`, verbatim — not from `injury_flags.md`.

## Planned — `analyze-form` edge function flow

The core of the app. Frames only — the client never sends, and the function never receives,
the original video (see "Media pipeline" below).

1. **Auth** — verify the JWT, reject anon.
2. **Consent** — refuse to run for a user with no recorded consent in `public.consents` (added
   2026-07-12, issue #68): a missing row, a `granted = false` row, or a query error all mean
   refuse. The client's `<ConsentGate />` is UX only and does not enforce this — see
   `docs/status.md` Known Issue #14 for the exact check.

   **Open question for M4, unresolved — do not silently pick one**: this step runs before
   idempotency (step 4) on purpose, refuse-before-work, but that leaves undecided what happens
   when consent is withdrawn *after* an analysis already settled under an idempotency key. A
   replay of that same request now hits this step first and is refused, rather than reaching
   step 4 and returning the existing row as-is, which is what idempotency currently promises.
   Both readings have a real argument: returning the cached row is arguably fine (GDPR Art.
   7(3) — withdrawal "shall not affect the lawfulness of processing based on consent before its
   withdrawal," and serving an already-produced result isn't new processing), while refusing is
   the safer read (continuing to serve health inferences derived from withdrawn consent is at
   least awkward). Whoever builds M4 must decide and document which wins — and note that the
   answer likely coincides with whatever the delete/purge path (#57, #58) already does to that
   row, since a withdrawn-consent analysis is exactly the kind of row that path should be
   removing anyway.
3. **AI spend gate** (substrate added 2026-07-12, issue #91 — see "Current — AI spend
   guardrails substrate" above) — call `gateAiCall()` from
   `supabase/functions/_shared/ai-guard.ts` **before** idempotency/reserve, not after. On
   `allowed: false` (kill switch off, circuit breaker open, or the global daily $ cap would be
   exceeded), return `503` with `gateDenyResponseBody()`'s structured `{ error, code }` body —
   this is the brake, not the caller's fault, so it is never a `4xx`. On allow, hold the returned
   `call_id` for step 9. This runs before idempotency deliberately — see the "call ordering"
   note in that section for why the alternative (gate after reserve) would eventually lock out
   legitimate users.
4. **Idempotency** — an existing `(user_id, idempotency_key)` row is returned as-is instead of
   re-running the analysis. If this branch fires, the call was never going to happen even though
   the gate already reserved budget for it — settle that reservation immediately with
   `recordAiCall({ callId, status: 'cancelled' })` before returning.
5. **Atomic reserve** — a `SECURITY DEFINER` RPC checks the tier's limit (Free 1 lifetime / Pro
   10 / Elite 30 per purchase-anchored period) and frame-count cap, then reserves the analysis
   atomically, before the model is ever called. Over quota → structured `402`, and — same as
   step 4 — settle the gate's reservation as `'cancelled'` before returning, since the model is
   never going to be called for this request either.
6. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames with their actual
   sampled timestamps (Android snaps to keyframes, so the actual timestamps are recorded rather
   than assumed to be evenly spaced). The frames ride in the request body as base64 and are
   **not** uploaded by the client — the server writes them to the bucket itself, after the model
   call (#88). Frame count per tier: Free 1 / Pro 5 / Elite 8.
7. **Build the grounded prompt**: system message = the certified PACE knowledge (framework +
   injury flags + drills, bundled with the function, not fetched per call), then the image
   block(s) plus their timestamps, then the PACE scoring instruction. Detail scales with tier
   via a verbosity dial on one prompt, not a different call — Free gets scores + one line per
   pillar and no drills; Pro gets fuller feedback, injury-risk flags, and drills; Elite gets the
   same analysis as Pro plus a small verbosity/depth bump (the Pro→Elite gap is intentionally
   tiny).
8. **One vision call** — `claude-sonnet-5`, explicit thinking config, `max_tokens` 4–8k, a
   forced tool call returning structured JSON for the 4 PACE pillars (Posture, Arm swing,
   Cadence, Elasticity), each scored with feedback, plus injury flags and (paid) drills.
9. **Validate structurally, loosely** — check the expected shape exists, never judge content.
   On failure retry once; on a second failure, a clearly-labelled partial result if ≥2 pillars
   parsed (`is_fallback: true`, never a fabricated score for the rest), else a clean failure.
   The reserve is released either way — failures and fallbacks never burn quota — capped at 3
   free retries per period against prompt-injection farming. Whatever the outcome, call
   `recordAiCall()` with the matching status (`'success'`, `'fallback'` for a delivered partial,
   `'validation_failed'` for a clean failure, or `'model_error'` if the Anthropic call itself
   errored) and the real token usage from the response — this is what feeds `actual_usd` and the
   circuit breaker; skipping it on any exit path leaves that call's reservation stuck as
   `'pending'` until `pending_timeout_seconds` ages it out on its own.
10. **Upload, then settle** — on a success or honest-partial, the function uploads the frames
    itself (service-role) to `{user_id}/{analysis_id}/frame-{NN}.jpg` — the row already exists, so
    no object can ever be orphaned — then marks the reservation delivered, persisting the result
    to `analyses` (`result` JSONB, `media_paths`, `tier_at_run`, `frame_count`, `is_fallback`) and
    returning `{ result, analysisId, isFallback }`. A frame that fails to upload does **not** fail
    the request: settle records only the paths that landed, so `media_paths` never names an object
    that doesn't exist. On a release path nothing is uploaded at all.

## Planned — media pipeline

Frames only, decided over "upload the media" (self-contradictory as originally specced — the
function was told to upload media it never receives).

- The client extracts and downscales the analyzed frames and sends them **in the request body as
  base64**. It does not upload them — the `analyze-form` function writes them to the private
  bucket with the service-role key, under `{user_id}/{analysis_id}/frame-{NN}.jpg`, and only
  after the model call has succeeded (#88 — the old ordering was circular: the client would have
  had to name `{user_id}/{analysis_id}/` before the `analysis_id` that path needs existed).
  Frames were previously specced to be uploaded twice (once direct-to-bucket, once in the body);
  now they cross the wire once.
- `storage.objects` RLS is **select-own only**: the client can read its own frames to mint signed
  URLs, and can no longer insert or delete. `analyses` is likewise select-own only — deleting an
  analysis is the job of `DELETE /functions/v1/analysis/:id` (#57), which removes the row and
  purges the storage prefix together.
- **Purge deletes by prefix** `{user_id}/{analysis_id}/`, never by iterating `media_paths`.
  Reachability comes from the row existing, not from `media_paths` being populated — a crash
  between the upload and the settle leaves objects under a prefix whose row is still `reserved`
  with an empty `media_paths`. `media_paths` is the frame-strip display list, not the deletion
  authority. #47/#57/#58 all inherit this rule.
- **The original full-resolution video is never uploaded or stored** — it stays on the device.
  This keeps the free-plan 1GB bucket viable (a few hundred KB per analysis instead of
  60–130MB) and needs no video player (`expo-video` is not installed).
- Past Analyses shows the stored frames as a frame strip via short-TTL (~1h, regenerated on
  open) signed URLs.
- Caps: max clip length 15s; max upload 50MB pre-compress; frames downscaled to ≤1568px long
  edge at JPEG q≈0.7 via `expo-image-manipulator`, targeting ~150–350KB/frame; total request
  body ≤5MB, enforced client-side and re-checked server-side.
- **Backgrounding recovery**: the server persists the result and settles quota even if the
  client is suspended before it receives the response — the next launch surfaces "Your analysis
  finished — see Past Analyses," so no one reports a stolen credit.

**As of 2026-07-12, this section describes the live contract, not just the target one** — the
migration that makes it true (`20260712123606_frame_upload_ordering.sql`) was applied to the
live project the same day and verified; see "Current — frame-upload ordering fix (#88)" and
"Current — DB schema" below, and `docs/status.md` Known Issue #16.

**Elite comparison** (decided, kept minimal): a client-side view of two already-stored
`analyses` rows side by side with per-pillar score deltas. It reads two rows the user already
has via the normal `analyses` RLS read and diffs them in the client — no new AI call, no quota
burn, no extra storage, no new edge function or API route.

## Planned — API

None of these edge functions exist yet — `supabase/functions/` has the `.env.example`
placeholder and, as of 2026-07-12 (issue #91), the `_shared/ai-guard*.ts` spend-gate substrate,
but no `analyze-form/index.ts` and no `Deno.serve` entrypoint of any kind. `analyze-form`'s core
dependencies are already live, though: the reserve/settle/release quota RPC family (live — see
"Current — DB schema" below) and the AI spend gate (live — see "Current — AI spend guardrails
substrate" above) are both applied and verified against the live database; only the edge
function code that calls them remains unbuilt. Also read the M1-review contract notes in
`docs/status.md` Known Issue #14 before building it.

The client never talks to Postgres for privileged operations — those go through edge
functions. Plain reads of the caller's own rows go through the Supabase client, protected by
RLS.

| Method / Route | Auth | Body | Returns | Notes |
|---|---|---|---|---|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], timestamps: number[], idempotencyKey }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. **No `mediaPaths`** — the client never names a storage path (#88). The server uploads the frames itself, after the model call, and derives their paths. Enforces tier + frame cap + atomic quota reserve, injects certified knowledge, validates, persists. Idempotent on `idempotencyKey`. |
| `POST /functions/v1/purchase-tier` | JWT | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` | Same contract as V2.2; v2 swaps `source` to receipt verification. |
| `GET /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, periodEnd }` | Drives Home "7 of 10 left" (Pro/Elite, period-based) or "1 of 1 used, lifetime" (Free). Computed from `count(analyses)`, never a client counter. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true }` | User-initiated delete: removes the `analyses` row **and** its frame objects atomically, so they can't get out of sync. |
| `POST /functions/v1/delete-account` | JWT | — | `{ deleted: true }` | Ported from Echo V1's `delete-user/`, because `storage.objects` has no FK to `auth.users` and would otherwise orphan every object. Delete order: storage objects → rows → auth user. |

**Error contract**: every non-2xx response body is structured `{ error, code }`.
`supabase.functions.invoke` wraps non-2xx responses in a generic `FunctionsHttpError`, so the
client uses one shared wrapper that parses `{ error, code }` back out of that exception, rather
than re-parsing it at each call site.

Direct Supabase-client reads (RLS-guarded, `user_id = auth.uid()`): list own `analyses`; read
own `subscriptions`; read own frames from the private bucket via short-TTL signed URLs. Inserts
into `analyses` happen only inside `analyze-form`.

## Current — frame-upload ordering fix (#88), applied and verified 2026-07-12

`supabase/migrations/20260712123606_frame_upload_ordering.sql` changes `reserve_analysis`/
`settle_analysis`'s signatures and three RLS policies (see below), and **it is now live** —
applied to `v2.3Analysis` via `supabase db push` on 2026-07-12, alongside #2's and #91's
migrations, and verified against the live database. The "Planned" sections above (media
pipeline, the `analyze-form` API contract) describe this post-#88 contract, and it is now what's
actually deployed, not just designed.

**Verified live**: `reserve_analysis` is the new 4-arg signature (`p_media_paths` dropped);
`settle_analysis` is the new 5-arg signature (namespace-guarded `p_media_paths`). `storage.
objects` has zero INSERT policies and zero DELETE policies — only the owner-scoped SELECT
remains. `public.analyses`'s client-facing DELETE policy is gone. Security advisors: zero
warnings, zero errors.

**Overlapped issue #2** (free quota resettable via client `DELETE` on `analyses`), applied in
the same push. Both migrations wanted the `analyses` DELETE policy gone; #2 (earlier timestamp)
dropped it first, so #88's `drop policy if exists` on the same policy was a safe no-op — the
push log shows exactly that: `NOTICE: policy "Users can delete their own analyses" ... does not
exist, skipping`. #2 never touches `reserve_analysis`'s body, so there was no risk of one
migration's `create or replace function` silently overwriting the other's — the two composed
cleanly, exactly as designed. See the migration file's own header comment and `docs/status.md`
Known Issue #16 for the full note.

**One gap this migration did not close**: it drops `storage.objects`'s client-facing INSERT/
DELETE *policies*, but never revokes the table-level `GRANT INSERT`/`GRANT DELETE` to
`authenticated` that the bucket-creation migration left in place — unlike `public.analyses`,
which #2's migration hardened with an explicit `revoke all` + narrow re-grant. The client is
blocked today only because RLS has no policy permitting either statement, not because the
privilege itself is gone — no defense in depth. Tracked as issue #100 (narrower than originally
filed: `storage.objects` specifically, shared across every bucket). See `docs/status.md` Known
Issue #18.

## Current — DB schema (LIVE, applied 2026-07-11 – 2026-07-12)

The live Supabase project (`v2.3Analysis`) has **13 migrations applied** (`supabase db push`,
security advisors clean) — this is the as-built schema, not the draft in `planning/03` (which
drifted on a few points, noted inline below; `planning/03` and `planning/02` should be treated
as the design intent, this section as ground truth for what's actually deployed). The first 7
landed with M1 on 2026-07-11; the 8th and 9th, `consents` and `consents_grant_hardening` (issue
#68), landed 2026-07-12 — see "Current — consent record & disclaimer" above. **The 10th–13th —
`analyses_quota_soft_delete` (#2), `frame_upload_ordering` (#88), and `ai_spend_guardrails` +
`ai_spend_guardrail_functions` (#91) — were all applied together via `supabase db push` on
2026-07-12** and verified against the live database; see "Current — frame-upload ordering fix
(#88)" above and "Current — AI spend guardrails substrate" below (both formerly
"Pending"/written-not-applied, now genuinely live).

```sql
-- public.profiles: one row per auth.users row, auto-created by an AFTER INSERT trigger
-- (handle_new_user, SECURITY DEFINER) on signup for every provider.
profiles       (id uuid pk -> auth.users(id) on delete cascade,
                display_name text, created_at timestamptz)

-- public.subscriptions: at most one row per user; NO row = free. subscription_tier is
-- 'pro' | 'elite' ONLY — 'free' is never a value here (contrast analysis_tier below).
subscriptions  (user_id uuid pk -> profiles(id) on delete cascade,
                tier subscription_tier not null,      -- enum: 'pro' | 'elite'
                purchased_at timestamptz not null,    -- the period anchor; no stored
                                                       -- period_start/period_end, no cron —
                                                       -- periods are derived at read time
                status subscription_status not null,  -- enum: 'active' | 'canceled'
                created_at, updated_at)

-- public.analyses: one row per reserve_analysis() call. media_paths is plural (drift fix vs
-- planning/03's earlier media_path text draft — plural was already correct there too, kept
-- consistent here). No separate frame-count/tier duplication anywhere else to drift.
analyses       (id uuid pk default gen_random_uuid(),
                user_id uuid not null -> profiles(id) on delete cascade,
                media_type media_type not null,          -- enum: 'photo' | 'video'
                media_paths text[] not null default '{}',-- private-bucket paths; NOT a video
                frame_count integer not null check (> 0),
                tier_at_run analysis_tier not null,       -- enum: 'free' | 'pro' | 'elite'
                status analysis_status not null default 'reserved', -- enum: 'reserved' |
                                                                      -- 'delivered' | 'released'
                result jsonb,                              -- 4 PACE pillars + flags + drills
                is_fallback boolean not null default false,
                idempotency_key text not null,             -- UNIQUE (user_id, idempotency_key)
                release_reason text,                        -- e.g. 'validation_failed' — observability only
                deleted_at timestamptz,                    -- null = not deleted (issue #2); a
                                                            -- client soft-delete sets this AND
                                                            -- redacts result/media_paths, see
                                                            -- the RLS note below
                created_at, delivered_at, released_at, updated_at)
-- indexes: (user_id, created_at desc) for "list my analyses"; (user_id, status, created_at)
-- for the quota-window counts the RPCs below run.

-- public.consents: append-only log of consent events (issue #68), one immutable row per grant
-- or withdrawal. No UPDATE or DELETE policy exists for anyone — see RLS below. This is the
-- record that DEMONSTRATES consent (GDPR Art. 7(1)); the client checkbox only collects it.
consents       (id uuid pk default gen_random_uuid(),
                user_id uuid not null default auth.uid() -> profiles(id) on delete cascade,
                consent_key text not null,    -- versioned in the key itself, e.g.
                                               -- 'upload.health.v1' — not a separate column
                granted boolean not null,      -- false = withdrawal
                created_at timestamptz not null default now())
-- index: (user_id, consent_key, created_at desc) — the only read this table serves is
-- "latest row for this user and key".
```

**Quota RPC family — `reserve_analysis` / `settle_analysis` / `release_analysis`, live and the
sole enforcement point.** All three are `SECURITY DEFINER`, `EXECUTE` revoked from
`public`/`anon`/`authenticated` and granted only to `service_role` — so only a future edge
function calling with the service-role key can invoke them, never the client directly.
**Signatures below reflect #88's migration, applied and verified live 2026-07-12**:
`reserve_analysis` is 4 args (`p_media_paths` dropped), `settle_analysis` is 5 (gained it, with
a `{p_user_id}/{p_analysis_id}/` namespace guard).

- **`reserve_analysis(p_user_id, p_idempotency_key, p_media_type, p_frame_count)`**
  — the sole write path for new `analyses` rows (4 args as of #88 — the row is minted with an
  empty `media_paths`, which `settle_analysis` fills in after the upload). Serializes concurrent
  calls for one user via `pg_advisory_xact_lock(hashtext(p_user_id || ':analysis_reserve'))` (a
  bare count-then-insert does not close the race on its own — see the migration's own comment for
  why); `UNIQUE (user_id, idempotency_key)` is a second, unconditional backstop against a lock-
  hash collision. An existing row for `(user_id, idempotency_key)` is returned as-is, **whatever
  its status** — a caller MUST branch on the returned `status`, not just `allowed` (a replayed
  request against a since-released reservation returns `allowed: true, existing: true, status:
  "released"`). Tier is derived server-side from `subscriptions` (no row = `free`), never
  trusted from the caller. Enforces, in order: frame-count cap per tier (Free 1 / Pro 5 /
  Elite 8 — photo must be exactly 1 frame), the 3-failed-attempt anti-farming cap (counts
  `'released'` rows in the window — a released reservation never counts toward the quota limit,
  but does count here, since failures/fallbacks don't cost quota and would otherwise be a free
  retry farm), then the quota limit itself (Free 1 **lifetime**, count of all
  `'reserved'`/`'delivered'` rows ever; Pro 10 / Elite 30 **per current period**, via
  `pace_current_period` below — Free does not reuse the period logic, a separate branch). This
  counting query is **unaffected by #2's soft-delete** (below) — it never filters on
  `deleted_at`, so a soft-deleted row keeps counting exactly as before.
- **`settle_analysis(p_user_id, p_analysis_id, p_result, p_is_fallback, p_media_paths)`** — marks
  a `'reserved'` row `'delivered'` with its result and the frame paths that actually landed (5
  args as of #88 — every path must sit under the row's own `{p_user_id}/{p_analysis_id}/`
  namespace, or the whole call is rejected with `invalid_media_path`); guarded to only affect a
  still-`'reserved'` row, so a duplicate/late call is a safe no-op rather than overwriting an
  already-delivered result.
- **`release_analysis(p_user_id, p_analysis_id, p_reason)`** — the compensating release: a
  `'reserved'` row that never gets settled (the vision call errored after its one retry, or the
  response was a clean failure) moves to `'released'` so it stops counting toward quota, while
  the row itself is kept (not hard-deleted) so it still counts toward the 3-failed-attempt cap.
  **Must be called on every M4 failure path** — an unreleased `'reserved'` row silently eats a
  quota slot forever (`docs/status.md` Known Issue #14).
- **`pace_current_period(anchor, as_of)` / `pace_add_months_clamped(base, n)`** — SQL port of
  V2.2's `currentPeriod(anchorDate, now)`: purchase-day-anchored, month-end clamped (Jan 31 →
  Feb 28 → Mar 31, verified), computed inside the same transaction as the reserve, no cron, no
  stored `period_start`/`period_end` columns (a drift fix vs `planning/03`'s draft schema, which
  sketched those columns on `subscriptions` — the live schema derives the period from
  `purchased_at` alone at read/reserve time instead).

**RLS, as deployed** (all policies wrap `auth.uid()` as `(select auth.uid())` — a performance
fix, InitPlan-evaluated once per statement instead of once per row, applied in the 7th
migration; behavior is identical to bare `auth.uid()`): `profiles` and `subscriptions` are
select-own only (no client insert/update/delete — writes are trigger- or future-service-role-
only). `consents` is select-own and **insert-own only** — deliberately **no UPDATE and no DELETE
policy for anyone**, which is what makes the log append-only (RLS default-denies whatever it has
no policy for).

`analyses`'s RLS **changed live on 2026-07-12** (issues #2 and #88, applied together): the
client-facing DELETE policy is gone. The two policies that remain are select-own ("Users can
view their own analyses") and a column-and-transition-restricted soft-delete UPDATE policy
("Users can soft-delete their own analyses", #2) — its `USING` clause matches only the caller's
own, not-yet-deleted rows, and its `WITH CHECK` allows only the `deleted_at: null → now()`
transition, so a soft-deleted row becomes permanently immutable to the client from that point
on; a trigger also redacts `result` and `media_paths` to null/empty on that same transition,
keeping only what `reserve_analysis`'s counting depends on. Underneath the policies, #2's
migration also closed the privilege layer: `revoke all on public.analyses from authenticated,
anon`, then `grant select on public.analyses to authenticated` and `grant update (deleted_at) on
public.analyses to authenticated` — verified live via `has_table_privilege`: `authenticated` can
no longer INSERT, DELETE, or TRUNCATE this table at all, and the one column it can UPDATE is
`deleted_at`. `anon` gets nothing on this table, as before.

**Media privacy, as deployed**: the private `media` bucket (5MB/object cap, `image/jpeg` only)
originally had owner-scoped `storage.objects` RLS for insert/select/delete — first path segment
must equal `(select auth.uid())::text` — and deliberately **no UPDATE policy** (frames are
write-once or deleted, never edited in place). Photos/videos of people are sensitive; only the
analyzed frames (never the original video) are ever uploaded. No public URLs — access is via
signed URLs or authenticated reads only.
**#88's migration dropped the insert and delete policies here, applied and verified live
2026-07-12**: RLS is enabled with zero INSERT policies and zero DELETE policies — only the
owner-scoped SELECT remains, so the bucket is select-only from the client's side (server uploads
with service-role, which bypasses RLS; purge belongs to #57/#58). **One gap this did not
close**: `storage.objects`'s table-level `GRANT INSERT`/`GRANT DELETE` to `authenticated` were
never revoked (unlike `public.analyses` above) — the client is blocked only because RLS has no
policy permitting either statement, not because the privilege is gone. No defense in depth if a
policy is ever carelessly re-added, or RLS disabled on this table. Tracked as issue #100 — see
`docs/status.md` Known Issue #18.

## Planned — anti-farming cap distinguishes our fault from theirs (issue #6, migration written
2026-07-12, NOT yet applied)

`supabase/migrations/20260712220000_anti_farm_release_reason_fix.sql` exists in the repo but has
**not** been pushed to the live project — same footing the two AI spend guardrail migrations
below were on before their 2026-07-12 push (see that section's note on this same convention).
Local migrations and the live DB are therefore 14 files vs. 13 applied until this one lands.

**The bug it fixes**: `reserve_analysis`'s `v_released_count` (both the DB schema section above
and the live database, verified via `pg_get_functiondef` before writing the fix) counted every
`status = 'released'` row with no regard for *why* it was released — a transient Anthropic
timeout counted identically to a deliberate prompt-injection/farming attempt. Free's branch has
no window at all (matching its lifetime quota), so 3 such failures — entirely Anthropic's fault —
permanently bricked a free account with no recovery path, before this fix.

**The fix, and a correction made the same day.** `release_reason` (previously freeform,
"observability only, not read by any check" — see the schema block above) is pinned to a closed
vocabulary via a new CHECK constraint: `model_error` / `provider_timeout` / `internal_error` are
server-fault and excluded from the anti-farm count; `validation_failed` is the farming signal and
still counts. Classification lives in one new standalone function,
`public.pace_is_farming_signal(text)` — deliberately kept OUT of `reserve_analysis`'s body so a
future taxonomy change never has to `create or replace` that function again (the exact
two-migrations-collide hazard #88's and #2's own header comments flag). The first cut of this
migration then left free's cap **lifetime**-scoped on `validation_failed`, reasoning that a
confirmed farming signal deserved a lifetime consequence. Review (Ian + the coordinating agent)
caught that this reopened a narrower version of the same bug: `validation_failed` is an *outcome*
label ("we couldn't produce a valid result" — it fires on genuinely hard/honest inputs too, not
just attacks), and #45 (retry-once + honest-partial fallback) doesn't exist yet to reduce that
noise. A first-time user who hit 3 confusing (not malicious) videos would be permanently locked
out, having never received a result. **Fixed by windowing free's anti-farm count to a rolling
24 hours** (`released_at > now() - interval '24 hours'`) — which turns out to match what the
original spec always said ("3 free retries **per period**", `planning/02`, `planning/03`,
`docs/mvp-build-prompt.md:223`) rather than the lifetime scope the first implementation gave it.
Pro/elite's existing purchase-anchored period window is untouched beyond gaining the same reason
filter — it already self-resets, so it never had this failure mode. Both branches of
`reserve_analysis` filter `v_released_count` through the classifier; every other line —
signature, quota check, insert, exception handler — is unchanged from #88's version.
`settle_analysis`/`release_analysis` are not touched. The 3-attempt threshold and the cap itself
are preserved — this narrows and time-bounds what counts, it does not remove the cap. The
governing invariant: **a user who has never successfully received an analysis must never be
permanently unable to obtain one** — anti-farming may throttle, never permanently deny.

No data backfill ships with it: verified live immediately before writing the migration,
`public.analyses` has 0 rows and `public.profiles` has 2 — no account is bricked today. Whoever
builds `analyze-form` (#44) must call `release_analysis` with one of the four pinned reason
strings above on every failure path, or the CHECK constraint rejects the call.

**Copy gap, flagged not filled**: `reserve_analysis` can return `reason: 'too_many_failed_attempts'`
but `docs/design/copy-deck.md` has no string for it — the nearest strings
(`analyzing.error.failed.*`) cover a single failed attempt and unconditionally say "try again"
with no cap-awareness. `ux-copywriter` needs to add a key for this refusal (ideally naming the
24h recovery window) before #44 ships; not added here — out of a database migration's scope.

## Current — AI spend guardrails substrate (issue #91, 2026-07-12)

**Migrations applied to the live project 2026-07-12** (`supabase db push`, alongside #2's and
#88's migrations) and verified: `ai_ops_config`, `ai_model_pricing`, and `ai_call_log` all
exist; `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call`,
`record_ai_call`, `ai_breaker_state`, or `ai_spend_today` — service-role only, exactly as
designed. The two migrations below (`20260712210000_ai_spend_guardrails.sql`,
`20260712210100_ai_spend_guardrail_functions.sql`) are genuinely deployed, not just written —
this section describes live behavior, the same footing as "Current — DB schema" above.

The security advisors show three INFO-level `rls_enabled_no_policy` notices, one per `ai_*`
table — this is **intentional**, not a gap: RLS enabled + zero policies + `revoke all` from
`anon`/`authenticated` is deny-by-default for tables only `service_role` should ever touch. Do
not "fix" this by adding a policy.

Design spec: `docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md`. Built because
issue #48 established account creation on this project is currently unbounded (no signup rate
limit, autoconfirm on, CAPTCHA blocked on Ian) and its own conclusion is that this blocks M4
*going live*, not the M4 *build* — so M4 (#44, still Not Started) is expected to land with that
hole open. This substrate is the brake it lands behind.

```sql
-- public.ai_ops_config: singleton row (id boolean primary key default true check (id)).
-- THE KILL SWITCH lives here. RLS on, zero policies, and every anon/authenticated grant
-- explicitly revoked (not left to RLS alone — see the consents_grant_hardening lesson) — the
-- client cannot read or write this table at all. An operator flips it from the dashboard/SQL
-- editor/MCP with one UPDATE. No redeploy.
ai_ops_config    (id boolean pk default true check (id),
                  analyze_enabled boolean not null default true,   -- THE KILL SWITCH
                  disabled_reason text,
                  daily_usd_cap numeric not null default 10.00,     -- global daily ceiling
                  breaker_failure_threshold integer not null default 5,
                  breaker_cooldown_seconds integer not null default 900,
                  pending_timeout_seconds integer not null default 300,
                  updated_at)

-- public.ai_model_pricing: rates, not a migration — reprice with one UPDATE. Seeded at
-- claude-sonnet-5's LIST price ($3/$15 per Mtok), not the cheaper introductory rate, so every
-- estimate errs conservative.
ai_model_pricing (model text pk, input_usd_per_mtok, output_usd_per_mtok,
                  cache_write_multiplier numeric not null default 1.25,
                  cache_read_multiplier numeric not null default 0.10, updated_at)

-- public.ai_call_log: one row per attempted model call — the spend ledger. user_id/analysis_id
-- are ON DELETE SET NULL, not CASCADE: deleting an account/analysis erases personal data but
-- keeps the cost row queryable (satisfies both the issue's "queryable" requirement and GDPR
-- erasure). All four token fields stored separately — they bill at different rates.
ai_call_log      (id uuid pk, user_id uuid -> profiles(id) on delete set null,
                  analysis_id uuid -> analyses(id) on delete set null,
                  model text not null -> ai_model_pricing(model),
                  status ai_call_status not null default 'pending', -- pending|success|
                                                                     -- model_error|
                                                                     -- validation_failed|
                                                                     -- fallback|cancelled
                  estimated_input_tokens, estimated_output_tokens, estimated_usd not null,
                  input_tokens, output_tokens, cache_creation_input_tokens,
                  cache_read_input_tokens, actual_usd,               -- null until settled
                  created_at, settled_at)
```

**The gate — `gate_ai_call` / `record_ai_call` / `ai_breaker_state` / `ai_spend_today`.** All
four are `SECURITY DEFINER`, pinned `search_path`, `EXECUTE` revoked from
`public`/`anon`/`authenticated` and granted only to `service_role` — the exact same privilege
shape as `reserve_analysis`/`settle_analysis`/`release_analysis`, and for the identical reason:
only a future edge function calling with the service-role key can invoke these, never the client.

- **`gate_ai_call(p_user_id, p_estimated_input_tokens, p_estimated_output_tokens, p_model, p_analysis_id)`**
  takes a single **global** advisory lock (`hashtext('ai_ops_gate')` — deliberately not per-user
  like `reserve_analysis`'s lock, because this cap is global), then denies in order: kill switch
  off (`reason: 'killed'`) → circuit breaker open (`reason: 'breaker_open'`) → unpriced model
  (`reason: 'unknown_model'`) → daily cap would be exceeded (`reason: 'daily_cap'`). "Today's
  spend" counts settled `actual_usd` since UTC midnight (the function pins `set timezone = 'UTC'`, not relying on the session default) **plus** every still-`'pending'`
  reservation's `estimated_usd` made since midnight and not yet timed out — counting pending
  estimates is what makes the cap hold under a concurrent burst; an orphaned pending row (the
  function crashed mid-call) ages out of the sum on its own after `pending_timeout_seconds`, no
  cron sweeper needed. On allow, inserts a `'pending'` row and returns
  `{ allowed: true, call_id, estimated_usd }`.
- **`ai_breaker_state()`** is derived on every read, not stored: open if the last
  `breaker_failure_threshold` settled calls are **all** `model_error`/`validation_failed` (a
  delivered `'fallback'` counts as success — the user got value) and the most recent is within
  `breaker_cooldown_seconds`. A gap the design spec left open, filled here: once the cooldown
  lapses, the state alone can't guarantee "exactly one call probes through" under a concurrent
  burst (the advisory lock only serializes calls that already reached the gate, not a decision
  about who gets to be *the* probe) — so a still-`'pending'` row created after the last failure
  counts as a probe already in flight, and the breaker stays open for every other caller until it
  settles.
- **`record_ai_call(p_call_id, p_status, p_input_tokens, p_output_tokens, p_cache_creation_input_tokens, p_cache_read_input_tokens, p_analysis_id)`**
  settles a `'pending'` row exactly once; a retried call for an already-settled row is a safe
  no-op (`already_settled: true`), same guard shape as `settle_analysis`/`release_analysis`. A
  `'cancelled'` settle (the gate allowed the call but it was never made — see "call ordering"
  below) records `actual_usd = 0`. A settle with **no usage data at all** (e.g. the Anthropic
  call itself network-timed-out) records `actual_usd` at the **estimate**, not zero — an unknown
  cost is assumed incurred so the daily-cap budget never quietly under-counts. Otherwise
  `actual_usd` is computed from `ai_model_pricing`'s rates across all four token fields.
- **`ai_spend_today()`** returns one JSONB snapshot — spend (settled/pending/total), the cap,
  today's call counts by status, breaker state, kill-switch state — for `db-audit`,
  `cost-monitor`, and manual inspection. Service-role only, same as the rest.

**Call ordering — binding on #44, not optional.** The gate runs **before** `reserve_analysis`:

```
auth → consent → AI GATE → idempotency + quota reserve → model call → record + settle
```

If the gate ran after the quota reserve, every kill-switch/cap/breaker denial would have to
release that reservation — and `reserve_analysis` counts released rows against its
3-failed-attempt anti-farming cap (see "Quota RPC family" above), so repeated guardrail denials
would eventually lock out a legitimate user for something the guardrail did, not them. Gating
first means a denied request never creates a reservation, and **`reserve_analysis` needs no
changes** for this to work. The cost: because idempotency lives inside `reserve_analysis`, every
call — including a pure replay of an already-delivered analysis — reserves a `'pending'`
`ai_call_log` row before the edge function can know the model call isn't actually needed;
`record_ai_call(status: 'cancelled')` is the release valve for exactly that case, released for
$0 immediately rather than left to age out.

**What #44 must do, added to the binding M4 contract (alongside Known Issue #14's existing
items — see `docs/status.md`):**
1. Call `gateAiCall()` (from `supabase/functions/_shared/ai-guard.ts`) before every Anthropic
   request. On `allowed: false`, return `503` (`httpStatusForGateDeny`) with the structured
   `{ error, code }` body (`gateDenyResponseBody`) — never a `4xx`; every denial is the brake,
   not the caller's fault.
2. Call `recordAiCall()` on **every** exit path after a successful gate — success, model error,
   validation failure, delivered fallback, or a `'cancelled'` settle when the call turns out
   never to be needed. Treat it like a `finally`: an unsettled `'pending'` row silently eats
   daily-cap headroom until `pending_timeout_seconds` ages it out, with no other cleanup path.
3. Use `supabase/functions/_shared/ai-guard-client.ts`'s `createAiGuardClient()` (or an
   equivalent service-role client) — never a client built from the caller's JWT; the RPCs are
   `service_role`-only by grant and will simply fail for anything else.

**Honest scope of "physically cannot make an Anthropic call without passing through the
brake"**: real in two senses, not three. (1) The client cannot bypass any of this — DB privilege,
enforced. (2) There is no exported way to get a `call_id` other than `gateAiCall()`, and
`recordAiCall()` requires one, so *using the ledger at all* runs through the gate by
construction. (3) Nothing in Postgres can stop `analyze-form`'s own code from calling Anthropic
directly and never importing this module — that is a code-review problem, closed by
`AGENTS.md`'s mandatory HIGH/CRITICAL chain, which requires `security-auditor` review of
anything on the hot list (edge functions and the `analyze-form` flow are both named explicitly)
before it ships, not by anything in this migration.

**TypeScript interface** (`supabase/functions/_shared/`, all new, none deployed — there is still
no edge function): `ai-pricing.ts` (pure, zero imports, Jest-tested — token/cost estimate math
for the pre-call estimate; `AI_MODEL_PRICING` mirrors `ai_model_pricing`'s seed row, manually
kept in sync, used only for pre-call estimation, never actual billing) → `ai-guard.ts`
(`gateAiCall`/`recordAiCall`/HTTP mapping against an injected `RpcClient`, also Jest-tested, also
free of Deno-only imports) → `ai-guard-client.ts` (the real Deno/`Deno.env`/`npm:` client
factory, imported only by the eventual edge function, not tested — nothing pure to test).
`tsconfig.json` now excludes `supabase/functions/**` from `npm run typecheck` — it runs on Deno,
a different module/type system than this Expo app's `tsc` project; #44 should add its own
Deno-side check (`deno check`) rather than rely on `npm run typecheck` to cover it.

**Manual step that cannot be automated from this repo**: set a hard spend ceiling in the
Anthropic Console. It's free configuration and the only backstop that survives a bug in this
gate, a Supabase outage, or a leaked `ANTHROPIC_API_KEY` — everything above is defense-in-depth
*behind* it, not instead of it. Tracked as an open item in `docs/status.md` until Ian sets it.

## Current — Supabase config: `config.toml` vs dashboard-only

`supabase/config.toml` (added by `supabase init` in M1) is a **local mirror + audit trail**, not
the live source of truth — most of it documents settings the hosted project's Management API
either can't take from this file at all, or was only ever pushed via a narrowly scoped PATCH,
never `supabase config push` (a warning to that effect lives in the file itself; running that
command against this project would attempt to push unrelated settings this file was never meant
to own).

- **Pushed live via a scoped Management API PATCH (`site_url`, `uri_allow_list`,
  `mailer_autoconfirm` only), and mirrored in `config.toml` for the record**: `site_url =
  "paceanalysisai://"` (no web frontend, so this is the app's own deep-link scheme, not a
  marketing site); `additional_redirect_urls` = `paceanalysisai://oauth-callback` (the exact URI
  `lib/auth.ts`'s `makeRedirectUri` produces), `paceanalysisai://**` (future deep links —
  password reset, magic links — under the same scheme), and `exp://**` (Expo Go dev testing via
  `npm run start:go`; scoped to a local-dev-only scheme, tracked as a pre-EAS-build cleanup item
  in `config.toml` and as [issue #69](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/69)
  — it is blocked until the first dev build exists, since Expo Go's `makeRedirectUri` produces
  exactly the `exp://` URI that entry allowlists); `mailer_autoconfirm = true`
  (`enable_confirmations = false` in the file —
  the two are inverses) since no transactional email provider or confirmation-pending screen
  exists yet; `minimum_password_length = 8` (raised from 6, a security-audit LOW finding).
- **Dashboard-only, never pushed from this file**: which providers are enabled (`google` +
  `email` on; `apple` and `anonymous_users` off — set directly in the dashboard, `docs/status.md`
  Known Issue #3), the Google OAuth client ID/secret, and any future Apple Services ID/key.
- **Server-side HaveIBeenPwned leaked-password rejection: ENABLED and is the authority (issue
  #70, closed 2026-07-12).** Attempting to enable it during the M1 security audit
  (2026-07-11) returned HTTP 402 ("available on Pro Plans and up") because the org
  (`Echo_Running_Final`) was on the Free plan. The org has since moved to **Pro**, which removed
  the gate: `password_hibp_enabled = true` was set via the same scoped Management API PATCH
  (`/v1/projects/vputdomdlknvthnzritt/config/auth`, HTTP 200) and verified live — a breached
  password now hard-fails `signUp` with HTTP 422, `error_code: 'weak_password'`,
  `reasons: ['pwned']`; a strong password still succeeds. The `auth_leaked_password_protection`
  security-advisor lint is gone, and **the project's security advisor list is now completely
  empty (zero findings)**.
  - **`lib/hibp.ts` is deliberately KEPT (Ian's call), not deleted, now that the server enforces
    the real rule.** Its role changed: it is no longer the enforcement point, only (1) a fast,
    inline pre-check that gives instant feedback before the `signUp` round-trip, and (2)
    defense-in-depth if `password_hibp_enabled` is ever flipped off again (a billing lapse or a
    Dashboard toggle — the setting is Pro-plan-gated, so a downgrade silently disables it). It is
    unchanged from before: still client-side, still bypassable (a caller can talk to the
    Supabase Auth API directly and skip it), and still fails open on a HIBP timeout/outage — none
    of that is a coverage gap anymore, because the server backstops it.
  - **New `lib/auth-errors.ts`** — `mapAuthError`, extracted out of `(auth)/sign-in.tsx`'s catch
    block purely so this mapping gets real unit-test coverage (`lib/__tests__/auth-errors.test.ts`,
    8 tests, mutation-verified). It takes the raw caught `unknown`, not a message string, because
    telling the server's breach rejection apart from a plain too-short password needs
    supabase-js's typed `AuthWeakPasswordError.reasons` array — both throw the identical error
    class. **A GoTrue subtlety this depends on**: `reasons` accumulates rather than tagging one
    cause, so a password that is both too short and breached returns
    `['length', 'pwned']` (verified live with `"abc123"`). `mapAuthError` checks `length` before
    `pwned` so the more actionable message wins — a user is never told only "breached" and left
    never learning the 8-character rule.
  - **The daily canary now also watches the server-side setting, not just the client-side
    check** — see "Current — CI" below.
- **A discovery, not a config change**: the hosted Management API has **no field for a
  sign-in/sign-up rate limit** — `[auth.rate_limit].sign_in_sign_ups` in `config.toml` is a
  CLI/self-hosted-`supabase start`-only setting with no hosted equivalent; a PATCH attempt was
  silently accepted (HTTP 200) but never took effect, confirmed by a re-GET. CAPTCHA
  (`auth.captcha`, still disabled) is therefore the only real anti-farming lever available on
  this plan — tracked as blocking M4 going live in `docs/status.md` Known Issue #12, not
  something more config-file tuning can fix.
- **Local-stack-only settings that mean nothing for this hosted project**: everything else in
  `config.toml` outside the `[auth]` block (`[db]`, `[storage]`, `[api]`, etc.) governs a local
  `supabase start` stack only, present because `supabase init` generates the full default file —
  not evidence of any corresponding hosted configuration.
