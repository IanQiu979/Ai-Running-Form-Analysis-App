/**
 * Regression locks for `analyze-form/flow.ts` (issue #44) — the core of the product.
 *
 * The first five suites below are the FIVE BINDING CONTRACT RULES, one suite each, each written
 * against the specific failure mode that rule exists to prevent (`docs/status.md` Known Issue #14,
 * #17; `docs/architecture.md`'s call-ordering contract; #88's upload ordering). They are not
 * "coverage" — each one is a live production hazard that a plausible refactor could reintroduce
 * silently:
 *
 *   1. `p_user_id` comes from the verified JWT, never the request body — else a crafted body forges
 *      reservations into another user's quota, because the RPCs do no independent check.
 *   2. Branch on `reserve_analysis`'s `status`, not just `allowed` — else a replay against a
 *      RELEASED reservation is delivered as if it were fresh.
 *   3. `release_analysis` on EVERY failure path — else a `'reserved'` row eats a quota slot forever.
 *   4. Refuse without recorded consent — else the app processes Art. 9 health data with no legal
 *      basis, and `<ConsentGate />` (client-side, bypassable) was never the control.
 *   5. `gateAiCall()` before EVERY Anthropic request, `recordAiCall()` on EVERY exit path after —
 *      else spend runs un-braked and `'pending'` ledger rows eat daily-cap headroom.
 *
 * ZERO ANTHROPIC SPEND: `ModelCaller` is a fake queue. Nothing in this suite touches the network.
 *
 * DENO-ONLY (issue #90's convention): `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it; only `deno test` (`npm run test:edge`) runs it.
 */
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  UPLOAD_HEALTH_CONSENT_KEY,
  runAnalyzeForm,
  type AnalyzeFormDeps,
  type ModelCallResult,
} from '../flow.ts';
import type { RpcClient } from '../../_shared/ai-guard.ts';
import { PACE_ANALYSIS_TOOL_NAME } from '../../_shared/analyze-form-prompt.ts';
import type { AnthropicMessageResponse } from '../../_shared/analyze-form-validation.ts';
import { FREE_SAMPLE_PACE_RESULT } from '../../_shared/analyze-form-sample.ts';

const CALLER = '11111111-1111-4111-8111-111111111111';
const ATTACKER_TARGET = '22222222-2222-4222-8222-222222222222';
const ANALYSIS_ID = '33333333-3333-4333-8333-333333333333';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

type RpcHandler = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

class FakeRpc implements RpcClient {
  readonly calls: RpcCall[] = [];
  private gateSeq = 0;

  handlers: Record<string, RpcHandler> = {
    // Defaults to 'pro' — the free-tier short-circuit (`currentTier`, before the gate) is tested
    // explicitly in its own suite below; every OTHER test in this file exercises the pro/elite
    // path, which is what a default of 'pro' preserves without touching each one individually.
    pace_current_tier: () => ({ data: 'pro', error: null }),
    gate_ai_call: () => {
      this.gateSeq += 1;
      return { data: { allowed: true, call_id: `call-${this.gateSeq}`, estimated_usd: 0.09 }, error: null };
    },
    record_ai_call: () => ({ data: { ok: true }, error: null }),
    reserve_analysis: () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    }),
    settle_analysis: () => ({ data: { ok: true }, error: null }),
    attach_media_paths: () => ({ data: { ok: true }, error: null }),
    release_analysis: () => ({ data: { ok: true }, error: null }),
  };

  // deno-lint-ignore require-await
  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ fn, args });
    const handler = this.handlers[fn];
    if (!handler) {
      throw new Error(`FakeRpc: unstubbed rpc "${fn}"`);
    }
    return handler(args);
  }

  to(fn: string): RpcCall[] {
    return this.calls.filter((call) => call.fn === fn);
  }

  names(): string[] {
    return this.calls.map((call) => call.fn);
  }
}

class FakeStorage {
  readonly uploads: { path: string; bytes: number }[] = [];
  readonly removed: string[] = [];
  failOn: (path: string) => boolean = () => false;

  // deno-lint-ignore require-await
  async upload(path: string, bytes: Uint8Array, _contentType: string) {
    if (this.failOn(path)) {
      return { error: 'storage exploded' };
    }
    this.uploads.push({ path, bytes: bytes.length });
    return { error: null };
  }

  // `purgePrefix` lists, then removes, then re-lists to VERIFY the prefix is empty. This fake must
  // honour that contract or the verification pass will throw: report what is still present.
  // deno-lint-ignore require-await
  async list(prefix: string, _options: { limit: number; offset: number }) {
    return this.uploads
      .filter((u) => u.path.startsWith(prefix) && !this.removed.includes(u.path))
      .map((u) => ({ name: u.path.slice(prefix.length), isFolder: false }));
  }

  // deno-lint-ignore require-await
  async remove(paths: string[]) {
    this.removed.push(...paths);
    return { error: null };
  }
}

class FakeModel {
  readonly sent: number[] = [];
  constructor(private readonly queue: ModelCallResult[]) {}

  // deno-lint-ignore require-await
  async send(_request: unknown, timeoutMs: number): Promise<ModelCallResult> {
    this.sent.push(timeoutMs);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('FakeModel: called more times than the test scripted');
    }
    return next;
  }
}

class VirtualClock {
  private currentMs = 0;

  readonly now = (): number => this.currentMs;

  advance(elapsedMs: number): void {
    this.currentMs += elapsedMs;
  }
}

interface VirtualModelStep {
  durationMs: number;
  result: ModelCallResult;
}

class VirtualClockModel {
  readonly timeoutBudgets: number[] = [];

  constructor(
    private readonly clock: VirtualClock,
    private readonly queue: VirtualModelStep[]
  ) {}

  // deno-lint-ignore require-await
  async send(_request: unknown, timeoutMs: number): Promise<ModelCallResult> {
    this.timeoutBudgets.push(timeoutMs);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('VirtualClockModel: called more times than the test scripted');
    }

    this.clock.advance(Math.min(next.durationMs, timeoutMs));
    if (next.durationMs >= timeoutMs) {
      return { ok: false, kind: 'timeout', message: 'virtual model timeout' };
    }
    return next.result;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function scoredPillar(score: number, band: string) {
  return { score, band, feedback: 'Tall through mid-stance.', flags: [], drills: [] };
}

function validToolInput() {
  return {
    pillars: {
      posture: scoredPillar(80, 'good'),
      armSwing: scoredPillar(72, 'good'),
      cadence: scoredPillar(60, 'mid'),
      elasticity: scoredPillar(90, 'strong'),
    },
    overall: { score: 76, band: 'good' },
  };
}

function ok(input: unknown = validToolInput()): ModelCallResult {
  const response: AnthropicMessageResponse = {
    content: [{ type: 'tool_use', name: PACE_ANALYSIS_TOOL_NAME, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 26_000, output_tokens: 1_500 },
  };
  return { ok: true, response };
}

/** THE PRODUCTION ENVELOPE. `buildAnalyzeFormRequest` now sends `output_config.format` (structured
 * outputs) and no tool, so a real response is a JSON text block — grammar-constrained to
 * `PACE_RESULT_SCHEMA` — behind an empty-bodied thinking block. `ok()` above still uses the
 * tool_use envelope on purpose: the parser must handle both (see `extractPayload`), and the whole
 * flow must be indifferent to which one arrived. */
function structuredOk(input: unknown = validToolInput()): ModelCallResult {
  return {
    ok: true,
    response: {
      content: [{ type: 'thinking' }, { type: 'text', text: JSON.stringify(input) }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 26_000, output_tokens: 1_500 },
    },
  };
}

/** A prose reply — no tool_use block. Two of these is the prompt-injection signature. */
function prose(): ModelCallResult {
  return {
    ok: true,
    response: { content: [{ type: 'text' }], stop_reason: 'end_turn', usage: { output_tokens: 40 } },
  };
}

function refusal(): ModelCallResult {
  return {
    ok: true,
    response: {
      content: [],
      stop_reason: 'refusal',
      usage: { input_tokens: 26_000, output_tokens: 40 },
    },
  };
}

/** A response whose only readable pillars are `parsed`; no `overall`, so it cannot fully validate. */
function partial(parsed: string[]): ModelCallResult {
  const pillars: Record<string, unknown> = {};
  for (const id of ['posture', 'armSwing', 'cadence', 'elasticity']) {
    pillars[id] = parsed.includes(id) ? scoredPillar(80, 'good') : { garbage: true };
  }
  return ok({ pillars });
}

/** A pillar the model honestly reports as not assessed — `score`/`band` null together, per
 * `pace.ts`'s `isValidScoreBandPair`. Structurally VALID (unlike `{ garbage: true }` above). */
function notAssessedPillar(reason: 'angle' | 'needsVideo') {
  return {
    score: null,
    band: null,
    feedback: null,
    notAssessedReason: reason,
    flags: [],
    drills: [],
  };
}

/** A FULLY VALID response (every pillar structurally present, `overall` a valid null pair) in
 * which the model honestly assessed NOTHING — e.g. a clip that never shows the runner. This is
 * NOT a `partial()`/salvage case: it validates on the first attempt, so `decideOutcome` never
 * sees it and it would otherwise settle exactly like a normal success. */
function allNotAssessed(): ModelCallResult {
  return ok({
    pillars: {
      posture: notAssessedPillar('angle'),
      armSwing: notAssessedPillar('angle'),
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    },
    overall: { score: null, band: null },
  });
}

const VIDEO_BODY = {
  mediaType: 'video',
  frames: ['AAAA', 'BBBB'],
  timestamps: [0, 400],
  idempotencyKey: 'idem-1',
};

interface Harness {
  rpc: FakeRpc;
  storage: FakeStorage;
  model: FakeModel;
  deps: AnalyzeFormDeps;
}

function harness(
  modelResults: ModelCallResult[],
  options: { granted?: boolean | null; consentThrows?: boolean; now?: () => number } = {}
): Harness {
  const rpc = new FakeRpc();
  const storage = new FakeStorage();
  const model = new FakeModel(modelResults);

  const deps: AnalyzeFormDeps = {
    rpc,
    storage,
    model,
    consents: {
      // deno-lint-ignore require-await
      async latestGrant() {
        if (options.consentThrows) {
          throw new Error('consents table is on fire');
        }
        return options.granted === undefined ? true : options.granted;
      },
    },
    now: options.now,
  };

  return { rpc, storage, model, deps };
}

function run(h: Harness, body: unknown = VIDEO_BODY, callerUserId = CALLER) {
  return runAnalyzeForm(h.deps, { callerUserId, rawBody: body });
}

// ===========================================================================
// CONTRACT RULE 1 — p_user_id comes from the verified JWT, NEVER the request body.
// ===========================================================================

Deno.test('rule 1: every RPC receives the JWT-derived user id, on the happy path', async () => {
  const h = harness([ok()]);
  await run(h);

  for (const fn of ['gate_ai_call', 'reserve_analysis', 'settle_analysis']) {
    const calls = h.rpc.to(fn);
    assert(calls.length > 0, `${fn} was never called`);
    for (const call of calls) {
      assertEquals(call.args.p_user_id, CALLER, `${fn} must be told the JWT's user id`);
    }
  }
});

Deno.test('rule 1: a body that tries to name a different user cannot influence p_user_id', async () => {
  // The RPCs are service_role-only and trust `p_user_id` as a plain argument with NO independent
  // check — by design. If this ever regressed, a crafted body would reserve, settle, and release
  // against a stranger's quota, and write an analysis into their history.
  const h = harness([ok()]);

  await run(h, {
    ...VIDEO_BODY,
    userId: ATTACKER_TARGET,
    user_id: ATTACKER_TARGET,
    p_user_id: ATTACKER_TARGET,
    callerUserId: ATTACKER_TARGET,
  });

  for (const call of h.rpc.calls) {
    assertNotEquals(
      call.args.p_user_id,
      ATTACKER_TARGET,
      `${call.fn} was handed a user id from the request body`
    );
  }
  assertEquals(h.rpc.to('reserve_analysis')[0].args.p_user_id, CALLER);
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_user_id, CALLER);
});

Deno.test('rule 1: frames are uploaded under the JWT user id, inside the row\'s own namespace', async () => {
  const h = harness([ok()]);
  await run(h, { ...VIDEO_BODY, userId: ATTACKER_TARGET });

  // `attach_media_paths`'s namespace guard rejects the whole call for any path outside
  // `{p_user_id}/{p_analysis_id}/` — but the paths must be right in the first place, not merely
  // caught downstream.
  assertEquals(h.storage.uploads.map((u) => u.path), [
    `${CALLER}/${ANALYSIS_ID}/frame-01.jpg`,
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
  assertEquals(h.rpc.to('attach_media_paths')[0].args.p_media_paths, [
    `${CALLER}/${ANALYSIS_ID}/frame-01.jpg`,
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
});

// ===========================================================================
// CONTRACT RULE 2 — branch on reserve_analysis's `status`, not just `allowed`.
// ===========================================================================

function existing(status: string, extra: Record<string, unknown> = {}) {
  return {
    allowed: true,
    existing: true,
    id: ANALYSIS_ID,
    status,
    tier: 'pro',
    ...extra,
  };
}

Deno.test('rule 2: existing + RELEASED returns 409 — never a delivery, and never a model call', async () => {
  // THE case the M1 review flagged: `allowed: true, existing: true, status: "released"`. The row is
  // real. Nothing may be delivered against it as if it were a fresh reservation.
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({ data: existing('released'), error: null });

  const res = await run(h);

  assertEquals(res.status, 409);
  assertEquals(res.body.code, 'previous_attempt_failed');
  assertEquals(h.model.sent.length, 0, 'a released reservation must never trigger a paid call');
  assertEquals(h.rpc.to('settle_analysis').length, 0);
  assertEquals(h.storage.uploads.length, 0);
});

Deno.test('rule 2: existing + RESERVED returns 409 in-progress — no second model call, no double bill', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({ data: existing('reserved'), error: null });

  const res = await run(h);

  assertEquals(res.status, 409);
  assertEquals(res.body.code, 'analysis_in_progress');
  assertEquals(h.model.sent.length, 0);
  // And critically: we must NOT release a reservation another invocation is actively working on.
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

Deno.test('rule 2: existing + DELIVERED replays the stored result with no model call', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: existing('delivered', { result: validToolInput(), is_fallback: true }),
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.analysisId, ANALYSIS_ID);
  assertEquals(res.body.isFallback, true, 'the stored fallback flag is replayed, not re-derived');
  assertEquals(h.model.sent.length, 0, 'an idempotent replay must never re-run the model');
  assertEquals(h.rpc.to('release_analysis').length, 0, 'and must never release the delivered row');
});

Deno.test('rule 2: existing + DELIVERED but soft-deleted (result redacted to null) returns 410, not a null result', async () => {
  // `redact_analyses_on_soft_delete` sets `result := null`. Replaying that key must not hand the
  // client a 200 carrying `result: null`, which the result screen cannot render.
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: existing('delivered', { result: null, is_fallback: false }),
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 410);
  assertEquals(res.body.code, 'analysis_deleted');
});

Deno.test('rule 2: an unknown future status is treated as not-deliverable, not as success', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({ data: existing('some_new_status'), error: null });

  const res = await run(h);

  assertEquals(res.status, 409);
  assertEquals(h.model.sent.length, 0);
});

// ===========================================================================
// CONTRACT RULE 3 — release_analysis on EVERY failure path (a finally, not a branch).
// ===========================================================================

function releaseReasonFrom(rpc: FakeRpc): unknown {
  const calls = rpc.to('release_analysis');
  assertEquals(calls.length, 1, 'exactly one release per failed request');
  assertEquals(calls[0].args.p_user_id, CALLER);
  assertEquals(calls[0].args.p_analysis_id, ANALYSIS_ID);
  return calls[0].args.p_reason;
}

Deno.test('rule 3: a content failure is terminal and releases as model_error', async () => {
  const h = harness([prose(), prose()]);

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'model_error');
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
  assertEquals(h.model.sent.length, 1, 'validation/content failures are not retried');
});

Deno.test('finding 1(a): a transport error with too little full-attempt budget skips retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 6_000, result: { ok: false, kind: 'error', message: 'slow transport error' } },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 503, 'server fault is a 503, not the 422 a farming signal gets');
  assertEquals(res.body.code, 'model_error');
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
  assertEquals(model.timeoutBudgets, [80_000], 'the retry was skipped without a full 80s remaining');
});

Deno.test('finding 1(b): retry gate DENIED after a transport error -> model_error, no strike', async () => {
  let gateCalls = 0;
  const h = harness([{ ok: false, kind: 'error', message: 'Anthropic returned 500' }]);
  h.rpc.handlers.gate_ai_call = () => {
    gateCalls += 1;
    if (gateCalls === 1) {
      return { data: { allowed: true, call_id: 'call-1', estimated_usd: 0.09 }, error: null };
    }
    return { data: { allowed: false, reason: 'breaker_open' }, error: null };
  };

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(releaseReasonFrom(h.rpc), 'model_error', 'we suppressed the retry, so this is our fault');
  assertEquals(h.model.sent.length, 1, 'the retry was gated out');
});

Deno.test('rule 3: a model transport error releases with model_error (NOT a farming signal)', async () => {
  const err: ModelCallResult = { ok: false, kind: 'error', message: 'Anthropic returned 500' };
  const h = harness([err, err]);

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
});

Deno.test('rule 3: a timeout releases with provider_timeout (NOT a farming signal)', async () => {
  const timeout: ModelCallResult = { ok: false, kind: 'timeout', message: 'too slow' };
  const h = harness([timeout, timeout]);

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'provider_timeout');
  assertEquals(releaseReasonFrom(h.rpc), 'provider_timeout');
});

Deno.test('rule 3: a truncated response (max_tokens) releases with model_error, never validation_failed', async () => {
  // Thinking tokens count against max_tokens on Sonnet 5. A truncation is OUR budget being too
  // tight — charging it to the user's 3-strike anti-farming counter would lock them out for
  // something we did.
  const truncated: ModelCallResult = {
    ok: true,
    response: {
      content: [{ type: 'tool_use', name: PACE_ANALYSIS_TOOL_NAME, input: validToolInput() }],
      stop_reason: 'max_tokens',
      usage: { output_tokens: 4000 },
    },
  };
  const h = harness([truncated, truncated]);

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
});

Deno.test('rule 3: a settle that refuses still releases — and uploads NOTHING (#130)', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.settle_analysis = () => ({
    data: { ok: false, reason: 'not_reserved_or_not_found' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(releaseReasonFrom(h.rpc), 'internal_error');
  // THE #130 REGRESSION LOCK — the orphan that needed no crash. Under the old upload-then-settle
  // order the frames were already in the bucket by the time the settle refused (a late replay or a
  // concurrent duplicate is enough), and the released row never named them: a permanent orphan that
  // no sweep-side purge could ever have reached, because the sweep only touches 'reserved' rows.
  assertEquals(h.storage.uploads.length, 0);
  assertEquals(h.rpc.to('attach_media_paths').length, 0);
});

Deno.test('rule 3: an UNEXPECTED throw mid-flight still releases — the case a catch-chain always misses', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.settle_analysis = () => {
    throw new Error('the database fell over');
  };

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(res.body.code, 'internal_error');
  assertEquals(releaseReasonFrom(h.rpc), 'internal_error');
});

Deno.test('rule 3: a storage outage does NOT fail the request, and does NOT release', async () => {
  // The analysis is done, correct, and ALREADY SETTLED. Refusing to deliver it because a thumbnail
  // did not persist would be absurd — and releasing would hand back a slot for work we did.
  const h = harness([ok()]);
  h.storage.failOn = () => true;

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(
    h.rpc.to('attach_media_paths').length,
    0,
    'nothing landed, so nothing is attached — media_paths never names an object that does not exist'
  );
});

Deno.test('rule 3: a SUCCESS never releases', async () => {
  const h = harness([ok()]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_is_fallback, false);
});

Deno.test('rule 3: an honest partial SETTLES (is_fallback = true) — it never releases', async () => {
  // A fallback is a delivered result, not a failure. Releasing it would refund a slot for an
  // analysis the user actually received.
  const h = harness([partial(['posture', 'armSwing']), partial(['posture', 'armSwing'])]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, true);
  assertEquals(h.rpc.to('release_analysis').length, 0);

  const settle = h.rpc.to('settle_analysis')[0];
  assertEquals(settle.args.p_is_fallback, true);

  const result = settle.args.p_result as { pillars: Record<string, { score: number | null }> };
  assertEquals(result.pillars.posture.score, 80);
  assertEquals(result.pillars.cadence.score, null, 'never a fabricated score for a dropped pillar');
  assertEquals(result.pillars.elasticity.score, null);
});

Deno.test('rule 3: nothing is reserved and nothing is released when the reserve itself is denied', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: false, reason: 'quota_exceeded', tier: 'free', used: 1, limit: 1 },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 402);
  assertEquals(res.body.code, 'quota_exceeded');
  assertEquals(h.rpc.to('release_analysis').length, 0, 'no row was created, so there is nothing to release');
  assertEquals(h.storage.uploads.length, 0);
  assertEquals(h.model.sent.length, 0);
});

Deno.test('rule 3: the anti-farming refusal is a 429, not a paywall 402', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: false, reason: 'too_many_failed_attempts', tier: 'free' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 429);
  assertEquals(res.body.code, 'too_many_failed_attempts');
});

// ===========================================================================
// CAPTAIN DECISION (audit-v23-r1-decision-zero-pillar-charge-policy) — a structurally VALID
// result in which every pillar is honestly not-assessed carries no information the user paid
// for. It must not charge the quota slot — but the request must still deliver the (empty)
// result, not fail outright.
// ===========================================================================

Deno.test('zero-pillar policy: a fully valid result with ZERO assessed pillars RELEASES, not settles', async () => {
  const h = harness([allNotAssessed()]);

  const res = await run(h);

  assertEquals(res.status, 200, 'the (empty) result is still delivered, not failed outright');
  assertEquals((res.body.result as { pillars: unknown }).pillars, {
    posture: notAssessedPillar('angle'),
    armSwing: notAssessedPillar('angle'),
    cadence: notAssessedPillar('needsVideo'),
    elasticity: notAssessedPillar('needsVideo'),
  });

  assertEquals(h.rpc.to('settle_analysis').length, 0, 'nothing useful was delivered — never settle it');
  const release = h.rpc.to('release_analysis');
  assertEquals(release.length, 1, 'the quota slot must be handed back, not charged');
  assertEquals(release[0].args.p_reason, 'zero_pillars_assessed');
});

Deno.test('zero-pillar policy: a released zero-pillar row does NOT count as a farming signal', async () => {
  // pace_is_farming_signal only treats 'validation_failed' as abuse (20260712220000). Prove the
  // reason this suite releases with is never that string, so reserve_analysis's 3-strike cap is
  // never ticked by an honest zero-pillar read.
  const h = harness([allNotAssessed()]);

  await run(h);

  const release = h.rpc.to('release_analysis');
  assertNotEquals(release[0].args.p_reason, 'validation_failed');
});

Deno.test('zero-pillar policy: at least one real score still settles normally, even if others are not assessed', async () => {
  const input = {
    pillars: {
      posture: scoredPillar(80, 'good'),
      armSwing: notAssessedPillar('angle'),
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    },
    overall: { score: 80, band: 'good' },
  };
  const h = harness([ok(input)]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('settle_analysis').length, 1, 'one real score is a real, chargeable analysis');
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

// ===========================================================================
// CONTRACT RULE 4 — refuse to run without recorded consent.
// ===========================================================================

Deno.test('rule 4: no consent row at all -> 403, and NOTHING else happens', async () => {
  const h = harness([], { granted: null });

  const res = await run(h);

  assertEquals(res.status, 403);
  assertEquals(res.body.code, 'consent_required');
  // The refusal must precede the gate, the reserve, the model, and the bucket. No spend, no row, no
  // image of anyone's body anywhere.
  assertEquals(h.rpc.calls.length, 0, 'not even the AI gate may run without consent');
  assertEquals(h.model.sent.length, 0);
  assertEquals(h.storage.uploads.length, 0);
});

Deno.test('rule 4: a withdrawal (granted = false) -> 403', async () => {
  const h = harness([], { granted: false });

  const res = await run(h);

  assertEquals(res.status, 403);
  assertEquals(h.rpc.calls.length, 0);
});

Deno.test('rule 4: a consent QUERY ERROR -> 403 (fail closed — "we could not ask" is not "yes")', async () => {
  const h = harness([], { consentThrows: true });

  const res = await run(h);

  assertEquals(res.status, 403);
  assertEquals(res.body.code, 'consent_required');
  assertEquals(h.rpc.calls.length, 0);
});

Deno.test('rule 4: the consent key checked is the versioned upload.health.v1', async () => {
  // Consent to one wording is not consent to a later one: a reworded deck mints `...v2` and this
  // check fails closed for every user until they re-tick.
  assertEquals(UPLOAD_HEALTH_CONSENT_KEY, 'upload.health.v1');

  let seenKey: string | null = null;
  const h = harness([ok()]);
  h.deps.consents = {
    // deno-lint-ignore require-await
    async latestGrant(_userId, key) {
      seenKey = key;
      return true;
    },
  };

  await run(h);

  assertEquals(seenKey, 'upload.health.v1');
});

Deno.test('rule 4: consent is checked for the JWT user, not anyone named in the body', async () => {
  let seenUser: string | null = null;
  const h = harness([ok()]);
  h.deps.consents = {
    // deno-lint-ignore require-await
    async latestGrant(userId) {
      seenUser = userId;
      return true;
    },
  };

  await run(h, { ...VIDEO_BODY, userId: ATTACKER_TARGET });

  assertEquals(seenUser, CALLER);
});

// ===========================================================================
// CONTRACT RULE 5 — gateAiCall() before EVERY Anthropic request; recordAiCall() on EVERY exit.
// ===========================================================================

Deno.test('rule 5: the gate runs BEFORE idempotency/reserve — a denial never creates a reservation', async () => {
  const h = harness([]);
  h.rpc.handlers.gate_ai_call = () => ({
    data: { allowed: false, reason: 'daily_cap', spent_usd: 20.1 },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 503, 'a guardrail denial is our brake, never the caller\'s fault — never a 4xx');
  assertEquals(res.body.code, 'daily_cap');
  assertEquals(h.rpc.to('reserve_analysis').length, 0, 'gating first is what keeps outages from tripping the anti-farm cap');
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(h.model.sent.length, 0);
});

Deno.test('rule 5: the kill switch and the circuit breaker are also 503s', async () => {
  for (const reason of ['killed', 'breaker_open']) {
    const h = harness([]);
    h.rpc.handlers.gate_ai_call = () => ({ data: { allowed: false, reason }, error: null });

    const res = await run(h);

    assertEquals(res.status, 503);
    assertEquals(res.body.code, reason);
  }
});

Deno.test('rule 5: gate ordering is auth -> consent -> tier -> gate -> reserve -> settle -> attach', async () => {
  const h = harness([ok()]);
  await run(h);

  assertEquals(h.rpc.names(), [
    'pace_current_tier',
    'gate_ai_call',
    'reserve_analysis',
    'settle_analysis',
    'attach_media_paths',
    'record_ai_call',
  ]);
});

Deno.test('rule 5: a successful call is recorded as success, with the real token usage', async () => {
  const h = harness([ok()]);
  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1);
  assertEquals(records[0].args.p_call_id, 'call-1');
  assertEquals(records[0].args.p_status, 'success');
  assertEquals(records[0].args.p_input_tokens, 26_000);
  assertEquals(records[0].args.p_output_tokens, 1_500);
  assertEquals(records[0].args.p_analysis_id, ANALYSIS_ID);
});

Deno.test('rule 5: a directly delivered partial is recorded as fallback without a retry', async () => {
  const h = harness([partial(['posture', 'armSwing'])]);

  const res = await run(h);

  assertEquals(res.body.isFallback, true);
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-1')?.args.p_status, 'fallback');
  assertEquals(records.length, 1);
});

Deno.test('rule 5: a partial delivered from the RETRY marks the retry as the fallback', async () => {
  const h = harness([
    { ok: false, kind: 'error', message: 'Anthropic returned 500' },
    partial(['posture', 'armSwing']),
  ]);

  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-1')?.args.p_status, 'model_error');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-2')?.args.p_status, 'fallback');
});

Deno.test('rule 5: a terminal content failure is recorded as validation_failed', async () => {
  const h = harness([prose(), prose()]);
  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1);
  assertEquals(records[0].args.p_status, 'validation_failed');
});

Deno.test('rule 5: an idempotent replay settles the gate reservation as CANCELLED, at $0', async () => {
  // The gate necessarily runs before the edge function can know (from `reserve_analysis`) that no
  // model call is needed. `'cancelled'` is the release valve: nothing failed, so it must not feed
  // the circuit breaker, and it must not be left `'pending'` to eat daily-cap headroom.
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: existing('delivered', { result: validToolInput(), is_fallback: false }),
    error: null,
  });

  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1);
  assertEquals(records[0].args.p_status, 'cancelled');
});

Deno.test('rule 5: a quota denial after the gate also settles as cancelled', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: false, reason: 'quota_exceeded', tier: 'free' },
    error: null,
  });

  await run(h);

  assertEquals(h.rpc.to('record_ai_call')[0].args.p_status, 'cancelled');
});

Deno.test('rule 5: a consent refusal records nothing — the gate never ran, so there is nothing to settle', async () => {
  const h = harness([], { granted: false });
  await run(h);

  assertEquals(h.rpc.to('record_ai_call').length, 0);
});

Deno.test('rule 5: THE RETRY IS A SECOND BILLED CALL AND GETS ITS OWN GATE', async () => {
  const h = harness([{ ok: false, kind: 'error', message: 'Anthropic returned 500' }, ok()]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.model.sent.length, 2, 'exactly one retry');
  assertEquals(h.rpc.to('gate_ai_call').length, 2, 'the daily cap and the breaker must see both calls');
  assertEquals(h.rpc.to('record_ai_call').length, 2, 'and both must be settled');

  // The first gate cannot know the tier (only reserve_analysis may decide it), so it estimates at
  // the worst case. The retry's gate knows the real tier and uses it — a strictly tighter estimate.
  const gates = h.rpc.to('gate_ai_call');
  assertEquals(gates[0].args.p_analysis_id, null, 'the first gate runs before the row exists');
  assertEquals(gates[1].args.p_analysis_id, ANALYSIS_ID);
  assert(
    (gates[1].args.p_estimated_output_tokens as number) <
      (gates[0].args.p_estimated_output_tokens as number),
    'the retry gate should use the real (pro) tier, not the elite worst case'
  );
});

Deno.test('rule 5: a failed attempt rescued by a retry is STILL recorded as a failure', async () => {
  // The circuit breaker opens only when the last N settled calls ALL carry
  // 'model_error'/'validation_failed' (`ai_breaker_state`). Settling attempt 1 as 'success' just
  // because the retry saved the request would hide a genuine model degradation from the breaker —
  // and would bill attempt 2's tokens to attempt 1's ledger row.
  const h = harness([{ ok: false, kind: 'error', message: 'Anthropic returned 500' }, ok()]);

  const res = await run(h);

  assertEquals(res.status, 200);
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 2);

  const first = records.find((r) => r.args.p_call_id === 'call-1');
  const second = records.find((r) => r.args.p_call_id === 'call-2');

  assertEquals(first?.args.p_status, 'model_error', 'attempt 1 really did fail');
  assertEquals(first?.args.p_output_tokens, null, 'the failed transport returned no usage');
  assertEquals(second?.args.p_status, 'success');
  assertEquals(second?.args.p_output_tokens, 1_500);
});

Deno.test('rule 5: a transport failure rescued by a retry is recorded as model_error', async () => {
  const h = harness([{ ok: false, kind: 'error', message: 'Anthropic 529 overloaded' }, ok()]);

  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-1')?.args.p_status, 'model_error');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-2')?.args.p_status, 'success');
});

Deno.test('rule 5: a gate denial never leaks our AI spend or our cap to the caller', async () => {
  // `gate_ai_call`'s daily_cap payload carries `spent_usd` / `estimated_usd` / `cap_usd`, and its
  // `killed` payload carries the operator's `disabled_reason`. Any authenticated user could read
  // our operational spend just by tripping the cap. The client needs `code` and nothing else.
  const h = harness([]);
  h.rpc.handlers.gate_ai_call = () => ({
    data: {
      allowed: false,
      reason: 'daily_cap',
      spent_usd: 19.87,
      estimated_usd: 0.31,
      cap_usd: 20,
    },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'daily_cap');

  // Assert on the SERIALIZED body — what `index.ts` actually puts on the wire — not on the object,
  // whose `Object.keys` would still show a key explicitly set to `undefined`.
  const serialized = JSON.stringify(res.body);
  assertEquals(Object.keys(JSON.parse(serialized)).sort(), ['code', 'error']);
  assert(!serialized.includes('19.87'), 'our current AI spend must never reach the client');
  assert(!serialized.includes('cap_usd'), 'nor our cap');
});

Deno.test('rule 5: the model is called AT MOST twice — the retry is once, never a loop', async () => {
  // A retry loop against a transport outage burns money and time.
  const transportError: ModelCallResult = {
    ok: false,
    kind: 'error',
    message: 'Anthropic returned 500',
  };
  const h = harness([transportError, transportError, transportError]);

  await run(h);

  assertEquals(h.model.sent.length, 2);
});

// ===========================================================================
// #88 — upload ordering: nothing reaches the bucket unless a row already owns it.
// ===========================================================================

Deno.test('#88: NOTHING is uploaded when the model fails — a failed analysis leaves no images behind', async () => {
  const h = harness([prose(), prose()]);

  await run(h);

  assertEquals(h.storage.uploads.length, 0);
});

Deno.test('#88: NOTHING is uploaded when the reserve is denied', async () => {
  const h = harness([]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: false, reason: 'frame_cap_exceeded', tier: 'free', frame_cap: 1 },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 400);
  assertEquals(h.storage.uploads.length, 0, 'the exact leak #88 exists to close');
});

Deno.test('#88/#130: the upload happens AFTER the model call and AFTER the settle', async () => {
  // #88's rule was "never upload before the reserve" — a rejected or failed analysis must leave
  // NOTHING in the bucket. #130 tightened it further: never upload before the SETTLE either, so a
  // 'reserved' row can never have frames. Both still hold; the upload simply moved one step later.
  const order: string[] = [];
  const h = harness([ok()]);

  const realUpload = h.storage.upload.bind(h.storage);
  h.storage.upload = async (path, bytes, type) => {
    order.push('upload');
    return await realUpload(path, bytes, type);
  };
  const baseSettle = h.rpc.handlers.settle_analysis;
  h.rpc.handlers.settle_analysis = (args) => {
    order.push('settle');
    return baseSettle(args);
  };
  const baseAttach = h.rpc.handlers.attach_media_paths;
  h.rpc.handlers.attach_media_paths = (args) => {
    order.push('attach');
    return baseAttach(args);
  };
  h.deps.model = {
    // deno-lint-ignore require-await
    async send() {
      order.push('model');
      return ok();
    },
  };

  await run(h);

  assertEquals(order, ['model', 'settle', 'upload', 'upload', 'attach']);
});

Deno.test('#88/#130: only the frames that LANDED are recorded in media_paths', async () => {
  const h = harness([ok()]);
  h.storage.failOn = (path) => path.endsWith('frame-01.jpg');

  await run(h);

  // The recording moved from `settle_analysis` to `attach_media_paths`, but the rule did not:
  // `media_paths` never names an object that is not in the bucket.
  assertEquals(h.rpc.to('attach_media_paths')[0].args.p_media_paths, [
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
});

// ===========================================================================
// Request validation, tiers, and the retry budget.
// ===========================================================================

Deno.test('an oversize / malformed body is rejected before any spend, any row, and any bucket write', async () => {
  const bad: [string, unknown][] = [
    ['not an object', 'nope'],
    ['no mediaType', { frames: ['AAAA'], timestamps: [0], idempotencyKey: 'k' }],
    ['bad mediaType', { mediaType: 'gif', frames: ['AAAA'], timestamps: [0], idempotencyKey: 'k' }],
    ['no frames', { mediaType: 'photo', frames: [], timestamps: [], idempotencyKey: 'k' }],
    ['timestamp count mismatch', { mediaType: 'video', frames: ['AAAA', 'BBBB'], timestamps: [0], idempotencyKey: 'k' }],
    ['blank idempotency key', { mediaType: 'photo', frames: ['AAAA'], timestamps: [0], idempotencyKey: '  ' }],
    ['a data: URI prefix', { mediaType: 'photo', frames: ['data:image/jpeg;base64,AAAA'], timestamps: [0], idempotencyKey: 'k' }],
    ['not base64', { mediaType: 'photo', frames: ['!!!!'], timestamps: [0], idempotencyKey: 'k' }],
    ['negative timestamp', { mediaType: 'photo', frames: ['AAAA'], timestamps: [-1], idempotencyKey: 'k' }],
    ['oversize payload', { mediaType: 'photo', frames: ['A'.repeat(6 * 1024 * 1024)], timestamps: [0], idempotencyKey: 'k' }],
  ];

  for (const [label, body] of bad) {
    const h = harness([]);
    const res = await run(h, body);

    assertEquals(res.status, 400, label);
    assertEquals(res.body.code, 'invalid_request', label);
    assertEquals(h.rpc.calls.length, 0, `${label}: nothing may be gated or reserved`);
    assertEquals(h.storage.uploads.length, 0, label);
  }
});

Deno.test('finding 2: >8 frames is rejected as too_many_frames BEFORE any gate/reserve/model call', async () => {
  // The pre-reserve DoS bound. Because the spend gate runs before the reserve (#91), an unbounded
  // frame count lets a caller whose quota is spent send ~2000 tiny valid-base64 frames:
  // estimateTokensForCall(2000,'elite') ~= $9.9, which gate_ai_call holds against the live $10
  // daily cap as a 'pending' row for the whole request — costing $0 of real spend but, sustained,
  // saturating the GLOBAL cap so every legitimate analysis 503s. Capping at PACE_FRAME_CAP.elite (8)
  // bounds that estimate to ~$0.23, and rejecting BEFORE the gate means the pending row is never
  // even created.
  const nineFrames = Array.from({ length: 9 }, () => 'AAAA');
  const nineStamps = Array.from({ length: 9 }, (_, i) => i * 100);

  const h = harness([]);
  const res = await run(h, {
    mediaType: 'video',
    frames: nineFrames,
    timestamps: nineStamps,
    idempotencyKey: 'k',
  });

  assertEquals(res.status, 400);
  assertEquals(res.body.code, 'too_many_frames', 'a distinct code, not a generic invalid_request');
  assertEquals(h.rpc.calls.length, 0, 'the gate must never see it — that is the whole point');
  assertEquals(h.model.sent.length, 0);
  assertEquals(h.storage.uploads.length, 0);
});

Deno.test('finding 2: a pathological 2000-frame payload never reserves gate budget', async () => {
  const h = harness([]);
  const res = await run(h, {
    mediaType: 'video',
    frames: Array.from({ length: 2000 }, () => 'AAAA'),
    timestamps: Array.from({ length: 2000 }, (_, i) => i),
    idempotencyKey: 'k',
  });

  assertEquals(res.status, 400);
  assertEquals(res.body.code, 'too_many_frames');
  assertEquals(h.rpc.calls.length, 0, 'no gate_ai_call, so no ~$9.9 pending hold against the daily cap');
});

Deno.test('finding 2: exactly 8 frames (Elite\'s legitimate max) is accepted past the parse gate', async () => {
  // The cap is the global maximum, not a per-tier rule. 8 frames from an Elite clip must pass parse
  // validation; reserve_analysis remains the authority on the actual per-tier limit.
  const h = harness([ok()]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'elite' },
    error: null,
  });

  const res = await run(h, {
    mediaType: 'video',
    frames: Array.from({ length: 8 }, () => 'AAAA'),
    timestamps: Array.from({ length: 8 }, (_, i) => i * 100),
    idempotencyKey: 'k',
  });

  assertEquals(res.status, 200, '8 frames is legitimate for Elite and must not be rejected at parse');
  assertEquals(h.rpc.to('reserve_analysis')[0].args.p_frame_count, 8);
});

Deno.test('a photo runs on the free tier at one frame, and the tier comes from the RESERVE, not the body', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'free' },
    error: null,
  });

  const res = await run(h, {
    mediaType: 'photo',
    frames: ['AAAA'],
    timestamps: [0],
    idempotencyKey: 'k',
    tier: 'elite', // ignored — the client is never the authority on tier
  });

  assertEquals(res.status, 200);
  assertEquals(h.storage.uploads.map((u) => u.path), [`${CALLER}/${ANALYSIS_ID}/frame-01.jpg`]);
});

Deno.test('the model gets a real timeout budget, never Infinity', async () => {
  const h = harness([ok()]);
  await run(h);

  assert(h.model.sent[0] > 0);
  assertEquals(h.model.sent[0], 80_000);
});

Deno.test('model window: a result needing 70 seconds succeeds on attempt 1', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 70_000, result: ok() },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  // A model result that needs 70 seconds must succeed on attempt 1.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 200);
});

Deno.test('model window: a full timeout does not launch an underfunded retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    {
      durationMs: 80_000,
      result: { ok: false, kind: 'timeout', message: 'full attempt timed out' },
    },
    {
      durationMs: 0,
      result: { ok: false, kind: 'error', message: 'underfunded retry must not run' },
    },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  // A full 80-second timeout must not launch a second underfunded disclosure/call.
  assertEquals(model.timeoutBudgets, [80_000]);
  assertEquals(response.status, 503);
});

Deno.test('model window: reserve and gate time do not consume the first attempt', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 0, result: ok() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  h.rpc.handlers.reserve_analysis = () => {
    clock.advance(50_000);
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    };
  };

  const response = await run(h);

  assertEquals(response.status, 200);
  // Reserve/gate time does not consume the model window.
  assertEquals(model.timeoutBudgets[0], 80_000);
});

Deno.test('model window: a quick transport error retries only with a full attempt remaining', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    {
      durationMs: 2_000,
      result: { ok: false, kind: 'error', message: 'quick transport error' },
    },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  assertEquals(response.status, 200);
  // A quick model transport error may retry only while a full attempt remains.
  assertEquals(model.timeoutBudgets, [80_000, 80_000]);
});

Deno.test('retry policy: max_tokens is terminal after one model call', async () => {
  const truncated: ModelCallResult = {
    ok: true,
    response: {
      content: [{ type: 'tool_use', name: PACE_ANALYSIS_TOOL_NAME, input: validToolInput() }],
      stop_reason: 'max_tokens',
      usage: { output_tokens: 4_000 },
    },
  };
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 0, result: truncated },
    { durationMs: 0, result: truncated },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  assertEquals(response.status, 503);
  assertEquals(model.timeoutBudgets, [80_000]);
});

Deno.test('retry policy: a refusal is terminal after one model call', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 0, result: refusal() },
    { durationMs: 0, result: refusal() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  assertEquals(response.status, 503);
  assertEquals(model.timeoutBudgets, [80_000]);
});

// ===========================================================================
// Structured outputs — the real production response envelope.
// ===========================================================================

Deno.test('structured outputs: the request carries output_config.format and NO tool', async () => {
  // The whole platform-specific `tool_choice`-vs-thinking question is moot when there is no tool in
  // the request at all. This asserts the flow actually sends that request.
  let sent: Record<string, unknown> | null = null;
  const h = harness([]);
  h.deps.model = {
    // deno-lint-ignore require-await
    async send(request) {
      sent = request as unknown as Record<string, unknown>;
      return structuredOk();
    },
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assert(sent, 'the model was never called');
  const request = sent as Record<string, unknown>;
  assertEquals(request.tools, undefined, 'no tool is sent');
  assertEquals(request.tool_choice, undefined, 'and therefore no tool_choice to get wrong');

  const outputConfig = request.output_config as { effort: string; format?: { type: string } };
  assertEquals(outputConfig.format?.type, 'json_schema', 'the contract rides in output_config.format');
  assertEquals((request.thinking as { type: string }).type, 'adaptive', 'thinking stays on');
  assertEquals(request.temperature, undefined, 'sonnet-5 400s on a non-default temperature');
});

Deno.test('structured outputs: a JSON-text response settles exactly like a tool response did', async () => {
  const h = harness([structuredOk()]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, false);
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_is_fallback, false);
  assertEquals(h.rpc.to('record_ai_call')[0].args.p_status, 'success');
});

Deno.test('structured outputs: a schema-shaped but out-of-range score still cannot reach the user', async () => {
  // The schema cannot express `minimum`/`maximum`, so a 140 is schema-VALID. Only the runtime check
  // stops it. Two attempts, both out of range on posture -> salvage keeps the other three pillars
  // and posture comes back not-assessed. Never a clamped, invented 100.
  const bogus = () => {
    const input = validToolInput();
    (input.pillars as Record<string, unknown>).posture = scoredPillar(140, 'strong');
    return structuredOk(input);
  };
  const h = harness([bogus(), bogus()]);

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, true);
  const result = h.rpc.to('settle_analysis')[0].args.p_result as {
    pillars: Record<string, { score: number | null }>;
  };
  assertEquals(result.pillars.posture.score, null, 'out of range must be dropped, never clamped');
  assertEquals(result.pillars.armSwing.score, 72, 'the readable pillars survive verbatim');
});

// ===========================================================================
// Observability — you cannot tell a prompt regression from a provider incident without this.
// ===========================================================================

Deno.test('every request emits one structured log line: tier, tokens, latency, retried, fell back', async () => {
  const logs: Record<string, unknown>[] = [];
  const h = harness([
    { ok: false, kind: 'error', message: 'Anthropic returned 500' },
    partial(['posture', 'armSwing']),
  ]);
  h.deps.log = (event) => logs.push(event as unknown as Record<string, unknown>);

  await run(h);

  assertEquals(logs.length, 1);
  const log = logs[0];
  assertEquals(log.outcome, 'partial');
  assertEquals(log.retried, true);
  assertEquals(log.attempts, 2);
  assertEquals(log.isFallback, true);
  assertEquals(log.tier, 'pro');
  assertEquals(log.status, 200);
  assertEquals(log.analysisId, ANALYSIS_ID);
  assertEquals(log.framesUploaded, 2);
  assertEquals(log.releaseReason, null, 'a settled analysis was never released');
  assert(typeof log.latencyMs === 'number');
  assert((log.outputTokens as number) > 0);
});

Deno.test('a failed request logs the release reason it actually used', async () => {
  const logs: Record<string, unknown>[] = [];
  const h = harness([prose(), prose()]);
  h.deps.log = (event) => logs.push(event as unknown as Record<string, unknown>);

  await run(h);

  assertEquals(logs[0].releaseReason, 'model_error');
  assertEquals(logs[0].status, 503);
});

// ===========================================================================
// ISSUE #130 — THE INVARIANT: a 'reserved' row can never have frames.
// ===========================================================================

Deno.test('#130: the row is DELIVERED before the first frame is uploaded', async () => {
  // The whole design in one assertion. If this inverts, orphans come back.
  const h = harness([ok()]);
  let uploadsAtSettleTime = -1;
  const settleOk = h.rpc.handlers.settle_analysis;
  h.rpc.handlers.settle_analysis = (args) => {
    uploadsAtSettleTime = h.storage.uploads.length;
    return settleOk(args);
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(uploadsAtSettleTime, 0, 'a reserved row must never have frames — settle runs FIRST');
  assertEquals(h.storage.uploads.length, 2);
});

Deno.test('#130: settle_analysis is called with NO media paths', async () => {
  const h = harness([ok()]);
  await run(h);

  // Not `[]` — absent. There is nothing to pass: the frames do not exist yet. The RPC's own
  // `p_media_paths text[] default '{}'` covers the omission.
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_media_paths, undefined);
});

Deno.test('#130: a THROWING attach_media_paths still delivers 200 and still does not release', async () => {
  // The analysis is delivered and the quota is SPENT. A throw here used to be impossible (the
  // settle was last); now it must be caught, or a bookkeeping miss would 500 an analysis the user
  // already paid for and cannot retry.
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => {
    throw new Error('the database fell over mid-attach');
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

Deno.test('#130: a REFUSING attach_media_paths still delivers 200 and still does not release', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'already_attached' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

// --- The delete-during-upload window: the frames we wrote after the user's purge already ran ---

Deno.test('#130: row_deleted mid-upload -> we purge the frames we just wrote', async () => {
  // `deleteAnalysis` purges Storage BEFORE marking the row. Our upload finished after that purge
  // walked the prefix, so these objects are stranded under a deleted analysis — images of a
  // person's body, retained after they asked for them to be gone. The refusal is the signal.
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'row_deleted' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 200, 'the analysis was delivered before the delete — that stands');
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(h.storage.removed, [
    `${CALLER}/${ANALYSIS_ID}/frame-01.jpg`,
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
});

Deno.test('#130: not_found (hard-deleted row) -> we purge too', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'not_found' },
    error: null,
  });

  await run(h);

  assertEquals(h.storage.removed.length, 2);
});

Deno.test('#130: already_attached -> we purge NOTHING (those objects are live and named)', async () => {
  // THE INVERSE MISTAKE, and the more dangerous one: a replay refusal means a live row already
  // names these paths. Purging here would delete a working analysis's frame strip.
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'already_attached' },
    error: null,
  });

  await run(h);

  assertEquals(h.storage.removed, []);
});

Deno.test('#130: a purge that itself fails still delivers 200 — nothing after the settle can 500', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'row_deleted' },
    error: null,
  });
  h.storage.remove = () => {
    throw new Error('storage remove exploded');
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

// ===========================================================================
// FREE-TIER SAMPLE PREVIEW (captain-approved 2026-07-26) — Free makes ZERO Anthropic calls, ever.
// `pace_current_tier` short-circuits BEFORE the AI gate and BEFORE reserve_analysis: this is the
// concrete proof that a free-tier request never reaches `deps.model.send`, never reserves a row,
// and never gates AI spend — a code-review claim is not sufficient given the AI-spend stakes.
// ===========================================================================

Deno.test('free tier: zero model calls, zero gate, zero reserve — a labeled sample instead', async () => {
  const h = harness([]); // an empty model queue — `deps.model.send` throws if ever invoked
  h.rpc.handlers.pace_current_tier = () => ({ data: 'free', error: null });

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body, { result: FREE_SAMPLE_PACE_RESULT, isSample: true });
  assertEquals(h.model.sent.length, 0, 'free tier must never call the model');
  assertEquals(h.rpc.to('gate_ai_call').length, 0, 'free tier must never gate AI spend');
  assertEquals(h.rpc.to('reserve_analysis').length, 0, 'free tier must never reserve a row/quota slot');
  assertEquals(h.rpc.to('settle_analysis').length, 0);
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(h.rpc.to('record_ai_call').length, 0);
  assertEquals(h.storage.uploads.length, 0, 'nothing is uploaded for a sample — no frame ever lands');
  assertEquals(h.rpc.names(), ['pace_current_tier']);
});

Deno.test('free tier: consent (CONTRACT RULE 4) still governs — the tier lookup never runs before it', async () => {
  const h = harness([], { granted: false });
  h.rpc.handlers.pace_current_tier = () => ({ data: 'free', error: null });

  const res = await run(h);

  assertEquals(res.status, 403);
  assertEquals(res.body.code, 'consent_required');
  assertEquals(h.rpc.calls.length, 0, 'refused before the tier lookup ever ran');
});

Deno.test('all-users override: a normally-free account runs the full Elite path through the additive RPCs', async () => {
  const h = harness([ok()]);
  h.deps.allUsersUnlimitedAccess = true;
  h.rpc.handlers.pace_current_tier_unlimited = () => ({ data: 'elite', error: null });
  h.rpc.handlers.reserve_analysis_unlimited = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'elite' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.model.sent.length, 1, 'override must produce a real model analysis, never the Free sample');
  assert(!('isSample' in res.body), 'override responses must never carry the Free sample marker');
  assertEquals(h.rpc.names().includes('pace_current_tier'), false);
  assertEquals(h.rpc.names().includes('reserve_analysis'), false);
  assertEquals(h.rpc.names().includes('pace_current_tier_unlimited'), true);
  assertEquals(h.rpc.names().includes('reserve_analysis_unlimited'), true);
});

Deno.test('pro/elite tiers are completely unaffected by the tier-lookup branch', async () => {
  for (const tier of ['pro', 'elite']) {
    const h = harness([ok()]);
    h.rpc.handlers.pace_current_tier = () => ({ data: tier, error: null });
    h.rpc.handlers.reserve_analysis = () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
      error: null,
    });

    const res = await run(h);

    assertEquals(res.status, 200);
    assertEquals(h.model.sent.length, 1, `${tier} must still call the model exactly once`);
    assert(!('isSample' in res.body), `${tier} response must never carry isSample`);
  }
});

Deno.test('a pace_current_tier RPC failure fails CLOSED as a 500, never silently as a sample or a paid call', async () => {
  const h = harness([]);
  h.rpc.handlers.pace_current_tier = () => ({ data: null, error: { message: 'db is on fire' } });

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(res.body.code, 'internal_error');
  assertEquals(h.model.sent.length, 0);
  assert(!('isSample' in res.body), 'an RPC failure must not silently degrade into a sample response');
});

Deno.test('a pace_current_tier RPC returning an unrecognized value also fails closed as a 500', async () => {
  const h = harness([]);
  h.rpc.handlers.pace_current_tier = () => ({ data: 'platinum', error: null });

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(res.body.code, 'internal_error');
  assertEquals(h.model.sent.length, 0);
});
