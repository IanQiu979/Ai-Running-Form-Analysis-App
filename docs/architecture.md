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
Still absent: `supabase/functions/analyze-form` and `purchase-tier`/`quota-status`,
`lib/subscription.ts`, and the result/paywall/settings/history routes. **One edge function now
exists**: `supabase/functions/analysis/index.ts` (issue #57, 2026-07-12) — `DELETE
/functions/v1/analysis/:id`, the first `Deno.serve` entrypoint in the repo. Written and
Deno-tested on `fix/57` only; **not deployed**, no migration applied. See "Current — `DELETE
/functions/v1/analysis/:id` (issue #57)" below. `supabase/functions/_shared/pace.ts` now exists
(#43; moved here from `lib/pace.ts` by #90, 2026-07-12, which settled the Deno bundling
mechanism) — the shared PACE types, result shape, and structural validator, imported by the app
(via the new `@shared/*` tsconfig alias) and, once it exists, the edge functions.

**Correction, issue #36 (2026-07-12):** the paragraph above previously listed `lib/frames.ts` as
absent — stale since issue #34 (merged before #36 started), which is when it actually landed.
`lib/frames.ts` and its route consumers are both current now; see "Current — capture screens
(issue #36)" below.
Still absent: `supabase/functions/analyze-form` and `purchase-tier`/`quota-status`, `lib/
subscription.ts`, and every route beyond sign-in, empty Home, and Analyzing (capture, result,
paywall, settings, history). **One edge function now exists**: `supabase/functions/analysis/
Still absent: `supabase/functions/analyze-form` and `purchase-tier`, `lib/
frames.ts`, `lib/subscription.ts`, and every route beyond sign-in + empty Home (capture, result,
paywall, settings, history). **Two edge functions now exist**: `supabase/functions/analysis/
index.ts` (issue #57, 2026-07-12) — `DELETE /functions/v1/analysis/:id`, the first
`Deno.serve` entrypoint in the repo — and `supabase/functions/quota-status/index.ts` (issue #50,
2026-07-12) — `GET /functions/v1/quota-status`, the server-authoritative read #54 (Home's quota
display) must be wired to. Both written and Deno-tested on their own branches only (`fix/57`,
`fix/50`); **neither is deployed**. #50's function additionally depends on a new DB function,
`pace_quota_status`, whose migration is written but **not applied** to any database. See
"Current — `DELETE /functions/v1/analysis/:id` (issue #57)" and "Current — `GET
/functions/v1/quota-status` (issue #50)" below.
`supabase/functions/_shared/pace.ts` now exists (#43; moved here from `lib/pace.ts` by #90,
2026-07-12, which settled the Deno bundling mechanism) — the shared PACE types, result shape,
and structural validator, imported by the app (via the new `@shared/*` tsconfig alias) and,
once it exists, the edge functions. `lib/frames.ts` (issue #34, 2026-07-12) also now exists —
client-side frame extraction/downscaling/budget-check; see "`lib/` layout" below. **The
Analyzing screen now exists too** (`app/analyzing.tsx`, issue #80, 2026-07-12) — Screen 6, built
entirely against `analyze-form`'s documented contract via an injectable client seam
(`lib/analyze-form.ts`), since `analyze-form` itself (#44) is still not built. See "Current — the
Analyzing screen (issue #80)" below.

## Route tree — current (M1) vs planned

**As of 2026-07-13, every route below is current — nothing in this app's route tree is still
"planned".** This table previously listed `(tabs)/history`, `paywall`, `capture/`, and `result/
[id]` inconsistently (some rows current, some duplicated as "planned" further down) as different
issues landed piecemeal; consolidated here into one accurate list rather than left contradicting
itself.

```
app/
  (auth)/sign-in           # current — sign-up folds into the same screen, no separate route
  (auth)/reset-password    # current (issue #81, 2026-07-13) — request a password-reset email;
                          # see "Current — password reset" below
  (auth)/update-password   # current (issue #81, 2026-07-13) — consumes the emailed recovery
                          # link's session, sets a new password; see "Current — password reset"
  (tabs)/index             # current — Home / Analyze
  (tabs)/history           # current (issue #55, 2026-07-13) — Past Analyses list + delete; see
                          # "Current — Past Analyses" below. Second Tabs.Screen alongside Home
                          # (`app/(tabs)/_layout.tsx`).
  capture/                  # current (issue #36) — source picker, in-app record, frame
                          # extraction; see "Current — capture screens (issue #36)" below
  analyzing                 # current (issue #80, 2026-07-12) — Screen 6, the analyze-form wait
                          # screen; top-level route (not nested under (tabs)/capture), guarded
                          # the same as (tabs). See "Current — the Analyzing screen" below.
  result/[id]                # current (issue #56) — the PACE readout. `app/analyzing.tsx`
                          # navigates to `result/[id]` (singular, matching this table);
                          # docs/design/motion-consult.md's nav-param example was corrected to
                          # match (docs/status.md Known Issue #20, resolved).
  settings                   # current (issue #53) — top-level pushed route, not a tab; see
                          # "Current — the Settings screen" below.
  paywall                     # current (issue #52, 2026-07-13) — the M5 dummy paywall; see
                          # "Current — app/paywall.tsx" below. Declared inside app/_layout.tsx's
                          # signed-in Stack.Protected block — it was reachable, unguarded, via
                          # file-based routing the moment it landed on disk; that declaration is
                          # what actually puts it behind the session.
```

**Not built**: the Elite `compare` screen (design brief Screen 9). `history.compare.*` copy exists
in the deck but is deliberately excluded from `constants/copy.ts` — see "Current — Past Analyses"
below.

## `lib/` layout — current (M1) vs planned

```
lib/
  supabase.ts             # current — the Supabase client; see "Current — auth flow" below
  database.types.ts       # current (issue #32, 2026-07-13) — generated `Database` type from the
                          # live schema; passed to `createClient<Database>` in supabase.ts. See
                          # "Current — typed Supabase client" below.
  functions-client.ts     # current (issue #46, 2026-07-13) — shared `invokeFunction()` wrapper
                          # around `supabase.functions.invoke()`; every lib/*.ts edge-function
                          # caller should use this instead of calling `.invoke()` directly. See
                          # "Planned — API"'s Error contract below.
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
                          # `reasons` accumulation subtlety this depends on. Also hosts
                          # `validateSignInForm` (issue #17, 2026-07-13) — the purely
                          # client-side, pre-network form check, kept in this module so its output
                          # can never accidentally converge with a real server-error string from
                          # `mapAuthError`.
  consent.ts               # current (issue #68) — hasConsented/grantConsent/withdrawConsent
                          # against public.consents; fails closed (throws) on any query error
                          # rather than defaulting either way — see "Current — consent record &
                          # disclaimer" below. `analyze-form` (M4) must run the equivalent check
                          # server-side; the client call here is not the enforcement point.
  frames.ts               # current (issue #34) — extract and downscale N frames from a video
                          # (client-side). It does NOT upload: since #88, frames ride in the
                          # analyze-form request body as base64 and the edge function writes
                          # them to the bucket itself, after the model call.
  media-caps.ts            # current (issue #36) — MAX_CLIP_DURATION_MS (15s) /
                          # MAX_PRE_COMPRESS_BYTES (50MB) and checkMediaCaps(), the UX guardrails
                          # `docs/mvp-build-prompt.md` gate #5 asked for; distinct from
                          # PACE_MAX_REQUEST_BODY_BYTES above (that caps the post-extraction
                          # payload; this caps the source file before extraction runs at all).
  media-file-size.ts       # current (issue #36) — best-effort local file size via the SDK 54
                          # `expo-file-system` `File` class; feeds checkMediaCaps for a library
                          # pick (fileSize isn't always reported by the picker) and for
                          # app/capture/extracting.tsx's pre-flight re-check.
  permission-state.ts      # current (issue #36) — classifyPermission (checking/undetermined/
                          # denied/granted) and permissionRecoveryAction (request vs. Settings,
                          # via canAskAgain), shared by app/capture/index.tsx (photo library) and
                          # app/capture/record.tsx (camera) so both derive permission UI state
                          # from one tested function instead of two hand-rolled ones.
  parse-capture-params.ts  # current (issue #36) — parses app/capture/extracting.tsx's route
                          # params back into frames.ts's PaceMediaInput; malformed params (a
                          # missing uri, a non-numeric durationMs) become the same generic
                          # extraction-failed state as any other extraction error, never a crash.
  frames.ts               # current (issue #34, 2026-07-12) — extracts and downscales N frames
                          # from a photo/video (client-side). Does NOT upload: since #88, frames
                          # ride in the analyze-form request body as base64 and the edge function
                          # writes them to the bucket itself, after the model call. Exports
                          # PaceFrame/PaceFrameSet, consumed by lib/analyze-form.ts below.
  analyze-form.ts          # current (issue #80, 2026-07-12) — the analyze-form CLIENT seam:
                          # AnalyzeFormRequest/AnalyzeFormClient types matching the documented
                          # wire contract, toAnalyzeFormRequest() (flattens a PaceFrameSet into
                          # it), a dev-only mock client (analyze-form/#44 doesn't exist yet — the
                          # `analyzeFormClient` binding is the one line #44 swaps for the real
                          # implementation), and the one-shot pending-request mailbox
                          # app/analyzing.tsx reads from. See "Current — the Analyzing screen"
                          # below.
  analyzing-machine.ts     # current (issue #80, 2026-07-12) — the Analyzing screen's pure,
                          # unit-tested wait-state reducer + caption-pacing function; no I/O.
  # pace.ts is NOT here — moved to supabase/functions/_shared/pace.ts by issue #90 (2026-07-12),
  # the single source of truth for the app + edge function (no copy/codegen/symlink). The app
  # imports it via the `@shared/*` tsconfig alias (`@shared/pace`). See "Current — Deno
  # build/test contract, pace.ts location & knowledge bundling" below.
  subscription.ts         # current (issue #52, 2026-07-13) — GET /functions/v1/quota-status read
                          # + POST /functions/v1/purchase-tier dummy purchase for app/paywall.tsx.
                          # Cosmetic only; no tier/quota number is ever hardcoded here — every
                          # count/limit is read fresh off the quota-status response, locked by a
                          # regression test. See "Current — app/paywall.tsx" below.
  quota.ts                 # current (issues #54/#15, 2026-07-13) — the quota-status client for
                          # Home, replacing app/(tabs)/index.tsx's former hand-rolled
                          # subscriptions+analyses count query. Also holds Home's pure
                          # quota -> copy/CTA mapping. See "Current — Home quota (issues #54/
                          # #15)" below.
  history.ts               # current (issue #55, 2026-07-13) — Past Analyses list fetch, per-row
                          # interpretation, and short-TTL signed-URL frame-strip minting for
                          # app/(tabs)/history.tsx; mirrors lib/analysis-result.ts's split for the
                          # single-result screen. See "Current — Past Analyses" below.
  connectivity.ts           # current (issue #93, 2026-07-13) — useIsOffline() (live hook,
                          # components/offline-banner.tsx) and checkConnectivity() (one-shot
                          # pre-flight check, exported but NOT yet called by analyzing.tsx or
                          # capture/index.tsx — see "Current — connectivity" below).
  app-state.ts              # current (issues #10/#64, 2026-07-13) — the app's ONE AppState
                          # listener; re-arms Supabase's token refresh on foreground and exposes
                          # onAppForeground() as a pub/sub seam other modules subscribe to instead
                          # of registering a second native listener. See "Current — AppState &
                          # foreground reconciliation" below.
  use-announce.ts            # current (issue #11, 2026-07-13) — fires
                          # AccessibilityInfo.announceForAccessibility on iOS, the iOS-side
                          # complement to accessibilityLiveRegion="polite" (Android-only). See
                          # "Current — sign-in hierarchy & a11y" below.
  password-reset.ts          # current (issue #81, 2026-07-13) — requestPasswordReset() +
                          # updateRecoveryPassword() backing app/(auth)/reset-password.tsx and
                          # app/(auth)/update-password.tsx. See "Current — password reset" below.
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
- **Session storage is SecureStore-backed (issue #38, closes `docs/status.md` Known Issue #13).**
  `lib/secure-storage.ts`'s `LargeSecureStore` implements the "LargeSecureStore" pattern:
  SecureStore holds a random AES-256 key (64 hex chars, constant size — proven under the
  2048-byte SecureStore value limit regardless of session size), AsyncStorage holds the
  AES-CTR-encrypted session blob. **The key is created once per storage key and reused, not
  regenerated on every write** (hardened after review, same branch) — SecureStore and
  AsyncStorage are two stores that cannot be written atomically as a pair, and a fresh-key-per-
  write design turns every `setItem` into a two-store transaction a torn write (app killed,
  device out of storage) can interrupt, pairing a new key with an old blob or vice versa. With a
  stable key, only the very first write for a storage key still touches two stores; every write
  after that touches only AsyncStorage. CTR-mode safety instead comes from a fresh random 16-byte
  IV generated per write and prepended to its ciphertext, and a per-storage-key async lock
  (`_getOrCreateKey`) closes the remaining race where two concurrent first-writes could each
  mint a different key. `getItem` also no longer trusts a decrypt just because it didn't throw —
  AES-CTR produces well-formed-looking garbage under a mismatched key/IV instead of erroring, so
  a `JSON.parse` validity check catches that case too; either way `getItem` clears the broken
  key+blob pair and calls `onSessionRestoreFailure` so `lib/session-provider.tsx` can surface
  `corruptedSessionError` (shown on the sign-in screen, `Copy.auth.error.generic` reused rather
  than inventing new copy) instead of the failure presenting as an unexplained, silent sign-out —
  the same bug class issue #5 fixed for the OAuth redirect path. `getItem` also transparently
  migrates any legacy plaintext session still sitting in AsyncStorage from before this change
  (detected by its leading `{`, since every ciphertext this class writes is pure hex) instead of
  returning null and forcing a silent sign-out. On web (`Platform.OS === 'web'`),
  `createSecureSessionStorage` falls back to plain AsyncStorage — `expo-secure-store` has no web
  implementation and `npm run web` must not crash; browsers have no Keychain/Keystore equivalent
  to move to regardless.
- **The web fallback itself is SSR/static-export-safe (issue #119, 2026-07-13).** `expo export
  --platform web`'s static rendering prerenders every route in Node, where `window` does not
  exist, but AsyncStorage's web implementation reaches for `window.localStorage` completely
  unguarded — and `supabase-js`'s `GoTrueClient` touches storage eagerly at construction, before
  any React effect runs, so `npm run web`'s prerender crashed with `ReferenceError: window is not
  defined` the instant `SessionProvider`'s module tree loaded. `createSecureSessionStorage` now
  takes an injectable `hasWindow` param (default `typeof window !== 'undefined'`, same pattern as
  the existing `platformOS` param) and returns a no-op storage — an honest "no session" answer,
  since a prerendered page genuinely cannot see the browser's localStorage — instead of bare
  AsyncStorage when there is no `window`. Once hydrated in an actual browser it returns the same
  real, localStorage-backed AsyncStorage as before.

## Current — typed Supabase client (issue #32, 2026-07-13)

`lib/database.types.ts` is generated from the live project (`supabase gen types typescript
--project-id vputdomdlknvthnzritt`, cross-checked against the Supabase MCP's
`generate_typescript_types` for the same project — identical for the public schema).
`lib/supabase.ts` passes it as `createClient<Database>(supabaseUrl, supabasePublishableKey,
{...})`, so every `.from(...)`/`.rpc(...)` call site across the app is checked against real
column/RPC shapes at compile time instead of resolving to `any`. Verified the generic is actually
active (not silently falling back to untyped) by temporarily probing a bad table name and a
malformed RPC arg list — both produced real `tsc` errors, then were reverted.

Every existing query call site (`app/(tabs)/index.tsx`, `app/settings.tsx`,
`app/result/[id].tsx`, `lib/consent.ts`) already type-checked clean with zero query-shape changes
needed. The one real edit: `app/result/[id].tsx` drops the `as AnalysisRow` cast it used to need,
now that the generated `analyses` Row type is structurally proven to match `AnalysisRow`'s
hand-written shape — `tsc` verifies that assertion on every build now, rather than the cast
trusting it blindly. No RPCs are called from the app client today (`reserve_analysis`/
`settle_analysis`/etc. are all service-role-only, called from edge functions), so no `.rpc()`
call site needed fixing here.

**Known drift, not touched (read-only against the live DB, out of scope for this issue):** two
functions defined in the repo's migrations — `pace_quota_status` (20260712233000) and
`pace_purchase_tier` (20260713120000) — are not yet pushed to the linked project (confirmed via
`list_migrations`) and so are absent from the generated types. Both are already deploy-gated with
header comments in their respective edge functions acknowledging exactly this.

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
itself landed 2026-07-12, issue #90** — see the next section. **The prompt that injects them
landed 2026-07-12, issue #41** — see "Current — the `analyze-form` prompt" below.

## Current — the `analyze-form` prompt (issue #41, done 2026-07-12)

`supabase/functions/_shared/analyze-form-prompt.ts` — the grounded system prompt, the tier
verbosity dial, and the structured-output contract. M4's blocker: #44 (the edge function) and #45
(validation/fallback) both build on it. **Pure and injectable** — no `Deno` global, no `fetch`, no
env var, and it never calls Anthropic; it turns `(tier, media, frames)` into a request body, so the
part most likely to change (prompt wording) is testable with zero network and zero API spend. Same
pure/client split as `ai-guard.ts`. 28 Deno tests.

- **Grounded, provably.** The three certified files are injected verbatim from
  `knowledge.generated.ts` (#90) — never inlined, never paraphrased. Importing that module runs
  `assertNonEmptyKnowledge()` at load, so an empty bundle fails the suite before an assertion runs;
  a test then asserts each file appears in the assembled prompt **byte-for-byte** (an anchor-phrase
  check would miss a truncation bug).
- **The tier dial is one parameter on one prompt** (`TIER_VERBOSITY`), never a second prompt or a
  second call. It is *structurally* incapable of buying certainty: the not-assessed rules, the
  medical boundary, the #112 timestamp rules, and the input-channel rules are assembled **outside**
  the dial (`INVARIANT_RULES`) and are byte-identical for Free, Pro, and Elite. A test asserts every
  certainty rule appears at all three tiers. Higher tier ⇒ more words, never more confidence.
- **Issue #112 is handled at the prompt layer.** Timestamps are typed and named
  `requestedTimestampMs`, every rendered time carries `~`/"requested", every interval is
  "approximately … (NOT an exact interval)", and the model is told the error bar (hundreds of ms,
  Android keyframe snapping). Precise SPM / GCT-in-ms / VO-in-cm figures are **forbidden at every
  tier including Elite**. The escape hatch that keeps the product useful: Cadence and Elasticity are
  steered onto **timestamp-independent** evidence — the overstriding signature and the visible
  quality of the landing, which `pace_framework.md` already calls the most important thing you can
  see, and which need no clock.
- **`pace_framework.md`'s two timing clauses are amended at the prompt layer, not edited** (#112,
  the same mechanism as the note-conditional clauses below). The certified file — which ships
  byte-for-byte and is not editable without Ian's certification review — says *"**Only if frame
  timestamps are known** may you estimate a cadence *range*"* and *"Across evenly-spaced frames you
  can estimate … vertical bounce"*. A model reading the frame manifest would score the first as
  **satisfied** (timestamps are visibly there) and the second as **true** (the requested times look
  evenly spaced); neither holds. So `TIMESTAMP_RULES` quotes both clauses back and re-reads them:
  *"known"* ⇒ **"known approximately"** (licensing a wide, labelled range — never a point figure),
  and *"evenly-spaced"* ⇒ **"not reliably evenly spaced"** (torso height *change* between frames is
  still visible evidence; its *rate* is not). The amendment can only ever **tighten** — it licenses
  nothing the certified file forbids — and the test suite asserts both quoted clauses still exist
  in the shipped bundle byte-for-byte, so a future re-certification that rewords them fails the
  build instead of leaving an amendment aimed at a sentence that no longer exists.
- **The uncertainty must reach the runner, not just the model.** Any Cadence/Elasticity judgement
  that leans on the frame timing has to carry the hedge into the user-visible `feedback` ("roughly
  160–170 SPM — approximate, estimated from frames whose timing is not exact"). The runner sees
  only `score`, `band`, and `feedback`; a hedge the model keeps to itself is not a hedge.
- **The note-conditional certified guidance is neutralised at the prompt layer**, not by editing
  certified text (that needs Ian's review — #39/#40). No note field ships (Known Issue #10), so the
  prompt states plainly that there is no runner's note, no history, no reported symptoms, and that
  every note-conditional clause in the certified files is therefore inactive — otherwise a model
  trying to satisfy them can invent what the runner "reported".
- **The disclaimer is not model output, deliberately.** It ships as a static footer
  (`components/result-disclaimer.tsx`, #68) under **every** result, every tier — a stronger
  guarantee than asking a model to remember it, since a static footer cannot be omitted, reworded,
  or hallucinated. The model's half is the *boundary* (never diagnose, never name a condition, never
  prescribe treatment), which is unconditional at every tier, plus an explicit instruction **not** to
  re-emit the disclaimer text (it would double-render). **Stop-running safety signals override the
  tier dial** and reach Free as prose in `feedback`, since Free's `flags` is always `[]`.
- **The output contract IS `PaceResult`.** `submit_pace_analysis`, `strict: true`, forced. A test
  round-trips schema-shaped responses (fully assessed, the photo case with Cadence/Elasticity `null`,
  and the all-null case) through `isPaceResult` — so #45 can never reject a perfectly obedient
  model. The schema encodes Anthropic's documented strict-mode limits (no `minimum`/`maximum` — the
  0–100 range lives in the description and is enforced at runtime by `isPaceResult`;
  `additionalProperties: false` everywhere; ≤16 `anyOf` unions), guarded by a test.
- **The band vocabulary is translated explicitly.** The certified rubric speaks in labels
  ("Solid"), `ScoreBand` speaks in codes (`'good'`). `SCORE_BAND_RUBRIC` maps them, and a test
  asserts every label it claims actually appears in `pace_framework.md`. Without this the model
  guesses, and a correctly-scored pillar renders in the wrong colour.
- **Thinking is ON (adaptive), effort is `medium`, and — as of 2026-07-13 (#44) — there is no
  `tool_choice` at all**: the output contract moved to structured outputs (`output_config.format`).
  The "unresolved forced-tool/thinking compatibility question" this bullet used to point at is
  RESOLVED and was based on a false premise — the restriction is **Amazon Bedrock only** and never
  applied to this project's first-party Claude API calls. See "Current — `analyze-form` edge
  function" at the end of this file for the correction and the mechanism that replaced it. #42
  sweeps `effort` via the exported `ANALYZE_FORM_EFFORT` constant.
- **The spend gate's INPUT estimate was corrected in the same change.**
  `SYSTEM_PROMPT_TOKENS_ESTIMATE` (`ai-pricing.ts`, #91) shipped at `6000` as an explicit
  placeholder for a prompt that did not exist ("refine once it exists"). Two things drive the real
  number: the assembled prompt is ~57k characters at Elite (system + user text + a ~13k-character
  tool schema, which `tools` bills as input), **and Claude Sonnet 5's new tokenizer produces ~30%
  more tokens for the same text** — so the familiar ~3.5–4 chars/token rule of thumb silently
  under-counts. At ~2.7 chars/token the Elite worst case is **~21.5k** tokens, so `6000` was
  under-reserving every call by ~3.5x — the wrong direction to be wrong in on an account with a
  hard ceiling and auto-reload off. Now `24000`, with a test that re-measures the assembled prompt
  at the Sonnet-5 ratio and fails if it outgrows the constant again. Still conservative: it prices
  all input as uncached even though the knowledge + tools prefix is `cache_control: ephemeral` (a
  0.1x read in steady state). #44 should pin it exactly with the free `count_tokens` endpoint
  before the first production call.
- **The OUTPUT reservation is sound, and thinking does not break it.** Thinking tokens bill as
  output, but `max_tokens` is a hard limit on thinking + response text *together*, and the request
  sends `max_tokens = MAX_OUTPUT_TOKENS_BY_TIER[tier]` — the exact number `estimateTokensForCall`
  reserves as `outputTokens`. So billed output ≤ reserved output, thinking included. A test asserts
  the two never drift apart, because that equality is the whole guarantee.

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

## Current — `npm run typecheck` self-generates typed routes (issue #118, 2026-07-13)

`app.json`'s `experiments.typedRoutes: true` makes expo-router generate the gitignored
`.expo/types/router.d.ts` — the file `tsc` needs to know which route strings (e.g.
`router.push('/capture')`) are valid — but it was previously produced only by a *running* Metro
dev/watch server (`npx expo start`); `npx expo export` doesn't touch it, and nothing in
`typecheck`/`lint`/`test` generated it either. A fresh clone or CI checkout with no `.expo/`
directory either silently disabled route type-checking (file absent → permissive fallback) or
failed on stale route unions left over from whichever dev-server session last happened to run —
exactly what happened merging issues #113–#117.

Fixed with a new `"generate:routes": "expo customize tsconfig.json"` script — `npx expo
customize tsconfig.json` is Expo's own non-interactive codegen entry point for this file (the
`@expo/cli` `customize` command's tsconfig.json target calls the same typed-routes generator a
dev server would, without booting Metro or a device/watch server; verified to write
`.expo/types/router.d.ts`/`expo-env.d.ts` byte-for-byte identical to what `expo start` produces,
and to leave the committed `tsconfig.json` itself untouched). `"typecheck"` is now `"npm run
generate:routes && tsc --noEmit && npm run typecheck:edge"`, so `npm run typecheck` is
self-sufficient on a checkout with no `.expo/` directory — verified with `rm -rf .expo && npm run
typecheck`. `.github/workflows/ci.yml` (issue #82, below) deliberately does not duplicate this
step — it relies on `npm run typecheck` to generate its own routes, so there is only one place to
change the mechanism.

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
  values, spacing/radii/type scales, and the score-band palette, with an 83-assertion Jest test
  (`constants/__tests__/theme-contrast.test.ts`) proving every text/surface and band pair clears
  WCAG AA. Font families (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`) installed via
  `npx expo install`; `expo-font` added to `app.json`'s plugins.
- **`Colors[scheme].control.border`, a new interactive-boundary role (issue #96, 2026-07-13).**
  Every non-accent button/input/checkbox previously relied on `hairline` (~1.22–1.49:1 across
  surfaces) as its only visible edge, below the 3:1 floor WCAG 1.4.11 sets for a UI-component
  boundary. `control.border` is the same hue/saturation family as `hairline`, with lightness
  moved until it clears 3:1 against every surface in both schemes (3.06–3.64:1) — a genuinely new
  role, not a re-tune of the decorative `hairline` rule, which is unchanged and still deliberately
  below 3:1 (rules/ticks/annotations, not a control boundary). Applied to
  `components/consent-gate.tsx`'s checkbox border and `app/(auth)/sign-in.tsx`'s secondary/email
  buttons and text input. `theme-contrast.test.ts` gained a regression guard, not just new
  assertions: it asserts `hairline` itself stays below 3:1 (computed from the live export) and
  that `control.border !== hairline` per scheme, so the token can never silently collapse back
  into the rule it replaces — bringing the suite from 69 to 83 assertions.

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

## Current — CI (`hibp-canary.yml` added 2026-07-12; `ci.yml`, the commit gate, added 2026-07-13, issue #82)

The repo previously had **no CI at all**. `.github/workflows/hibp-canary.yml` is the first
workflow, and it is deliberately narrow: a **daily scheduled cron, not a PR gate** — a
live-network check required on every PR would make unrelated PRs flaky against a third party's
uptime.

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

**`.github/workflows/ci.yml` (issue #82, 2026-07-13) is the repo's first actual commit gate.**
Until it existed, `npm run typecheck && npm run lint && npm test` (CLAUDE.md's pre-commit rule)
was enforced by convention only — a PR that broke the build could merge exactly as easily as one
that didn't. Distinct from `hibp-canary.yml` above: this one runs on every `push`/`pull_request`
to `main`, not on a schedule.

- **Mirrors the project's own gate exactly**: `npm ci`, then typecheck → lint → test — cheapest
  static checks first, so a broken build fails in seconds rather than after a full Jest + Deno
  run. No build/EAS step (that's a separate, Apple-gated concern — `docs/blocked-on-apple.md`).
- **Node 24, Deno 2.9.2.** No `engines` field in `package.json` and no `.nvmrc`/`.node-version`
  to pin against, so Node 24 is kept identical to `hibp-canary.yml`'s own `setup-node` pin,
  deliberately, so the two workflows can't silently drift onto different runtimes. Deno is pinned
  to 2.9.2 to match the version installed locally (CLAUDE.md: `~/.local/bin/deno`) — there is no
  repo-committed Deno version file to defer to instead.
- **Does not generate `.expo/types/router.d.ts` itself.** `npm run typecheck` now does that on
  its own (issue #118, above), so this workflow deliberately does not duplicate the mechanism —
  there is only one place to change it.
- **`concurrency` cancels a superseded run** for the same ref (a fast follow-up push, or two
  pushes to the same PR racing each other) rather than letting both run to completion.
  **`permissions: contents: read`** only — the workflow never comments, labels, or writes
  anything back; widen deliberately if a future step needs more.
- **Provisions no dummy `.env`.** `expo lint` loads `.env` via `@expo/env`, and `.env` is
  gitignored so it never exists in CI; verified locally that `expo lint` and `npm test` both exit
  clean with no `.env`/`supabase/functions/.env` present, so no placeholder is provisioned — if
  either command ever starts failing on a missing env var, that's a genuine new dependency to fix
  at the source, not paper over here.

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

## Current — capture screens (issue #36, done 2026-07-12)

Design-brief screens 3-5: source picker, in-app record, and frame extraction. Built against
`lib/frames.ts` (#34, already merged) and the live #88 contract — no upload code anywhere in
this flow, since the client has no Storage write path.

```
app/capture/
  _layout.tsx   # nested Stack (index/record/extracting), headerShown: false — same mechanism as
                # (auth)/_layout.tsx and (tabs)/_layout.tsx. Registered as a third Stack.Screen
                # inside app/_layout.tsx's existing `guard={!!session}` Stack.Protected block,
                # sibling to (tabs) rather than nested under it (it's a full-screen record/pick
                # flow, not a tab) — the only route-tree edit this issue made.
  index.tsx     # Source picker (screen 3): Upload/Record cards, the photo-library permission
                # dance (soft-ask -> OS prompt -> denied, sourcePicker.permission.library.*), and
                # the Art. 9 consent gate (components/consent-gate.tsx, issue #68) — the copy
                # deck names this screen as where it "gates the Source Picker -> Capture/Upload
                # handoff", and this is the first host that ticks that box (M4/M5 were the other
                # two named candidates; still open there).
  record.tsx    # Capture (screen 4): expo-camera's CameraView, mode="video" + mute (audio is
                # never captured — app.json's expo-camera/expo-image-picker plugins already had
                # microphonePermission: false and recordAudioAndroid: false from M1; unchanged),
                # the side-on framing-guide overlay (components/framing-guide.tsx), and the
                # camera permission dance (capture.permission.camera.*). recordAsync's own
                # maxDuration (MAX_CLIP_DURATION_MS/1000) makes the 15s clip cap physically
                # unreachable to exceed by recording; recordAsync resolves with only `{ uri }` —
                # no duration — so this screen measures wall-clock elapsed time itself, which
                # both drives the live "{elapsed}s / 15s" counter and becomes the clip's
                # `durationMs` handed to Extracting.
  extracting.tsx # Extracting (screen 5, "Uploading / Extracting" in the deck): runs
                # lib/frames.ts's extractFrames with real onProgress-driven counts
                # (upload.step.extracting) against whatever the other two screens handed off via
                # router.push params. Tier is hardcoded to 'free' for frame-count purposes (a
                # comment at the call site explains why: lib/subscription.ts is M5, "Not
                # started", and frame count is display-only regardless per CLAUDE.md — Free's
                # cap, the smallest, is the only one this screen can pick without guessing at
                # something it has no way to confirm). Surfaces `FrameBudgetExceededError`
                # (`upload.error.budgetExceeded`, no Retry — the same input would fail again) and
                # a generic extraction failure (`upload.error.extractionFailed`, Retry + Back)
                # as distinct, real states, not a raw alert. On success: `upload.ready.*` (NEW
                # copy — see below) and "Done" back to Home.
```

**Where the frame set goes: nowhere yet, honestly.** `analyze-form` (M4, issue #44) and the
Analyzing wait screen it needs (issue #80) don't exist. The M2 gate this issue closes is "both
sources hand a valid, budget-compliant frame set to the analysis step on iOS" — this is
extraction's boundary, not the handoff itself. `extracting.tsx`'s success state is a genuine
stopping point (`upload.ready.*`, honest copy, not a placeholder implying more exists), not a
fake next screen invented to paper over the gap. M4 replaces that one branch; the extraction,
progress, and error handling above it should not need to change.

**Copy**: `constants/copy.ts` gained `sourcePicker.*`, `capture.*`, and `upload.*` (the last
reusing the deck's Screen 5 key prefix even though the screen only implements the
extraction half — see the #36 update note in `docs/design/copy-deck.md`'s Screen 5 section for
why `upload.step.uploading`/`upload.error.*`/`upload.offline.*` are specced but not built). Most
strings are lifted verbatim by key; a handful are genuinely new (`sourcePicker.error.*`,
`upload.error.budgetExceeded.*`, `upload.error.extractionFailed.*`, `upload.ready.*`) because the
scenarios they cover — a library-picked clip over the cap, a local extraction failure, the
no-next-screen-yet stopping point — were never specced. Each is marked "NEW key" at both its
`constants/copy.ts` definition and its mirrored row in `docs/design/copy-deck.md`, the same
convention issue #68 established for `consent.upload.checkbox`/`error.record`.

**Known gap this issue does not close**: Home's CTA (`app/(tabs)/index.tsx`) is still the M1
disabled stub — it does not navigate into `/capture`. Deliberately not touched here: it's a
different screen with its own in-flight M5/M7 work (issue #54's quota wiring, issue #15's
"disabled CTA with no explanation" bug), and this issue's scope is the capture/library screens
themselves, not cross-screen wiring into them. The capture flow is reachable today only via
direct navigation (`router.push('/capture')`, or during development, typing the route). Whoever
wires Home's CTA should route to `/capture`, not re-derive this flow.

**Framing guide**: `components/framing-guide.tsx` draws a faint running-stance figure (head,
torso, four limbs) plus a ground/level reference line from plain `View`s — no
`react-native-svg` (not installed) and no new illustration-library dependency, matching
`pace_framework.md`'s side-on/full-body/level/~10m/good-light requirement from brief §4.4. Purely
decorative: hidden from the accessibility tree (`accessibilityElementsHidden` +
`importantForAccessibility="no-hide-descendants"`) — the a11y-visible guidance is the sibling
`capture.overlay.tip` text.

**Tests**: screens are not unit-tested by convention (CLAUDE.md); the new `lib/` logic is —
`media-caps.test.ts`, `media-file-size.test.ts`, `permission-state.test.ts`, and
`parse-capture-params.test.ts`. `lib/frames.ts` itself already had `frames.test.ts` from #34;
issue #37 (open) covers extending that suite further (timestamp spacing, per-tier caps, size
budget), not this issue.
## Current — the Analyzing screen (issue #80, 2026-07-12)

Screen 6 — the wait screen shown while `analyze-form` is in flight (§4.6 of the design brief).
Built on `fix/80` before `analyze-form` (#44) or the result screen (#56) existed, entirely
against their documented contracts (this section and the two "Planned" sections right below it).

- **`lib/analyze-form.ts`** — the client seam. `AnalyzeFormRequest` mirrors the documented wire
  body exactly (`{ mediaType, frames: string[], timestamps: number[], idempotencyKey }`, not
  `PaceFrame[]`); `toAnalyzeFormRequest()` is the missing glue that flattens `lib/frames.ts`'s
  `PaceFrameSet` into it (nothing needed this before #80, since no caller of `extractFrames()`
  existed yet). `AnalyzeFormClient.submit()` resolves `{ ok: true, data }` for a 200 (a full
  result and an honest `isFallback: true` partial — issue #45 — are the SAME shape, never a
  different response type) or resolves `{ ok: false, error }` for a documented non-2xx; the real
  implementation (#44) is expected to produce that error shape via issue #46's shared `{ error,
  code }` unwrapper, which #80 does not build. The `analyzeFormClient` binding is currently a
  dev-only mock (`success`/`fallback`/`failed`/`timeout`/`thrown` outcomes) — the one line #44
  swaps for the real implementation. A one-shot module-level mailbox
  (`setPendingAnalyzeFormRequest`/`takePendingAnalyzeFormRequest`) hands the request from whatever
  builds the capture flow (#36) to the screen — not route params, since a request carries
  multi-megabyte base64 frame data, and not a state-management library.
- **`lib/analyzing-machine.ts`** — the screen's pure, unit-tested state machine:
  `waiting → succeeded | failed | timedOut`, with an attempt-counter staleness guard (a late
  event from an old attempt — e.g. a timeout that fires after a Retry already started a new
  attempt — is dropped, never applied) and `captionPhaseForElapsed`, a pure function of elapsed
  time implementing `docs/design/motion-consult.md`'s wait-state pacing (a fixed two-step list,
  each held ~400ms, then a ~1.75s dwell before the honesty-threshold "Still analyzing" line fades
  in once).
- **`app/analyzing.tsx`** — a top-level route (registered in `app/_layout.tsx`'s signed-in
  `Stack.Protected` group, not nested under `(tabs)` or `capture/`). Client-side timeout
  (`ANALYZING_TIMEOUT_MS`, 120s) does NOT cancel the underlying `submit()` call — the server
  settles the analysis and releases/keeps quota regardless of whether this screen is still
  listening (see "Backgrounding recovery" below) — and Retry always resubmits the SAME
  `AnalyzeFormRequest` (same `idempotencyKey`), never minting a new one, so a timeout followed by
  Retry can never double-run the model or double-burn quota. A success and an honest
  `isFallback: true` partial both navigate to `/result/[id]` (with `justAnalyzed: '1'`, per
  `docs/design/motion-consult.md` item 3) — never to a failure state.
- **Explicitly out of scope, by design**: issue #64's full backgrounding-recovery flow (this
  screen only avoids assuming a promise survives backgrounding — see `lib/analyzing-machine.ts`'s
  header comment — it does not implement the "Your analysis finished — see Past Analyses" toast),
  and issue #61's full motion/reduced-motion spec (this screen implements only what
  `motion-consult.md` already pins down for the wait state, which that doc marks EXEMPT from
  reduced-motion suppression).
- **Copy**: `Copy.analyzing.*` in `constants/copy.ts`, lifted verbatim from
  `docs/design/copy-deck.md` Screen 6. No `Copy.shared` namespace exists in this codebase (Home
  and `<ConsentGate />` each independently duplicated "Retry"/"Cancel" under their own keys before
  this issue too); `Copy.analyzing.error.cta.*` follows that same precedent rather than
  introducing one.

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
6. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames with the timestamps
   the client **requested** from the extractor. **These are NOT the actual decoded times** —
   `expo-video-thumbnails` cannot report those on either platform (Android snaps to the nearest
   keyframe and exposes no PTS; iOS discards `AVAssetImageGenerator`'s `actualTime`), so the real
   intervals can differ by hundreds of ms and are not necessarily evenly spaced (issue #112; this
   paragraph previously claimed the opposite). Cadence and Elasticity are both derived from motion
   over time, so the prompt (step 7) is required to present these intervals as approximate — see
   "Current — the `analyze-form` prompt" below. The frames ride in the request body as base64 and
   are **not** uploaded by the client — the server writes them to the bucket itself, after the
   model call (#88). Frame count per tier: Free 1 / Pro 5 / Elite 8.
7. **Build the grounded prompt** — **built, issue #41**: `supabase/functions/_shared/analyze-form-prompt.ts`.
   System message = the certified PACE knowledge (framework + injury flags + drills, bundled with
   the function, not fetched per call), then the image block(s) each labelled with their
   (approximate) timestamps, then the PACE scoring instruction last. Detail scales with tier via a
   verbosity dial on one prompt, not a different call — Free gets scores + one line per pillar and
   no drills; Pro gets fuller feedback, injury-risk flags, and drills; Elite gets the same analysis
   as Pro plus a small verbosity/depth bump (the Pro→Elite gap is intentionally tiny). The dial
   moves depth and **only** depth: the scoring, not-assessed, medical-boundary, and
   timestamp-approximation rules are assembled outside it and are identical at every tier.
8. **One vision call** — `claude-sonnet-5`, **adaptive thinking ON** (`thinking: {type:
   'adaptive'}`, set explicitly), `output_config: {effort: 'medium'}`, `max_tokens` 4–8k (from
   `MAX_OUTPUT_TOKENS_BY_TIER`, the same constant the spend gate reserved against), and a
   `strict: true` `submit_pace_analysis` tool returning structured JSON for the 4 PACE pillars,
   each scored with feedback, plus injury flags and (paid) drills. **The tool schema IS
   `PaceResult`** (`_shared/pace.ts`) — no second definition, no adapter.

   **Thinking is ON, and that is deliberate.** This is a multi-step vision-reasoning task over up
   to 8 frames against a 25KB rubric — the single call the whole product exists to make. Running it
   with thinking off would be a material quality regression. On `claude-sonnet-5` adaptive thinking
   is the default (omitting `thinking` does *not* mean off), and manual thinking
   (`{type: 'enabled', budget_tokens}`) is a 400; we set `{type: 'adaptive'}` explicitly so the
   intent is legible.

   **SUPERSEDED 2026-07-13 (#44) — this paragraph's premise was false.** It used to say that the
   docs state, "with no platform scoping", that a forced `tool_choice` is incompatible with
   thinking, that the Bedrock-only reading "could not be confirmed", and that `tool_choice: auto`
   was therefore the safe default. **The restriction IS Amazon Bedrock only** — the first-party
   Claude API (what this project calls) accepts a forced tool call alongside adaptive thinking. But
   the request no longer sends a tool at all: the output contract moved to **structured outputs**
   (`output_config.format` against `PACE_RESULT_SCHEMA`), which is a stronger guarantee, makes the
   platform question moot, and is cheaper. See "Current — `analyze-form` edge function" at the end
   of this file for the full correction, and `_shared/analyze-form-prompt.ts`'s header for the
   reasoning in code.

   **`max_tokens` is a hard limit on thinking + response text together**, so the gate's *output*
   reservation (`MAX_OUTPUT_TOKENS_BY_TIER`, the same number sent as `max_tokens`) remains a true
   upper bound on billed output even with thinking on. But the budget is tight, which is why
   `effort` is **`medium`**, not the default `high`: Anthropic names "drop to `medium` effort" as
   the direct remedy for a mostly-thinking, truncated answer, and Sonnet 5 at `medium` is
   comparable in intelligence to Sonnet 4.6 at `high`. **#44 must treat `stop_reason: 'max_tokens'`
   as a truncation**, never as a usable response.

   Also: this model **rejects any non-default `temperature`/`top_p`/`top_k` with a 400**, so the
   request sets none of them. Do not add `temperature: 0` for determinism — that buys a 400, not
   determinism. Determinism comes from `strict: true` (grammar-constrained sampling).
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
10. **Settle, then upload** — on a success or honest-partial, the function first marks the
    reservation delivered, persisting the result to `analyses` (`result` JSONB, `tier_at_run`,
    `frame_count`, `is_fallback`) with **no** `media_paths`. Only then does it upload the frames
    itself (service-role) to `{user_id}/{analysis_id}/frame-{NN}.jpg`, and record where they went
    via `attach_media_paths` — the second, and only other, writer of `media_paths`. This order
    (#130) establishes the invariant that **a `'reserved'` row can never have frames**: a row
    stranded by a killed invocation, or released by a refused settle, has nothing under its prefix,
    so `sweep_stale_reservations()` (#47) has nothing to purge and needs no Storage access.
    Everything after the settle is non-fatal — the analysis is already delivered and the quota
    already spent — so a frame that fails to upload, or an `attach_media_paths` that refuses, does
    **not** fail the request: it only shortens the Past Analyses frame strip. `media_paths` is the
    display list, never the deletion authority; purge walks the prefix. On a release path nothing
    is uploaded at all.

    **What this order does not fix.** A `'delivered'` row is *deletable* while frames are still
    uploading. If the attach lands after a delete marked the row, `attach_media_paths` refuses with
    `row_deleted`/`not_found` and the function purges the prefix it just wrote. But
    `deleteAnalysis` (#57) purges Storage *before* it marks the row, so an attach committing in the
    gap between those two steps still succeeds and nothing purges — those frames strand. Narrowed,
    not closed: see `docs/status.md` Known Issue #26 for the residual race and its known fix.

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
  Reachability comes from the row existing, not from `media_paths` being populated — since #130 the
  function settles *before* it uploads, so an invocation killed mid-upload leaves a `'delivered'`
  row with an empty or short `media_paths` and real objects under its prefix. `media_paths` is the
  frame-strip display list, not the deletion authority. #47/#57/#58 all inherit this rule.
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

Most of these edge functions do not exist yet — `supabase/functions/` has the `.env.example`
placeholder, the `_shared/ai-guard*.ts` spend-gate substrate (issue #91), and, as of 2026-07-12,
`_shared/delete-analysis*.ts` plus `analysis/index.ts` (issue #57) and `_shared/quota-status*.ts`
plus `quota-status/index.ts` (issue #50 — see "Current" below for both), but still no
`analyze-form/index.ts` or `purchase-tier/index.ts`. `analyze-form`'s core dependencies are
already live, though: the reserve/settle/release quota RPC family (live — see "Current — DB
schema" below) and the AI spend gate (live — see "Current — AI spend guardrails substrate" above)
are both applied and verified against the live database; only the edge function code that calls
them remains unbuilt. Also read the M1-review contract notes in `docs/status.md` Known Issue #14
before building it.

The client never talks to Postgres for privileged operations — those go through edge
functions. Plain reads of the caller's own rows go through the Supabase client, protected by
RLS.

| Method / Route | Auth | Body | Returns | Notes |
|---|---|---|---|---|
| `POST /functions/v1/analyze-form` | JWT | `{ mediaType: "photo"\|"video", frames: [base64...], timestamps: number[], idempotencyKey }` | `{ result, analysisId, isFallback }` or `402` over-quota / `403` anon | Core call. **No `mediaPaths`** — the client never names a storage path (#88). The server uploads the frames itself, after the model call, and derives their paths. Enforces tier + frame cap + atomic quota reserve, injects certified knowledge, validates, persists. Idempotent on `idempotencyKey`. |
| `POST /functions/v1/purchase-tier` | JWT + gate | `{ tier, source: "dummy" }` | `{ tier, periodStart, periodEnd }` or `404 not_found` (gate off) / `429 rate_limited` / `400 invalid_tier` / `invalid_source` | **Built, Deno-tested, not deployed (issue #51, 2026-07-13; hardened same day, PR #123)** — see "Current" below. **Gated behind `PURCHASE_TIER_DUMMY_ENABLED` (default OFF, must never be set in production secrets) — deploying without understanding the gate is a release blocker, `docs/status.md` Known Issue #23.** Same contract as V2.2; v2 swaps `source` to receipt verification (a non-`dummy` source is refused today). The only legitimate writer to `subscriptions`, via the service-role-only `pace_purchase_tier` RPC — no client-writable INSERT/UPDATE policy exists, and the default grant-all to `authenticated`/`anon` was revoked on both `subscriptions` and `profiles`. Idempotent: `purchased_at` (the period anchor) is written once on first purchase and never moved (no caller-suppliable `p_as_of` either), so a repurchase cannot reset the quota period. |
| `GET /functions/v1/quota-status` | JWT | — | `{ tier, used, limit, remaining, frameCap, isLifetime, periodStart, periodEnd, blocked, blockedReason, blockedUntil }` | **Built, Deno-tested, not deployed (issue #50, 2026-07-12)** — see "Current" below. Drives Home "7 of 10 left" (Pro/Elite, period-based) or "1 of 1 used, lifetime" (Free). `used`/`limit` computed server-side via a new read-only RPC, `pace_quota_status`, that shares `reserve_analysis`'s own `pace_current_period`/`pace_is_farming_signal` calls — never a client counter. `blocked`/`blockedReason`/`blockedUntil` represent issue #6's anti-farm cap as a state independent of quota: a user can have `remaining > 0` and `blocked: true` at the same time. |
| `DELETE /functions/v1/analysis/:id` | JWT | — | `{ deleted: true, alreadyDeleted: boolean }` (also `{ deleted: true, orphansRemaining: true }`, issue #132) or `404 not_found` / `403 not_yours` / `503 purge_failed` | **Built, Deno-tested, and DEPLOYED** (issue #57, 2026-07-12; confirmed live during this batch's 2026-07-13 verification — every earlier "not deployed" note about this function elsewhere in this doc and in `docs/status.md` was stale and is being corrected). Purges the Storage prefix first, then soft-deletes the row (never the reverse — a purge failure must never look like a successful delete); idempotent, always re-attempts the purge regardless of the row's current `deleted_at`. **Issue #132's second-purge/`orphans_remaining` behavior (below) is new code in this same batch and has NOT itself been confirmed redeployed** — the confirmed-live fact above is that some version of this function is deployed; whether it's the pre- or post-#132 code needs a fresh `supabase functions deploy analysis` check, not assumed from this note. |
| `POST /functions/v1/delete-account` | JWT | — | `200 { deleted: true, purgedObjectCount, consentEventsPurged }` (also `200` with `orphansRemaining: true` added — see below) or `503 { error, code }` for `purge_failed` / `rows_failed` / `auth_delete_failed` | **Built, Deno-tested, not deployed (issue #58, 2026-07-13; response contract fixed post-review, same date)** — see "Current" below. Ported from Echo V1's `delete-user/`, because `storage.objects` has no FK to `auth.users` and would otherwise orphan every object. Delete order: storage objects → rows → auth user. No id anywhere in the request: the only account it can delete is the JWT-verified caller's own. **`orphans_remaining` is a `200`, not an error** — by the time it fires, the account is already fully deleted, so there is nothing a non-2xx retry could fix; see "Current" below for the full status/body matrix. |

**Error contract**: every non-2xx response body is structured `{ error, code }`.
`supabase.functions.invoke()` wraps non-2xx responses in a generic `FunctionsHttpError` whose
body is only reachable via `await error.context.json()` — **`lib/functions-client.ts`'s
`invokeFunction<T>()` (issue #46, 2026-07-13) is the one shared wrapper that does this unwrap**,
rather than each call site re-parsing it. It resolves to a discriminated result —
`{ ok: true, data: T }` or `{ ok: false, error }`, where `error.kind` is `'http'` (a parsed
`{ error, code }` body — `code` typed only as `string`; narrowing it into a specific union per
endpoint is each call site's own job), `'network'` (`FunctionsRelayError`/`FunctionsFetchError` —
no server response was ever produced to read a body from), or `'malformed'` (an HTTP error whose
body didn't match the documented `{ error, code }` shape) — and it **never rejects**, so a caller
needs no `try`/`catch` around it. `lib/delete-account.ts` is the only real caller today.

Direct Supabase-client reads (RLS-guarded, `user_id = auth.uid()`): list own `analyses`; read
own `subscriptions`; read own frames from the private bucket via short-TTL signed URLs. Inserts
into `analyses` happen only inside `analyze-form`.

## Current — `DELETE /functions/v1/analysis/:id` (issue #57, 2026-07-12), closing issue #3

Built and Deno-tested on `fix/57`. **Confirmed DEPLOYED** during this batch's 2026-07-13
verification pass — every earlier note in this doc (and in `docs/status.md`) claiming this
function was "not deployed" was stale as of that check and has been corrected. No migration was
needed for the base function (see below); whether the specific #132 changes described at the end
of this section have been redeployed is a separate, unconfirmed question — see the API table's own
caveat.

**Purges Storage a SECOND time after the row is marked deleted (issue #132, 2026-07-13),
closing the delete-during-upload orphan window issue #130 narrowed but left open (`docs/status.md`
Known Issue #26).** `deleteAnalysis()` purges Storage first (A), then calls `markDeleted` (B) —
reversing that order is the privacy defect issue #3 exists to prevent. Since #130 settles a row
before its frames finish uploading, an `attach_media_paths` call that commits in the gap between A
and B still sees `deleted_at is null` at that instant and succeeds, so `safeAttachFrames`
correctly does not purge on its own — then B commits, the redact trigger wipes `media_paths` back
to `'{}'`, and any frame written in that gap is stranded under a prefix whose purge already ran and
reported empty. `deleteAnalysis()` now re-runs the same, unmodified `purgePrefix()` immediately
after `markDeleted` actually performs the transition (`updated === true` only — a retry against an
already-deleted row skips this, since there is no fresh gap to close). A non-empty second purge (a
real orphan caught) and a failed second purge are each logged via a new injectable `LogEvent` sink
(`analysis/index.ts` now wires a real `console.log`-based sink instead of the default no-op) —
`delete_analysis.second_purge_caught_orphan` (`warn`) and `delete_analysis.second_purge_failed`
(`error`) respectively. A failed second purge cannot be reported as `purge_failed` (503,
retryable) — the row is already, unambiguously deleted by that point, so there is nothing left to
retry — so it is instead reported as the new `orphans_remaining` outcome: `200`,
`{ deleted: true, orphansRemaining: true }`, mirroring `delete-account.ts`'s outcome of the same
name and shape (see "Current — `POST /functions/v1/delete-account`" below). This narrows, but does
not close, `docs/status.md` Known Issue #19 (the client's direct soft-delete UPDATE policy bypassing
this endpoint entirely) — a different door onto the same orphan class.

```
supabase/functions/
  analysis/index.ts                       # Deno.serve entrypoint — the first in the repo.
                                           # Method + id validation, JWT verification via
                                           # auth.getUser(), wires the two files below, maps the
                                           # outcome to the documented HTTP status/body.
  _shared/delete-analysis.ts               # pure, injectable orchestration — no npm:/Deno-only
                                           # import, same portability discipline as ai-guard.ts.
                                           # deleteAnalysis(), the purge/verify/mark-deleted flow,
                                           # and the HTTP-mapping + URL/UUID parsing helpers.
  _shared/delete-analysis-client.ts        # the real service-role Supabase/Storage client,
                                           # untested (nothing pure in a thin Deno/npm: factory),
                                           # same split as ai-guard.ts / ai-guard-client.ts.
  _shared/__tests__/delete-analysis.deno.test.ts   # 19 Deno tests
```

**No schema change was needed.** Verified live via the Supabase MCP before writing any code:
`service_role` holds unrestricted table-level grants on both `public.analyses` and
`storage.objects` (confirmed via `information_schema.role_table_grants`/`role_column_grants`,
bypassing RLS entirely), so the function reads/writes the row and lists/removes Storage objects
directly through a service-role client — no new RPC, no migration. `reserve_analysis`,
`settle_analysis`, and `release_analysis` are untouched, per this issue's own hard constraint.

**Ordering, binding**: purge the Storage prefix first, verify it is actually empty by re-listing
it, and only then mark the row `deleted_at` (a soft-delete — the row is never hard-deleted, so
`reserve_analysis`'s counting, untouched by this or #2, keeps working exactly as before). If the
row were marked first and the purge then failed, the analysis would disappear from the user's
view while its frames — images of a person's body — kept existing in the bucket, which is issue
#3 itself, reached through a different door. Purging first means a failure leaves the row
untouched and returns `503 purge_failed` (safe to retry, never the caller's fault), not a false
`{ deleted: true }`.

**Purge is idempotent and unconditional**: `deleteAnalysis()` always attempts the purge,
regardless of the row's current `deleted_at`. Two reasons: (1) a retried DELETE call converges
instead of erroring — re-listing an already-empty prefix is a cheap no-op; (2) `public.analyses`
still carries #2's client-facing soft-delete UPDATE policy, a real path that does not purge
Storage — if the client's UI ever does route that same analysis through this endpoint after a
direct soft-delete, the purge still runs and cleans up the orphan. **This narrows but does not
fully close that gap** — nothing forces a client to call this endpoint at all. See
`docs/status.md` Known Issue #19 for the residual risk and the two follow-up fixes that would
close it (a reconciliation job, or an async trigger-driven purge), neither built here.

**Authorization is explicit code, not RLS**: the service-role lookup has no ownership filter by
construction (service-role bypasses RLS), so `row.user_id !== callerUserId` is checked directly
in `deleteAnalysis()` and proven by a test asserting Storage is never even listed for an id that
isn't the caller's. The Storage prefix is always rooted at the caller's own id (`{callerUserId}/
{analysisId}/`), never the row's, so a wrong or foreign id can only ever probe an empty prefix
under the caller's own namespace — no cross-user object deletion is reachable regardless of the
ownership check.

**The nested-prefix trap, closed**: `docs/privacy-checklist-m7.md` names the exact failure a
naive port of Echo V1's flat `storage.list(user_id)` would reproduce here (removes nothing,
orphans every frame, reports success). `collectFiles()` recurses into any entry Storage reports
as a pseudo-directory (`id: null`) and paginates each level, proven by tests covering a nested
folder and a multi-page listing.

**Verification run**: `npm run typecheck && npm run lint && npm test` clean.

## Current — `GET /functions/v1/quota-status` (issue #50, 2026-07-12)

Built and Deno-tested on `fix/50`. **Not deployed** — `supabase functions deploy` was never run.
The DB function it depends on, `pace_quota_status`, has a written migration
(`20260712233000_quota_status_function.sql`) that is **not applied** to any database, live or
otherwise — this section describes what exists in the repo, not live behavior. Calling this
function against the live project today returns `500 quota_status_unavailable` (the RPC does not
exist yet), by design of the endpoint's own error handling, not a bug.

```
supabase/functions/
  quota-status/index.ts                    # Deno.serve entrypoint. Method + JWT verification via
                                            # auth.getUser() (same pattern as analysis/index.ts),
                                            # wires the two files below, maps the outcome to the
                                            # documented HTTP status/body.
  _shared/quota-status.ts                  # pure, injectable orchestration — no npm:/Deno-only
                                            # import. getQuotaStatus(), the RPC-response shaping,
                                            # and the HTTP-mapping helpers.
  _shared/quota-status-client.ts           # the real service-role Supabase client, untested
                                            # (nothing pure in a thin Deno/npm: factory), same
                                            # split as ai-guard.ts / ai-guard-client.ts.
  _shared/__tests__/quota-status.deno.test.ts   # 18 Deno tests
supabase/migrations/
  20260712233000_quota_status_function.sql # WRITTEN, NOT APPLIED — see its own header.
```

**Why this needed a new migration, unlike #57.** #57 found `service_role` already held enough
table-level privilege on `analyses`/`storage.objects` to skip a migration entirely. Quota
counting is different: it must agree with `reserve_analysis`'s tier-derivation, period-windowing,
and anti-farm-classification rules exactly, and issue #50's own brief forbids touching
`reserve_analysis`/`settle_analysis`/`release_analysis` to share that logic directly. The
resolution is a new, read-only, side-effect-free SQL function, `pace_quota_status(p_user_id,
p_as_of)` — SECURITY DEFINER, `STABLE`, pinned `search_path`, `EXECUTE` revoked from
`public`/`anon`/`authenticated` and granted only to `service_role`, same privilege shape as the
rest of the quota RPC family. It calls the exact same `pace_current_period` and
`pace_is_farming_signal` functions `reserve_analysis` calls (verified live via
`pg_get_functiondef` against `vputdomdlknvthnzritt` immediately before writing both files), so
period-boundary math and farming-signal classification cannot drift between the two functions.
The one piece that could not be shared without editing `reserve_analysis`'s own body is its
literal tier -> limit/frame_cap `case` expression (free 1/1, pro 10/5, elite 30/8); that table is
duplicated in `pace_quota_status` with a loud comment pinning it to the live values captured the
same session, and flagged as a follow-up (factor it into its own `pace_tier_limits(tier)` helper,
the same move the anti-farm fix already made for the farming-signal check) that issue #50
deliberately left undone since it requires touching `reserve_analysis`'s body.

**Representing the anti-farm block honestly (issue #6).** `blocked`, `blockedReason`, and
`blockedUntil` are independent of `used`/`remaining` — a free or paid user can have quota
remaining and still be refused by the rolling-window (free, 24h) or period-window (pro/elite)
anti-farm cap `reserve_analysis` enforces as `too_many_failed_attempts`. `pace_quota_status`
computes `blockedUntil` itself (not tracked anywhere else in the schema, since
`reserve_analysis` only ever needs to know "is the count >= 3", never "when does it drop back
below 3"): for pro/elite it is exactly `period_end` (the same window reset that zeroes the count);
for free it is the 24h expiry of the oldest currently-counted farming-signal release, found by
ordering the counted rows oldest-first and offsetting to the one whose expiry brings the count
below 3.

**Test strategy, and its honest limit.** There is no live (or local) database this branch is
allowed to run `pace_quota_status` against — issue #50's hard constraint forbids applying its
migration anywhere from this worktree. `_shared/__tests__/quota-status.deno.test.ts` therefore
splits into two kinds of test: (1) RPC-response-shaping tests against an injected fake `RpcClient`
(same technique `delete-analysis.deno.test.ts` uses), covering free lifetime exhaustion, paid
period windowing, and — the case issue #50 called out by name — a user simultaneously
`remaining > 0` and `blocked: true`; (2) migration-text invariant tests that read the migration
file's own SQL and assert specific properties by name: the counting queries never filter on
`deleted_at` (proving a soft-deleted analysis keeps counting, matching `reserve_analysis`), the
tier -> limit table matches the literal string captured from the live `reserve_analysis`, the
function calls (not reimplements) `pace_current_period`/`pace_is_farming_signal`, and the
migration never `create or replace`s any of the three forbidden functions. This is weaker than a
real integration test — it proves the migration file says the right thing, not that Postgres
executes it as written — but it is the same honest ceiling `analyses_quota_soft_delete.test.ts`
already operates under in this repo (see that file's own header) for the identical reason: no
Docker/local Postgres available to this sandbox, and no non-production project to push a real
migration to. Whoever applies this migration should re-verify `pace_quota_status`'s output
against a real `reserve_analysis` call for the same user, once both are live.

**Verification run**: `npm run typecheck && npm run lint && npm test` clean (47 Deno tests
total across all suites, including this one's 18; 309 Jest tests).

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
  empty `media_paths`, which `attach_media_paths` fills in after the upload, which in turn happens
  after the settle as of #130). Serializes concurrent
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
  a `'reserved'` row `'delivered'` with its result (5 args as of #88 — every path must sit under
  the row's own `{p_user_id}/{p_analysis_id}/` namespace, or the whole call is rejected with
  `invalid_media_path`); guarded to only affect a still-`'reserved'` row, so a duplicate/late call
  is a safe no-op rather than overwriting an already-delivered result. **As of #130 `analyze-form`
  calls this with four args**: the frames have not been uploaded yet, so there are no paths to pass
  and `p_media_paths` takes its `'{}'` default. The parameter itself is unchanged — nothing was
  migrated away — and the paths arrive afterwards via `attach_media_paths`.
- **`attach_media_paths(p_user_id, p_analysis_id, p_media_paths)`** (issue #130,
  `20260713140000_attach_media_paths.sql` — **written, NOT applied**) — records the frame paths that
  actually landed, on an already-`'delivered'` row. The second, and only other, writer of
  `media_paths`, so it carries the same namespace guard `settle_analysis` does, plus `status =
  'delivered' and deleted_at is null` (a soft-deleted row must never be silently un-redacted with
  live pointers into the private bucket) and write-once (`cardinality(media_paths) = 0`). Guards live
  in the UPDATE's WHERE clause, not in a check-then-write. It **returns** its refusals rather than
  raising — `invalid_media_path`, `not_found`, `row_deleted`, `not_delivered`, `already_attached` —
  because its caller runs after the analysis is already delivered and charged, and the four are kept
  distinct because two of them (`not_found`, `row_deleted`) mean the caller must purge the frames it
  just uploaded and one (`already_attached`) means it must not.
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

**Planned — the soft-delete UPDATE grant/policy above is itself being removed (issue #6's
follow-up, migration written 2026-07-12, NOT yet applied).** #57's agent, building the
server-side `DELETE /functions/v1/analysis/:id` edge function in a sibling worktree, found that
#2's client-facing soft-delete path is now a bypass around that endpoint: a client can PATCH
`deleted_at` directly, which fires the redaction trigger (wiping `media_paths`) without ever
purging the Storage objects it named — issue #3 (deleted media never actually purged)
reintroduced through the door #2 opened, exactly what CLAUDE.md forbids. Not exploited today (0
`analyses` rows live, and a repo-wide grep of `app/`/`lib`/`components/` found no client code that
writes `deleted_at`).
`supabase/migrations/20260712230000_analyses_client_delete_removed.sql` revokes `authenticated`'s
`update (deleted_at)` grant and drops the soft-delete policy; the `deleted_at` column, the
redaction trigger, and the three quota RPCs are untouched — `service_role` (which the future
delete edge function runs as) holds its own separate, unrevoked grant set and bypasses RLS
regardless, so it is unaffected. Once applied, the **resulting matrix on `public.analyses`** is:
`anon` — nothing; `authenticated` — `SELECT` only, table-level, one policy ("Users can view their
own analyses"), no INSERT/UPDATE/DELETE/TRUNCATE at all; `service_role` — unchanged, full access.
Delete becomes exclusively server-side. This migration is independent of and composes cleanly
with issue #6's other pending migration (`20260712220000`, the anti-farm fix above) — neither
touches a statement the other one wrote.

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

## Current — stale-reservation sweep (issue #47, 2026-07-13; migration written, NOT applied)

`supabase/migrations/20260713130000_stale_reservation_sweep.sql` exists in the repo but is
**not** applied to the live project (confirmed via `supabase migration list`, 2026-07-13 — its
`remote` column is empty, same footing as `pace_quota_status`'s, 20260712233000,
`pace_purchase_tier`'s, 20260713120000, and `attach_media_paths`'s, 20260713140000; the repo is
now **four** migrations ahead of production, tracked by issue #131). It is the backstop `docs/status.md` Known Issue #14
asked for: reclaiming a `'reserved'` row when the `analyze-form` invocation that created it is
killed (timeout/OOM/deploy) before its own `finally` block can reach `release_analysis`.

- **`public.sweep_stale_reservations(p_stale_after interval default '15 minutes', p_batch_limit
  integer default 500)`** — `SECURITY DEFINER`, `EXECUTE` revoked from
  `public`/`anon`/`authenticated`, scheduled via `pg_cron` (`create extension if not exists
  pg_cron`) every 5 minutes. Runs as `pg_cron` calling the SQL function directly rather than a
  scheduled edge function: pure DB bookkeeping needs no HTTP hop, and provisioning a Vault-stored
  credential for a `pg_net`-invoked edge function from a migration file isn't something this
  migration attempts.
- **The 15-minute threshold is derived, not guessed**: `analyze-form`'s own self-imposed
  `ANALYZE_FORM_DEADLINE_MS` (105s, `flow.ts`) and Supabase Edge Functions' 150s platform
  wall-clock kill bound how long a *legitimate*, still-running reservation can stay `'reserved'`;
  15 minutes is 6x the platform limit, ~7.5x the self-imposed one.
- **Extends `analyses_release_reason_known_values`** (the CHECK constraint the anti-farming fix
  below introduces) with a fifth value, `'stale_sweep'` — superset-only, so this is safe
  regardless of the table's row count. Deliberately kept OUT of `pace_is_farming_signal`'s
  vocabulary (unchanged), so a swept row can never count toward the 3-strike anti-farming cap
  (#6) — the row's own existence past the threshold proves the invocation that created it never
  reached any of its own release paths, so attributing it to the user would repeat the anti-farm
  fix's exact mistake in miniature.
- **Race-safe against a live `settle_analysis`/`release_analysis`, without an advisory lock**: a
  single conditional `UPDATE ... where status = 'reserved'`, plus `FOR UPDATE SKIP LOCKED` in the
  row-selection subquery for non-blocking batching. Whichever transaction reaches a row first
  wins; the other side's own pre-existing "duplicate/late call is a safe no-op" guard absorbs the
  loss. `p_batch_limit` (default 500) bounds how many rows one sweep run can lock and rewrite, so
  an incident leaving many rows stale at once can't make a single run try to process an unbounded
  number.
- **This migration reclaims the DB row only, and — since #130 — that is provably all it needs to
  do.** Known Issue #16 asked for a Storage purge here too. `analyze-form` now settles *before* it
  uploads, so a `'reserved'` row can never have frames: a swept row has zero objects under its
  prefix by construction, a purge here would list an always-empty prefix on every cron tick, and
  the `pg_net`/Vault/edge-function wiring Design Decision 3 declined to introduce stays off the
  table. Recorded as **Design Decision 5** in the migration's own header, so the next reader
  holding #130 does not add one back. Note this does not make every orphan impossible — the
  delete-during-upload race (Known Issue #26) is narrowed, not closed, and its fix belongs in
  `delete-analysis.ts`: those rows are `'delivered'`, never `'reserved'`, so this sweep would not
  see them even if it purged.
- **24 new Deno tests** (`_shared/__tests__/stale-reservation-sweep.deno.test.ts`): a TypeScript
  model of the sweep's contract (fresh/stale/settled/released rows, the race with a concurrent
  settle in both directions) plus migration-text invariant tests that read the actual SQL to
  prove the model isn't lying.

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

## Current — `POST /functions/v1/purchase-tier` (issue #51, 2026-07-13; hardened same day after a security audit on PR #123)

The M5 gate, and the **only legitimate writer to `public.subscriptions`**. Built and Deno-tested
on `feat/51-purchase-tier`; **not deployed**, and its migration is **written but not applied** —
same footing `quota-status` (#50) and `analysis` (#57) ship on. **Deploying this function is a
release blocker until the deployment gate below is understood — see `docs/status.md` Known Issue
#23.**

```
POST /functions/v1/purchase-tier   { tier, source: "dummy" }
  -> 200 { tier, periodStart, periodEnd }
  -> 404 not_found            (PURCHASE_TIER_DUMMY_ENABLED is not "true", or caller not on the
                                optional allowlist — the SAME body either way, see below)
  -> 400 invalid_tier | invalid_source | invalid_body
  -> 401 unauthorized         (missing/expired/invalid JWT)
  -> 405 method_not_allowed   (anything but POST)
  -> 429 rate_limited         (same user called again within 3s of their own last write)
  -> 500 purchase_unavailable (DB-side failure; never leaks the Postgres error)
```

### Deployment gate — the endpoint is a self-service $0 elite grant unless this is on

A 2026-07-13 security audit found this endpoint is a $0 self-grant of the highest paid tier,
reachable by anyone on the internet, the moment it is deployed to a project with open signup —
which is this project's current state (`enable_signup = true`, `enable_confirmations = false` in
`supabase/config.toml`). Full chain: pull the publishable key out of any build (inlined in
plaintext by design) → sign up with a throwaway address (no human needed, no email round trip) →
`POST` this endpoint with `tier=elite` → live `reserve_analysis` now grants 30 analyses / 8-frame
cap instead of free's 1/1 → burn them to trip the shared `ai_ops_config` daily spend cap ($10) →
every real user's `analyze-form` denied for the rest of the day → repeat with a fresh signup. Cost
to attacker: $0 — a 30× amplification of the existing daily-cap DoS. The header comment's original
"TestFlight-only, MUST NOT ship to a public App Store release" warning was a comment, not a
control, and did nothing to stop any of this the moment the function was deployed at all.

**The fix: `PURCHASE_TIER_DUMMY_ENABLED` must be the exact string `"true"` in the function's
environment, or every request gets an identical `404` — checked before the HTTP method, before the
Authorization header, before anything about the request is inspected, so the route is
indistinguishable from one that doesn't exist.** SQL cannot host this gate (a database serves both
a TestFlight build and a production build identically; there is no "which build is this" concept
at that layer), so it lives in `purchase-tier/index.ts`, the only file that reads it. **This
variable must never be set in production secrets** — `supabase secrets set` should scope it no
wider than a closed TestFlight tester group. An optional `PURCHASE_TIER_ALLOWED_USER_IDS`
(comma-separated user ids) narrows eligibility further once the flag is on; a miss gets the exact
same `404` a disabled flag would, so a prober cannot distinguish "off" from "on but you're not
listed." Decision logic (`checkDeploymentGate`) lives in `_shared/purchase-tier.ts`, portable and
unit-tested; only the two `Deno.env.get()` calls live in `index.ts`.

### Basic per-user rate limiting — honestly scoped

A repeat call from the *same* user within 3 seconds of their own last write returns their existing
state unchanged (`outcome: 'rate_limited'`, mapped to `429`) rather than doing any work — read from
the existing `updated_at` column, no new state. Said plainly: **this does not mitigate the audit's
actual amplification vector.** That attack uses one throwaway account per call; a per-user cooldown
cannot throttle a campaign that never calls this endpoint twice with the same user. The two real
levers are the deployment gate above (closes the whole vector when off) and CAPTCHA/signup
throttling (`docs/status.md` Known Issue #12, blocked on Ian). This control's actual job is
narrower: stopping one compromised or scripted account from hammering the endpoint in a tight loop.

The contract is **deliberately identical to V2.2's** so v2 can swap `source` to real receipt
verification without changing its shape. No real money moves in v1 — no IAP, no Stripe (real IAP
is Apple-gated and post-MVP). **A non-`dummy` source is refused**, so honoring a real receipt has
to be a conscious code change rather than something a client can opt into.

**Files.** `supabase/functions/purchase-tier/index.ts` (HTTP/auth glue only) ·
`_shared/purchase-tier.ts` (portable validation + shaping, unit-tested) ·
`_shared/purchase-tier-client.ts` (Deno/`npm:` service-role client factory) ·
`_shared/__tests__/purchase-tier.deno.test.ts` (37 tests) ·
`supabase/migrations/20260713120000_purchase_tier_function.sql` (`pace_purchase_tier`). Same
thin-glue/portable-core split as `quota-status` and `analysis`.

### No client-writable policy — the Echo V1 scar stays closed

`20260711150100_subscriptions.sql` gives the client SELECT and **no INSERT/UPDATE policy**,
deliberately: one would let any authenticated user self-grant elite tier for free with a single
REST call, which Echo V1's `schema.sql` shipped and then had to remove. **This endpoint is the
replacement for that policy.** The tier write happens in `pace_purchase_tier` — SECURITY DEFINER,
pinned `search_path`, EXECUTE revoked from `public`/`anon`/`authenticated` and granted only to
`service_role`, reachable only by an edge function holding the service-role key. This migration
adds **no policy and no grant to `authenticated`/`anon`**, and a test asserts on the migration's
own text that it never grows one.

**Grant-layer hardening (2026-07-13 audit).** `subscriptions` and `profiles` still carried
Supabase's default `grant all` to `anon`/`authenticated` underneath their RLS policies — no live
exploit (RLS with no INSERT/UPDATE/DELETE policy already denied those verbs), but TRUNCATE is a
table-level privilege RLS cannot restrict at all, and the whole point of "no INSERT policy" as a
control is that it is one accidental `create policy` away from Echo V1's mistake with nothing
underneath to catch it. This migration revokes INSERT/UPDATE/DELETE/TRUNCATE on both tables from
`authenticated`/`anon`, mirroring the fix already applied to `consents`
(`20260712030617_consents_grant_hardening.sql`) and still open for `storage.objects` (issue #100,
Known Issue #18). Verified safe first, not assumed: the only two writers of either table
(`pace_purchase_tier`, `handle_new_user()`) are both `security definer` and run as the function
owner regardless of the invoking role's own grants; `profiles`' `on delete cascade` FK is enforced
by Postgres's internal referential-integrity trigger (system-level privilege, not the deleting
session's); and neither table has any client write path in `app/`/`lib/` (`subscriptions`' one
client reference is a SELECT).

The caller's id comes from the **verified JWT** (`auth.getUser()`, a real round trip), never the
request body — `parsePurchaseRequest` reads exactly `tier` and `source`, so there is no channel
through which a body-supplied `user_id` could reach the RPC.

### `purchased_at` is the period anchor, and it is set exactly once

Quota periods are **derived at read time** from the single column `subscriptions.purchased_at` via
`pace_current_period` — there are no stored period columns and no rollover cron, by design. Both
`reserve_analysis` and `pace_quota_status` count a paid user's usage as
`created_at <@ pace_current_period(purchased_at, now())`.

That makes the anchor load-bearing: **moving `purchased_at` moves the window**, and every analysis
created before the new anchor falls outside it — silently resetting `used` to 0. Since the v1
purchase is a free, unlimited dummy, re-anchoring on each call would be an *unlimited
free-analysis exploit* reachable by replaying one request, not a billing quirk. The same hole
would open via `pro → elite → pro` tier flapping if a tier change re-anchored.

**So `purchased_at` is written only by the INSERT** (first purchase ever) and is deliberately
absent from the UPDATE's SET list. A test parses the migration's UPDATE statement and fails if
`purchased_at` ever appears in it.

**The anchor is always the real wall-clock `now()` — there is no `p_as_of` parameter (removed
2026-07-13 audit).** The function originally took an optional `p_as_of timestamptz default now()`,
mirroring `pace_quota_status`'s own harmless read-only version of the same parameter. Here it was a
live footgun even though unreachable today (EXECUTE is service-role-only and `purchaseTier()` never
passed it): a future edge-function edit threading a client-supplied timestamp through to it would
hand an attacker exactly the re-anchoring exploit described above. Removed entirely rather than
guarded, so it cannot be reintroduced by accident the way a guard could be loosened by accident.

### Repurchase / idempotency semantics

Idempotent by construction — no idempotency key, and none is needed: the natural key is the user's
single `subscriptions` row (PK on `user_id`), and the operation is a **state assertion** ("this
user's tier is now X"), not an accumulating one. A retry, a double-tapped button, and a replayed
request all converge on the same state. `pace_purchase_tier` returns an `outcome` (logged
structurally, never returned — the response contract is exactly three fields):

| Outcome | When | Anchor |
|---|---|---|
| `created` | No row existed | **Written** — `purchased_at := now()`. The only path that writes it. |
| `unchanged` | Same tier, already active | Preserved — a true no-op. The repurchase case. |
| `tier_changed` | Different tier (up or down) | Preserved — an upgrade raises the limit *within the same window*; a downgrade lowers it (`remaining` floors at 0). Neither resets `used`, which is what makes tier flapping worthless as an exploit. |
| `reactivated` | Same tier, status was `canceled` | Preserved — harmless, because `pace_current_period` derives the window *containing now()* from any anchor however old, so a long-lapsed user lands in a current period with a correctly-zero usage count without the anchor moving. |
| `rate_limited` | Same user called again within 3s of their own last write | Preserved — no INSERT, no UPDATE at all. Visible to the caller as `429`, unlike the four outcomes above which are all `200`. |

Nothing in v1 writes `canceled` (there is no cancel endpoint yet), but the path is pinned down
rather than left for whoever adds one to discover. **When real receipt verification replaces
`source: "dummy"`, the store owns the true renewal date and this anchoring policy should be
revisited there, consciously — not loosened here.**

### What is deliberately *not* here

No tier limits (free 1 / pro 10 / elite 30) and no frame caps (1 / 5 / 8): `reserve_analysis` is
the sole enforcement point, and duplicating those numbers into a second place is Echo V1's
documented duplication mistake. Prices (Pro $6.99 / Elite $14.99) are display-only and live in
`docs/design/copy-deck.md`. Tests assert the migration contains none of them. This endpoint grants
a **tier**; it never says what a tier is worth.

## Current — `POST /functions/v1/delete-account` (issue #58, 2026-07-13)

In-app account deletion. An **App Store submission blocker** (Guideline 5.1.1(v)) and the hard
gate on publishing `docs/privacy-policy.md` at all (`docs/status.md` Known Issue #15). **Written
and Deno-tested; NOT deployed** — `supabase functions deploy delete-account` is Ian's to run.

Three files, the same three-way split as `analysis/index.ts` (#57):
`supabase/functions/delete-account/index.ts` (HTTP + JWT glue),
`_shared/delete-account.ts` (all decision logic, no Deno/`npm:` import, unit-tested), and
`_shared/delete-account-client.ts` (the service-role `npm:@supabase/supabase-js` factory).

- **The delete order IS the design: storage objects → rows → auth user.** It is the reverse of
  what feels natural and inverting it is unrecoverable. Deleting the auth user first cascades
  `profiles` → `analyses`/`subscriptions`/`consents` away — and `storage.objects` has **no FK to
  `auth.users`**, so every frame survives under a `{user_id}/` prefix whose owner no longer
  exists: un-enumerable (the rows that named them are gone), un-ownable, and nothing else in the
  system will ever clean them up. Asserted by a test on the observed call order.
- **Purge by prefix, never by `media_paths` and never by walking `analyses` rows.** The sweep
  target is the single prefix `{user_id}/`, built from the JWT-verified caller id alone. That is
  strictly stronger than any row-driven purge and closes four orphan sources without
  special-casing any: rows whose `media_paths` is empty or short because `analyze-form` was killed
  mid-upload, after its settle (#88's write-side bug, reintroduced if the read side is row-driven);
  rows **soft-deleted** through #2's client `deleted_at` UPDATE policy, whose `media_paths` the
  redact trigger has since blanked (**Known Issue #19** — a row-driven sweep misses these, this one
  cannot); frames stranded by the delete-during-upload race (**Known Issue #26**, where this
  account-level sweep is currently the *only* thing that would ever reach them); and objects under a
  prefix with no row at all, from any cause.
- **The nested-prefix trap is reused, not re-implemented.** `purgePrefix()` in
  `_shared/delete-analysis.ts` (#57) is now exported and called by both delete paths. It
  recurses into every `{analysis_id}/` sub-prefix, paginates each level, and **re-lists the
  prefix after removing, refusing to return unless it comes back empty** — so a `remove()` that
  silently drops paths is caught rather than reported as success. A flat `storage.list(user_id)`
  returns the analysis-id **pseudo-directories**, not files, and removing those deletes NOTHING
  while reporting success: V1's `delete-user` bug, named in `docs/privacy-checklist-m7.md`. One
  implementation, two callers, exactly one place it can ever be wrong.
- **The purge is BLOCKING, not best-effort and not reconciled.** If Storage fails, nothing is
  deleted — no rows, no auth user — and the caller gets a `503`. Reconciliation would need a
  durable work record, a scheduled worker, and alerting on its own silent failure, and would be
  the only thing standing between a failed purge and permanently un-ownable body images. Blocking
  needs none of that, because the retry key is the user id and the user id still exists precisely
  *because* we refused to delete the account. Every step is idempotent, so a retry converges: an
  empty prefix, zero rows, and an already-absent auth user are all successes.
- **A second sweep runs after the auth user is deleted**, closing the one race blocking cannot: an
  `analyze-form` call that reserved its row before our row delete can upload frames into a prefix
  we already swept. If that sweep cannot clear them, the outcome is `orphans_remaining`.
- **Response contract — the status/body matrix, settled centrally after PR #121 security/code
  review** (both reviewers confirmed the purge logic itself is sound; the one real finding was
  here, not there):

  | Outcome | Status | Body |
  |---|---|---|
  | Full success (`deleted`) | `200` | `{ deleted: true, purgedObjectCount, consentEventsPurged }` |
  | `orphans_remaining` | `200` | `{ deleted: true, orphansRemaining: true, purgedObjectCount, consentEventsPurged }` |
  | `purge_failed` | `503` | `{ error, code: 'purge_failed' }` |
  | `rows_failed` | `503` | `{ error, code: 'rows_failed' }` |
  | `auth_delete_failed` | `503` | `{ error, code: 'auth_delete_failed' }` |

  **`orphans_remaining` is a `200`, not the `500` this endpoint originally returned.** By the time
  that outcome fires, the storage purge, every row, AND the `auth.users` record are ALL already
  destroyed — the account is irreversibly gone. The original implementation returned a `500` whose
  body carried **both** `deleted: true` and `error`/`code` at once, which (a) violates this very
  API table's own stated contract that every non-2xx body is a clean `{ error, code }` — the body
  was neither shape, it was both — and (b) is unconsumable by any correct client: a client seeing a
  non-2xx does the sane thing and reports failure, but every clause of "still active, please retry"
  is false here (the account is not active, a retry can only `401` since there is no user left to
  authenticate as, and the client would then sit the user on a dead access token indefinitely). The
  fix: `orphans_remaining` returns the SUCCESS shape plus an `orphansRemaining: true` hint (for
  copy like "some stored media may take longer to purge"), with no retry affordance, because there
  is nothing left to retry. The ops response — the exact `{user_id}/` prefix a human must go clean
  — lives **only** in the error-level structured log this outcome triggers; it is deliberately kept
  out of the end-user-facing body, since the user cannot act on it. **Invariant, enforced by a
  test**: no response body, for any outcome, ever carries both `deleted` and `error`/`code`.
  `DeleteAccountErrorCode` (`'purge_failed' | 'rows_failed' | 'auth_delete_failed'`) is exported as
  its own discriminated union rather than a bare `code: string`, so a client can exhaustively switch
  on it and the compiler — not a missed `if` — catches a new failure code that isn't handled.
- **The consent trail is PURGED — explicitly, in code, not by inheriting the FK cascade.**
  `consents.user_id references profiles(id) on delete cascade` would erase the Art. 9 consent
  record as a side effect nobody chose; `20260712020729_consents.sql`'s own comment demands a
  "conscious purge-vs-retain-for-defence choice for this table specifically." The choice is purge,
  enforced by a named `deleteConsents()` step that runs *before* the profile delete and reports
  the count. Reasoning (argued in full in `_shared/delete-account.ts`'s header): GDPR Art. 17(3)(e)
  permits retaining what is **necessary** to defend a legal claim, and a consent row keyed only on
  a `user_id` we can no longer map to any person — email, identity and profile all cascade out of
  `auth.users` — cannot defend anything, so the exception does not reach it. Making it usable would
  mean retaining a re-identifiable token (an email, or a keyed hash of one) of someone who asked to
  be forgotten, purely so we could find them again: more invasive than the risk it hedges. What
  actually answers a "no valid consent" complaint is systemic and survives — `<ConsentGate />`,
  `lib/consent.ts`, the append-only `consents` schema and their tests demonstrate the *process*
  (Art. 7(1)) — and to an erasure complaint, "we hold nothing about you" is the complete answer.
  **Revisit if EU/UK users are admitted** (the TestFlight beta excludes them today) or the user
  base grows enough for a claim to be plausible; the decision then is a bounded, keyed-hash consent
  archive with a retention window and a privacy-policy disclosure, not a flipped FK. Because the
  purge is an explicit step, that change has exactly one home.
- **`public.ai_call_log` deliberately survives, stripped.** Both its FKs are `on delete set null`
  (`20260712210000_ai_spend_guardrails.sql`): the spend ledger outlives the account with the only
  two identifying columns nulled, so a farm cannot delete its own cost evidence and no personal
  data survives. `delete-account` relies on that and must not defeat it.
- **Identity comes only from the verified JWT** (`auth.getUser()` — a real round trip, not a local
  decode). There is no id in the path and none in the body. This endpoint is irreversible, so an id
  read off the request would be a one-request account-deletion weapon against any user whose UUID
  could be guessed or observed.
- **Service-role key, non-negotiable.** Removing objects from the private `media` bucket
  (`storage.objects` grants the client SELECT only — #88), deleting `public.consents` /
  `public.analyses` rows (no client DELETE grant — #68, #2), and removing the `auth.users` row (the
  Auth **admin** API) are each unreachable without it. None of this can ever be a client operation.
- **The removes are bounded (`REMOVE_BATCH_SIZE = 500`).** `purgePrefix` hands every collected path
  to a single `remove()` — fine for one analysis (~10 frames), but an account spans every analysis
  the user ever ran, and one `remove()` carrying thousands of paths is the call that starts failing
  on request size. Because the purge is (correctly) blocking, that failure would make the heaviest
  accounts **permanently undeletable** — the classic "runs fine for six months, then breaks with no
  code change" failure, breaching Guideline 5.1.1(v) for exactly the users least willing to wait.
  `batchedRemove()` in `_shared/delete-account.ts` wraps the injected bucket so removes go out in
  fixed-size batches, leaving `purgePrefix` itself untouched and still the only implementation of
  the recursion. Asserted by a 1250-object test.
- **The account-level sweep is bounded-concurrency and resumable, not sequential (issue #125,
  2026-07-13).** The original account sweep handed the whole `{userId}/` prefix to one
  `purgePrefix()` call, whose recursion walks every `{analysis_id}/` sub-prefix ONE AT A TIME —
  fine for `delete-analysis.ts`'s own single-analysis callers, but an account spans every analysis
  the user ever ran, and a long-lived Elite account (30 analyses/period) accumulates hundreds of
  sub-prefixes. Since the purge is deliberately blocking (above), a sweep that times out deletes
  **nothing** — the heaviest accounts, with the strongest claim to erasure, became permanently
  undeletable. New `purgeAccountPrefix()` enumerates the account root, then purges each sub-prefix
  through the **unchanged** `purgePrefix()` via a new `mapWithConcurrency()` helper, bounded to
  `ACCOUNT_PURGE_CONCURRENCY` (8) in-flight purges at once — a modest, single-digit fan-out chosen
  to cut wall-clock time by close to an order of magnitude without tripping Storage's own rate
  limiting. Soft wall-clock budgets (`ACCOUNT_PURGE_DEADLINE_MS`, 60s; and
  `ACCOUNT_POST_DELETE_SWEEP_DEADLINE_MS`, 20s, for the post-delete race sweep below) stop
  dispatching new sub-prefix purges once spent and fail closed as the same `purge_failed` outcome
  — no new response contract. **Checkpointing falls out for free**: each sub-prefix purge
  independently `list → remove → verify`s before the next starts, so a timed-out retry
  re-enumerates the account root and finds strictly fewer sub-prefixes (an emptied
  `{analysis_id}/` vanishes from the listing) rather than redoing the whole sweep. 8 new Deno
  tests cover `mapWithConcurrency`'s bound/order/fail-fast properties, a 40-analysis
  bounded-concurrency proof, a budget-exceeded case, and a resume-after-timeout case.
- **Structured JSON logs at every boundary** — invocation, storage purge, consent purge, row
  delete, auth delete, completion, each failure, with durations. When a deletion half-succeeds in
  production these are the only evidence of where it stopped, and they have to exist *before* the
  incident. No frame bytes, results, or emails are logged.

- **A valid JWT is no longer SUFFICIENT — the caller must also prove RECENT reauthentication
  (issue #124, 2026-07-13).** A stolen or leaked access token is a *valid* token right up until it
  expires, and `autoRefreshToken: true` (`lib/supabase.ts`) means a device silently refreshing in
  the background can keep producing valid tokens indefinitely with no credential ever re-presented
  — acceptable for ordinary endpoints, not acceptable for the one irreversible, unrecoverable
  action in this product.
  - **Mechanism**: Supabase Auth's `amr` (Authentication Methods Reference) JWT claim — an array of
    `{ method, timestamp }` entries, one per real authentication *event*, not per token.
    `isReauthFresh()` (`_shared/delete-account.ts`) reads the SAME already-verified token
    `index.ts`'s `auth.getUser()` call trusted — it never re-verifies a signature, only decodes
    claims out of a token already established as trustworthy — and requires the most recent
    non-excluded `amr` entry to be within `REAUTH_FRESHNESS_WINDOW_SECONDS` (5 minutes) of now.
    Fails CLOSED on anything it can't positively confirm (an undecodable token, a missing `amr`, a
    stale timestamp) by demanding reauthentication rather than assuming it.
  - **Deliberately NOT `iat` (issued-at)**, which advances on every silent token refresh even
    though the user did nothing — an `iat`-based check would be exactly the "looks like a control,
    protects against nothing" trap this issue exists to close, since a stolen persisted session
    could stay "recently authenticated" forever just by refreshing.
  - **`token_refresh` is explicitly excluded from counting as assurance** (defensive: Supabase's
    authoritative "currently recognized" `amr` method list doesn't include it today, but this
    project's own live project has no populated `auth.mfa_amr_claims` rows to empirically confirm a
    refresh never gets stamped in — the exclusion hedges against a future GoTrue change).
  - **The gate runs in `index.ts`, before `createDeleteAccountDeps`/`deleteAccount` are ever
    called** — a stale-session request never touches storage, rows, or the auth user, and gets its
    own `401 { error, code: 'reauth_required' }`, parallel to the existing missing/invalid-JWT
    401s. It is deliberately not a `{ confirm: "DELETE" }`-style body field, which protects against
    nothing when the attacker already holds the token and composes the request themselves.
  - **Client step-up flow, `app/settings.tsx`**: on `reauth_required`, the screen inspects the
    session's provider (`getReauthProvider`) and either opens a password re-entry modal
    (`reauthenticateWithPassword`) or re-runs Google sign-in behind a warning `Alert`
    (`reauthenticateWithGoogle`); an unrecognized provider gets an honest "we can't confirm it's
    you, sign out and back in" message. Exactly one retry loop — a retry that ALSO comes back
    `reauth_required` (clock skew, a second concurrent stale request) falls through to the ordinary
    failure copy rather than prompting a second time. New, uncertified `Copy.settings.reauth.*`.

**Still open** (see `docs/status.md` Known Issue #22): the #59 half that runs against a real local
Supabase (Postgres *and* Storage — the property under test is that two different systems agree,
which a fake cannot fail the way production does). The wall-clock-bound-but-not-checkpointed
concern this paragraph used to also list is **resolved** — see the bounded-concurrency bullet
above (issue #125). Issue #124 (re-authentication) is also now **resolved** — see the bullet
above — leaving this endpoint's remaining gap purely the #59 local-integration-test half and the
not-deployed status this whole section opens with.

## Current — the Settings screen (issue #53, 2026-07-13), closing issue #27

Design-brief screen 11. **Supersedes the "Route tree" table above for `settings`**, which still
lists it as `planned (M5)` — that line is now stale (left in place rather than edited, to avoid a
merge conflict with the parallel paywall work that owns the other half of it).

**Route placement: `app/settings.tsx`, a top-level PUSHED route — not a tab.** The planned route
tree already implied this (it lists `paywall, settings` at root while nesting only
`(tabs)/history`), and it is the right product call: the tab bar is for co-equal primary surfaces
(Home, and later History), whereas Settings is a rare destination you push into and back out of.
Entry point is a "Settings" link in Home's header — the slot the M1 sign-out stub used to occupy.

⚠️ **It is declared as a `Stack.Screen` inside `app/_layout.tsx`'s signed-in `Stack.Protected`
block, and that is a security property, not a formality.** Per that file's own contract, an
*undeclared* route file renders as an always-available, **unguarded** top-level screen regardless
of session. This screen hosts sign-out and account deletion; it must never be reachable signed-out.

| Concern | Where it lives | State today |
|---|---|---|
| Account (email) | `session.user.email` | Real. Falls back to an honest line when a provider returns no email, rather than rendering an empty row. |
| Plan (tier) | `subscriptions` read, `status = 'active'` | Real, and **display-only** — read, never computed (CLAUDE.md: the client is never the authority on tier). Loading and error are real states; a failed read never silently renders "Free". |
| Sign out | `lib/sign-out.ts` | Real, and correct against all three real outcomes — see below. |
| Delete account | `lib/delete-account.ts` | Real client, calls the `delete-account` edge function through the shared `invokeFunction()` wrapper (`lib/functions-client.ts`, issue #46, 2026-07-13) rather than `supabase.functions.invoke` directly. ⚠️ The edge function it calls (#58/#121) is built but not yet merged/deployed — see below. |
| Privacy disclosure + consent withdrawal | `lib/consent.ts` | Real. Restates the pre-upload disclosure (#68) and calls `withdrawConsent`, which had been built and waiting for a caller since #68. |
| Privacy policy link | — | **Deliberately not linked.** See below. |

**`lib/sign-out.ts` — the issue #27 fix, made once, in its final home.** The bug: `signOut()` was
fire-and-forget, so a failed **global** token revoke left server-side refresh tokens alive while the
user was shown a clean sign-out. `signOut()` awaits the call and **never rejects** (the
unhandled-rejection half of #27), surfacing a failure through a native **`Alert`** rather than
inline text, since a failure can mean the route guard is mid-unmount (see below) and an inline
error would render into a dying tree.

⚠️ **Corrected 2026-07-13, same day, per a security audit on PR #122 (finding F3):** the paragraph
this replaces claimed auth-js clears the LOCAL session unconditionally on any `signOut()` failure.
That is FALSE — verified against the installed `@supabase/auth-js` source (`GoTrueClient.js`'s
`_signOut`, ~line 3360): an expired access token whose refresh also fails takes an **early return**
that reports an error WITHOUT ever clearing the local session. So there are genuinely **three**
outcomes, not two, and `signOut()` re-checks `supabase.auth.getSession()` after any failure to tell
them apart, rather than assuming the local session is gone:
1. Success — server revoke landed, local session cleared.
2. `globalRevokeFailed` — local session **is** cleared; other sessions may still be active. Not
   retryable from here (no local session survives to retry with) — the copy offers the one recovery
   that works: sign in again, then sign out on a connection.
3. `stillSignedIn` — the early-return case. Nothing happened; the user is signed in **everywhere**,
   still. A real retry **is** offered here (the session it would authenticate with still exists).
`hasLocalSession()`'s own read failure fails closed toward `stillSignedIn` — the same direction
`lib/consent.ts`'s `hasConsented` fails closed — rather than ever guessing the reassuring answer.

**`lib/delete-account.ts` — a real client (fixed 2026-07-13, same audit, finding F1).** This
section originally described an injectable seam bound to a dev mock, on the theory that #58 would
"replace one binding line." That handoff had no owner: #58/#121's file list is entirely under
`supabase/functions/` and never touches `lib/`, so the swap would never have happened and
production would have shipped silently lying about account erasure. `lib/delete-account.ts` now
calls the real `delete-account` edge function, against this response contract, through the shared
`invokeFunction()` wrapper (`lib/functions-client.ts`, issue #46, 2026-07-13) rather than calling
`supabase.functions.invoke` directly — that wrapper owns the generic `FunctionsHttpError` unwrap
now; this file keeps only what's specific to this endpoint, the 200 success shape and narrowing
the wrapper's generic `code: string` to the three codes below:

| Outcome | Status | Body |
|---|---|---|
| Full success | `200` | `{ deleted: true, purgedObjectCount, consentEventsPurged }` |
| `orphans_remaining` | `200` | `{ deleted: true, orphansRemaining: true, … }` — a **success**: the account is irreversibly gone; only a few stray objects didn't clear. No retry offered (there is no account left to retry deleting). |
| `purge_failed` / `rows_failed` / `auth_delete_failed` | `503` | `{ error, code }` — all three retryable. The screen's copy (finding F2) deliberately does NOT claim a specific "what survived" per code, since the purge order (storage → rows → auth user) means different codes leave different things destroyed; it says only what's true across all three: some data may already be gone, retry is safe. |

`submit()` stays **nullary** — the function identifies the user from the JWT; a client that could
name the user to delete would be a vulnerability. Two things still narrow this implementation:
the edge function (#58/#121) is **built but not yet merged to `main` or deployed**, so calling this
today gets a 404, which the client folds into an honest, retryable failure rather than a false
success (proven by test); and the exact contract may still drift, since this PR cannot import
`#121`'s real `DeleteAccountErrorCode` type (barred from touching `supabase/functions/`) and
instead hand-maintains a mirror of it — see `lib/delete-account.ts`'s header.

**The privacy policy is not linked, and the draft is not rendered in-app.** `docs/privacy-policy.md`
still carries its `DO NOT PUBLISH` guard: the data-controller legal identity, country, and contact
email are unresolved (blocked on the Apple Developer account decision — `docs/blocked-on-apple.md`).
So there is no URL, and inventing one is not an option. Rendering the *draft* in-app was rejected
for the same reason the guard exists — it would show users placeholder legal identity and rights
promises they could not actually exercise, which is worse than saying nothing. The screen instead
shows an honest pending state and points at the disclosure that **is** certified and true today
(`settings.privacy.body`, the fuller version of the pre-upload consent line). Replace the pending
state with a real link in the same change that publishes the policy.

**Not built, deliberately:** `settings.plan.cta` ("See plans") and `settings.restorePurchases.cta`.
Both route to a Paywall (#52) and an IAP flow that do not exist; shipping them would build a dead
end. #52 adds them back with the route they point at.

## Current — `analyze-form` edge function (issues #44 + #45, built 2026-07-13, NOT deployed)

The core of the product, and the first code in this repo that spends money. Written and fully
tested; **not deployed** — `supabase functions deploy analyze-form` and `supabase secrets set
ANTHROPIC_API_KEY` are still Ian's to run. This section supersedes "Planned — `analyze-form` edge
function flow" above wherever the two disagree.

**File split** (the same three-way shape `analysis/` and `quota-status/` already use):

| File | Role | Tested |
|---|---|---|
| `analyze-form/index.ts` | HTTP + auth glue only. Verifies the JWT via `auth.getUser()`. | — |
| `analyze-form/flow.ts` | The whole orchestration, against injected deps. No npm/Deno import. | 50 Deno tests |
| `analyze-form/deps.ts` | Deno wiring: service-role Supabase client, Storage, the Anthropic `fetch`. | — (thin factory) |
| `_shared/analyze-form-validation.ts` | #45: read the response, validate structurally, salvage, classify. | 34 Deno tests |

The model is a **fake queue** in every test. The suite makes **zero Anthropic calls** and costs $0.

**The order, as built:**

```
auth → consent → AI gate → idempotency + reserve → prompt → call (+1 retry)
     → settle → upload → attach_media_paths          ↘ (any failure before the settle) release
```

**Settle before upload (#130).** The last three steps used to run `upload → settle`. They were
inverted so that a `'reserved'` row can never have frames — see step 10 of the call-ordering list
above for the full reasoning, and Known Issue #26 in `docs/status.md` for the one orphan window this
narrows but does not close. Everything after the settle is non-fatal (`safeAttachFrames` cannot
throw): the analysis is delivered and the quota is spent by then, so a bookkeeping miss must never
become a 500. When the attach refuses with `row_deleted`/`not_found` — the row was deleted while we
were uploading — the function purges the prefix it just wrote.

**How the five binding contract rules are discharged:**

1. **`p_user_id` from the verified JWT.** `index.ts` resolves it via `auth.getUser()` and passes it
   as `callerUserId`; `flow.ts` threads that one value into every RPC. There is no field in the
   request body that could name a user, and a test asserts that a body carrying `userId`/`user_id`/
   `p_user_id` cannot influence any RPC argument or any upload path.
2. **Branch on `reserve_analysis`'s `status`.** `handleExisting()`: `'delivered'` → 200 with the
   stored result (410 if it was soft-deleted and its `result` redacted to NULL); `'released'` → 409
   `previous_attempt_failed`, never a delivery; `'reserved'` → 409 `analysis_in_progress`, never a
   second model call against a live reservation; any unknown status → 409, because an unknown state
   is never a deliverable one.
3. **`release_analysis` on every failure path.** There is exactly ONE `release_analysis` call site
   and one `recordAiCall` call site in the whole function, both in a `finally`. The body never
   releases and never records — it only sets the intent (`releaseReason`, and each open call's
   attempt binding). A branch cannot forget an obligation it does not perform, and an unexpected
   throw takes the same path.
4. **Consent (`upload.health.v1`), fail-closed.** Checked before the gate, the reserve, the model,
   and the bucket. A missing row, `granted = false`, AND a query error all refuse with 403. A test
   asserts that a refusal leaves *zero* RPC calls behind.
5. **`gateAiCall()` before every Anthropic request; `recordAiCall()` on every exit.** The first gate
   runs before idempotency/reserve (so a denial never creates a reservation). **The retry gets its
   own gate** — it is a second billed call, and the daily cap and breaker must see it. Each gated
   call is settled with **its own** outcome, so an attempt that failed and was rescued by a retry
   still settles as `'validation_failed'`/`'model_error'`, not as `'success'` — otherwise a model
   that had stopped calling tools correctly would be invisible to the circuit breaker while
   silently doubling spend on every request.

**The model call — verified against the live Anthropic docs on 2026-07-13, not recalled.**
`claude-sonnet-5`, `thinking: {type: 'adaptive'}`, `output_config: {effort: 'medium', format:
{type: 'json_schema', schema: PACE_RESULT_SCHEMA}}`, `max_tokens` 4–8k from
`MAX_OUTPUT_TOKENS_BY_TIER`. **No `tools`. No `tool_choice`.**

- **The output contract is STRUCTURED OUTPUTS (`output_config.format`), not a tool call.** This
  supersedes both the "forced tool call" of the original spec and the `tool_choice: auto` this
  section briefly recommended. Grammar-constrained sampling is applied to the **response itself**
  against `PACE_RESULT_SCHEMA` — the same single schema constant the (now optional) tool would use,
  so there is still exactly one definition of the shape. GA on `claude-sonnet-5` on the Claude API,
  and documented compatible with extended thinking, so adaptive thinking stays on.
- **CORRECTION — the forced-`tool_choice`-conflicts-with-thinking rule is AMAZON BEDROCK ONLY.**
  This section, and `analyze-form-prompt.ts`'s header, previously claimed the restriction was stated
  "with no platform scoping" and that the Bedrock-only reading "could not be confirmed". **That was
  wrong.** On Bedrock, a forced `tool_choice` requires `thinking: {type: 'disabled'}`; the
  **first-party Claude API** (`api.anthropic.com` + `x-api-key`, which is what `analyze-form/deps.ts`
  calls) and Vertex AI do **not** require this. Forcing the tool call would never have 400'd here.
  The claim is deleted rather than merely annotated, because leaving it visible is how it got
  re-derived twice.
- **Why structured outputs rather than simply forcing the tool now that we may.** Three reasons, in
  order of weight: (1) it is a **stronger** guarantee — a forced tool call guarantees only that a
  tool was invoked, and the schema then constrains that tool's *input*; structured outputs
  constrains the *answer*, with no indirection; (2) it makes the platform question **moot** — with
  no `tools` and no `tool_choice` in the request, there is nothing for a platform-specific
  tool-choice rule to be incompatible with, and the request is correct on the Claude API, Bedrock,
  and Vertex under every reading; (3) it is **cheaper** — `tools` is billed as input (~13k characters
  of schema descriptions), plus a ~474-token tool-use system preamble when forced. The tool is
  retained as an opt-in (`BuildRequestOptions.includeTool`, `forceToolCall`) purely so #42 can eval
  the two mechanisms against each other.
- **The schema does NOT make #45's fallback path dead code, and it was not weakened.** Structured
  outputs explicitly does not guarantee conformance when `stop_reason` is `'refusal'` ("the output
  may not match your schema because the refusal message takes precedence") or `'max_tokens'` ("the
  output may be incomplete and not match your schema"). And **`minimum`/`maximum` are not in the
  supported JSON Schema subset**, so "score is an integer 0–100" is *unenforceable* by the schema —
  a `score: 140` is schema-valid and is caught only by `isPaceResult` at runtime. **The schema
  guarantees the shape; code guarantees the range.**
- **The response parser accepts both envelopes** — a JSON text block (structured outputs) and a
  `tool_use` block (if anyone opts the tool back in). Insurance, not indecision: the zero-spend rule
  meant no live call could confirm the structured-output envelope before shipping.
- **Thinking tokens count against `max_tokens`** (docs: "Use `max_tokens` as a hard limit on total
  output (thinking + response text)"). `stop_reason: 'max_tokens'` is therefore treated as a
  **truncation and is never usable**, whatever the content looks like — Echo V1's exact bug.

**Timing.** Total model budget `ANALYZE_FORM_DEADLINE_MS` = 105s, per-attempt cap 65s; the retry is
skipped when under `MIN_RETRY_BUDGET_MS` (20s) remains, because a call we start and abort is a call
we pay for and cannot use. 105s sits under the client's own `ANALYZING_TIMEOUT_MS` (120s), so a
doomed request fails as our structured `{ error, code }` — reservation released, ledger settled —
rather than as the client's blind timeout, which would leave the row `'reserved'` until #47's sweep.

**Status codes** (every non-2xx body is `{ error, code }`):

| Status | Code | When |
|---|---|---|
| 200 | — | `{ result, analysisId, isFallback }`. A full success and an honest partial share this shape. |
| 400 | `invalid_request` / `frame_cap_exceeded` / `invalid_*` | Bad body, or a reserve-side input refusal. |
| 401 | `unauthorized` | No/!valid JWT. |
| 402 | `quota_exceeded` | Over quota — the one code the paywall (#52) routes on. |
| 403 | `consent_required` | No recorded `upload.health.v1` grant. |
| 409 | `analysis_in_progress` / `previous_attempt_failed` | The idempotency key names a live or released reservation. |
| 410 | `analysis_deleted` | Replay of a key whose analysis was soft-deleted (its `result` is redacted). |
| 422 | `validation_failed` | Clean failure after the retry. Quota refunded. |
| 429 | `too_many_failed_attempts` | Anti-farming throttle. Deliberately not a 402 — it clears on its own. |
| 503 | `killed`/`breaker_open`/`daily_cap` · `model_error`/`provider_timeout` | Our brake, or the provider. Never the caller's fault. |
| 500 | `internal_error` / `misconfigured` | Our bug, or a missing secret. |

The gate's `detail` payload is **never** forwarded to the client: on a `daily_cap` denial it carries
`spent_usd`/`cap_usd`, so returning it would let any authenticated user read our AI spend and our
ceiling by tripping the cap. It is logged server-side instead.

**Observability.** One structured JSON line per request: model outcome, tier, media type, frame
count, attempt count, whether it retried, whether it fell back, the release reason if any, every
`stop_reason`, the four token counts, frames uploaded, latency, and the HTTP status. Without these
you cannot tell a prompt regression from a provider incident.

**Open, deliberately** (see `docs/status.md` Known Issue #21): the consent-withdrawal-vs-idempotent-
replay question is resolved as **refuse** (consent is checked before idempotency, so a replay after a
withdrawal is refused rather than served from cache) — the safer read, and the one that agrees with
what the delete/purge path (#57) does to such a row anyway.

## Current — four unapplied migrations close real holes found reviewing #130 (issues #133, #8, #7, #100+#4, 2026-07-13)

All four are **written, NOT APPLIED** to the live project — see `docs/status.md` Known Issue #29
for the full, current list of unapplied migrations (six, not four, once `attach_media_paths` and
the stale-reservation sweep are counted too).

- **`20260713150000_settle_analysis_deleted_at_guard.sql` (#133).** Adds `and deleted_at is null`
  to `settle_analysis`'s `WHERE` clause — the same guard #130 already gave `attach_media_paths` —
  closing a path where a soft-deleted `'reserved'` row could still be un-redacted by a
  late-arriving `settle_analysis` write and served back as a `200` instead of the `410` the
  soft-delete contract promises. Same 5-arg signature, `create or replace`; deliberately does not
  touch `reserve_analysis`.
- **`20260713151000_reserve_analysis_media_path_guard.sql` (#8).** #8 as filed no longer applies —
  `reserve_analysis` is 4-arg (`p_media_paths` dropped by #88) with no path to guard. Instead adds
  a table-level `CHECK` constraint, `analyses_media_paths_within_owner_namespace`, backed by
  `public.pace_media_paths_within_namespace()` — the same namespace rule `settle_analysis`/
  `attach_media_paths` already enforce in their own bodies, now enforced at the row level against
  *every* writer, present or future.
- **`20260713152000_storage_user_budget.sql` (#7).** A `BEFORE INSERT` trigger on
  `storage.objects` (a trigger, not RLS, because `service_role` — the only live writer — bypasses
  RLS but not triggers): Guard 1 rejects any object whose path doesn't name a live, non-deleted
  `analyses` row owned by that user; Guard 2 caps each user at 3000 objects / 500 MiB in the
  `media` bucket. Plus a read-only `public.list_orphaned_media_prefixes` detection RPC for a
  future scheduled purge — see the next section.
- **`20260713153000_grant_hardening.sql` (#100 + #4).** `storage.objects` still carried Supabase's
  legacy table-level grant-all (including `TRUNCATE`, which no RLS policy can filter) to
  `authenticated`/`anon` — #88 dropped the client's INSERT/DELETE *policies* but never touched the
  underlying *grant*. Fixed: `revoke all on storage.objects from authenticated, anon`, re-granting
  `authenticated` only `SELECT`. Also tightens `subscriptions`/`profiles`'s stray `anon` grants and
  revokes `set_updated_at()`'s EXECUTE. **This is the fix `CLAUDE.md`'s "Uploaded media is
  sensitive" section now describes as written but not yet applied** — see that file.

## Current — orphan-purge action, wired to nothing (issue #7's action half, 2026-07-13)

`supabase/functions/_shared/storage-sweep.ts` — the ACTION half of the detection RPC above.
`sweepOrphanedMediaPrefixes()` is pure, dependency-free orchestration (same discipline as
`ai-guard.ts`/`delete-analysis.ts`), fully Deno-tested, and deliberately does not import
`delete-analysis.ts`'s `purgePrefix()` (the ~30-line list→remove→verify idiom is reimplemented
independently to avoid coupling two parallel worktrees' files — a candidate follow-up refactor,
not forced here). **No scheduled edge function calls it, and none exists in this repo** — wiring
one up (a new `supabase/functions/<name>/index.ts` plus a Dashboard Cron Job or
`pg_cron`+`pg_net`+Vault trigger) is a `jobs-queues-edge` + deploy/config task, not done here. See
`docs/status.md`'s Known Issues for this.

## Current — the two-phase consent gate (issues #68 restatement + #94, 2026-07-13)

`components/consent-gate.tsx` now gates three distinct things, with two different lifecycles:

1. **Health-processing consent** (#68, unchanged) — once-ever.
2. **Age confirmation** (#94, new) — "I confirm I'm 16 or older," also once-ever (age only moves
   one direction). `docs/privacy-policy.md` already stated a 16+ minimum; nothing had ever asked
   or recorded it. Same screen as (1), its own checkbox, its own `consent_key`.
3. **Subject attestation** (#94, new) — who is actually in this photo or video. This **cannot** be
   a once-ever grant, because the answer is a property of the specific upload, not the account.
   Runs on **every** gate presentation with no `hasConsented` short-circuit; the previous shortcut
   (skip the whole gate for a returning consented user) is gone, since phase 'subject' has no
   "already answered" state. Answering "This is me" records no new consent (self-processing is
   already covered by (1)); answering "Someone else" requires a fresh checkbox attestation —
   including an explicit under-16 parent/guardian clause — and records its own, distinct
   `consent_key` on every occurrence.

`app/capture/index.tsx` now always mounts the gate. **New, UNCERTIFIED copy**:
`consent.upload.age.checkbox` and the whole `consent.upload.subject.*` namespace — legally
load-bearing (the Art. 9 obligation, the under-16 clause) and not yet reviewed by `ux-copywriter`
or Ian. See `docs/design/copy-deck.md`'s new-copy section.

## Current — `app/paywall.tsx` (issue #52, 2026-07-13)

The M5 dummy paywall. `lib/subscription.ts` reads `GET /functions/v1/quota-status` and calls
`POST /functions/v1/purchase-tier` (#51, still deploy-gated behind `PURCHASE_TIER_DUMMY_ENABLED`,
default OFF), both through issue #46's shared `invokeFunction()` wrapper. **No tier limit or frame
cap is hardcoded anywhere in either file** — every count/limit shown is read fresh off the
`quota-status` response, and a regression test fails if a numeric tier constant is ever added
here; this is the exact trap `lib/subscription.ts`'s own header names by name, since Echo V1 once
mistakenly believed enforcement lived in a file shaped like this one (it lived in the edge
function, same as here). Registered inside `app/_layout.tsx`'s signed-in `Stack.Protected` block.
New, uncertified purchase pending/success/failure copy (`paywall.alertDismiss`, `paywall.plan.*`,
`paywall.purchase.*`) — the deck's Screen 10 table only ever specced the static tier cards and the
two 402-gate banners, never what happens during/after tapping Upgrade.

## Current — Home quota (issues #54/#15, 2026-07-13)

`app/(tabs)/index.tsx`'s former hand-rolled `subscriptions` + `analyses` count query — a second,
independent implementation of counting logic `reserve_analysis`/`pace_quota_status` already own
server-side — is **deleted**. New `lib/quota.ts` calls `GET /functions/v1/quota-status` and holds
Home's pure quota→copy/CTA mapping as unit-tested logic rather than inlined JSX. Exhausted-quota
CTAs (`"Upgrade to analyze"` / `"Upgrade for more"`) now open the real Paywall route. Also renders
issue #6's anti-farm `blocked` state (`pace_quota_status` can report `blocked: true` independently
of `remaining`), which the old mirror had no way to represent — new, uncertified
`home.quota.blocked` copy, since the deck never specced this state.

## Current — Past Analyses (issues #55/#12, 2026-07-13)

`app/(tabs)/history.tsx`, a second tab alongside Home (`app/(tabs)/_layout.tsx`). New
`lib/history.ts` owns list-fetching, per-row interpretation, and short-TTL signed-URL frame-strip
minting, mirroring `lib/analysis-result.ts`'s split for the single-result screen.
`fetchHistoryList` filters `deleted_at is null` server-side AND `readHistoryRow` re-checks it in
code — never trusting one layer alone. Signed URLs are minted fresh on every screen open (never
cached long-lived) and never logged. A row whose media can't be shown (an honestly-empty
`media_paths` from a non-fatal post-settle frame-upload failure, or a path that fails to sign)
folds into a per-row "no thumbnail" state rather than crashing the whole list. Delete routes
through `DELETE /functions/v1/analysis/:id` (see its section above, including issue #132's second
purge). New, uncertified `history.item.a11yLabelNotAssessed`, `history.item.deleteCta`,
`history.delete.error.*`, and `history.error.*` — states the deck never specced. The Elite Compare
screen (`history.compare.*`) is **not built** — out of #55's scope.

**Tab bar chrome fixed, partially (#12).** React Navigation's stock cool-gray tab bar sat directly
beneath this app's warm Gait Plate tokens — invisible with one tab, glaring once a second tab made
the bar itself always-visible chrome. `(tabs)/_layout.tsx` now sets `tabBarStyle`'s
`backgroundColor`/`borderTopColor` to `surface.base`/`hairline` and `tabBarLabelStyle.fontFamily`
to the app's own type family. **The root `ThemeProvider`'s `DefaultTheme`/`DarkTheme` in
`app/_layout.tsx` is still React Navigation's stock palette** (screen-transition backgrounds, any
future header chrome outside `(tabs)`) — out of this file's lane, a follow-up.

## Current — AppState & foreground reconciliation (issues #10/#64, 2026-07-13)

New `lib/app-state.ts` is the app's ONE `AppState.addEventListener` call (a `started` guard makes
a second real registration fail loud rather than silently double-firing), wired from
`lib/session-provider.tsx`'s top-level effect. On every transition into `'active'` it re-arms
`supabase.auth.startAutoRefresh()` (Supabase's own React Native guidance: the refresh ticker does
not run while JS is suspended, so a backgrounded app can foreground with an expired token and
nothing refreshing it) and then notifies every `onAppForeground` subscriber — a pub/sub seam, not
a second listener.

`app/analyzing.tsx` is the one subscriber today (#64). If the app is backgrounded (not killed)
while still `waiting`, `analyzeFormClient.submit()`'s promise may never resolve even though the
server-side `analyze-form` invocation runs to completion regardless. On every foreground it
re-reads the `analyses` row by `idempotency_key` (never `id` — the DB id isn't known client-side
until a real response names it, and `reserve_analysis` guarantees at most one row per `(user,
idempotency_key)`) via a plain RLS-scoped `SELECT`, structurally validates it
(`isPaceAnalysisOutcome`) before trusting it, and dispatches `succeeded`/`reconciledReleased`
accordingly; `'reserved'`, no row, or a read error are all no-ops — it never resubmits.

**Partial, stated plainly: a process KILL, not just background, is NOT recovered.**
`lib/analyze-form.ts`'s one-shot mailbox does not survive a process restart, so a cold relaunch
never re-enters this screen with a live `waiting` state to reconcile against. Surfacing "your
analysis finished" after a real kill needs a persisted, cross-restart marker read at app startup —
out of scope here. See `docs/status.md`'s Known Issues.

## Current — connectivity detection (issue #93, 2026-07-13)

New `lib/connectivity.ts` (`@react-native-community/netinfo`) backs two shapes: `useIsOffline()` —
a live hook for `components/offline-banner.tsx`, mounted globally in `app/_layout.tsx` — and
`checkConnectivity()`, a one-shot pre-flight check for a network-dependent action. Fails closed
toward "online" on an indeterminate reading (`isInternetReachable: null`) — a false "connection is
fine" just lets a real call try and possibly fail normally, cheaper than a false "you're offline"
blocking a working connection outright. Uses the deck's pre-existing `offline.banner`/
`offline.blocked.*` copy (already specced in `docs/design/copy-deck.md`'s "Cross-cutting —
Offline" section — nothing new to mirror there).

**Partial, stated plainly: the pre-flight gate is not wired in.** `checkConnectivity()` is
exported and tested but neither `app/analyzing.tsx`'s submit nor `app/capture/index.tsx`'s upload
handoff calls it — both are owned by other in-flight work. Today only the passive banner is live;
a user who taps Analyze while offline still watches a spinner before failing. See `docs/status.md`'s
Known Issues.

## Current — sign-in hierarchy & a11y (issues #16, #20, #28, #11, 2026-07-13)

`app/(auth)/sign-in.tsx`: Google is now the accent-styled primary CTA; the sign-in↔sign-up mode
toggle actually opens the email form (previously a dead tap target); busy state, header
`accessibilityRole`, autofill hints, and inter-field focus chaining are all real. New
`lib/use-announce.ts` fires `AccessibilityInfo.announceForAccessibility` on iOS whenever a message
changes to a new truthy value — the iOS-side complement to `accessibilityLiveRegion="polite"`,
which React Native maps only to `android:accessibilityLiveRegion` and is a silent no-op on iOS.
Every dynamic-status text that relied on `accessibilityLiveRegion` alone (an auth error, a quota
caption) was completely silent to VoiceOver on iOS until this landed. Applied to sign-in's
error/status text and Home's three quota captions; every future screen with a dynamic status
string should call both mechanisms, never `accessibilityLiveRegion` alone.

## Current — password reset (issue #81, 2026-07-13)

New `app/(auth)/reset-password.tsx` (request the email), `app/(auth)/update-password.tsx`
(consume the recovery link, set a new password), and `lib/password-reset.ts` (both Supabase Auth
calls, reusing `PASSWORD_MIN_LENGTH` and `checkPasswordBreached` rather than re-deriving either).
`requestPasswordReset` is deliberately enumeration-safe: the success copy is identical whether or
not the submitted email has an account — the only success message that flow can produce.

**A recovery session IS a session — this is the detail worth remembering.** The instant the
emailed link's PKCE exchange resolves, `session` goes non-null, and a bare
`Stack.Protected guard={!!session}` would flip on exactly that transition, excluding the whole
`(auth)` group from the navigator (`Stack.Protected` omits, it does not merely hide) and ejecting
the user into `(tabs)` before they had set a new password — making the reset screen unreachable at
precisely the moment it's needed. Fixed: `lib/session-provider.tsx` now tracks a
`PASSWORD_RECOVERY` auth event as `isPasswordRecovery` (cleared on `SIGNED_OUT` or once
`update-password.tsx` commits the new password), and both `Stack.Protected` guards in
`app/_layout.tsx` now read `!!session && !isPasswordRecovery` / `!session || isPasswordRecovery`.

New, uncertified `Copy.auth.reset.*` — not in the copy deck, needs review. See
`docs/design/copy-deck.md`'s new-copy section.

## `.maestro/` E2E flows (issue #86, 2026-07-13) — UNVERIFIED, never executed

Four flows (`happy-path`, `dead-end-offline`, `dead-end-quota-exhausted`,
`dead-end-analysis-failure`) plus shared subflows (`sign-up`, `grant-consent`), written against the
documented screen contracts for the M7 no-dead-end gate. **Blocked on issue #84** (no dev build
exists — Maestro drives a real app binary, not Metro/Expo Go) and never run against one. Treat as
an unrun draft, not a passing gate, until #84 unblocks a real execution.
