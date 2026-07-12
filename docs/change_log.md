# Change Log

Running history of behavior-changing work, newest first. Each entry is a dated `## YYYY-MM-DD`
heading followed by a bulleted list of what changed (and why, where it's not obvious). When you
make a behavior-changing commit, add a bullet under today's date — create a new heading at the
**top** of the file if there isn't one yet for today. Don't rewrite or delete past entries.

## 2026-07-13

- **Frame timestamps are told the truth, end to end (issue #112)** — `expo-video-thumbnails`
  records the time the client *requested*, never the time it decoded (Android snaps to the nearest
  keyframe and exposes no PTS; iOS computes `AVAssetImageGenerator`'s `actualTime` and discards
  it). Cadence and Elasticity are the two PACE pillars derived from motion over time, so intervals
  presented as exact would have the model reason about a rhythm the runner does not have — and
  produce confident, fluent, wrong advice without crashing. `lib/frames.ts` was already honest; the
  gap was in what the prompt let the model *conclude*.
  - **`pace_framework.md`'s two timing clauses are now amended at the prompt layer**
    (`TIMESTAMP_RULES` in `supabase/functions/_shared/analyze-form-prompt.ts`), never by editing
    the certified file — the same mechanism #41 used for #40's runner's-note clauses. The certified
    *"**Only if frame timestamps are known** may you estimate a cadence *range*"* is quoted back and
    re-read as **"known approximately"** (a wide, labelled range is the most it can license; a point
    figure never was), and *"Across evenly-spaced frames…"* as **"not reliably evenly spaced"**
    (torso height *change* is visible evidence; its *rate* is not). The amendment can only tighten.
  - **The hedge now has to reach the runner.** Any Cadence/Elasticity judgement leaning on the
    timing must carry the uncertainty into the user-visible `feedback` — the runner sees only
    `score`, `band`, and `feedback`, so a hedge the model keeps to itself is not a hedge.
  - **Tests** (`analyze-form-prompt.deno.test.ts`, 30 → 33): the amendment is asserted present at
    every tier, and both quoted certified clauses are asserted to still exist in the shipped bundle
    **byte-for-byte** — so a re-certification that rewords them fails the build rather than leaving
    an amendment aimed at a sentence that no longer exists.
  - **Docs**: `docs/architecture.md`'s `analyze-form` flow no longer promises "actual sampled
    timestamps" (corrected under #41; this pass adds the clause-amendment and runner-visible-hedge
    bullets), and `lib/frames.ts`'s header now points at the prompt-layer mitigation instead of a
    doc requirement that no longer exists.
  - **Not done, on purpose**: no evenly-spaced timestamps computed and presented as actual (that
    looks precise, is wrong, and signals nothing), and no fork of `expo-video-thumbnails`. Real
    timestamps remain the long-term option in #112.
- **`POST /functions/v1/purchase-tier` built (issue #51, M5 gate)** — the dummy purchase, and the
  only legitimate writer to `public.subscriptions`. Contract deliberately identical to V2.2's
  (`{ tier, source: "dummy" }` → `{ tier, periodStart, periodEnd }`) so v2 can swap `source` to
  real receipt verification without changing its shape; a non-`dummy` source is refused today, so
  that swap must be a conscious code change. Written and Deno-tested (28 tests), **not deployed**;
  its `pace_purchase_tier` migration is written but **not applied**.
  - **No client-writable INSERT/UPDATE policy was added to `subscriptions`** — the tier write goes
    through a `service_role`-only SECURITY DEFINER RPC. Echo V1 shipped exactly such a policy (any
    user could self-grant elite for free with one REST call) and had to remove it; this endpoint is
    the replacement for it, and a test asserts on the migration's own text that it never grows one.
  - **Repurchase is idempotent, and that is a security property, not a nicety.** `purchased_at` is
    the period anchor `pace_current_period` derives every quota window from, and both
    `reserve_analysis` and `pace_quota_status` count usage as
    `created_at <@ pace_current_period(purchased_at, now())`. Re-anchoring on each call would slide
    the window and silently reset `used` to 0 — an *unlimited free-analysis exploit*, since the v1
    purchase is a free, unlimited dummy. So `purchased_at` is written only by the INSERT and is
    absent from the UPDATE's SET list: repurchase, upgrade, downgrade, and reactivation all
    preserve the anchor, which also makes `pro → elite → pro` tier flapping worthless.
  - Caller id comes from the verified JWT (`auth.getUser()`), never the request body. No tier
    limits, frame caps, or prices live in this function — `reserve_analysis` remains the sole
    enforcement point, and prices stay display-only in `docs/design/copy-deck.md`.

- **`purchase-tier` hardened same day after a security audit on PR #123** — a HIGH finding: once
  deployed to this project's open-signup state, the endpoint was a $0 self-grant of the highest
  paid tier reachable by anyone on the internet (throwaway signup → `tier=elite` → 30 analyses
  instead of free's 1 → burn quota to trip the shared `ai_ops_config` daily spend cap → every real
  user's `analyze-form` denied for the rest of the day → repeat). Fixed with a server-side
  deployment gate, not a comment: the function now returns an indistinguishable `404` for every
  request unless `PURCHASE_TIER_DUMMY_ENABLED` is exactly `"true"` in its environment — checked
  before the HTTP method, before auth, before anything about the request is read. **This variable
  must never be set in production secrets** (`docs/status.md` Known Issue #23, a release blocker),
  with an optional `PURCHASE_TIER_ALLOWED_USER_IDS` tester allowlist as further defense-in-depth
  once the gate is on. Also added: basic per-user rate limiting (`rate_limited` outcome, 429 — a
  repeat call from the same user within 3s of their own last write is a no-op; honestly scoped in
  the code comments as *not* mitigating the actual amplification vector, which uses one account per
  call — CAPTCHA/signup throttling, Known Issue #12, is the real lever there). Two MEDIUM/LOW
  findings closed in the same migration: revoked the default Supabase `grant all` to
  `authenticated`/`anon` on `subscriptions` and `profiles` (no live exploit — RLS already denied
  those verbs — but TRUNCATE isn't subject to RLS at all, mirroring the fix already applied to
  `consents`); and removed `pace_purchase_tier`'s optional `p_as_of` parameter entirely (a
  caller-suppliable period anchor, unreachable today but one careless edit from reopening the exact
  re-anchoring exploit the function exists to prevent). 9 new tests (37 total), including
  mutation-verified migration-text invariants for all three fixes.
- **`POST /functions/v1/delete-account` built (issue #58)** — in-app account deletion, the App
  Store submission blocker (Guideline 5.1.1(v)) and the hard gate on publishing the privacy policy
  at all (Known Issue #15). **Written and Deno-tested; NOT deployed** — deployment is Ian's.
  - **Added** `supabase/functions/delete-account/index.ts` (HTTP + JWT glue),
    `supabase/functions/_shared/delete-account.ts` (all decision logic, no Deno/`npm:` import), and
    `supabase/functions/_shared/delete-account-client.ts` (the service-role client factory) — the
    same three-way split `analysis/index.ts` (#57) uses, for the same reason.
  - **Delete order is the design: storage objects → rows → auth user.** Deleting the auth user
    first cascades every row away, and `storage.objects` has no FK to `auth.users` — so every
    frame would survive, un-enumerable and un-ownable, on the one code path whose whole purpose is
    to leave nothing behind. A test asserts the observed call order.
  - **Reuses #57's purge rather than re-implementing it.** `purgePrefix()` in
    `_shared/delete-analysis.ts` is now exported (a strictly additive change — that file's logic is
    otherwise untouched) and swept over `{user_id}/` instead of `{user_id}/{analysis_id}/`. It
    already recurses, paginates, and re-lists to verify the prefix is actually empty. The
    nested-prefix trap — a flat `list(user_id)` returns pseudo-directories and removes **nothing**
    while reporting success, which is V1's `delete-user` bug — now has exactly one place it can be
    wrong. Verified by mutation: deleting the recursion makes the zero-orphans test fail.
  - **Purge by prefix, never by `media_paths` or by walking rows** — so it also sweeps frames left
    by rows soft-deleted through #2's client UPDATE policy (**Known Issue #19**) and by
    `analyze-form` runs that crashed before `settle_analysis`. Neither is enumerable from the rows.
  - **The purge is blocking, not best-effort**: a Storage failure deletes nothing at all (no rows,
    no auth user) and returns a retryable `503`. Echo V1's pattern could delete the auth user while
    a failed `remove()` left frames un-ownable; that is now unreachable by construction. A **second
    sweep after the auth delete** closes the concurrent-upload race, and reports `orphans_remaining`
    (a `500`, logged at error level with the prefix) if it cannot.
  - **The consent trail is purged — explicitly, in code, not by inheriting the FK cascade.** The
    `consents` migration demanded a conscious purge-vs-retain-for-defence choice; the choice is
    purge, because a consent row keyed only on a `user_id` we can no longer map to a person is not
    "necessary for the defence of legal claims" (Art. 17(3)(e)) — it cannot defend anything — and
    making it usable would mean retaining a re-identifiable token of someone who asked to be
    forgotten. Full reasoning in `_shared/delete-account.ts`'s header and `docs/architecture.md`.
    `public.ai_call_log` still survives with its FKs nulled, as designed.
  - **20 Deno tests** (`_shared/__tests__/delete-account.deno.test.ts`) asserting from the
    **Storage side**, not the row side: zero orphaned objects after a full delete (issue #59's core
    assertion), nested-prefix recursion, pagination, the delete order, a mid-purge failure leaving
    the auth user alive, the consent-trail decision, cross-user isolation, retry convergence, and
    the boundary logs.

- **`delete-account`'s response contract fixed, on the same PR (#121), after security/code
  review.** CORRECTS the entry directly above: `orphans_remaining` no longer returns a `500` with
  a body carrying both `deleted: true` and `error`/`code`. Two problems with the original shape:
  it violated `docs/architecture.md`'s own contract that every non-2xx body is a clean
  `{ error, code }` (this body was neither shape, it was both), and it was unconsumable by any
  correct client — by the time `orphans_remaining` fires, storage, every row, AND the `auth.users`
  record are ALL already deleted, so a client reporting "still active, please retry" off a non-2xx
  would be false on every clause (the account is not active; retrying can only `401`; the user
  would sit on a dead access token indefinitely).
  - **New matrix** (also in `docs/architecture.md`'s "Current — `POST /functions/v1/delete-account`"
    section): `deleted` and `orphans_remaining` are both `200` — `orphans_remaining` adds
    `orphansRemaining: true` to the success body, with no retry affordance, because there is
    nothing left to retry. `purge_failed`/`rows_failed`/`auth_delete_failed` stay `503` with a
    clean `{ error, code }` and nothing else. The ops alarm — the exact `{user_id}/` prefix a human
    must go clean for `orphans_remaining` — now lives **only** in the existing error-level
    structured log, since the HTTP response carries no user-actionable remedy.
  - **`DeleteAccountErrorCode`** (`'purge_failed' | 'rows_failed' | 'auth_delete_failed'`) is now
    exported as its own discriminated union from `_shared/delete-account.ts`, replacing a bare
    `code: string`. The original bug survived because nothing forced a switch over `code` to be
    exhaustive; a stringly-typed code let a client (or this file's own tests) silently ignore a
    case.
  - **5 new/rewritten Deno tests**, bringing the suite to 25: `orphans_remaining` is asserted as a
    `200` with the success-plus-flag body, the full status/body matrix is asserted end to end, and
    a new invariant test asserts — for every outcome — that no response body ever carries both
    `deleted` and `error`/`code`.
  - Known Issue #21 rewritten (not just appended) to state plainly that `delete-account` does not
    work end to end until **both** this issue and #122 (the client's binding swap off its current
    mock) ship — read alone, neither issue said that. Issues #124 (no re-authentication) and #125
    (wall-clock bound, not checkpointed) filed separately and are explicitly out of scope here.

## 2026-07-12

- **M2 capture screens built (issue #36)** — design-brief screens 3-5: source picker, in-app
  muted record, and frame extraction, gated on M2's own requirement ("both sources hand a valid,
  budget-compliant frame set to the analysis step on iOS").
  - **Added** `app/capture/_layout.tsx`, `index.tsx` (Source picker), `record.tsx` (Capture), and
    `extracting.tsx` (Extracting), plus `components/framing-guide.tsx` (the faint side-on
    running-stance figure + level line, built from plain `View`s — no new dependency).
    Registered as a third `Stack.Screen` inside `app/_layout.tsx`'s existing signed-in
    `Stack.Protected` block (`app/_layout.tsx`'s only change).
  - **Muted recording, unregressed**: `expo-camera`'s `CameraView` uses `mode="video"` + `mute`;
    `app.json`'s `microphonePermission: false` / `recordAudioAndroid: false` (both plugins,
    already correct from M1) are untouched.
  - **Permission states are real, not raw alerts**: camera and photo-library each get a soft-ask
    (rationale before the OS prompt), a denied panel (real copy, a "the other path" secondary
    action, and a CTA that requests again or opens Settings depending on `canAskAgain` — new
    `lib/permission-state.ts`, tested), covering the "camera denied / library denied /
    permanently denied" states the issue named explicitly.
  - **`lib/frames.ts`'s `FrameBudgetExceededError` surfaces honestly** on Extracting
    (`upload.error.budgetExceeded`, no Retry — the same input would fail again), distinct from a
    generic extraction failure (`upload.error.extractionFailed`, Retry + Back) and from a
    pre-flight cap violation caught before extraction even starts (new `lib/media-caps.ts`:
    `MAX_CLIP_DURATION_MS` 15s / `MAX_PRE_COMPRESS_BYTES` 50MB, per `docs/mvp-build-prompt.md`
    gate #5).
  - **The Art. 9 consent gate** (`components/consent-gate.tsx`, issue #68) is now hosted — on the
    Source picker, intercepting the tap on either card, per the copy deck's own placement
    ("gates the Source Picker -> Capture/Upload handoff").
  - **New tested `lib/` modules**: `media-caps.ts`, `media-file-size.ts` (SDK 54's `expo-file-
    system` `File.size`), `permission-state.ts`, `parse-capture-params.ts` (route-param ->
    `PaceMediaInput` parsing). 27 new Jest tests, all passing; `npm run typecheck && npm run lint
    && npm test` clean; `npx expo export` verified a clean Metro bundle on both iOS and Android.
  - **New copy** in `constants/copy.ts` (`sourcePicker.*`, `capture.*`, `upload.*`), lifted
    verbatim from `docs/design/copy-deck.md` where a key existed; a handful of genuinely new keys
    (a library clip over the caps, a local extraction failure, the honest no-next-screen-yet
    stopping point since `analyze-form`/M4 doesn't exist) are marked "NEW key" in both
    `constants/copy.ts` and the deck, mirroring issue #68's precedent.
  - **Known gaps flagged, not silently fixed**: Home's CTA (`app/(tabs)/index.tsx`) is not wired
    to `/capture` — a different screen with its own in-flight M5/M7 work, out of this issue's
    scope. Issue #35 (direct-to-bucket upload) is superseded by #88's live no-client-upload
    contract and should not be built as originally scoped. `lib/frames.ts`'s own test coverage
    (#37) and frame-timestamp accuracy (#112) are separate, still-open issues.
  - Full detail: `docs/architecture.md`'s "Current — capture screens (issue #36)" section.
- **Screen 6 — Analyzing built (issue #80), the wait screen between "frames uploaded" and
  "result rendered."** Built on `fix/80` in an isolated worktree, in parallel with three other
  in-flight screen issues. Neither `analyze-form` (#44) nor the result screen (#56) exist yet;
  this screen is built entirely against their documented contracts, with a clean, injectable seam
  #44 drops its real implementation into.
  - **Added** `lib/analyze-form.ts`: `AnalyzeFormRequest`/`AnalyzeFormClientResult` types matching
    `docs/architecture.md`'s `analyze-form` request/response contract exactly (two parallel
    `frames`/`timestamps` arrays, not `PaceFrame[]`), the `AnalyzeFormClient` interface, a dev-only
    mock (`success` / `fallback` / `failed` / `timeout` / `thrown` outcomes, nothing calls the
    Anthropic API or any edge function), `toAnalyzeFormRequest()` (the missing glue flattening
    `lib/frames.ts`'s `PaceFrameSet` into the wire shape — nothing needed it before this issue,
    since no caller of `extractFrames()` existed yet), and a one-shot module-level
    `setPendingAnalyzeFormRequest`/`takePendingAnalyzeFormRequest` mailbox (not a state-management
    library — a multi-megabyte base64 payload is far past what's sane to round-trip through
    expo-router's serialized route params).
  - **Added** `lib/analyzing-machine.ts`: the screen's pure, fully unit-tested state machine —
    `analyzingReducer` (`waiting` → `succeeded` / `failed` / `timedOut`, with an attempt-counter
    staleness guard so a late-arriving stale event from an old attempt, e.g. a timeout firing
    after a Retry already started a new attempt, can never clobber the current one) and
    `captionPhaseForElapsed` (the `docs/design/motion-consult.md` wait-state pacing: a fixed
    step-list floor, then the honesty-threshold "Still analyzing" line — pure function of elapsed
    time, no timers inside, so it's testable with plain numbers). 31 tests across both new `lib/`
    files.
  - **Added** `app/analyzing.tsx` and registered it as a new `<Stack.Screen name="analyzing">`
    inside `app/_layout.tsx`'s existing signed-in `Stack.Protected` group (minimal, additive —
    nothing else in that file changed). Renders the step list, the honesty-threshold fade (plain
    RN `Animated`, no new motion dependency), and the `analyzing.error.failed.*` /
    `.timeout.*` states with Retry/Cancel (Cancel routes to Home; Retry reuses the SAME
    `idempotencyKey`, never mints a new one, so a client-side timeout followed by Retry can never
    double-run the model or double-burn quota). A full result and an honest `isFallback: true`
    partial (issue #45) route through the identical success path to the result screen
    (`/result/[id]`, forward-referenced via an `as Href` cast since that route doesn't exist in
    this worktree) — never treated as a failure. Explicitly does NOT build #64's backgrounding-
    recovery flow or #61's full motion/reduced-motion spec — the wait-state signaling this screen
    implements is motion-consult.md's own documented exemption from reduced-motion suppression
    ("opacity/color-only functional state signaling," not a vestibular trigger), not an oversight.
  - **Added** `Copy.analyzing` to `constants/copy.ts` — every string lifted verbatim from
    `docs/design/copy-deck.md` Screen 6 (`analyzing.title`, `.step.reading`/`.scoring`,
    `.longWait`, `.error.failed.*`, `.error.timeout.*`); the Retry/Cancel CTA strings duplicate
    the literal "Retry"/"Cancel" values under this screen's own keys rather than introducing a
    `Copy.shared` namespace — no such namespace exists anywhere in this codebase yet (Home and
    ConsentGate made the same call before this issue), and adding one was explicitly out of scope.
  - Verified end-to-end, not just typechecked: a throwaway (not committed) React Testing Library
    smoke test mounted the real screen against the real default mock client with fake timers and
    confirmed the full happy path — step 1 → step 2 → the long-wait fade → navigation to
    `/result/[id]` with `justAnalyzed: '1'` — actually renders and transitions correctly, plus a
    clean `npx expo export -p ios` bundle (1456 modules, zero errors).
  - `npm run typecheck && npm run lint && npm test` clean (340 Jest + 29 Deno tests, up from 309 +
    29).
- **The grounded `analyze-form` prompt, the tier verbosity dial, and the structured-output
  contract (issue #41 — M4's blocker; #44 and #45 can now start).** New:
  `supabase/functions/_shared/analyze-form-prompt.ts` (pure, injectable, never calls Anthropic —
  same pure/client split as `ai-guard.ts`) plus 28 Deno tests. **No live model call was made** and
  no function was deployed. Full detail in `docs/architecture.md` → "Current — the `analyze-form`
  prompt".
  - **Grounding**: the three certified `knowledge/*.md` files are injected **verbatim** from
    `knowledge.generated.ts` (#90) and asserted present **byte-for-byte** in the assembled prompt.
  - **Tier dial**: one prompt, one parameter (`TIER_VERBOSITY`). It moves depth and only depth —
    the not-assessed, medical-boundary, timestamp, and input-channel rules are assembled *outside*
    the dial and are byte-identical at every tier, so a paid tier can buy more words but never more
    confidence. Tested as a property across all three tiers.
  - **Issue #112 honored**: frame timestamps are the **requested** times, not the decoded ones, so
    every rendered time and interval is explicitly approximate, the error bar (hundreds of ms) is
    stated, precise SPM/GCT/VO figures are forbidden **at every tier including Elite**, and Cadence
    and Elasticity are steered onto timestamp-*independent* evidence (the overstriding signature;
    the visible quality of the landing) — which `pace_framework.md` already calls the most important
    thing you can see, and which needs no clock.
  - **Contract**: a forced, `strict: true` `submit_pace_analysis` tool whose `input_schema` **is**
    `PaceResult` (#43) — no parallel shape, no adapter. A round-trip test proves schema-shaped
    responses (including the photo case, where Cadence and Elasticity are honestly `null`) satisfy
    `isPaceResult`, so #45 can never reject an obedient model.
  - **Call config**: `thinking: {type: 'adaptive'}` (ON — this is a multi-step vision-reasoning
    task and the one call the product exists to make; running it with thinking off would be a
    material quality regression), `output_config: {effort: 'medium'}` (exported as
    `ANALYZE_FORM_EFFORT` for #42 to sweep — `medium` because `max_tokens` is a tight 4–8k that
    thinking counts against, Anthropic names "drop to medium" as the direct remedy for a
    mostly-thinking truncated answer, and Sonnet 5 at medium ≈ Sonnet 4.6 at high), and
    `tool_choice: auto`. `thinking` and `tool_choice` are **independent** options — no coupling.
    The docs state (with no platform scoping) that a *forced* `tool_choice` is incompatible with
    thinking; a credible report scopes that to Amazon Bedrock only, which could not be confirmed.
    `auto` is correct under both readings, so it is the default, and `strict: true` + a prompt that
    demands the tool call + #45's fallback carry the shape guarantee. #44 should confirm on its
    first live call whether `forceToolCall: true` works alongside adaptive thinking.
  - **Corrected two stale architecture claims that would have shipped as bugs.** (1) Step 6 asserted
    the frames carry their *actual* sampled timestamps; they do not (#112) — corrected. (2) Step 8
    specified a forced tool call **and** an explicit thinking config, without saying which thinking
    config — rewritten to state the real contract, the forced-tool/thinking open question, and the
    fact that `max_tokens` bounds thinking + text together. Also verified: this model rejects any
    non-default `temperature`/`top_p`/`top_k`, so the request sets none — determinism comes from
    `strict: true`, not from a sampling parameter.
  - **Fixed an under-reserving spend gate (`ai-pricing.ts`, #91).** `SYSTEM_PROMPT_TOKENS_ESTIMATE`
    shipped at `6000` as an admitted placeholder for a prompt that did not exist yet. The real
    prompt is ~57k characters at Elite (system + user text + a ~13k-character tool schema, billed as
    input) **and Claude Sonnet 5's new tokenizer produces ~30% more tokens for the same text**, so
    the usual ~3.5–4 chars/token heuristic under-counts: at ~2.7 chars/token the worst case is
    **~21.5k** tokens. `gate_ai_call` was reserving ~3.5x too little on every call — on a hard
    credit ceiling with auto-reload off, that is how you run out mid-analysis. Raised to `24000`
    (still conservative: priced as uncached, though the knowledge + tool prefix is cached at 0.1x),
    with a test that re-measures the prompt at the Sonnet-5 ratio and fails if it outgrows the
    constant. The **output** reservation needed no change and is not exposed by thinking: thinking
    bills as output, but `max_tokens` caps thinking + text together and equals the reserved
    `outputTokens`, so billed output ≤ reserved output — asserted by a test.
- **`GET /functions/v1/quota-status` built (issue #50), the server-authoritative read that #54
  (Home's quota display) must replace its client-side count query with.** `app/(tabs)/index.tsx`
  currently derives quota itself via a `subscriptions` + `analyses` count query, which CLAUDE.md's
  "no business rules in the client" rule forbids and which cannot even be completed for Pro/Elite
  (`pace_current_period`'s `EXECUTE` is revoked from `authenticated`). Built and Deno-tested on
  `fix/50`; **not deployed**. See `docs/architecture.md`'s "Current — `GET
  /functions/v1/quota-status` (issue #50)" section for the full design.
  - **Added** `supabase/migrations/20260712233000_quota_status_function.sql`: a new, read-only,
    `SECURITY DEFINER` function, `pace_quota_status(p_user_id, p_as_of)`, granted to
    `service_role` only — **WRITTEN, NOT APPLIED** to any database (issue #50's hard constraint).
    Calls the exact same `pace_current_period`/`pace_is_farming_signal` functions the live
    `reserve_analysis` calls (verified via `pg_get_functiondef` against project
    `vputdomdlknvthnzritt` before writing this file), so period math and farming-signal
    classification cannot drift between the two. Does not `create or replace` `reserve_analysis`,
    `settle_analysis`, or `release_analysis`. The one unavoidable duplication — the literal tier
    -> limit/frame_cap table `reserve_analysis` inlines rather than exposing as a helper — is
    copied verbatim with a loud "keep in sync" comment, since closing it fully would require
    editing `reserve_analysis`'s own body, out of scope here.
  - **Added** `supabase/functions/quota-status/index.ts`, `_shared/quota-status.ts` (pure
    orchestration), `_shared/quota-status-client.ts` (service-role client factory, same
    `ai-guard-client.ts`/`delete-analysis-client.ts` split). The response represents the issue #6
    anti-farm block as a state independent of quota — `blocked`/`blockedReason`/`blockedUntil`
    can be true/set even while `remaining > 0`, so a rate-limited-but-not-out-of-quota user is
    never shown a plain "1 analysis left."
  - **Added** `supabase/functions/_shared/__tests__/quota-status.deno.test.ts` (18 tests): RPC
    response-shaping tests (free lifetime exhaustion, paid period windowing, the
    blocked-with-quota-remaining case) against an injected fake `RpcClient`, plus migration-text
    invariant tests proving the migration's counting queries never filter on `deleted_at` (a
    soft-deleted analysis keeps counting, matching `reserve_analysis`) and that its tier -> limit
    table matches the live `reserve_analysis`'s literal values. No live/local database was
    available or permitted to integration-test against — see the architecture doc section above
    for the honest scope of what this proves.

- **Client-side soft-delete bypass around #57's delete endpoint closed (found by #57's agent,
  fixed alongside #6, migration written, not yet applied to the live project).** #2's soft-delete
  `UPDATE(deleted_at)` grant + policy on `public.analyses` was the intended client delete path
  before a server-side delete endpoint existed; now that #57's `DELETE
  /functions/v1/analysis/:id` edge function exists (built in a sibling worktree), that path is a
  bypass — a client can PATCH `deleted_at` directly, firing #2's redaction trigger (which wipes
  `media_paths`) without ever purging the Storage objects it named. That is issue #3 (deleted
  media never actually purged) reintroduced through the door #2 opened. Not exploited today:
  verified live (project `vputdomdlknvthnzritt`) that `public.analyses` has 0 rows, and a
  repo-wide grep of `app/`, `lib/`, `components/` found zero client code writing `deleted_at` or
  calling `.update()` against `analyses` — the only client reference to the table is the
  read-only quota-count `SELECT` in `app/(tabs)/index.tsx`. Revoking this breaks nothing live
  today.
  - **Added** `supabase/migrations/20260712230000_analyses_client_delete_removed.sql`: revokes
    `authenticated`'s `update (deleted_at)` column grant and drops the "Users can soft-delete
    their own analyses" policy. Leaves the `deleted_at` column, the redaction trigger, and all
    three quota RPCs (`reserve_analysis`/`settle_analysis`/`release_analysis`) untouched —
    `service_role` (which the delete edge function runs as) holds its own separate, unrevoked
    grant set and bypasses RLS regardless, confirmed by reading
    `information_schema.column_privileges` live rather than assumed. Resulting matrix on
    `public.analyses`: `anon` — nothing; `authenticated` — `SELECT` only (one policy, no
    INSERT/UPDATE/DELETE/TRUNCATE); `service_role` — unchanged, full access. Delete is now
    exclusively server-side. Composes cleanly with this same branch's other pending migration
    (`20260712220000`, the anti-farm fix below) — timestamped later, touches no statement the
    other one wrote (policies/grants only here; a function body and a CHECK constraint only
    there).
  - **Added** `supabase/migrations/__tests__/analyses_client_delete_removed.test.ts` (13 tests)
    and **updated** `supabase/migrations/__tests__/analyses_quota_soft_delete.test.ts`'s two
    cross-migration policy-simulation assertions — that suite dynamically scans every migration
    file's `CREATE`/`DROP POLICY` statements to compute the net-effect policy set, so adding this
    migration correctly changes its computed end state from "one SELECT + one UPDATE policy
    survive" to "one SELECT policy survives, zero UPDATE"; a new test was added alongside it that
    checks the soft-delete policy's shape directly against #2's own migration file (independent of
    later supersession), so #2's fix is still provably correct as originally written even though a
    later migration removes what it added.
  - **Updated** `docs/architecture.md`'s `analyses`'s RLS section with a new "Planned" paragraph;
    not yet applied to the live project, same not-yet-live footing as #6's anti-farm migration.

- **Anti-farming cap now distinguishes our infrastructure failures from genuine abuse (fixes
  #6, HIGH — migration written, not yet applied to the live project).** `reserve_analysis`
  counted every `status = 'released'` row toward its 3-failed-attempt anti-farming cap
  regardless of cause; free's branch has no window (matching its lifetime quota), so 3
  transient Anthropic timeouts/outages — none of them the user's fault — permanently bricked a
  free account with no recovery path. Verified live before touching anything: the current
  `reserve_analysis` (`pg_get_functiondef` against project `vputdomdlknvthnzritt`) matched
  `20260712123606_frame_upload_ordering.sql` (#88's 4-arg signature) byte-for-byte, and
  `public.analyses` had 0 rows against 2 `profiles` — no account is bricked today, so this ships
  with no data backfill.
  - **Added** `supabase/migrations/20260712220000_anti_farm_release_reason_fix.sql`: pins
    `release_reason` (previously freeform, "observability only") to a closed vocabulary via a
    new CHECK constraint — `model_error` / `provider_timeout` / `internal_error` (server-fault,
    excluded from the cap) vs. `validation_failed` (fires on genuine abuse AND on honest
    hard/confusing input, since #45's retry+honest-partial fallback doesn't exist yet to
    distinguish them — still counted, but see the windowing point below for why that alone isn't
    enough) — and adds `public.pace_is_farming_signal(text)`, a standalone classifier kept
    deliberately OUT of `reserve_analysis`'s body so a future taxonomy change never needs to
    `create or replace` that function again (the exact two-migrations-collide hazard #88's and
    #2's own header comments warn about, after one such collision already cost this repo work).
    **Free's anti-farm count is windowed to a rolling 24h** (`released_at > now() - interval
    '24 hours'`) rather than left lifetime-scoped like its quota — a same-day review (Ian +
    the coordinating agent) caught that an unwindowed count on `validation_failed` could
    permanently lock out a first-time user after 3 merely-confusing (not malicious) videos,
    a narrower recurrence of the exact bug #6 exists to close. The governing invariant, stated
    explicitly in the migration: **a user who has never successfully received an analysis must
    never be permanently unable to obtain one** — anti-farming may throttle, never permanently
    deny. 24h was chosen over shorter (too weak a deterrent) or period-length (too long a wait
    for a first-time user) alternatives, and turns out to match what the original spec always
    said — "3 free retries **per period**" (`planning/02-product-requirements.md:64`,
    `planning/03-engineering-requirements.md:81`, `docs/mvp-build-prompt.md:223`) — distinct from
    the lifetime quota, which the first implementation had conflated. Pro/elite's existing
    purchase-anchored period window is left as-is (it already self-resets, so never had this
    failure mode) and only gains the same reason filter. Every other line of `reserve_analysis` —
    signature, quota check, insert, exception handler — is preserved verbatim from #88.
    `settle_analysis`/`release_analysis` are untouched. The cap itself is not weakened: 3
    confirmed, recent farming-signal releases still trips `too_many_failed_attempts`.
  - **Added** `supabase/migrations/__tests__/anti_farm_release_reason_fix.test.ts` (30 tests),
    following this repo's existing text-level migration-contract convention (no pgTAP/local
    Postgres available — see that suite's own header, and `analyses_quota_soft_delete.test.ts`
    for precedent) — asserts the CHECK constraint's exact vocabulary, the classifier's boolean
    semantics, that both `reserve_analysis` branches gained the filter, that free's branch is
    additionally windowed to 24h while pro/elite's is not further shrunk, and that no data-repair
    statement was added.
  - **Updated** `docs/architecture.md`'s new "Planned — anti-farming cap distinguishes our fault
    from theirs" section (this migration is written but **not yet applied** to the live
    project — same not-yet-live footing the AI spend guardrail migrations were on before their
    own 2026-07-12 push), including a flagged copy gap: `too_many_failed_attempts` has no
    `docs/design/copy-deck.md` string yet — `ux-copywriter`'s job, not added here.

- **Session storage moved off plaintext AsyncStorage to a SecureStore-backed adapter (closes
  #38, `docs/status.md` Known Issue #13).** `lib/supabase.ts` was passing `storage: AsyncStorage`
  straight to `createClient` — the session, including the refresh token, sat unencrypted on
  disk. Harmless while nothing sensitive sat behind a session (M1); no longer true once M2 gates
  a private bucket of body-image media on it. New `lib/secure-storage.ts` implements Supabase's
  documented "LargeSecureStore" pattern: `expo-secure-store` (Keychain on iOS, Keystore on
  Android) enforces roughly a 2048-byte ceiling per value, far too small for a full session
  (JWT + refresh token + user object), so SecureStore instead holds a fresh random AES-256 key
  per write (`aes-js`, CTR mode; 64 hex chars, constant size regardless of session size) and
  AsyncStorage holds the AES-encrypted, size-unbounded session blob. Proven under the 2048-byte
  limit for an oversized (>2KB) session fixture, not just a small demo one — that's the failure
  mode a naive `storage: SecureStore` swap hits silently.
  - **Migration for the app's 2 existing real accounts:** `getItem` detects a legacy plaintext
    session left over from the old adapter (its leading `{`, since every ciphertext this class
    writes is pure hex and can never start with `{`) and transparently re-encrypts it in place
    instead of returning null — which would read to supabase-js as "no session" and silently
    sign the user out with no explanation on their first launch after this update (the same bug
    class as issue #5). If the re-encrypt write itself fails, the legacy plaintext value is still
    returned so the session isn't lost over a storage hiccup.
  - **Web fallback:** `expo-secure-store` has no web implementation (confirmed against the
    installed package — `ExpoSecureStore.web.ts` is an empty module) and `npm run web` is a
    supported dev command in this project, so `createSecureSessionStorage` falls back to plain
    AsyncStorage on `Platform.OS === 'web'`. Not a new weakness introduced for web specifically —
    browsers have no Keychain/Keystore equivalent to move to, and this project's real target is
    the mobile app.
  - Added dependencies: `expo-secure-store` (`npx expo install`, SDK 54-compatible) and `aes-js`
    + `@types/aes-js` (pure JS, no native module, safe to run for real under Jest).
  - `lib/__tests__/secure-storage.test.ts`: 16 cases covering the round trip, the oversized-
    session/2048-byte requirement, the full migration path (including the failed-migration-write
    fallback and a "malformed JSON that happens to start with `{`" guard), corrupted-ciphertext
    fail-closed behavior, and the web/native platform split. Verified load-bearing by temporarily
    deleting the migration branch and confirming 4 of the 16 tests fail exactly as expected.
- **Torn-write hardening for the SecureStore session adapter, same-branch review follow-up
  (still #38).** The AES key (SecureStore) and the ciphertext (AsyncStorage) live in two stores
  that cannot be written atomically as a pair. The initial #38 implementation above followed
  Supabase's documented recipe literally — a fresh random key on every `setItem` — which means
  every write was a two-store transaction: a `setItem` interrupted mid-way (app killed, device
  out of storage) could leave a new key paired with an old blob, or an old key paired with a new
  blob. AES-CTR does not error on that mismatch; it produces well-formed-looking garbage. The
  next `getItem` would have decrypted "successfully" into nonsense, and — with no check beyond
  "did decrypt throw" — handed it to supabase-js as if it were a real session, or (if the key
  itself was missing) simply returned null, which supabase-js reads as "no session" — a real,
  previously-good session silently laundered into an unexplained sign-out. That is the same bug
  class issue #5 fixed for the OAuth redirect path, and this review round exists specifically so
  it isn't fixed in one place and shipped broken in another.
  - **Stable key, per-write IV.** `lib/secure-storage.ts`'s `_getOrCreateKey` now creates the
    AES-256 key once per storage key and reads it back on every later call instead of
    regenerating it. After the first successful write there is no longer a key/blob *pair* to
    tear — SecureStore is never written again for that key, and every later `setItem` touches
    only AsyncStorage. CTR-mode safety, which the "fresh key every write" trick existed to
    provide, now comes from a fresh random 16-byte IV generated on every write and prepended to
    the ciphertext it belongs to (a fixed 32-hex-char prefix `_decrypt` splits back out).
  - **Residual window, narrowed not eliminated:** the very first write for a storage key still
    touches two stores (key, then blob), so a process kill strictly between those two writes
    still leaves a torn state — but since no blob was ever fully written in that case, the next
    `getItem` sees "nothing to restore," which is honest (no session had actually been
    established yet), not a previously-good session vanishing.
  - **Closed the first-write race.** Two `setItem` calls racing on the very first write for the
    same key (e.g. two auth events firing close together) could previously each find no key,
    each mint a different one, and clobber each other. `_getOrCreateKey` now serializes that
    step per storage key via an in-process async lock (a promise chain, not an OS-level lock —
    sufficient because the only real hazard is concurrent `await`s within this one running JS
    process, not two independent OS processes, which cannot race a single-instance mobile app).
  - **A decrypt that doesn't throw is not proof it's real.** `getItem` no longer trusts `_decrypt`
    just because it didn't throw — a wrong key/IV pairing (the residual torn-write window, or any
    bit-level corruption) decrypts "successfully" into garbage bytes. A Supabase session is
    always a JSON object, so `getItem` now runs `JSON.parse` on the result as the actual validity
    check before trusting it.
  - **Undecryptable state is cleared and reported, not silently absorbed.** On any unrecoverable
    blob (missing key, truncated/torn ciphertext, wrong-key-length exception, or a decrypt that
    fails the JSON check), `getItem` now clears both the AsyncStorage entry and the SecureStore
    key (so it can't keep failing the same way forever) and calls a new
    `onSessionRestoreFailure(key)` subscription hook — `getItem`'s `string | null` return type
    has no room to carry a reason, so this is the side channel. `lib/session-provider.tsx`
    subscribes to it (registered in the same effect as, and before, the `getSession()` call it
    needs to catch) and exposes `corruptedSessionError` / `clearCorruptedSessionError`, named
    distinctly from issue #5's `deepLinkAuthError` / `clearDeepLinkAuthError` on the same
    context so the two additions merge cleanly. `app/(auth)/sign-in.tsx` now reads it via
    `useSession()` with `displayedError = errorMessage ?? corruptedSessionError`, the same
    precedence pattern issue #5 established for its own deep-link error. **Copy: no
    purpose-written string exists for "we couldn't restore your saved sign-in."** Checked
    `docs/design/copy-deck.md` and issue #5's additions to `lib/auth-errors.ts` /
    `constants/copy.ts` (`signInCancelled`, `signInExpired`) first, per instruction not to invent
    copy — neither fits (both are scoped to the OAuth PKCE flow, not a decayed at-rest session).
    Reused `Copy.auth.error.generic` ("Sign-in didn't go through. Try again.") instead, per the
    copy deck's own stated policy for `generic`: fall back to it for "any other auth failure"
    without a specific string rather than inventing one. A precise string is left as future
    `ux-copywriter` work.
  - `lib/__tests__/secure-storage.test.ts` grew from 16 to 21 cases: the stable-key/reused-key
    behavior with a per-write IV-uniqueness assertion, the concurrent-first-write lock (asserts
    exactly one SecureStore key is ever created across two racing writes), and four new
    corrupted/torn-state cases — a blob with no matching key, a truncated/too-short blob, a
    SecureStore key of the wrong byte length (exercises the exception path), and — the core case
    review asked for — a decrypt that succeeds under a wrong-but-validly-shaped key and must
    still be caught by the JSON-validity check, not returned as if real. Verified load-bearing by
    two separate mutations: removing the `JSON.parse` validity check (failed exactly the
    "decrypt succeeds under the wrong key" test) and removing the per-key lock (failed exactly
    the concurrency test, with `SecureStore.setItemAsync` called twice instead of once).
- **Edge-function build/test contract closed (closes #90).** Three previously-unowned mechanics
  that #41/#43/#44/#49/#59 all silently assumed, found by the full-repo audit the same day:
  - **No runner could execute edge-function code.** Added `supabase/functions/deno.json`
    (scoped to that directory) and two npm scripts, `typecheck:edge` (`deno check`) and
    `test:edge` (`deno test`), folded into `npm run typecheck` / `npm run test` respectively so
    the CLAUDE.md-mandated `typecheck && lint && test` gate covers edge code for the first time.
    Running `deno check` immediately surfaced a real, previously invisible type bug in
    `ai-guard-client.ts` (issue #91) — `@supabase/supabase-js`'s `rpc()` returns a
    `PostgrestFilterBuilder`, not a true `Promise`, which didn't structurally satisfy
    `RpcClient.rpc()`'s declared return type; fixed by wrapping the call in an `async` function.
    The pre-existing `_shared/__tests__/ai-guard.test.ts` / `ai-pricing.test.ts` stay Jest-only
    (they use `jest.fn()` and their subjects are deliberately Deno-agnostic pure logic) and are
    excluded from `deno check`/`deno test` via `deno.json`'s `exclude`; new Deno-only test files
    use a `.deno.test.ts` suffix, excluded from Jest via a new `testPathIgnorePatterns` entry in
    `jest.config.js` (mirroring the existing `*.canary.test.ts` exclusion) — the two runners
    share the same `_shared/__tests__/` directory without either choking on the other's globals.
  - **`lib/pace.ts` could not satisfy both the app and the edge function as specced.** Moved to
    `supabase/functions/_shared/pace.ts` — the single source of truth, no copy/codegen/symlink,
    structurally impossible to drift since there is only one file. The app imports it via a new
    `@shared/*` tsconfig path alias (`@shared/*` → `./supabase/functions/_shared/*`); `jest-expo`
    derives its Jest `moduleNameMapper` from the same `tsconfig.json` `paths`, so the alias
    resolves identically under Metro and Jest with no extra config. The `import type { ScoreBand
    } from '../constants/theme'` line is gone — Deno cannot resolve that extensionless,
    non-aliased specifier, and `theme.ts` pulls in `react-native` regardless — replaced with an
    inline `ScoreBand` union plus a runtime `SCORE_BAND_VALUES` companion. A new test in the
    moved `supabase/functions/_shared/__tests__/pace.test.ts` (Jest-only, since only Jest can
    resolve `constants/theme.ts`) asserts `SCORE_BAND_VALUES` matches `constants/theme.ts`'s
    `ScoreBandOrder` exactly — verified to actually fail by temporarily desyncing the two and
    confirming the test catches it. `npm run typecheck` (`tsc --noEmit`) still passes: `pace.ts`
    is pulled back into the TS program via the import graph despite `tsconfig.json`'s
    `supabase/functions/**` exclude, and has zero Deno-only syntax to break it.
  - **The `knowledge/*.md` files had no bundling mechanism, and the failure mode was silent.**
    `supabase functions deploy` only bundles `supabase/functions/` — the three certified files
    live at the repo root and could never reach a deployed function. Added
    `scripts/generate-knowledge-bundle.js` (`npm run generate:knowledge`), which codegens
    `supabase/functions/_shared/knowledge.generated.ts` (checked in) exporting each file's exact
    contents as a string constant, each wrapped in `assertNonEmptyKnowledge()`
    (`supabase/functions/_shared/knowledge-guard.ts`, hand-written, not generated) — it throws at
    module load if any bundle is empty or whitespace-only, so a deploy can never silently serve
    confident, fluent, ungrounded biomechanics advice; verified live by deliberately emptying a
    generated constant and confirming `deno test` fails loud the moment the module is imported,
    before any handler code runs. `npm run verify:knowledge` (part of `test:edge`, hence part of
    `npm test`) regenerates and runs `git diff --exit-code` against the checked-in file, so
    editing a `knowledge/*.md` without regenerating fails the build — verified live the same way
    (edited `knowledge/drills.md`, confirmed the check failed; reverted, confirmed it passed).
    New Deno-only tests (`knowledge-guard.deno.test.ts`, `knowledge.deno.test.ts`) assert each
    constant is non-empty, contains an anchor heading from its source `.md`, and matches the file
    on disk byte-for-byte.

  Full detail: `docs/architecture.md`'s "Current — Deno build/test contract, pace.ts location &
  knowledge bundling" section; `docs/status.md`'s "Done so far" entry for the same date.

- **AI spend guardrails substrate landed, ahead of `analyze-form` itself (closes #91).** #48
  established account creation on this project is currently unbounded (no signup rate limit,
  autoconfirm on, CAPTCHA blocked on Ian) and its own conclusion is that this blocks M4 *going
  live*, not the M4 *build* — so M4 (#44, still Not Started) was on track to land with no brake
  behind it at all. This ships that brake first, built against the design spec in
  `docs/superpowers/specs/2026-07-12-ai-spend-guardrails-design.md`.
  - **Added** `supabase/migrations/20260712210000_ai_spend_guardrails.sql` — `ai_ops_config`
    (the kill switch + daily $ cap + breaker dials, singleton row, RLS-on-zero-policies plus
    explicit `anon`/`authenticated` grant revocation), `ai_model_pricing` (rates, reprice with
    an `UPDATE`, never a migration; seeded at `claude-sonnet-5` LIST price so every estimate
    errs conservative), `ai_call_log` (the per-call spend ledger — all four token fields stored
    separately since they bill at different rates; `user_id`/`analysis_id` `ON DELETE SET NULL`
    so account/analysis deletion erases personal data but keeps spend history queryable).
  - **Added** `supabase/migrations/20260712210100_ai_spend_guardrail_functions.sql` —
    `gate_ai_call` (kill switch → circuit breaker → daily cap, in order, on a global advisory
    lock; reserves a `'pending'` ledger row on allow), `record_ai_call` (idempotent settle;
    `'cancelled'` releases at $0 immediately, a no-usage-data settle falls back to the estimate
    rather than $0), `ai_breaker_state` (derived on read, not stored — filled a gap the design
    spec left open: a still-`'pending'` row created after the last failure now counts as an
    in-flight breaker probe, so a concurrent burst can't all pass through as "the" probe once
    the cooldown lapses), `ai_spend_today` (one JSONB snapshot for `db-audit`/`cost-monitor`).
    All four `service_role`-only, same privilege shape as `reserve_analysis`'s RPC family.
    **Neither migration is applied to the live project** — no non-production Supabase
    environment exists yet (#92), so both wait on that or Ian applying them directly.
  - **Added** `supabase/functions/_shared/ai-pricing.ts` (pure token/cost estimate math, zero
    imports), `ai-guard.ts` (`gateAiCall`/`recordAiCall`/the deny→`503` HTTP mapping against an
    injected `RpcClient`, also free of Deno-only imports), `ai-guard-client.ts` (the real
    Deno/`Deno.env`/`npm:` service-role client factory, imported only by the eventual edge
    function). 33 new Jest tests across
    `supabase/functions/_shared/__tests__/{ai-pricing,ai-guard}.test.ts` covering the cost math
    and the three refusal cases the issue names (cap exceeded, kill switch on, breaker open)
    against a mocked RPC transport.
  - **Updated** `tsconfig.json` to exclude `supabase/functions/**` from `npm run typecheck` —
    that tree runs on Deno, a different module/type system than this Expo app's `tsc` project;
    `#44` should add its own Deno-side check rather than rely on this one to cover it.
  - **Call ordering, binding on #44**: the gate runs *before* idempotency/`reserve_analysis`,
    not after — if it ran after, every guardrail denial would have to release that reservation,
    and `reserve_analysis` counts released rows against its 3-failed-attempt anti-farming cap,
    which would eventually lock out a legitimate user for something the guardrail did. Full
    contract recorded in `docs/architecture.md`'s "Current — AI spend guardrails substrate"
    section and `docs/status.md` Known Issue #16.
  - **Honestly scoped, not overclaimed**: DB grants make the client unable to bypass the gate,
    and there's no way to get a `call_id` other than through it — but nothing here can stop
    `analyze-form`'s own code from skipping the gate and calling Anthropic directly; that's
    closed by `AGENTS.md`'s mandatory `security-auditor` review of the hot list, not by this
    migration. Also still open, and not something buildable from this repo: the hard spend
    ceiling in the Anthropic Console (Known Issue #16).
- **Issue #70 is genuinely fixed, not just mitigated: server-side HaveIBeenPwned leaked-password
  rejection is now enabled and is the authority.** The blocker was the org (`Echo_Running_Final`)
  sitting on the Free plan — enabling `password_hibp_enabled` returned HTTP 402 during the M1
  security audit (2026-07-11). The org is now on the **Pro plan**, which removed the gate.
  - Set `password_hibp_enabled = true` on the hosted project (`vputdomdlknvthnzritt`) via a
    Management API PATCH to `/v1/projects/{ref}/config/auth`. Returned HTTP 200.
  - **Verified live**: a breached password now hard-fails at `signUp` with HTTP 422,
    `error_code: 'weak_password'`, `reasons: ['pwned']`; a strong password still succeeds. The
    `auth_leaked_password_protection` security-advisor lint is gone — **the project's security
    advisor list is now completely empty (zero findings)**.
  - **`lib/hibp.ts` is deliberately KEPT (Ian's call)**, but its role changes: it is no longer
    the enforcement point, the server is. It stays as (1) a fast inline pre-check for UX —
    instant feedback before the `signUp` round-trip — and (2) defense-in-depth if
    `password_hibp_enabled` is ever flipped off again. It remains client-side, bypassable, and
    fails open on a HIBP timeout/outage, same as before; that is no longer a coverage gap, since
    the server backstops it.
  - New `lib/auth-errors.ts` — `mapAuthError` extracted out of `app/(auth)/sign-in.tsx`'s catch
    block so this security-relevant mapping gets real unit-test coverage (screens aren't
    unit-tested by convention). It takes the raw caught `unknown`, not just a message string,
    because the new branch needs supabase-js's typed `AuthWeakPasswordError.reasons` array to
    tell a server-side breach rejection apart from a plain too-short password — both throw the
    same error class. Covered by new `lib/__tests__/auth-errors.test.ts` (8 tests,
    mutation-verified).
  - **A GoTrue subtlety worth recording**: `reasons` is a set, not a tag — it accumulates, so a
    password that is both too short and breached returns `['length', 'pwned']` (verified live
    with `"abc123"`). `mapAuthError` therefore checks `length` before `pwned`: the more
    actionable message wins, so a user isn't told only "breached" and left never learning the
    8-character rule.
  - `.github/workflows/hibp-canary.yml` gained a second, read-only assertion that
    `password_hibp_enabled` is still `true` on every daily run, filing a distinct
    `security`-labelled issue if it ever reverts (self-healing on recovery, same as the
    existing canary). Rationale: the control is Pro-plan-gated, so a billing lapse or a
    Dashboard toggle could silently disable it, and `lib/hibp.ts` fails open, so it would NOT
    catch that on its own. **This assertion needs a `SUPABASE_ACCESS_TOKEN` repo secret, which
    does not exist yet** — until Ian adds it, the step fails loudly (rather than passing green)
    so an unarmed monitor can't be mistaken for coverage.
  - `docs/status.md`, `docs/architecture.md`, and `docs/blocked-on-apple.md` updated: #70 moves
    from "mitigated, blocked on Supabase Pro" to resolved; the Known Issue about the client-side
    check being the only line of defense is rewritten to reflect that the server now backstops
    it.
  - Verification: `npm run typecheck && npm run lint && npm test` all clean (116 tests).
- **Frame uploads move server-side, after the model call — contract settled, migration written
  but NOT applied to the live project (issue #88).** The old contract was both unbuildable and
  leaking: `reserve_analysis` minted the analysis id server-side yet took `p_media_paths` as an
  input, so the client had to name `{user_id}/{analysis_id}/` before that id existed — and every
  rejection branch (402 over-quota, frame cap, anti-farming) returned *before* the insert, so a
  Free user who had spent their one lifetime analysis uploaded frames, got a 402, and left
  images of their body in the bucket with no row pointing at them, undeletable forever.
  - **Changed** `reserve_analysis` to drop `p_media_paths` (now 4 args) and `settle_analysis` to
    take it (now 5 args), guarded so every path must sit under `{p_user_id}/{p_analysis_id}/` —
    which is what permanently closes #8. Old signatures are `drop function`'d, not merely
    replaced, so no overload keeps the old contract callable.
  - **Removes** the client's `INSERT` and `DELETE` policies on `storage.objects` — the server
    uploads with the service-role key, so a bucket-fill by an authenticated client (#7) stops
    being *possible* rather than being budgeted against.
  - **Removes** the client's `DELETE` policy on `analyses`. With the storage `DELETE` gone, a
    client-side row delete would have stranded that row's frames — #88's own bug from the other
    end. Deletion becomes exclusively #57's edge function, which makes **#57 a hard prerequisite
    for any user-facing delete**. Nothing regressed today: no client code deletes an analysis and
    the M6 delete UI does not exist. This is also the exact policy issue #2 needs gone (deleting
    a row currently resets the free-tier lifetime quota count) — see the overlap note below.
  - **Establishes** that purge deletes by the `{user_id}/{analysis_id}/` **prefix**, never by
    iterating `media_paths` — reachability comes from the row existing, not from `media_paths`
    being populated. #47/#57/#58 inherit this.
  - **Net effect for the client, once applied:** frames cross the wire **once** (base64 in the
    body) instead of twice (bucket + body), and `lib/frames.ts` (#34) never touches Storage.
  - **NOT applied to the live `v2.3Analysis` project.** There is no non-production Supabase
    environment (#92), so applying goes straight to prod, and this work was explicitly scoped to
    write the migration file only (`supabase/migrations/20260712123606_frame_upload_ordering.sql`)
    — read-only MCP queries confirmed the live schema matches the repo's other 9 migrations
    exactly, with no drift, before this file was authored. Applying it and running the live
    verification queries (`docs/superpowers/plans/2026-07-12-frame-upload-ordering.md` Task 2) is
    the required next step before #34/#44 are built.
  - **Overlaps issue #2**, worked concurrently in a sibling worktree: both fixes drop the same
    `analyses` DELETE policy (compatible), but #2 may also rewrite `reserve_analysis`'s
    quota-counting query inside the function body, and this migration's `create or replace
    function public.reserve_analysis(...)` is a full body replacement — whichever migration
    applies last silently wins in full. The two `reserve_analysis` bodies need manual merging
    before either is applied to the live project, not a sequential apply of both files.
  - Added `supabase/__tests__/frame-upload-ordering.test.ts` — a structural regression lock
    against the migration file's text (no pgTAP harness exists in this repo, and the migration
    can't be verified live yet — see above).
  - Docs updated to describe the settled (not-yet-live) contract: `docs/architecture.md` (new
    "Pending" section, the analyze-form flow, the media-pipeline section, the API table row, the
    RPC/RLS/media-privacy paragraphs annotated as pending), `CLAUDE.md` (the media bullet),
    `docs/status.md` (new Known Issue #16, a note on #14's contract list, the M2 next-action
    item).
- **HIBP fail-open is now observable (refs #74).** `lib/hibp.ts` fails open and deliberately
  never logs, which made the leaked-password check silently unobservable: if HIBP's endpoint
  rotted, every sign-up would pass the check forever with nothing to show for it.
  - **Added** `lib/__tests__/hibp.canary.test.ts` — a live-network canary that runs the real
    shipped `checkPasswordBreached` against the live Pwned Passwords range API, asserting a
    known-breached password still returns `breached` and a random one still returns `safe`.
    Both reject `unavailable`. It mocks only `expo-crypto`'s native digest (a real `node:crypto`
    SHA-1 returning lowercase hex, as the native module does), so the uppercase normalization is
    proven end-to-end against a live response.
  - **Added** `jest.canary.config.js` + `npm run test:canary`, and excluded `*.canary.test.ts`
    from `jest.config.js`, so `npm test` stays hermetic and offline.
  - **Added** `.github/workflows/hibp-canary.yml` — the repo's first CI workflow. Daily cron,
    3 attempts with backoff (a canary that cries wolf gets muted), opens/updates a labelled
    `security` issue on sustained failure and auto-closes it on recovery.
  - **Narrowed** issue #74 to the device-side residue only, recording that **Sentry is actively
    contraindicated** here: its breadcrumbs would fingerprint the very passwords the check
    protects.
  - **No user data is collected** and no SDK was added — the App Store privacy-label answers
    are unchanged.
- **Repo audit, second pass: the six actionable Low-severity issues (closes #9, #21, #24, #25,
  #29, #30).** All six needed a design decision, which is why they were not taken in the first
  pass; each decision below is derived from `docs/design/frontend-design-brief.md` §2/§4.1 rather
  than invented. The two remaining Low issues (#60 Elite comparison, #61 motion) are blocked on
  M6/M4 screens that do not exist yet and were left open.
  - **A real semantic error token (#24).** `constants/theme.ts` gains `Semantic.error` (light
    `#C23B52` / dark `#D47383`) — a cool crimson (hue ~350°) deliberately ~335° away from
    `Score.low`'s clay red-orange (hue ~15°), so a **system error and a low pillar score can
    never read as the same thing** on M6's Result screen. Both values clear WCAG AA as text
    (4.5:1) against `background`, `surface.base` **and** `surface.raised` in both themes — worst
    pair 4.61:1 (light/bg) and 4.70:1 (dark/surface.raised, the binding constraint in dark mode).
    Proven, not asserted: 8 new assertions in `constants/__tests__/theme-contrast.test.ts`,
    including an inequality lock against `Score.low`. `sign-in.tsx`'s error text now uses it.
    `success`/`warning` were deliberately **not** added — no consumer exists, and an unproven
    token is exactly what this file's discipline forbids.
  - **The accent is single-use again (#21).** `constants/theme.ts` reserves `Accent.value` for
    "the primary CTA and *only* the primary CTA"; it was appearing 2–3 times at once. Home's
    Retry link → `text.primary` + underline (it keeps the underline, which is what marks it as an
    action). The tab bar's active tint → `text.primary`, and `tabBarInactiveTintColor` is now set
    to `text.secondary` instead of falling back to React Navigation's stock gray. `Accent` now
    appears exactly once per screen: the primary CTA fill. (The full nav-theme rework is #12 and
    was left alone.)
  - **One raised element per screen (#25).** `surface.raised` is defined as "the one raised
    element per screen" and sign-in was giving it to **both** secondary buttons. Google keeps it
    (brief §4.1 lists it first, and it is the lower-friction path); "Continue with email" drops to
    `surface.base`, keeping its `hairline` border. **No accent primary button was introduced** —
    which button should be primary is #20, it is entangled with the not-yet-installed Sign in with
    Apple button, and it stays open.
  - **Four hardcoded strings routed through the copy deck (#30).** `Copy.auth.wordmark`,
    `Copy.home.title` (shared by the heading and the tab label — two independent `'Home'` literals
    before), and `Copy.home.quota.tier.pro`/`.elite`. Two of these have **no deck entry** and are
    backfilled with the gap recorded in-place: whether Home should carry a "Home" heading above a
    "Home" tab at all, and whether the wordmark should become the real mark asset (which now
    exists at `assets/source/mark-*.svg`), are open design questions this change deliberately does
    not answer.
  - **One password-length constant, and the rule shown before you break it (#9).** New
    `constants/auth.ts` exports `PASSWORD_MIN_LENGTH = 8`; the sign-up pre-check and **both** copy
    strings now template off it, killing the triplicated literal. It still **cannot** bind
    `supabase/config.toml`'s `minimum_password_length`, which remains the sole authority — that
    constraint is now stated at the constant itself, not scattered across three files. Sign-up mode
    also shows the rule as helper text under the password field (`Copy.auth.password.hint`), wired
    to the field via `accessibilityHint` so a screen reader gets it too.
  - **Reduced motion is wired (#29).** New `hooks/use-reduced-motion.ts` reads
    `AccessibilityInfo.isReduceMotionEnabled()` and subscribes to `reduceMotionChanged`. It gates
    the one animation that exists today — expo-router's default Stack transition in
    `app/_layout.tsx`. **No new motion was added**: `docs/design/motion-consult.md` is binding, and
    this is the mechanism #61 must plug every future animation into, built before there is anything
    to retrofit.
- **Repo audit: seven small, self-contained M1 bugs fixed in one pass (closes #13, #14, #19,
  #22, #23, #31, #33).** Each had a prescribed, mechanical fix in its issue and needed no design
  decision; everything larger or ambiguous found in the same read-through was left as an issue
  rather than fixed inline.
  - `app/_layout.tsx` — both splash-screen calls (`preventAutoHideAsync`, `hideAsync`) can reject
    and neither was caught (#31). Also caught `Linking.getInitialURL()`'s rejection in
    `lib/session-provider.tsx`, the same class of unhandled promise, found in the same pass.
  - `app/(tabs)/index.tsx` — Home's root is now a `ScrollView` with `flexGrow: 1` (the pattern
    sign-in already used), so large Dynamic Type sizes reflow instead of clipping with no way to
    reach the CTA (#19); the loading state renders `Copy.home.quota.loading` ("Checking your
    plan…") next to the spinner instead of leaving the deck key unused and screen readers with
    nothing to announce (#14); the quota Retry button gets `HitTarget.min` on both axes, up from
    ~28pt (#13); and the sign-out link gets the pressed-state dim every other touchable has (#22).
  - `app/(auth)/sign-in.tsx` — pressed and disabled/busy no longer render at the same opacity
    (#23): `buttonPressed` (0.6) and `buttonDisabled` (0.4) are now separate, matching Home's
    meaning of the two tokens. The mode-toggle link gets press feedback (#22).
  - Deleted the unreferenced create-expo-app template UI — `external-link`, `hello-wave`,
    `parallax-scroll-view`, `ui/collapsible`, `themed-text`, `themed-view`, `hooks/use-theme-color`
    and the four `react-logo` assets (#33). `themed-text` held `#0a7ea4`, the last hardcoded color
    outside `constants/theme.ts`. `haptic-tab` and `ui/icon-symbol` are the only components left,
    both live via `(tabs)/_layout.tsx`.
- **Trimmed the sign-in error that promised a password reset the app doesn't have (closes #18).**
  `auth.error.invalidCredentials` is now "Email or password doesn't match. Try again." — the
  clause "or reset your password" is gone from both `docs/design/copy-deck.md` (Screen 1) and
  `constants/copy.ts`. There is no forgot-password link, no reset screen, and no
  `resetPasswordForEmail` call anywhere in the repo, and this is the error a returning user is
  most likely to hit, so it was routing them at a capability that does not exist. Ian's call
  (2026-07-12) was to trim the copy rather than build the flow; a real reset flow is an auth
  feature (new screen + deep-link/redirect config) and would be filed separately.
- **Closed #65 (M7: remaining empty/error/offline states) as not planned, no code changed.** It
  was an umbrella whose two halves both belong elsewhere. Wiring the deck's states into screens
  3–11 is blocked — those screens don't exist (M2–M6 not started) — and lifting a screen's copy
  keys is part of building that screen, not a polish pass afterwards, so it belongs in each
  milestone's own issue rather than a standing M7 one. Its actionable half (the M1 audit's
  missing deck keys) was already covered by #30, #17, #9, and #18. The audit found gaps wider
  than those issues recorded; they're now comments on #30 (a third hardcoded string,
  `title: 'Home'` in `app/(tabs)/_layout.tsx`, plus hardcoded `'Pro'`/`'Elite'` in
  `describeReadyQuota`) and #9 (the `8` is triplicated across `config.toml`, `sign-in.tsx`, and
  the `copy.ts` string, and the rule is still invisible until the user fails).
- **Merged the three open PRs to `main` and cleared the Apple-blocked work out of the tracker.**
  - Merged PR #73 (client-side HIBP check), PR #72 (privacy policy + labels + consent design),
    and PR #75 (EAS init + icon/splash) into `main`, resolving the conflicts between them. All
    three had added an entry under this date, and all three had edited `docs/status.md`.
  - **One real integration bug surfaced only in the merge:** #73 added HIBP as a new third party
    and made `docs/privacy-checklist-m7.md` require the policy to name it — while #72, written in
    parallel, drafted a policy that never mentioned HIBP at all. Each PR was self-consistent; the
    two merged together were not. `docs/privacy-policy.md` now discloses HIBP/Cloudflare
    (k-anonymity: the password never leaves the device; HIBP sees an IP + timestamp).
  - **New [`docs/blocked-on-apple.md`](blocked-on-apple.md).** Everything needing the Apple
    Developer Program is tracked in that file instead of in GitHub issues, so the open-issue list
    holds only work that is actionable today. Issues #66 (EAS/TestFlight pipeline) and #67 (Sign
    in with Apple) were **deleted** and reproduced verbatim there; #68 and #69 were **rewritten**
    to keep only their non-Apple halves.
  - #69 was retitled — it is **not** Apple-blocked. Its trigger is the first dev build, and
    `eas.json`'s `development` profile builds for the iOS simulator with no Apple account.
  - **Closed #26** (splash / Android adaptive-icon colors) — fully fixed by PR #75.
  - `jest.config.js` now ignores `.claude/worktrees/`. Those worktrees carry their own
    `node_modules` and a duplicate copy of the test suite, so `npm test` was discovering the
    copies and failing two suites that pass in the real tree. Added to `.gitignore` as well.
- **Implemented the client-side HaveIBeenPwned leaked-password check (issue #70)** — the
  follow-up to the 2026-07-11 M1 security audit's HTTP 402 finding below: Supabase's
  server-side leaked-password protection is Pro-plan-gated and stays unenabled, so this adds an
  equivalent check ourselves instead of waiting on a plan upgrade.
  - New `lib/hibp.ts`: `checkPasswordBreached(password)` SHA-1s the password on-device
    (`expo-crypto`), sends only the first 5 hex chars of the hash to HIBP's free, keyless Pwned
    Passwords range API (`api.pwnedpasswords.com`, Cloudflare-fronted) with `Add-Padding: true`,
    and matches the remaining 35 chars locally — k-anonymity means the plaintext password and
    the full hash never leave the device.
  - Wired into `app/(auth)/sign-in.tsx`'s sign-up branch only, called before
    `supabase.auth.signUp`: a breached password hard-blocks account creation (no account is
    ever created); an unreachable/timed-out HIBP fails open and lets the signup proceed —
    deliberate, since a bypassable client-side check must not block a real signup on a
    third-party outage.
  - Adjacent fix: `mapAuthError` used to swallow Supabase's "password should be at least 8
    characters" into the generic error, telling a user with a too-short password nothing
    actionable. Added a specific `auth.error.passwordTooShort` mapping, plus a new
    `auth.error.passwordBreached` copy key — both added to `docs/design/copy-deck.md` first,
    then lifted into `constants/copy.ts`, per the deck's rule against hand-writing copy in JSX.
  - `lib/__tests__/hibp.test.ts` — 15 tests, mutation-verified, covering the correctness traps
    called out in `lib/hibp.ts`'s header comment (padding rows never count as a match,
    case-insensitive suffix compare, uppercase-before-slice, non-2xx/timeout/network-throw all
    fold to `unavailable`, and a privacy assertion that only the 5-char prefix ever appears in
    the outbound request URL).
  - **Known, deliberate limits — this does not close issue #70.** The check is client-side and
    therefore bypassable: anyone can call the Supabase Auth API directly and set a breached
    password, so it protects real users from reused breached passwords but is not server-side
    enforcement — the Pro-plan upgrade is still the real fix. It runs on sign-up only; there is
    no password-reset/change-password flow in the app yet, and one built later must call
    `checkPasswordBreached` too. Not applicable to Google OAuth, which has no password.
  - `docs/architecture.md`'s `lib/` layout and Supabase-config sections updated to distinguish
    the still-unapplied server-side setting from the new client-side mitigation.
    `docs/privacy-checklist-m7.md`'s data inventory gained a row for `api.pwnedpasswords.com`,
    plus a standing requirement to deny/drop that URL if a crash or analytics SDK is ever added
    (its request URL is a durable, identity-linked password-hash-prefix fingerprint otherwise).
- **Issue #68 (M7 privacy gate) — the unblocked slice.** The issue's two in-app items (consent
  line, result disclaimer) are blocked on M2/M4, which don't exist yet; the rest was buildable
  now and is done.
  - `docs/privacy-policy.md` — new, the publishable policy text. **Publication is ON HOLD**:
    the data controller's legal name/country and a contact email are unresolved, and
    publication is additionally gated on in-app account deletion actually shipping (App Store
    Guideline 5.1.1(v)). Guarded by a `DO NOT PUBLISH` HTML comment.
  - `docs/app-store-privacy-labels.md` — new, the exact App Store Connect / Play Data Safety
    answers so submission is a lookup rather than a re-derivation.
  - **Corrected a material factual error before it could ship.** The draft policy (and
    `docs/privacy-checklist-m7.md`, its source) claimed Anthropic retains data for a ~30-day
    "trust-and-safety window." Verified against Anthropic's live retention docs: that is
    backwards — 30 days is the *ordinary* window, and content flagged by Anthropic's automated
    safety systems may be retained **up to two years**, a carve-out that survives even Zero
    Data Retention. The draft also wrongly promised ZDR would "close this window entirely."
    This matters here specifically: the payload is images of bodies in running kit, the class
    of image most likely to be a safety-classifier false positive.
  - **Consent upgraded to an Art. 9-grade design (Ian's call).** The drafted Continue/Cancel
    modal is an affirmative act but not *explicit* consent, and it never named health data at
    all — so it could not carry Art. 9. `consent.upload.*` in `docs/design/copy-deck.md` now
    has a `consent.upload.checkbox` key naming the health processing and Anthropic by name,
    with the primary CTA disabled until it's ticked. M2 must build this variant.
  - **Fixed invalid-consent copy.** `consent.upload.body` said "Your photo or video is stored
    privately" and `settings.privacy.body` contradicted itself in a single string — but the
    original video never leaves the device (Ruling 1). Misinformed consent is invalid consent;
    both are now frames-only.
  - **Label answers: declare more, not less.** Added `Health & Fitness → Health` (the
    injury-risk flags are health data regardless of whether the runner's note ever ships) and
    `Usage Data → Product Interaction`, resolving two policy-vs-label contradictions that App
    Review specifically checks for.
  - **Decisions recorded:** TestFlight beta excludes EU/UK testers (keeps GDPR out of scope for
    the beta, avoiding an Art. 27 representative); the policy will be hosted from a new public
    repo via GitHub Pages (this repo is private on GitHub Free, where Pages is unavailable —
    and pointing Pages at `/docs` would leak internal planning docs).
  - **New for counsel:** the Australian Privacy Act's small-business exemption does **not**
    apply to a business holding health information (s6D(4)(b)) — an app producing injury-risk
    assessments plausibly qualifies, which would make this a full APP entity regardless of
    size. Flagged in the checklist.
  - Checklist stale items resolved: the camera/photo-library permission strings *are* present
    in `app.json` (landed in `943d04b`), so that MUST box and conflict #3 are now ticked.
  - Verified no analytics/crash SDK: `package.json` is clean (no Sentry/Segment/Firebase/
    RevenueCat/Amplitude/Mixpanel/PostHog/Bugsnag/AppsFlyer/Facebook, and no `expo-updates`).
- **EAS project initialized** (GitHub issue #66, groundwork only — the pipeline is still
  blocked, see below). `eas init` created `@ianbeatingpros/pace-analysis-ai`
  (`d19968ff-22b8-4851-8e74-087aeb9846b0`); `app.json` gained `extra.eas.projectId` and a
  top-level `owner: "ianbeatingpros"`. `owner` was added deliberately, not left to the default:
  without it, EAS resolves a project by slug against whoever is currently logged in, which
  silently breaks the same `eas build` command on another machine or in CI.
- **New `eas.json`**, four build profiles. `eas.json` is parsed with a strict Joi schema (plain
  `JSON.parse`) and cannot contain comments, so the reasoning below lives here, not in the file:
  - `development` — dev client, internal distribution, `ios.simulator: true`, Android APK.
    `ios.simulator: true` is what makes an iOS build possible **at all** today — there is no
    Apple Developer account, so a real-device iOS build has nowhere to get a provisioning
    profile from.
  - `development-device` — extends `development`, `ios.simulator: false`. Written but unusable:
    blocked on the Apple Developer account (an on-device build needs an ad-hoc provisioning
    profile).
  - `preview` — internal distribution, Android APK.
  - `production` — `autoIncrement`, Android app-bundle.
  - `submit.production` — an empty placeholder; the App Store Connect app ID and Apple team ID
    land once Apple exists.
- **EAS server-side env vars created** (project scope) for `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, in all three environments (development/preview/
  production), at visibility **`sensitive`, deliberately not `secret`** — recording the
  reasoning so a future session doesn't "harden" it and break things. `EXPO_PUBLIC_*` is
  inlined in plain text into the compiled bundle regardless of how EAS stores it, so anyone who
  installs the app can extract it — the key's real protection is Supabase RLS, not secrecy.
  `secret` visibility is **write-only** (unreadable via the dashboard, `env:list`, *and*
  `env:pull`), so it would buy zero security while destroying recoverability: no `eas env:pull`
  onto a new machine, and no diffing the EAS value against the live Supabase ref when a build
  points at the wrong backend. `ANTHROPIC_API_KEY` was verified **absent** from all three EAS
  environments and must stay that way — it belongs only in `supabase secrets`, per `CLAUDE.md`
  § Secrets & env. Worth stating plainly: a build missing these vars does not degrade —
  `lib/supabase.ts` throws at module import, so the app hard-crashes on the splash screen.
- **Real app icon + splash art landed, replacing the Expo template defaults — closes GitHub
  issue #26.** Design is "The Gait Plate" (`docs/design/frontend-design-brief.md` §1): a ground
  rule, a posture line leaning off it, a short detached arc marking the lean angle (drawn like a
  goniometer/biomechanics annotation), and a filled landing marker at the vertex — the one point
  of color, `score.strong` (`#2E7D5B`), deliberately **not** `accent` (`#2F6BEB`), which the
  brief reserves for the primary CTA alone.
  - New `assets/source/*.svg` (`mark-light`, `mark-dark`, `mark-mono`, `mark-favicon`) is now
    the versioned source of the art, not hand-edited PNGs.
  - New `scripts/generate-app-assets.js` + `npm run assets` rasterizes the SVGs into the six
    PNGs in `assets/images/` that `app.json` points at. `sharp` added as a devDependency — the
    machine had no rasterizer at all before this. The PNGs are build outputs: edit the SVGs, run
    `npm run assets`, never hand-edit the PNGs.
  - `icon.png` is deliberately flattened onto the bone field with **no alpha channel**: iOS
    applies its own corner mask, and App Store Connect rejects an icon that carries
    transparency. The generator script hard-fails if alpha ever reappears on that file — this
    rule is enforced in code, not just documented, so it can't silently regress.
  - New `assets/images/splash-icon-dark.png` and a new `dark.image` key in `app.json`'s
    `expo-splash-screen` plugin config. This goes beyond what issue #26 asked for (a dark splash
    **background color** swap only), and the reason matters: the splash mark is dark ink drawn
    for the light (bone) field, so on the warm-graphite dark background it would have been
    near-invisible — and `app/_layout.tsx` deliberately holds the splash (
    `SplashScreen.preventAutoHideAsync()`, hidden only once fonts and the session check both
    resolve) for a real, visible duration, so an invisible mark would actually be seen.
  - Deleted `assets/images/android-icon-background.png`: issue #26 wanted a flat background
    **color** for the Android adaptive icon, so the PNG that used to hold a solid field was dead
    weight.
- **Issue #26 is closed by this work**: splash `backgroundColor` `#ffffff` → `#F4F1EA`, dark
  `#000000` → `#1A1712`; Android `adaptiveIcon.backgroundColor` `#E6F4FE` (Expo template pale
  blue) → `#F4F1EA`. All three are now `constants/theme.ts` tokens instead of template defaults.
- **Issue #66 stays open.** There is still no Apple Developer account, so there are no iOS
  credentials, no `eas build` for a device or the store, no `eas submit`, and no TestFlight
  pipeline — the second half of #66's title ("...and TestFlight pipeline") is not done. Sign in
  with Apple (#67, already `docs/status.md` Known Issue #3) is the same dependency. Removing
  `exp://**` from the Supabase redirect allowlist (#69) is still a required pre-first-EAS-build
  cleanup and has not been done. `docs/status.md` Known Issue #7 is split rather than closed to
  reflect this.
- **Built the consent record + the two Art. 9 UI drop-ins (issue #68), plus the binding
  `analyze-form` consent check they depend on.** The client checkbox only *collects* consent;
  GDPR Art. 7(1) requires being able to *demonstrate* it, so this adds the record that does that.
  - New `public.consents` (8th migration, `20260712020729_consents.sql`) — an append-only log of
    consent events: `id`, `user_id` (defaults to `auth.uid()`, FK to `profiles` on delete
    cascade), `consent_key`, `granted`, `created_at`. Owner-scoped SELECT and INSERT RLS
    policies; deliberately **no UPDATE and no DELETE policy at all** — RLS default-denies
    whatever it has no policy for, so that absence, not a convention, is what makes the log
    append-only. A withdrawal is a new row with `granted = false`, never a mutation of the
    grant. Verified live against the real database with an `authenticated` JWT.
  - New `lib/consent.ts` — `UPLOAD_HEALTH_CONSENT` (`'upload.health.v1'`), `hasConsented`,
    `grantConsent`, `withdrawConsent`. Versioning lives in the key, not a column: rewording the
    consent copy mints a `v2` key and `hasConsented` is automatically false for every existing
    user until they re-tick, no migration needed. **Fails closed**: `hasConsented` throws on any
    query error instead of defaulting to `true` (would process Art. 9 health data with no legal
    basis) or `false` (indistinguishable from a real non-consent, which hides an outage — the
    same class of bug already open at #74, where `lib/hibp.ts` fails *open* with nothing saying
    so). 10 tests.
  - New `components/consent-gate.tsx` — the Art. 9 modal content: checkbox unticked by default,
    primary CTA disabled until it's ticked (the affirmative, unbundled act that makes this
    consent rather than a "by continuing" notice), and a fail-closed error state if the write to
    `public.consents` fails (the gate stays up, nothing is uploaded). 6 tests.
  - New `components/result-disclaimer.tsx` — the "not medical advice" footer,
    `result.disclaimer.footer` from the copy deck. 2 tests.
  - `constants/copy.ts` gained the `consent.upload.*` keys and one genuinely new one,
    `consent.upload.error.record` (the consent-write-failed message); `docs/design/copy-deck.md`
    documents both.
  - New devDependency `@testing-library/react-native` — a deliberate, narrow exception to
    `CLAUDE.md`'s "screens are not unit-tested for now": these are components, not screens, and
    the disabled-until-ticked gate is a compliance control that must not be able to regress
    silently.
  - **The binding half of this work: `analyze-form` (M4, issue #44) must refuse to run for a
    user with no recorded consent, or none of the above is enforcement, just UX that anyone
    calling the API directly can skip.** That function doesn't exist yet, so the exact check is
    recorded where its builder will find it — `docs/status.md` Known Issue #14 (a fourth,
    binding contract bullet alongside the existing M4 notes) and `docs/architecture.md`'s
    `analyze-form` flow spec.
  - `docs/status.md`'s M7 milestone row and `docs/privacy-checklist-m7.md` updated: the three
    #68 checkboxes (consent modal, disclaimer, and the public-launch consent-modal item) stay
    **unticked** — this is UI still blocked on M2/M4/M5 hosting it — but each now notes that the
    record, copy bindings, and both components already exist, so what's left is purely hosting
    plus the M4 server-side check.
  - **Corrected a factual error in issue #68 and this checklist**: both claimed the disclaimer
    was "sourced from `knowledge/injury_flags.md`." Checked against both knowledge files —
    `injury_flags.md`'s disclaimer is differently-worded prompt content for the model (it adds a
    "never run through sharp or worsening pain" sentence, among other changes). The shipped
    string, `result.disclaimer.footer`, is sourced verbatim from `knowledge/pace_framework.md`
    instead.
- **The four pending migrations above were applied to the live project and verified — the
  "written but not yet applied" state recorded earlier in today's entries is over.** Ian ran
  `supabase db push` against `v2.3Analysis` (ref `vputdomdlknvthnzritt`), landing
  `20260712040000_analyses_quota_soft_delete.sql` (#2), `20260712123606_frame_upload_ordering.sql`
  (#88), `20260712210000_ai_spend_guardrails.sql` and `20260712210100_ai_spend_guardrail_
  functions.sql` (#91) in one push — 13 migrations total now live, up from 9. Low-risk timing:
  the database is essentially empty (2 auth users, 2 profiles, 0 analyses, 0 consents, 0
  subscriptions, 0 storage objects), which is exactly the situation issue #92 (no non-production
  Supabase environment) predicted this project would stay in until a real feature starts writing
  rows.
  - **`analyses`, verified**: the client-facing DELETE policy is gone; the two remaining
    policies are "Users can view their own analyses" (SELECT) and "Users can soft-delete their
    own analyses" (UPDATE, #2). `has_table_privilege` confirms DELETE, INSERT, and TRUNCATE are
    all revoked for `anon` and `authenticated`; SELECT is retained; UPDATE is column-scoped to
    `deleted_at` only. The `deleted_at` column exists.
  - **RPC signatures, verified**: `reserve_analysis` is the new 4-arg form (`p_media_paths`
    dropped); `settle_analysis` is the new 5-arg form (namespace-guarded `p_media_paths`) — #88's
    signature change landed, and #2 did not overwrite it (#2 never touches either function body).
  - **The predicted overlap between #2 and #88 resolved exactly as designed, confirmed by the
    push log itself**: applying `20260712123606` emitted `NOTICE: policy "Users can delete their
    own analyses" ... does not exist, skipping` — the safe no-op the migration's own header
    comment predicted, because #2 (earlier timestamp) had already dropped that policy. No manual
    reconciliation was needed.
  - **`storage.objects`, verified**: RLS enabled, zero INSERT policies, zero DELETE policies;
    only "Users can view their own media objects" (SELECT) remains — the client cannot write to
    the bucket. **Not closed by this push**: the bucket's table-level `GRANT INSERT`/`GRANT
    DELETE` to `authenticated`, left over from the bucket-creation migration, were never revoked
    — the client is blocked only by the missing RLS policy, not by privilege, so there's no
    defense in depth here the way `analyses` now has. Filed as issue #100 (narrower than
    originally suggested: `storage.objects` specifically, shared across every bucket) — see
    `docs/status.md` Known Issue #18.
  - **Guardrail tables, verified**: `ai_ops_config`, `ai_model_pricing`, and `ai_call_log` all
    exist; `authenticated` can SELECT none of them and cannot EXECUTE `gate_ai_call` —
    service-role only, as designed.
  - **Security advisors: zero warnings, zero errors.** Three INFO-level `rls_enabled_no_policy`
    notices remain, one per `ai_*` table — this is **intentional** (RLS on + zero policies +
    `revoke all` = deny-by-default for operator-only tables) and should not be "fixed" by adding
    a policy later.
  - **Still open, unaffected by this push**: the hard spend ceiling in the Anthropic Console
    (issue #91's one remaining manual step, needs Ian's Console access) and issue #92 itself
    (no non-production environment) — this push went straight to prod precisely because #92
    hasn't been resolved.
  - **Not changed by this push**: the app's upload/analysis flow does not exist yet (#34, #44).
    The schema these four migrations harden is now ready for that flow to be built against; the
    flow itself is still Not Started.
  - `CLAUDE.md`, `docs/status.md` (M4 milestone row, Known Issues #16/#17, new Known Issue #18),
    and `docs/architecture.md` (DB schema, RLS, and AI-guardrail sections) updated to describe
    this as live rather than pending.
- **Built `DELETE /functions/v1/analysis/:id` (issue #57), closing issue #3** (deleting an
  analysis orphaned its Storage frames forever — a privacy defect, not a storage-cost one).
  Written and tested only, on `fix/57` — **not deployed and no migration applied**; see
  `docs/status.md` for exactly what remains before this is live.
  - **Files**: `supabase/functions/_shared/delete-analysis.ts` (pure, injectable orchestration:
    ownership check, prefix purge with pagination + recursion + a post-remove verification
    re-list, HTTP-status/body mapping — fully Deno-tested), `supabase/functions/_shared/
    delete-analysis-client.ts` (the real service-role Supabase/Storage client, untested, same
    split as `ai-guard.ts`/`ai-guard-client.ts`), `supabase/functions/analysis/index.ts` (the
    thin `Deno.serve` entrypoint: method/id validation, JWT verification via
    `auth.getUser()`, wiring), and 19 new Deno tests in
    `supabase/functions/_shared/__tests__/delete-analysis.deno.test.ts`.
  - **No schema change was needed.** Verified live via the Supabase MCP before writing any code:
    `service_role` holds unrestricted table-level grants on both `public.analyses` and
    `storage.objects` (bypasses RLS entirely), so the function reads/writes the row and lists/
    removes Storage objects directly — no new RPC, no migration, and (per this issue's hard
    constraint) `reserve_analysis`/`settle_analysis`/`release_analysis` were never touched.
  - **Ordering: purge Storage first, mark the row deleted second — never the reverse.** If the
    row were marked deleted first and the purge then failed, the analysis would vanish from the
    user's view while its frames (images of a person's body) kept existing in the bucket — the
    exact failure issue #3 exists to close, reached through this function instead of a raw
    client DELETE. Purging first means any failure leaves the row exactly as it was and returns
    `purge_failed` (503, safe to retry) instead of a false "deleted".
  - **The purge is idempotent by construction and always attempted, regardless of the row's
    current `deleted_at`.** This closes two problems with one property: a retried DELETE call
    converges instead of erroring (re-listing an empty prefix is a cheap no-op), and — more
    importantly — `public.analyses` still carries a client-facing soft-delete UPDATE policy
    (issue #2) that a caller can hit directly, bypassing this endpoint and leaving frames
    orphaned. Because this function never gates the purge on `deleted_at`, if the client's UI
    ever does route that same analysis's delete through this endpoint, the orphaned frames get
    purged anyway. **This narrows but does not fully close that gap** — nothing can force a
    client to call this endpoint at all; a scheduled reconciliation job or an async
    trigger-driven purge would close it completely and is a good candidate for a follow-up
    issue, not attempted here (out of scope, and #2's migration is settled).
  - **Purge-then-verify, not purge-and-trust.** After `remove()` reports no error, the code
    re-lists the same prefix and refuses to mark the row deleted if anything is still there —
    proven by a test that makes `remove()` silently drop one path with no reported error.
  - **Authorization is explicit code, not RLS**: `findById` has no ownership filter (the real
    client bypasses RLS by design, same as every other service-role path in this codebase);
    `row.user_id !== callerUserId` is checked in `deleteAnalysis()` itself and proven by a test
    asserting Storage is never even listed for someone else's analysis id. The Storage prefix is
    also always rooted at the *caller's own* id, never the row's, so a wrong/foreign id can only
    ever probe an empty prefix under the caller's own namespace.
  - **Recursion and pagination**: proven against the exact "nested-prefix trap"
    `docs/privacy-checklist-m7.md` names (a flat, non-recursive list "removes nothing, and
    orphans every frame — while reporting success") with a test asserting a nested folder under
    the prefix is still purged, plus a pagination test across multiple `list()` pages.
  - **Verification run**: `npm run typecheck && npm run lint && npm test` clean — `tsc --noEmit`,
    `deno check` (12 files, including the 2 new source files + new test file), `expo lint`, 207
    Jest tests (unchanged), and 29 Deno tests (19 new + the pre-existing 10) all pass.

- **A failed Google OAuth exchange is no longer a silent no-op (closes #5).** Root cause was
  two-fold. First, `lib/session-provider.tsx`'s Linking listener — the deep-link fallback path
  for a redirect that arrives outside `signInWithGoogle`'s own awaited call — discarded every
  exchange failure with a bare `.catch(() => {})`; nothing else was watching that path, so the
  failure had nowhere to go. Second, `lib/auth.ts`'s dedupe guard against the Android
  double-delivery race (the same redirect reaching `createSessionFromUrl` more than once
  concurrently) marked a code "processed" in a `Set` *before* the exchange resolved and never
  unmarked it on failure — so the race's loser silently got `null` back (read by
  `app/(auth)/sign-in.tsx` as "user cancelled") even when the winner's exchange had actually
  thrown.
  - `lib/auth.ts`: the `Set` is replaced with a `Map<code, Promise<Session | null>>` of in-flight
    exchanges. Every concurrent caller racing the same code now awaits the identical promise and
    gets the identical outcome — success or the real rejection, never a silent `null` — and the
    entry is evicted once the exchange settles, so it can't grow unbounded either. Provider-
    reported redirect errors (`?error=access_denied` etc.) now throw a typed `OAuthRedirectError`
    (`lib/auth-errors.ts`) instead of a plain `Error`, so the message doesn't have to be
    pattern-matched later.
  - `lib/session-provider.tsx`: the Linking listener's catch now maps the error (`mapAuthError`)
    into a new `deepLinkAuthError` on `SessionContextValue`, plus a `clearDeepLinkAuthError()`.
    Safe to always surface — `createSessionFromUrl` only ever throws for a URL that really was
    part of an auth redirect; it returns `null`, not a rejection, for any unrelated deep link.
  - `lib/auth-errors.ts` (`mapAuthError`): two new typed branches. `OAuthRedirectError` with
    `code === 'access_denied'` → `Copy.auth.error.signInCancelled` (the user declined on the
    provider's own consent screen — a decision, not a break, but delivered through a different
    channel than `WebBrowser`'s cancel/dismiss result, so it can't stay silent the way a plain
    browser-cancel does). Any other provider code, plus `AuthPKCECodeVerifierMissingError` /
    GoTrue's `flow_state_not_found` / `flow_state_expired` / `bad_code_verifier` /
    `bad_oauth_state` / `bad_oauth_callback` (a lost or no-longer-matching PKCE verifier — the
    verifier lives in client storage, so this is a real failure mode, not a hypothetical one) →
    `Copy.auth.error.signInExpired`. Everything else (bad/expired code, network) still falls
    through to the existing `Copy.auth.error.generic`, unchanged.
  - `app/(auth)/sign-in.tsx` reads `deepLinkAuthError` from `useSession()` alongside its own local
    `errorMessage` (`errorMessage ?? deepLinkAuthError`) and clears both together on every new
    attempt, so a stale message from a previous failure can't linger into the next one.
  - New copy: `Copy.auth.error.signInCancelled` ("Sign-in was cancelled.") and
    `Copy.auth.error.signInExpired` ("Sign-in expired before it could finish. Try again.") —
    both provider-neutral, since Apple sign-in (`auth.cta.apple`) will reuse the same
    `createSessionFromUrl` path once it ships. Added to `constants/copy.ts` and
    `docs/design/copy-deck.md` (Screen 1).
  - Tests: `lib/__tests__/auth.test.ts` (new) locks `createSessionFromUrl`'s contract directly —
    a URL with no `code`/`error` still resolves `null`, a provider error throws
    `OAuthRedirectError`, and the race-condition fix specifically: concurrent callers on the same
    code share one exchange call and get the identical resolution *or* the identical rejection.
    Verified this last case is load-bearing by reimplementing the old `Set`-based dedupe
    standalone and confirming it fails that exact assertion (the race's loser resolves `null`
    instead of rejecting). `lib/__tests__/auth-errors.test.ts` extended with the two new
    `mapAuthError` branches, including every `FLOW_STATE_ERROR_CODES` entry individually and a
    negative case for an unrelated `AuthApiError` code.

## 2026-07-11

- Executed Phase 0 of `docs/mvp-build-prompt.md` ("Reconcile before building anything"),
  committing the previous session's layer (the knowledge files, the `docs/design/` brief, and
  the build prompt itself) and closing the decision gate.
- **Ian answered the five remaining decision-gate items:**
  - Fallback/quota (#4): a validation-failed analysis becomes an honest, clearly-labelled
    partial result only when ≥2 pillars parsed, otherwise a clean failure; failures and
    fallbacks never burn quota (the atomic reserve is released), capped at 3 free retries per
    period against prompt-injection farming.
  - The numbers (#5): max clip length 15s; frames analyzed per tier — Free 1 / Pro 5 / Elite 8;
    max upload size 50MB pre-compress.
  - App name (#6): **"Pace AnalysisAI."** Repo/directory keeps the "V2.3" codename internally.
  - Apple Developer timing (#7): build email + Google sign-in in M1 now; add Sign in with Apple
    the moment an Apple Developer account exists, before TestFlight review.
  - Consent & privacy (#8): a one-line consent notice before first upload plus a Settings
    disclosure ship in v1; the full privacy policy and App Store privacy labels are tracked for
    M7, not dropped.
- Renamed the app in `app.json` to match decision #6: `name` "Pace AnalysisAI", `slug`
  `pace-analysis-ai` (dots removed — the previous slug was illegal), `scheme` "paceanalysisai",
  `ios.bundleIdentifier` and `android.package` both `com.ian.paceanalysisai` (follows V2.2's
  `com.ian.*` precedent).
- Synced all 14 rulings from `docs/mvp-build-prompt.md` §0-B into `planning/README.md`,
  `planning/01-brainstorm.md`, `planning/02-product-requirements.md`,
  `planning/03-engineering-requirements.md`, and `docs/architecture.md`: frames-only media
  pipeline (`media_path text` → `media_paths text[]`, direct-to-bucket upload, no video ever
  stored), the atomic reserve/settle quota RPC replacing count-then-insert, the idempotency-key
  design, the frame-sampling spec (5%–95% window, actual timestamps, ≤1568px/q≈0.7 downscale),
  V2.2's purchase-anchored quota-period arithmetic with Free as lifetime, the new
  `delete-account` edge function, the corrected Sonnet 5 model config (explicit thinking,
  4–8k `max_tokens`, forced tool call), the `{ error, code }` error contract and the
  `FunctionsHttpError`-unwrapping client note, the corrected 4-source-files-to-3-targets
  knowledge mapping (`drills.md` sourced from `ECHO_Framework_CORRECTED.md`, not
  `training_zones.md`/`workout_library.md`, which have zero drills), and the V1 ground-truth
  corrections (real enforcement lives in `anthropic-coach`, not `lib/subscription.ts`; V1 video
  "analysis" was one thumbnail at t=1s; V1 never persisted results).
- Updated `docs/status.md`: Known Issues #1 (app name) and #2 (illegal slug) marked resolved;
  #3 (Apple) records the timing decision; #9 (storage) updated to reflect frames-only retention.
  "Next action" now points at Phase 1 (the spine, M1) since the decision gate is fully closed.
- **Executed Phase 0.5 (the design layer) via four parallel agents**, closing its gate:
  - `ux-copywriter` → `docs/design/copy-deck.md`: the full copy deck — every screen state,
    permission rationales, the consent line, quota captions, and the disclaimer wording the
    brief called for but didn't fully write out.
  - `design-system` → rebuilt `constants/theme.ts` from the brief's §2 tokens (light+dark,
    score-band palette, spacing/radii/type scales), added `constants/contrast.ts`, and added
    `constants/__tests__/theme-contrast.test.ts` — a 61-assertion Jest proof every text/surface
    and band pair clears WCAG AA. **9 of the brief's intent values needed adjustment** to pass
    (darkened or lightened minimally); each old → new value is recorded inline in `theme.ts`
    next to the token it changed, not repeated here. Installed the three font families
    (`@expo-google-fonts/archivo`, `inter`, `ibm-plex-mono`) via `npx expo install`, which
    auto-added the `expo-font` plugin to `app.json`.
  - `motion-animation` → `docs/design/motion-consult.md`: confirmed every motion in brief §6 is
    implementable on the already-installed Reanimated/gesture-handler stack (no new
    dependencies) and specified the gaps the brief left open (wait-state pacing, reveal
    triggers, reduced-motion mapping) as binding spec for `frontend-builder`.
  - `privacy-compliance` → `docs/privacy-checklist-m7.md`: a ranked MUST/SHOULD privacy and
    compliance checklist gating M7 (App Store privacy labels, consent upgrade, data inventory,
    retention limits), which surfaced two new decisions for Ian, added to `docs/status.md` as
    Known Issues #10 and #11: (a) `knowledge/injury_flags.md` assumes a user-supplied free-text
    injury/pain note that has no field or screen anywhere in `planning/02` or the design brief —
    ship it (a new health-data channel needing its own consent + label) or drop it for MVP,
    decide before M3/M4; (b) no dollar figure exists anywhere for the Pro/Elite paywall, needed
    before M5.
  - Also fixed a dangling cross-reference in `docs/design/frontend-design-brief.md` screen 6:
    it cited "build prompt Ruling 15" for the Retry/Cancel-must-never-trap-the-user rule, but
    the build prompt's rulings end at 14. Replaced the citation with the rule stated inline.
- `CLAUDE.md`'s Secrets & env section's media bullet was corrected to frames-only wording
  (extracted frames are what's stored; the full-resolution video never leaves the device).

- **Ian closed the two decisions Phase 0.5 surfaced** (asked and answered same day):
  - **Runner's note: dropped for MVP.** The analysis runs on frames alone; no free-text
    injury/pain note field ships. `knowledge/injury_flags.md`'s note-handling guidance is
    dormant — M3's prompt adaptation excludes it (under Ian's certification review), and the
    `analyze-form` contract stays note-free. Revisit post-TestFlight (if shipped later it's a
    health-data channel with its own consent + privacy-label cost).
  - **Paywall pricing: Pro $6.99 / Elite $14.99 per month** — display prices for the M5 dummy
    paywall, chosen over Echo V1's $4.99/$9.99 as a higher anchor; real IAP (post-MVP) can
    re-decide. `docs/design/copy-deck.md`'s `{{price}}` placeholders resolved.
- **Executed Phase 1 — the spine (M1)** on `feat/m1-spine`, four commits, built/reviewed/audited
  same day:
  - `943d04b` — `supabase init` (`config.toml`, `supabase/.gitignore`, project linked to
    `vputdomdlknvthnzritt`); `app.json` got the `expo-camera` + `expo-image-picker` plugins with
    the copy deck's exact `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` strings,
    mic permission stripped on both platforms (`microphonePermission: false` on both plugins,
    `recordAudioAndroid: false`) — verified via a throwaway prebuild that no
    `NSMicrophoneUsageDescription` lands in `Info.plist` and `RECORD_AUDIO` is actively removed
    from the Android manifest.
  - `2b1e6f6` — the DB spine, **7 migrations applied live** (`supabase db push`, advisors
    clean): `profiles` (auto-created via an `auth.users` trigger), `subscriptions` (no row =
    free), `analyses` (`UNIQUE(user_id, idempotency_key)`, `media_paths text[]`,
    reserved/delivered/released lifecycle), the `reserve_analysis`/`settle_analysis`/
    `release_analysis` RPC family (service-role-only, `pg_advisory_xact_lock`-serialized
    concurrency, Free 1 lifetime / Pro 10 / Elite 30 purchase-anchored month-end-clamped
    periods, 3-failed-attempt anti-farming cap), and the private `media` Storage bucket (5MB
    cap, `image/jpeg` only, path-owner RLS).
  - `31098f0` — the auth spine: `lib/supabase.ts` + `lib/crypto-polyfill.ts` (Hermes has no
    WebCrypto, so PKCE silently degrades S256→plain without it — the root cause behind Echo
    V1's "invalid flow state" failures, fixed with an `expo-crypto` shim), `lib/auth.ts` (browser
    OAuth for Google), `lib/session-provider.tsx` + `Stack.Protected` guards, `app/(auth)/sign-in`
    per design-brief screen 1, and the M1 empty Home per screen 2 (RLS-scoped, display-only
    quota). Fonts wired at the root layout; the template Explore tab and modal deleted.
  - `5f14b22` — code-review fixes (splash-screen `.catch` on a rejected session read, Home's
    quota error state with last-known-value + Retry + focus refetch, a `crypto-polyfill`
    byteOffset fix, Android OAuth double-exchange dedupe, hardcoded dimensions replaced with
    `ControlHeight`/`HitTarget`/`Opacity` tokens) plus auth config hardening
    (`minimum_password_length` 6→8).
  - **Security audit: no Critical or High findings**; 5 findings fixed same-day (above).
    Two config discoveries recorded in `supabase/config.toml`'s `[auth]` block rather than lost:
    the hosted project has **no signup rate-limit field** at all (`sign_in_sign_ups` is
    CLI/self-hosted-only; the Management API silently drops it), so CAPTCHA is the only real
    anti-farming lever; and **HaveIBeenPwned leaked-password rejection is Pro-plan-gated** —
    attempting to enable it returned HTTP 402, so it's documented as deferred, not applied.
  - **Live auth config changes** (via a scoped Management API PATCH — `site_url`,
    `uri_allow_list`, `mailer_autoconfirm` only; `supabase config push` deliberately not run
    against this project, see `config.toml`'s warning): `site_url` set to the app's own
    `paceanalysisai://` scheme (no web frontend); the redirect allowlist replaced a stale
    pre-rename entry (`v23photovideoanalysis://google-auth`) with
    `paceanalysisai://oauth-callback`, `paceanalysisai://**`, and `exp://**` (Expo Go dev
    testing); `mailer_autoconfirm` turned on deliberately — no transactional email provider or
    confirmation-pending screen exists yet, so requiring email confirmation would dead-end a
    fresh signup; `minimum_password_length` raised 6→8.
  - **`ANTHROPIC_API_KEY` rotated by Ian**, placed in the gitignored `supabase/functions/.env`
    for local dev, and pushed to production via `supabase secrets set` (confirmed present in the
    secrets list) — the long-standing M4 blocker (Known Issue #4) is gone.
  - Supabase CLI confirmed logged in and linked to the project for the session.
- Replaced `AGENTS.md`'s "How much process to run" tier table with a mandatory **Subagent Usage
  Policy** (written by `doc-writer` to Ian's spec): LOW / MEDIUM / HIGH-CRITICAL severity tiers
  with a required minimum subagent chain per tier (HIGH runs the full 7-step
  plan → architecture review → implement → test → security/review → docs → final-QA chain, and
  keeps the existing hot list — auth, RLS, payments, uploaded media, edge functions, schema,
  `analyze-form`), a category → agent lookup reaching all 70 subagents in `~/.claude/agents/`,
  an explicit no-skipping rule (same-message user override only), and a default-to-the-higher-tier
  escalation rule. This deliberately supersedes the old table's inline-first philosophy
  ("spawning a subagent is the expensive path"); delegation is now the default for anything
  non-trivial. `CLAUDE.md` needed no change — nothing in it contradicts the new policy.

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
- Repaired `.env`. `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` had lost its `KEY=`, leaving the line
  with no `=` at all, so dotenv skipped it and the key never loaded — the Supabase client would
  have thrown on first import. Also deleted the two dead `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`
  placeholders: the browser OAuth flow keeps Google's client ID and secret in the Supabase
  dashboard, and no source file reads them. Verified via `npm run lint`, whose loader output now
  exports both Supabase vars and no Google vars. Because `.env` is gitignored, this entry is the
  only record of that change.
- Rewrote `AGENTS.md` into an agent routing map. All 70 subagents in `~/.claude/agents/` are now
  mapped to the task each one owns, grouped by phase (plan / build / design / verify / test /
  ship / config), with read-only agents marked `°`. Routing rows point back at `CLAUDE.md`'s
  rules rather than restating them, so the two can't drift. The pinned-SDK note stays as the
  opening section; the file is held to 100 lines.
- Added a "How much process to run" tier table to `AGENTS.md`. Severity, not file count, decides
  how many steps run: Trivial edits go straight in, Small edits get `verifier` and stop, and any
  change to auth, RLS, payments, uploaded media, edge functions, schema, or the `analyze-form`
  flow runs the full plan → build → verify → review → docs chain **even as a one-file diff**.
  Small work stays inline because spawning a subagent is the expensive path — it starts cold and
  re-derives context the session already has.
- `CLAUDE.md` now says what its bare `@AGENTS.md` include actually pulls in: the routing map, and
  that the rules in `CLAUDE.md` bind every agent it names.
- Fixed "can't open the project in Expo Go". Root cause: `expo-dev-client` is a dependency, so
  `expo start` defaults to a development build and advertises
  `exp+v2.3-photo-video-analysis://expo-development-client/?url=…` — a deep link Expo Go cannot
  open. Nothing was wrong with the network or the phone. Added a `start:go` script
  (`expo start --go`), which serves `exp://192.168.x.x:8081` and reports "Using Expo Go";
  verified by running it. Pressing `s` in the dev server does the same thing at runtime.
  `expo-dev-client` was deliberately kept — a dev build is still the right target for Android and
  for any future custom native module.
