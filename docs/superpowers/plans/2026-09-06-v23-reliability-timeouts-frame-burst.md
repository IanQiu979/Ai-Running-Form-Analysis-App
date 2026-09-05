# V2.3 Reliability Timeouts and Frame Burst Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paid video analysis complete inside one useful model attempt and replace clip-wide thumbnail sampling with a verified, centered stride-cycle burst.

**Architecture:** Keep the synchronous edge endpoint, existing reservation/settlement row, server-authoritative Pro/Elite frame counts, five-megabyte request ceiling, and original-video-local privacy boundary. Start an 85-second model window after reservation, allow an 80-second first call, retry only a quick transport failure when a full 80-second second attempt still fits, and use low adaptive-thinking effort without increasing output caps. On-device, replace deprecated keyframe-only `expo-video-thumbnails` with SDK 57's `expo-video` batch decoder, sample the middle 700 ms of the clip, use decoder-reported timestamps, and fail extraction if the sequence is duplicate or non-monotonic.

**Tech Stack:** Expo SDK 57 (`expo ^57.0.9`), React Native, TypeScript, `expo-video ~57.0.3`, `expo-image-manipulator`, Supabase Edge Functions/Deno, Anthropic Messages API, Jest, Deno test.

**Spec:** `/Users/Guestyyyyyyyy/firstmate/data/v23-core-purpose-audit-r1/report.md`

## Global Constraints

- The project remains pinned to Expo SDK 57; use only `https://docs.expo.dev/versions/v57.0.0/` and SDK-57 source/API contracts.
- Do not change the Free-tier path, sample content, visual design, model variance/confabulation behavior, schema, RLS, frame entitlements, request-size ceiling, or original-video-local privacy contract.
- Pro remains five frames and Elite remains eight frames; do not raise either cap.
- The model output ceilings remain Free 4,000, Pro 6,000, and Elite 8,000 tokens; thinking and final text continue to share that ceiling.
- No real model calls are required for implementation or offline verification. Record the final real-call count explicitly.
- Tests must demonstrate the current timeout failure and current sparse-sampling behavior before production code changes.
- Preserve existing user-visible animated wait feedback; this change raises the per-attempt ceiling from 65 to 80 seconds but reduces the overall failed-wait path by eliminating the doomed partial retry.
- Never treat client-supplied timing metadata as tier, quota, billing, authentication, or authorization authority.

---

### Task 1: One useful model-time envelope

**Files:**
- Modify: `supabase/functions/analyze-form/flow.ts`
- Modify: `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`
- Modify: `supabase/functions/_shared/analyze-form-prompt.ts`
- Modify: `supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts`

**Interfaces:**
- Consumes: injected `deps.now()` clock and `deps.model.send(request, timeoutMs)` seam already used by flow tests.
- Produces: `MODEL_CALL_TIMEOUT_MS = 80_000`, `ANALYZE_FORM_DEADLINE_MS = 85_000` measured from successful reservation, `MIN_RETRY_BUDGET_MS = 80_000`, and `ANALYZE_FORM_EFFORT = 'low'`.
- Produces: retry admission only for a first-attempt `model_error` when at least 80,000 ms remain; `provider_timeout`, `max_tokens`, `refusal`, and validation/content failures are not retried unchanged.

- [ ] **Step 1: Write the deterministic failing timeout tests**

  Add virtual-clock model doubles to `flow.deno.test.ts` that record every `timeoutMs`. Cover these exact behaviors:

  ```ts
  // A model result that needs 70 seconds must succeed on attempt 1.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 200);

  // A full 80-second timeout must not launch a second underfunded disclosure/call.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 503);

  // Reserve/gate time does not consume the model window.
  assertEquals(model.timeoutBudgets[0], 80_000);

  // A quick model transport error may retry only while a full attempt remains.
  assertEquals(model.timeoutBudgets, [80_000, 80_000]);
  ```

  Add separate cases proving a `max_tokens` response and a refusal produce one call, not two.

- [ ] **Step 2: Run the focused edge test and capture RED evidence**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read --allow-env=SUPABASE_PUBLISHABLE_KEYS,SUPABASE_SECRET_KEYS,SUPABASE_URL supabase/functions/analyze-form/__tests__/flow.deno.test.ts
  ```

  Expected before production edits: the 70-second model gets only 65,000 ms and fails; the slow timeout admits a second roughly 40,000 ms call; pre-reservation elapsed time reduces the first call's budget; truncation/refusal retries once.

- [ ] **Step 3: Write the failing effort-policy test**

  In `analyze-form-prompt.deno.test.ts`, assert the exported named constant and request payload use low adaptive-thinking effort while keeping adaptive thinking and tier token caps unchanged:

  ```ts
  assertEquals(ANALYZE_FORM_EFFORT, 'low');
  assertEquals(request.thinking, { type: 'adaptive' });
  assertEquals(request.output_config.effort, 'low');
  assertEquals(request.max_tokens, MAX_OUTPUT_TOKENS_BY_TIER.pro);
  ```

- [ ] **Step 4: Run the prompt test and capture RED evidence**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  ```

  Expected before production edits: the effort assertion receives `medium`.

- [ ] **Step 5: Implement the model-window and retry policy**

  Keep `startedAt` for end-to-end latency logging, but create the model deadline only after `reserve_analysis` succeeds:

  ```ts
  const modelDeadline = deps.now() + ANALYZE_FORM_DEADLINE_MS;
  const timeoutMs = Math.min(MODEL_CALL_TIMEOUT_MS, modelDeadline - deps.now());
  ```

  Set the exact constants from Interfaces. Gate the one retry on both conditions:

  ```ts
  const mayRetry = lastFailureReason === 'model_error'
    && modelDeadline - deps.now() >= MIN_RETRY_BUDGET_MS;
  ```

  Preserve one-call accounting and existing failure/release semantics. Do not change `deps.ts`, model selection, token ceilings, client timeout, or Storage sequencing.

- [ ] **Step 6: Lower adaptive-thinking effort without changing output caps**

  Change only the named constant:

  ```ts
  export const ANALYZE_FORM_EFFORT = 'low' as const;
  ```

  Keep `{ type: 'adaptive' }` and `MAX_OUTPUT_TOKENS_BY_TIER` unchanged.

- [ ] **Step 7: Run focused and full task verification**

  Run:

  ```bash
  deno test --config supabase/functions/deno.json --allow-read --allow-env=SUPABASE_PUBLISHABLE_KEYS,SUPABASE_SECRET_KEYS,SUPABASE_URL supabase/functions/analyze-form/__tests__/flow.deno.test.ts supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  npm run typecheck:edge
  ```

  Expected: all pass, with the virtual-clock tests proving the formerly failing case now succeeds once.

- [ ] **Step 8: Commit**

  ```bash
  git add supabase/functions/analyze-form/flow.ts supabase/functions/analyze-form/__tests__/flow.deno.test.ts supabase/functions/_shared/analyze-form-prompt.ts supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  git commit -m "fix: give video analysis one useful model window"
  ```

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
- Produces: `extractVideoFrames` outputs decoder-reported `timestampMs` values in requested-time order and rejects incomplete, duplicate, non-finite, out-of-range, or non-increasing motion sequences.
- Produces: request manifests distinguish a compact stride burst from legacy sparse frames by timestamp span; legacy/sparse video explicitly instructs Cadence and Elasticity to be not assessed.

- [ ] **Step 1: Write exact sampler tests before changing production code**

  Replace old clip-coverage expectations with:

  ```ts
  expect(sampleTimestamps(10_000, 5)).toEqual([4650, 4825, 5000, 5175, 5350]);
  expect(sampleTimestamps(10_000, 8)).toEqual([4650, 4750, 4850, 4950, 5050, 5150, 5250, 5350]);
  expect(sampleTimestamps(500, 5)).toEqual([25, 138, 250, 363, 475]);
  expect(sampleTimestamps(10_000, 1)).toEqual([5000]);
  ```

  Preserve invalid-duration/count coverage.

- [ ] **Step 2: Write extractor contract tests before changing production code**

  Mock the Expo 57 player and SharedRef contracts. Assert one batch decode call in seconds with `{ maxWidth: 1568, maxHeight: 1568 }`, requested-time ordering, decoder-reported timestamps, per-frame JPEG/base64 conversion, progress increments, and release of the player, thumbnails, manipulator context, and rendered image on success and failure. Add failing cases for fewer than N results, duplicate JPEG base64, and non-increasing actual timestamps.

- [ ] **Step 3: Run the frame suite and capture RED evidence**

  Run:

  ```bash
  npm test -- --runInBand lib/__tests__/frames.test.ts
  ```

  Expected before production edits: exact timestamp expectations show the old 5%–95% spread, and the old module makes N sequential keyframe-only calls rather than one batch call.

- [ ] **Step 4: Replace the thumbnail dependency with the SDK-pinned decoder**

  Run the SDK-aware install and removal so both manifests update consistently:

  ```bash
  npx expo install expo-video
  npm uninstall expo-video-thumbnails
  ```

  Verify `package.json` contains `"expo-video": "~57.0.3"` and no `expo-video-thumbnails` entry.

- [ ] **Step 5: Implement centered burst timestamps**

  For `count > 1`, use:

  ```ts
  const spanMs = Math.min(700, durationMs * 0.9);
  const startMs = (durationMs - spanMs) / 2;
  return Array.from({ length: count }, (_, index) =>
    Math.round(startMs + (spanMs * index) / (count - 1))
  );
  ```

  This keeps every request inside the clip, gives both paid tiers one approximately stride-long window, and does not increase frame count or bytes.

- [ ] **Step 6: Implement batch non-keyframe extraction with deterministic cleanup**

  Create one player, wait until it is ready, call `generateThumbnailsAsync` once with millisecond timestamps converted to seconds, and always call `player.release()` in `finally`. Sort thumbnails by `requestedTime`; use each thumbnail SharedRef directly with `ImageManipulator.manipulate`; resize only if the batch max dimensions did not already bound it; render/save as JPEG quality `0.7` with base64; release each thumbnail and every releasable manipulator/rendered reference.

  Require exactly N thumbnails. Convert `actualTime` seconds to rounded milliseconds, reject non-finite/out-of-clip/non-increasing values, and reject exact duplicate JPEG base64 strings. Preserve `FrameExtractionError`, total five-megabyte enforcement, abort checks, and progress callbacks.

- [ ] **Step 7: Make prompt semantics conditional on real burst evidence**

  Treat a multi-frame video as a stride burst only when timestamps are finite, strictly increasing, and their total span is at most 900 ms. Render the manifest as `STRIDE BURST (decoder-reported times, approximate)` for eligible input and as `LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)` otherwise. The sparse branch must explicitly require `score: null`, `band: null`, and `needsVideo`/not-assessed treatment for Cadence and Elasticity. The burst branch may compare visible phase changes but must not claim laboratory cadence, ground-contact time, or exact timing from the timestamps.

- [ ] **Step 8: Run focused and full task verification**

  Run:

  ```bash
  npm test -- --runInBand lib/__tests__/frames.test.ts
  deno test --config supabase/functions/deno.json --allow-read supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  npm run typecheck
  ```

  Expected: all pass; dependency versions match Expo SDK 57; old sparse timestamps can no longer be presented to the model as video-derived motion evidence.

- [ ] **Step 9: Commit**

  ```bash
  git add package.json package-lock.json lib/frames.ts lib/__tests__/frames.test.ts supabase/functions/_shared/analyze-form-prompt.ts supabase/functions/_shared/__tests__/analyze-form-prompt.deno.test.ts
  git commit -m "fix: sample a verified stride-cycle frame burst"
  ```

### Task 3: Reliability documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/status.md`
- Modify: `docs/change_log.md`

**Interfaces:**
- Consumes: Task 1's 80/85-second model envelope, low adaptive-thinking effort, and retry rules.
- Consumes: Task 2's centered 700 ms burst, decoder migration, actual-time caveat, and invalid-sequence failure behavior.
- Produces: durable documentation that points future agents to the authoritative code/tests and records zero real model calls for this engineering pass.

- [ ] **Step 1: Update architecture documentation**

  Document the timing budget from reservation through provider call, why slow failures are not retried, and that request upload/frame extraction are outside provider latency. Replace the 5%–95% frame-sampling description with the centered burst and Expo 57 decoder behavior. State that Android's reported `actualTime` is estimated metadata timing, so timestamps remain approximate and motion scores still fail closed when visual evidence is insufficient.

- [ ] **Step 2: Update status and change log**

  Record the audit-rooted reliability fix, exact offline test commands/results supplied by Tasks 1 and 2, unchanged frame counts/privacy/request limits, and `0` real model calls made during this task. Do not claim real-device or paid-model validation that was not run; list physical iOS/Android known-frame fixture validation and a representative low-effort production eval as follow-up verification, not completed evidence.

- [ ] **Step 3: Verify docs and commit**

  Run:

  ```bash
  rg -n "65.?second|65_000|5.?95%|expo-video-thumbnails|medium effort" docs/architecture.md docs/status.md docs/change_log.md
  git diff --check
  ```

  Resolve stale statements in the changed sections without rewriting unrelated history, then commit:

  ```bash
  git add docs/architecture.md docs/status.md docs/change_log.md
  git commit -m "docs: record analysis reliability envelope"
  ```
