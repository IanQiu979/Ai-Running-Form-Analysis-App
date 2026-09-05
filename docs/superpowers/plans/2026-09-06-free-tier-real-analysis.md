# Free Tier Real Analysis Implementation Plan

> Handoff note: this plan and its RED tests are complete; production implementation, review, integration with `fm/v23-reliability-timeouts`, and verification remain.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fabricated Free sample with one genuine, server-capped lifetime analysis and honest paid-plan messaging.

**Architecture:** Remove the Free short-circuit so every tier uses the existing authenticated reserve/model/settle pipeline. Keep `reserve_analysis` as the entitlement authority: Free receives one lifetime delivered analysis and one frame; a valid all-not-assessed Free result is persisted and consumes that slot, while Pro/Elite keep their existing refund policy. Close the newly reachable delete-during-analysis spend bypass by making `reserved` rows undeletable and removing the obsolete direct client soft-delete permission.

**Tech Stack:** Expo SDK 57, React Native 0.86, Expo Router, TypeScript, Supabase Edge Functions/Deno, Postgres/RLS, Jest, Deno test.

**Spec:** `/Users/Guestyyyyyyyy/firstmate/data/v23-core-purpose-audit-r1/report.md`

## Global Constraints

- Free receives exactly one lifetime delivered analysis; `quota-status` remains the client-visible allowance authority.
- Every result uses certified knowledge. Free keeps empty injury flags and drills, and one-frame input cannot support Cadence, Elasticity, cadence figures, ground-contact timing, or left/right timing comparisons.
- `fm/v23-reliability-timeouts` owns timeout/retry logic, frame extraction, and prompt rules for sparse versus stride-burst evidence. Rebase that work before final verification; do not duplicate it here.
- No real Anthropic call is required. All automated model seams use deterministic fakes, and the final report states the real-call count.
- Historical changelog/audit entries remain historical; all live sample code, routes, copy, fixtures, and sample-specific behavior tests are removed.
- The edge function must be deployed before a client release because the simplified client intentionally rejects the retired `{ isSample: true }` response.

---

### Task 1: Failing Behavioral Tests

**Files:**
- Modify: `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`
- Modify: `supabase/functions/_shared/__tests__/delete-analysis.deno.test.ts`
- Modify: `lib/__tests__/analyze-form.test.ts`
- Modify: `lib/__tests__/analyzing-machine.test.ts`
- Modify: `app/__tests__/analyzing.test.tsx`
- Modify: `lib/__tests__/quota.test.ts`
- Create: `app/__tests__/paywall.test.tsx`
- Modify: `supabase/functions/_shared/integration/quota-rpc.local.ts`

**Interfaces:**
- Consumes: existing `runAnalyzeForm`, `deleteAnalysis`, `parseAnalyzeFormSuccess`, analyzer reducer, and `quota-status` contracts.
- Produces: executable regression coverage for a real persisted Free result, next-request denial, all-not-assessed Free settlement, reserved-delete refusal, simplified client success, allowance copy, and honest paywall copy.

- [x] **Step 1: Write edge tests that currently fail.** A Free reservation returns `tier: 'free'`; assert one fake model call, `settle_analysis`, a real `analysisId`, and no `isSample`. Add a second fresh-key call whose stateful RPC returns `quota_exceeded`; assert no second model call and one delivered row. Add a valid zero-pillar Free result that settles, plus the unchanged Pro/Elite zero-pillar release cases. **Follow-up (this session):** made the Free-tier fixture ADVERSARIAL (a hallucinated cadence figure + populated flags/drills, mirroring the retired sample's exact false claims) and asserted the EXACT normalized/settled result, not just that settlement happened — the earlier version would have passed even with no normalization at all.
- [x] **Step 2: Write a reserved-delete test that currently fails.** Seed an owned `status: 'reserved'` row and assert `deleteAnalysis` returns `{ outcome: 'in_progress' }` without Storage purge or row mutation; assert its HTTP mapping is 409.
- [x] **Step 3: Write client/UI tests that currently fail.** Assert only the persisted real-result shape is accepted and routed to `/result/[id]`; assert Free allowance copy says one real analysis; render the paywall and assert it promises only additional analyses, multi-frame evidence when footage supports it, certified flags/drills when supported, deeper feedback, and Elite history comparison.
- [ ] **Step 4: Extend the real-local-Postgres test.** Written by the predecessor in `supabase/functions/_shared/integration/quota-rpc.local.ts`, but **NOT RUN in this session or the prior one** — it needs a local Postgres via Docker, and this worktree's standing instruction is never to start Docker or take machine focus. Left as written; genuinely unproven. State this plainly in the handoff/report — do not imply it passed.
- [x] **Step 5: Run each focused suite and record RED failures.** Confirmed RED before the Task 2/3/4 implementation; GREEN after (see Task 2-4 checkmarks).

### Task 2: Uniform Server Analysis Path

**Files:**
- Modify: `supabase/functions/analyze-form/flow.ts`
- Delete: `supabase/functions/_shared/analyze-form-sample.ts`

**Interfaces:**
- Consumes: server-derived `tier` from `reserve_analysis` and the reliability lane's sparse-evidence prompt behavior.
- Produces: one response contract for all tiers: `{ result, analysisId, isFallback }` backed by a delivered row.
- Produces: deterministic post-model normalization that replaces Cadence and Elasticity with honest `needsVideo` pillars for every one-frame input, recalculates `overall`, and empties all Free flags/drills before settlement.

- [x] **Step 1: Remove `FREE_SAMPLE_PACE_RESULT`, `currentTier`, and the early Free return.** Preserve consent, AI gate, reserve, idempotency, settlement, upload, and call-ledger ordering.
- [x] **Step 2: Normalize unsupported output before quota policy.** For one frame, replace Cadence and Elasticity with `{ score: null, band: null, feedback: <honest single-frame limitation>, notAssessedReason: 'needsVideo', flags: [], drills: [] }`; for Free, empty every flags/drills array; then recompute `overall` from assessed pillar scores.
- [x] **Step 3: Apply the tier-specific all-not-assessed policy.** For a valid all-not-assessed result, settle when `tier === 'free'`; continue releasing for Pro/Elite under the 2026-08-19 ruling.
- [x] **Step 4: Run the focused flow suite and confirm GREEN.** `deno test` on `flow.deno.test.ts`: 72/72 passed, 0 real Anthropic calls (fake `ModelCaller` only).

### Task 3: In-Flight Delete Defense

**Files:**
- Create: `supabase/migrations/20260906090000_reserved_analysis_delete_guard.sql`
- Modify: `supabase/functions/_shared/delete-analysis.ts`
- Modify: `supabase/functions/_shared/delete-analysis-client.ts`
- Modify: `supabase/functions/analysis/index.ts`

**Interfaces:**
- Consumes: `analyses.status` (`reserved | delivered | released`).
- Produces: `DeleteAnalysisResult` outcome `in_progress`, HTTP 409, and a database permission state in which authenticated clients cannot update `deleted_at` directly.

- [x] **Step 1: Guard the deletion orchestrator.** Add `status` to the ownership row and return `in_progress` before touching Storage when the row is reserved.
- [x] **Step 2: Map `in_progress` to HTTP 409.** Return a stable structured error code from the existing response mapper.
- [x] **Step 3: Remove direct client soft-delete authority.** ~~Add a forward-only migration~~ — **already done.** Verified live-grant evidence in `supabase/migrations/20260712230000_analyses_client_delete_removed.sql` (applied well before this task): it already drops `"Users can soft-delete their own analyses"` and revokes `update (deleted_at) on public.analyses from authenticated`, and no later migration re-adds either. This step needed no new migration — creating one would have duplicated/conflicted with existing, applied state. No new migration file was created.
- [x] **Step 4: Run deletion unit tests and local privilege verification, confirming GREEN.** `deno test` on `delete-analysis.deno.test.ts`: 26/26 passed. The "local privilege verification" half (a live Postgres check) was not run — same Docker constraint as Task 1 Step 4; the grant/policy state was instead verified by reading the already-applied migration file directly.

### Task 4: Retire the Sample Client Surface

**Files:**
- Delete: `app/result/sample.tsx`
- Delete: `app/result/__tests__/sample.test.tsx`
- Delete: `components/sample-result-banner.tsx`
- Delete: `lib/pending-sample-result.ts`
- Delete: `lib/__tests__/pending-sample-result.test.ts`
- Modify: `lib/analyze-form.ts`
- Modify: `lib/analyzing-machine.ts`
- Modify: `app/analyzing.tsx`
- Modify: `app/_layout.tsx`
- Modify: `components/pace-readout.tsx`
- Modify: `app/compare.tsx`

**Interfaces:**
- Consumes: the server's single persisted-result response.
- Produces: `AnalyzeFormSuccess = { result, analysisId, isFallback }` and one success navigation path to `/result/[id]`.

- [x] **Step 1: Delete the sample-only surface.** Remove every sample-only route, mailbox, banner, reducer state/event, response parser branch, and live comment.
- [x] **Step 2: Keep old payloads closed.** Reject old `{ isSample: true }` payloads as malformed; route every accepted 200 to `/result/[id]`.
- [x] **Step 3: Run client, reducer, and Analyzing screen suites and confirm GREEN.** `analyze-form.test.ts`, `analyzing-machine.test.ts`, `analyzing.test.tsx`, `paywall.test.tsx` all green as part of the full 93-suite/1439-test Jest run.

### Task 5: Honest Allowance and Paywall Copy

**Files:**
- Modify: `constants/copy.ts`
- Modify: `lib/quota.ts`
- Modify: `docs/design/copy-deck.md`

**Interfaces:**
- Consumes: server `remaining`, `limit`, `frameCap`, and tier.
- Produces: Free available/exhausted text and plan descriptions that do not guarantee unsupported pillars, measurements, flags, drills, or immediate purchase availability.

- [x] **Step 1: Replace sample wording.** Use `1 free analysis available` and `You've used your free analysis`.
- [x] **Step 2: Describe the actual tier differences.** Free is one genuine, one-frame, short analysis with no flags/drills; Pro/Elite add allowance and frame evidence, with certified flags/drills only when supported, plus Elite comparison/depth.
- [x] **Step 3: Preserve the purchase disclosure.** The existing disabled-purchase/CTA-state logic in `app/paywall.tsx` (`ctaForPurchasableTier`/`ctaForFree`) was untouched — only copy strings changed. All claims that Pro always unlocks four scored pillars or a "full 4-pillar read" were removed (verified: zero remaining hits for both phrases in `constants/copy.ts`). `docs/design/copy-deck.md` needed no change — it never had the sample/over-claim copy in the first place (both the retired `result.sample.*` block and the paywall over-claims were marked "NOT in the copy deck" additions).
- [x] **Step 4: Run quota and paywall tests and confirm GREEN.** `quota.test.ts` and `paywall.test.tsx` both green.

### Task 6: Documentation and Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/status.md`
- Modify: `docs/change_log.md`
- Modify: `supabase/functions/_shared/integration/README.md`

**Interfaces:**
- Consumes: the completed implementation and test evidence.
- Produces: current architecture/deployment guidance with historical sample-era records left intact.

- [x] **Step 1: Update current documentation.** Delegated to a `docs-updater` subagent (architecture.md, status.md, README.md, change_log.md) with the full factual brief above; see its summary in this session's status/handoff for exactly what changed.
- [x] **Step 2: Record validation truthfully.** `0` real Anthropic calls anywhere in this work (every model seam in the tests is a deterministic fake); no live deployment and no device/simulator validation was performed — this is code-complete and locally test-green only.
- [x] **Step 3: Run the repository gate.** `npm run typecheck && npm run lint && npm test` all clean (93 Jest suites/1439 tests, 400 Deno tests). The local Supabase integration suite (`quota-rpc.local.ts`) was **not** run — Docker Desktop is stopped and this worktree's standing instruction forbids starting it or taking machine focus; this is honestly recorded as unproven, not claimed as passing.
- [x] **Step 4: Integrate the reliability lane.** **Deliberately SKIPPED, not forgotten.** `fm/v23-reliability-timeouts` is paused mid-flight (WIP, not completed/merged) as of this session's relaunch brief, which explicitly instructs staying out of its files and not duplicating its work rather than rebasing an unfinished branch into this one. Rebasing it in now would pull in unreviewed, unmerged work this task was never asked to integrate. Frame-sampling/prompt changes from that branch may still further constrain what a real analysis can honestly claim once it lands — noted as a follow-up, not resolved here.
- [ ] **Step 5: Commit and hand off.** Pending — commit after the security/code-review pass this session also ran comes back clean (or its findings are addressed).
