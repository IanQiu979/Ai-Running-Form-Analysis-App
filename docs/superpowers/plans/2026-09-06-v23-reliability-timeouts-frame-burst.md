# V2.3 Reliability Timeouts and Frame Burst Implementation Plan

> **Implementation record:** This plan was executed task-by-task. Completed steps use checkbox (`- [x]`) syntax.

**Goal:** Make paid video analysis complete inside one useful model attempt and replace clip-wide thumbnail sampling with a verified, centered stride-cycle burst.

**Architecture:** Keep the synchronous edge endpoint, existing reservation/settlement row, server-authoritative Pro/Elite frame counts, five-megabyte request ceiling, and original-video-local privacy boundary. Capture request start at `Deno.serve` entry before auth/body parsing, then cap the effective model deadline at `min(model start + 85s, request start + 105s)`, with an 80-second per-call ceiling. Retry `model_error` only with 80 seconds left and `no_tool_use`/`invalid_shape` with 20 seconds left; recheck that floor after the retry spend gate, while timeout, truncation, and refusal remain terminal. Zero budget never dispatches the provider, and failure cleanup releases quota before recording ledger rows. The 15-second client headroom is nominal: individual dependent calls have no local wall-clock cancellation, and no unsafe `Promise.race` is used around side effects. Use low adaptive-thinking effort without increasing output caps. On-device, replace deprecated keyframe-only `expo-video-thumbnails` with SDK 57's `expo-video` batch decoder, sample the middle 700 ms of the clip, use decoder-reported timestamps in the updated client, and fail extraction if the sequence is incomplete, duplicate, invalid, or non-monotonic. The server describes received times as provenance-neutral client-reported values because it cannot distinguish updated decoder estimates from old requested times. Native cleanup covers decode/render/progress failures without double-releasing thumbnails.

**Tech Stack:** Expo SDK 57 (`expo ^57.0.9`), React Native, TypeScript, `expo-video ~57.0.3`, `expo-image-manipulator`, Supabase Edge Functions/Deno, Anthropic Messages API, Jest, Deno test.

**Spec:** `/Users/Guestyyyyyyyy/firstmate/data/v23-core-purpose-audit-r1/report.md`

## Global Constraints

- The project remains pinned to Expo SDK 57; use only `https://docs.expo.dev/versions/v57.0.0/` and SDK-57 source/API contracts.
- Do not change the Free-tier path, sample content, visual design, model variance/confabulation behavior, schema, RLS, frame entitlements, request-size ceiling, or original-video-local privacy contract.
- Pro remains five frames and Elite remains eight frames; do not raise either cap.
- The model output ceilings remain Free 4,000, Pro 6,000, and Elite 8,000 tokens; thinking and final text continue to share that ceiling.
- 0 real model calls, so offline behaviour is proven and the live path is not.
- Tests must demonstrate the current timeout failure and current sparse-sampling behavior before production code changes.
- Preserve existing user-visible animated wait feedback; this change raises the per-attempt ceiling from 65 to 80 seconds but removes retries after provider timeouts, truncations, and refusals.
- Never treat client-supplied timing metadata as tier, quota, billing, authentication, or authorization authority.

---

### Task 1: One useful model-time envelope

**Files:**
- Modify: `supabase/functions/analyze-form/index.ts`
- Modify: `supabase/functions/analyze-form/flow.ts`
- Modify: `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`
- Modify: `supabase/functions/_shared/analyze-form-prompt.ts`
- Modify: `supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts`

**Interfaces:**
- Consumes: injected `deps.now()` clock and `deps.model.send(request, timeoutMs)` seam already used by flow tests.
- Produces: `ANALYZE_FORM_REQUEST_DEADLINE_MS = 105_000` from request start, `ANALYZE_FORM_DEADLINE_MS = 85_000` as the maximum post-preflight model window, `MODEL_CALL_TIMEOUT_MS = 80_000`, `MIN_RETRY_BUDGET_MS = 80_000`, `MIN_CONTENT_RETRY_BUDGET_MS = 20_000`, and `ANALYZE_FORM_EFFORT = 'low'`.
- Produces: handler-entry `requestStartedAt` and effective model deadline `min(model start + 85s, request start + 105s)`; preflight through 20 seconds preserves the full window/first-attempt cap, while slower preflight consumes model time and leaves 15 seconds nominal client headroom after the envelope.
- Produces: one retry for `model_error` when at least 80,000 ms remain, or for `no_tool_use`/`invalid_shape` when at least 20,000 ms remain, with the same floor rechecked after the retry spend gate. `provider_timeout`, `max_tokens`, and `refusal` are terminal; a smaller content retry that times out becomes non-farming `model_error`.
- Produces: zero/negative model budget skips provider dispatch and cancels the unused gate row; an allowed retry that becomes underfunded during its gate is likewise skipped/cancelled and logged with a before/after-gate stage.
- Produces: failure cleanup runs `release_analysis` before `record_ai_call`; auth/DB/Storage/RPC calls remain without local wall-clock cancellation, so one stalled dependency may outlive the client timeout and no unsafe `Promise.race` is introduced.

- [x] **Step 1: Write the deterministic failing timeout tests**

  Add virtual-clock model doubles to `flow.deno.test.ts` that record every `timeoutMs`. Cover these exact behaviors:

  ```ts
  // A model result that needs 70 seconds must succeed on attempt 1.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 200);

  // A full 80-second timeout must not launch a second underfunded disclosure/call.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 503);

  // Twenty seconds of preflight preserves the full first attempt.
  assertEquals(model.timeoutBudgets[0], 80_000);

  // Thirty seconds of preflight caps model work at the 75 seconds left in the request envelope.
  assertEquals(model.timeoutBudgets[0], 75_000);

  // Auth/body work before runAnalyzeForm counts because index.ts supplies requestStartedAt.
  assertEquals(model.timeoutBudgets[0], 75_000);

  // Exhausted preflight never reaches the provider; the unused gate row is cancelled.
  assertEquals(model.timeoutBudgets, []);

  // A quick model transport error may retry only while a full attempt remains.
  assertEquals(model.timeoutBudgets, [80_000, 80_000]);
  ```

  Add separate cases proving a `max_tokens` response and a refusal produce one call, not two, and
  use a `VirtualClock` to prove a realistic 20-second content failure still reaches its 20-second-
  floor retry and repeated-content classification. Cover both retry floors at their exact boundary,
  a gate delay consuming each floor, cancellation/log stage for an allowed-but-skipped retry, and
  `release_analysis` running before ledger recording.

- [x] **Step 2: Run the focused edge test and capture RED evidence**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read --allow-env=SUPABASE_PUBLISHABLE_KEYS,SUPABASE_SECRET_KEYS,SUPABASE_URL supabase/functions/analyze-form/__tests__/flow.deno.test.ts
  ```

  Observed before production edits: the 70-second model got only 65,000 ms and failed; the slow timeout admitted a second roughly 40,000 ms call; truncation/refusal retried once. Review then reproduced two additional RED cases against the intermediate implementation: 30 seconds of preflight extended model work beyond the client-safe request envelope, and a realistic 20-second content failure could not reach a retry under one shared 80-second floor.

- [x] **Step 3: Write the failing effort-policy test**

  In `analyze-form-prompt.deno.test.ts`, assert the exported named constant and request payload use low adaptive-thinking effort while keeping adaptive thinking and tier token caps unchanged:

  ```ts
  assertEquals(ANALYZE_FORM_EFFORT, 'low');
  assertEquals(request.thinking, { type: 'adaptive' });
  assertEquals(request.output_config.effort, 'low');
  assertEquals(request.max_tokens, MAX_OUTPUT_TOKENS_BY_TIER.pro);
  ```

- [x] **Step 4: Run the prompt test and capture RED evidence**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  ```

  Expected before production edits: the effort assertion receives `medium`.

- [x] **Step 5: Implement the request envelope, model window, and split retry policy**

  Capture the request envelope before auth/body parsing, pass it into the flow, then cap the model
  window after a successful reserve:

  ```ts
  const requestStartedAt = Date.now(); // index.ts, at Deno.serve entry

  const now = deps.now ?? Date.now; // flow.ts
  const startedAt = params.requestStartedAt ?? now();
  const requestDeadline = startedAt + ANALYZE_FORM_REQUEST_DEADLINE_MS;
  const modelDeadline = Math.min(now() + ANALYZE_FORM_DEADLINE_MS, requestDeadline);
  const timeoutMs = Math.min(MODEL_CALL_TIMEOUT_MS, modelDeadline - now());
  ```

  Set the exact constants from Interfaces. Gate the one retry on failure-specific floors:

  ```ts
  const minRetryBudgetMs =
    lastFailureReason === 'no_tool_use' || lastFailureReason === 'invalid_shape'
      ? MIN_CONTENT_RETRY_BUDGET_MS
      : MIN_RETRY_BUDGET_MS;
  const mayRetry = isRetryEligibleFailure
    && modelDeadline - deps.now() >= minRetryBudgetMs;
  ```

  Recheck `minRetryBudgetMs` after the retry gate returns. If it is now underfunded, keep the
  provider untouched, settle the allowed gate row as `cancelled`, and log
  `retry_skipped_insufficient_budget` with `stage: 'after_retry_gate'`. Before every provider send,
  reject zero/negative budget without dispatch. In `finally`, release the quota reservation before
  recording AI-call rows. Do not add a local `Promise.race` around auth/DB/Storage/RPC work: a losing
  side effect could still commit after the response. Preserve `deps.ts`, model selection, token
  ceilings, client timeout, and Storage sequencing.

- [x] **Step 6: Lower adaptive-thinking effort without changing output caps**

  Change only the named constant:

  ```ts
  export const ANALYZE_FORM_EFFORT = 'low' as const;
  ```

  Keep `{ type: 'adaptive' }` and `MAX_OUTPUT_TOKENS_BY_TIER` unchanged.

- [x] **Step 7: Run focused task verification**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read --allow-env=SUPABASE_PUBLISHABLE_KEYS,SUPABASE_SECRET_KEYS,SUPABASE_URL supabase/functions/analyze-form/__tests__/flow.deno.test.ts supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  npm run typecheck:edge
  ```

  Result: focused suites pass at 95 flow tests and 44 prompt tests; the virtual-clock cases cover
  realistic content latency, handler-entry request timing, zero-budget suppression, retry-gate
  TOCTOU, and cleanup ordering. No full-repository test total is claimed here.

- [x] **Step 8: Record the initial Task 1 implementation**

  The initial model-window work and anti-farming correction were committed as `9e7a200` and
  `8830798`. The approved request-envelope and split-floor review corrections are part of the
  owning no-mistakes pipeline's final combined commit.

### Task 2: Verified centered stride-burst extraction

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/frames.ts`
- Modify: `lib/__tests__/frames.test.ts`
- Modify: `supabase/functions/_shared/analyze-form-prompt.ts`
- Modify: `supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts`

**Interfaces:**
- Consumes: Expo SDK 57 `createVideoPlayer(source)` and `VideoPlayer.generateThumbnailsAsync(timesInSeconds, { maxWidth, maxHeight })`.
- Produces: `sampleTimestamps(durationMs: number, count: number): number[]` centered over `min(700, durationMs * 0.9)` ms, preserving `count === 1` as the midpoint.
- Produces: the updated `extractVideoFrames` outputs decoder-reported `timestampMs` values in requested-time order and rejects incomplete, duplicate, non-finite, out-of-range, or non-increasing motion sequences.
- Produces: request manifests use provenance-neutral client-reported timestamp wording, distinguish a compact stride burst from legacy sparse frames by timestamp span, and explicitly require Cadence and Elasticity to be not assessed for legacy/sparse video.

- [x] **Step 1: Write exact sampler tests before changing production code**

  Replace old clip-coverage expectations with:

  ```ts
  expect(sampleTimestamps(10_000, 5)).toEqual([4650, 4825, 5000, 5175, 5350]);
  expect(sampleTimestamps(10_000, 8)).toEqual([4650, 4750, 4850, 4950, 5050, 5150, 5250, 5350]);
  expect(sampleTimestamps(500, 5)).toEqual([25, 138, 250, 363, 475]);
  expect(sampleTimestamps(10_000, 1)).toEqual([5000]);
  ```

  Preserve invalid-duration/count coverage.

- [x] **Step 2: Write extractor contract tests before changing production code**

  Mock the Expo 57 player and SharedRef contracts. Assert one batch decode call in seconds with `{ maxWidth: 1568, maxHeight: 1568 }`, requested-time ordering, decoder-reported timestamps, per-frame JPEG/base64 conversion, progress increments, and release of the player, thumbnails, manipulator context, and rendered image on success and failure. Add failing cases for fewer than N results, duplicate JPEG base64, non-increasing actual timestamps, `renderAsync` rejection, and a throwing progress callback.

- [x] **Step 3: Run the frame suite and capture RED evidence**

  Run:

  ```bash
  npm test -- --runInBand lib/__tests__/frames.test.ts
  ```

  Expected before production edits: exact timestamp expectations show the old 5%–95% spread, and the old module makes N sequential keyframe-only calls rather than one batch call.

- [x] **Step 4: Replace the thumbnail dependency with the SDK-pinned decoder**

  Run the SDK-aware install and removal so both manifests update consistently:

  ```bash
  npx expo install expo-video
  npm uninstall expo-video-thumbnails
  ```

  Verify `package.json` contains `"expo-video": "~57.0.3"` and no `expo-video-thumbnails` entry.

- [x] **Step 5: Implement centered burst timestamps**

  For `count > 1`, use:

  ```ts
  const spanMs = Math.min(700, durationMs * 0.9);
  const startMs = (durationMs - spanMs) / 2;
  return Array.from({ length: count }, (_, index) =>
    Math.round(startMs + (spanMs * index) / (count - 1))
  );
  ```

  This keeps every request inside the clip, gives both paid tiers one approximately stride-long window, and does not increase frame count or bytes.

- [x] **Step 6: Implement batch non-keyframe extraction with deterministic cleanup**

  Create one player, wait until it is ready, call `generateThumbnailsAsync` once with millisecond timestamps converted to seconds, and always call `player.release()` in `finally`. Preserve the batch's documented request order; use each thumbnail SharedRef directly with `ImageManipulator.manipulate`; resize only if the batch max dimensions did not already bound it; render/save as JPEG quality `0.7` with base64; release each thumbnail and every releasable manipulator/rendered reference, including partial results returned on a count mismatch and the context when `renderAsync` rejects. Advance thumbnail ownership before release/progress callbacks so either callback throwing cannot make `finally` release the same native reference twice.

  Require exactly N thumbnails. Convert `actualTime` seconds to rounded milliseconds, reject non-finite/out-of-clip/non-increasing values, and reject exact duplicate JPEG base64 strings. Preserve `FrameExtractionError`, total five-megabyte enforcement, abort checks, and progress callbacks.

- [x] **Step 7: Make prompt semantics conditional on real burst evidence**

  Treat a multi-frame video as a stride burst only when timestamps are finite, strictly increasing, and their total span is at most 900 ms. Render the manifest as `STRIDE BURST (approximate client-reported timestamps)` for eligible input and as `LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)` otherwise. Explain that the server cannot know whether each value is an old requested time or an updated decoder estimate. The sparse branch must explicitly require `score: null`, `band: null`, and `needsVideo`/not-assessed treatment for Cadence and Elasticity. The burst branch may compare visible phase changes but must not claim laboratory cadence, ground-contact time, or exact timing from the timestamps.

- [x] **Step 8: Run focused task verification**

  Run:

  ```bash
  npm test -- --runInBand lib/__tests__/frames.test.ts
  deno test --config supabase/functions/deno.json --allow-read supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  npm run typecheck
  ```

  Result: the focused frame suite passes at 38 tests; dependency versions match Expo SDK 57; old
  sparse timestamps can no longer be presented to the model as video-derived motion evidence, and
  render/progress failures preserve exact-once native cleanup. No full-repository test total is
  claimed here.

- [x] **Step 9: Commit Task 2**

  The frame-burst implementation was committed as `b1bb7c0` (`fix(frames): sample a verified
  stride-cycle frame burst`).

### Task 3: Reliability documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/status.md`
- Modify: `docs/change_log.md`
- Modify: `docs/superpowers/plans/2026-09-06-v23-reliability-timeouts-frame-burst.md`

**Interfaces:**
- Consumes: Task 1's handler-entry 105-second request envelope, maximum 85-second model window, 80-second call cap, split/rechecked 80/20-second retry floors, zero-budget suppression, quota-first cleanup, and low adaptive-thinking effort.
- Consumes: Task 2's centered 700 ms burst, decoder migration, actual-time caveat, and invalid-sequence failure behavior.
- Produces: durable documentation that points future agents to the authoritative code/tests and records that 0 real model calls, no deployment, and no live function invocation occurred in this engineering pass.

- [x] **Step 1: Update architecture documentation**

  Document the handler-entry request envelope and effective model deadline, why timeout/truncation/refusal are terminal, why transport and content retries have different floors, the post-gate recheck, zero-budget suppression, and quota-first cleanup. State precisely that individual auth/DB/Storage/RPC calls lack local wall-clock cancellation, so 15 seconds is nominal headroom and one stalled dependency can still outlive the client; no unsafe `Promise.race` was added. Replace the 5%–95% frame-sampling description with the centered burst and Expo 57 decoder behavior, including exact-once cleanup on render/progress failure. State that Android's reported `actualTime` is estimated metadata timing and the server sees provenance-neutral client-reported values, so timestamps remain approximate and motion scores still fail closed when visual evidence is insufficient.

- [x] **Step 2: Update status and change log**

  Record the audit-rooted reliability fix, focused current suite counts (95 flow, 44 prompt, 38 frames; 177 across these three), unchanged frame counts/privacy/request limits, and this exact caveat: `0 real model calls, so offline behaviour is proven and the live path is not.` Record no deployment or live invocation. Do not claim real-device or paid-model validation that was not run; list physical iOS/Android known-frame fixture validation and a representative low-effort production eval as follow-up verification, not completed evidence.

- [x] **Step 3: Verify docs**

  Run:

  ```bash
  rg -n "measured from successful reservation|Start an 85-second model window after reservation|content/shape failure.*80|decoder-reported times, approximate|flow.deno.test.ts.*(80|83|87|88|93) tests|analyze-form-prompt.deno.test.ts.*43 tests|frames.test.ts.*36 tests|168 tests|175 tests" docs/architecture.md docs/change_log.md docs/status.md docs/superpowers/plans/2026-09-06-v23-reliability-timeouts-frame-burst.md | rg -v 'rg -n'
  git diff --check
  ```

  Result: the stale post-reservation/shared-floor/provenance/count scan returned no findings and
  `git diff --check` passed for all four documentation files. The owning no-mistakes pipeline, not
  this documentation-only worker, commits the final combined fix.
