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
import {
  PACE_ANALYSIS_TOOL_NAME,
  type AnalyzeFormRequest,
} from '../../_shared/analyze-form-prompt.ts';
import type { AnthropicMessageResponse } from '../../_shared/analyze-form-validation.ts';

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

type RpcResult = { data: unknown; error: { message: string } | null };
type RpcHandler = (args: Record<string, unknown>) => RpcResult | Promise<RpcResult>;

class FakeRpc implements RpcClient {
  readonly calls: RpcCall[] = [];
  private gateSeq = 0;

  constructor(private readonly events: string[] = []) {}

  handlers: Record<string, RpcHandler> = {
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
    pace_zero_pillar_cooldown_remaining: () => ({ data: 0, error: null }),
  };

  // deno-lint-ignore require-await
  async rpc(fn: string, args: Record<string, unknown>) {
    this.calls.push({ fn, args });
    this.events.push(`rpc:${fn}`);
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
  /** The actual request bodies, in order — the emitted prompt is a generated interface this suite
   * is allowed to assert on (which medium rules a submission was given is not observable any
   * other way). */
  readonly requests: AnalyzeFormRequest[] = [];
  constructor(private readonly queue: ModelCallResult[], private readonly events: string[] = []) {}

  // deno-lint-ignore require-await
  async send(request: unknown, timeoutMs: number): Promise<ModelCallResult> {
    this.requests.push(request as AnalyzeFormRequest);
    this.sent.push(timeoutMs);
    this.events.push('model');
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

/** `safety` is part of the contract now, not an optional extra: `analyze-form-validation.ts`
 * refuses to deliver a response whose pillar cannot declare one, so every fixture here declares
 * the ordinary answer — nothing of the kind is visible. */
const NO_SAFETY_SIGNAL = { signal: 'none', note: '' };

function scoredPillar(score: number, band: string) {
  return { score, band, feedback: 'Tall through mid-stance.', safety: NO_SAFETY_SIGNAL, flags: [], drills: [] };
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
    pillars[id] = parsed.includes(id) ? scoredPillar(80, 'good') : { garbage: true, safety: NO_SAFETY_SIGNAL };
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
    safety: NO_SAFETY_SIGNAL,
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
  events: string[];
}

function harness(
  modelResults: ModelCallResult[],
  options: { granted?: boolean | null; consentThrows?: boolean; now?: () => number } = {}
): Harness {
  const events: string[] = [];
  const rpc = new FakeRpc(events);
  const storage = new FakeStorage();
  const model = new FakeModel(modelResults, events);

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

  return { rpc, storage, model, deps, events };
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

Deno.test('rule 3 / finding 1(c): TWO content failures after a REAL retry -> validation_failed', async () => {
  // The genuine-farmer case, and the ONLY one that ticks the anti-farming counter: the model was
  // asked twice and twice refused to honor the schema. Content failures MUST stay retry-eligible
  // (not just transport errors, `model_error`) — see `flow.ts`'s `isRetryEligibleFailure` header
  // comment — or `retryRan` can never be true at the same time `everyResponseWasContentFailure`
  // is true, which makes `'validation_failed'` structurally unreachable and silently disables the
  // 3-strike anti-farming cap. Two attempts in the queue => the retry runs.
  const h = harness([prose(), prose()]);

  const res = await run(h);

  assertEquals(res.status, 422);
  assertEquals(res.body.code, 'validation_failed');
  assertEquals(releaseReasonFrom(h.rpc), 'validation_failed');
  assertEquals(h.model.sent.length, 2, 'the retry genuinely ran');
});

Deno.test('rule 3 / finding 1(c): a realistic 20s content failure still retries and reaches validation_failed', async () => {
  // This is the production-reachable anti-farming path. The instant FakeModel above protects the
  // classification contract, while this clock proves a real content failure can still reach it
  // after consuming meaningful model time. With one shared 80s retry floor, the remaining 65s
  // incorrectly suppresses attempt 2 and turns the repeated content failure into a 503.
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 20_000, result: prose() },
    { durationMs: 0, result: prose() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 422);
  assertEquals(res.body.code, 'validation_failed');
  assertEquals(releaseReasonFrom(h.rpc), 'validation_failed');
  assertEquals(model.timeoutBudgets, [80_000, 65_000]);
});

Deno.test('rule 3 / finding 1(c): a realistic 20s invalid-shape partial uses the content retry floor too', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 20_000, result: partial(['posture', 'armSwing']) },
    { durationMs: 0, result: partial(['posture', 'armSwing']) },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, true);
  assertEquals(model.timeoutBudgets, [80_000, 65_000]);
});

Deno.test('content retry timeout: a truncated second-attempt budget self-corrects to model_error', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 20_000, result: prose() },
    // Attempt 1 leaves a 65s retry budget. Reaching that exact ceiling is a provider timeout, but
    // the smaller budget is OUR retry policy after a content failure — not a provider-wide outage.
    { durationMs: 65_000, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'model_error');
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
  assertEquals(model.timeoutBudgets, [80_000, 65_000], 'both provider attempts were genuinely dispatched');
  assertEquals(h.rpc.to('gate_ai_call').length, 2, 'each dispatched provider call had its own spend gate');
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 2);
  assertEquals(records.find((call) => call.args.p_call_id === 'call-1')?.args.p_status, 'validation_failed');
  assertEquals(records.find((call) => call.args.p_call_id === 'call-2')?.args.p_status, 'model_error');
  assertEquals(h.rpc.to('settle_analysis').length, 0);
});

Deno.test('transport retry timeout: a full-budget second attempt remains provider_timeout', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 5_000, result: { ok: false, kind: 'error', message: 'quick transport error' } },
    { durationMs: 80_000, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'provider_timeout');
  assertEquals(releaseReasonFrom(h.rpc), 'provider_timeout');
  assertEquals(model.timeoutBudgets, [80_000, 80_000]);
  assertEquals(h.rpc.to('gate_ai_call').length, 2);
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 2);
  assertEquals(records.every((call) => call.args.p_status === 'model_error'), true);
});

Deno.test('rule 3: a lone content failure with insufficient retry budget -> model_error, no strike', async () => {
  // Attack-shaped-but-not-an-attack: the model degrades to prose AND attempt 1 used most of the
  // model window, so less than the 20s content-retry floor remains and we skip the retry. One attempt
  // exists, and WE cut the second — so this is OUR degradation, released as `model_error` (503,
  // refunds quota, does NOT tick the 3-strike cap), never `validation_failed`.
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 70_000, result: prose() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 503, 'server fault is a 503, not the 422 a farming signal gets');
  assertEquals(res.body.code, 'model_error');
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
  assertEquals(model.timeoutBudgets, [80_000], 'the retry was skipped with only 15s remaining');
});

Deno.test('content retry budget: exactly 20 seconds remaining still runs the retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 65_000, result: prose() },
    { durationMs: 0, result: prose() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 422);
  assertEquals(res.body.code, 'validation_failed');
  assertEquals(model.timeoutBudgets, [80_000, 20_000]);
});

Deno.test('content retry budget: 19,999 milliseconds remaining skips the retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 65_001, result: prose() },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'model_error');
  assertEquals(model.timeoutBudgets, [80_000]);
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

Deno.test('retry budget TOCTOU: a delayed retry gate can consume the transport retry floor', async () => {
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
  let gateCalls = 0;
  h.rpc.handlers.gate_ai_call = () => {
    gateCalls += 1;
    if (gateCalls === 2) {
      clock.advance(4_000);
    }
    return {
      data: { allowed: true, call_id: `call-${gateCalls}`, estimated_usd: 0.09 },
      error: null,
    };
  };

  const res = await run(h);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'model_error');
  assertEquals(model.timeoutBudgets, [80_000], 'the provider must not receive an underfunded retry');
  assertEquals(releaseReasonFrom(h.rpc), 'model_error');
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((call) => call.args.p_call_id === 'call-1')?.args.p_status, 'model_error');
  assertEquals(records.find((call) => call.args.p_call_id === 'call-2')?.args.p_status, 'cancelled');
});

Deno.test('retry budget TOCTOU: a delayed retry gate can consume the content retry floor', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    { durationMs: 20_000, result: partial(['posture', 'armSwing']) },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  let gateCalls = 0;
  h.rpc.handlers.gate_ai_call = () => {
    gateCalls += 1;
    if (gateCalls === 2) {
      clock.advance(46_000);
    }
    return {
      data: { allowed: true, call_id: `call-${gateCalls}`, estimated_usd: 0.09 },
      error: null,
    };
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, true, 'attempt 1 remains the delivered partial');
  assertEquals(model.timeoutBudgets, [80_000], 'the provider must not receive an underfunded retry');
  assertEquals(h.rpc.to('release_analysis').length, 0, 'the delivered partial consumes quota');
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_is_fallback, true);
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((call) => call.args.p_call_id === 'call-1')?.args.p_status, 'fallback');
  assertEquals(records.find((call) => call.args.p_call_id === 'call-2')?.args.p_status, 'cancelled');
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
  assertEquals(h.model.sent.length, 1, 'a timed-out first attempt is terminal');
  assertEquals(h.rpc.to('record_ai_call')[0].args.p_status, 'model_error');
});

Deno.test('rule 3: reservation cleanup runs before ledger recording on a failed request', async () => {
  const h = harness([{ ok: false, kind: 'timeout', message: 'too slow' }]);
  let finishRelease!: () => void;
  let markReleaseStarted!: () => void;
  const releaseStarted = new Promise<void>((resolve) => {
    markReleaseStarted = resolve;
  });
  h.rpc.handlers.release_analysis = () => {
    markReleaseStarted();
    return new Promise<RpcResult>((resolve) => {
      finishRelease = () => resolve({ data: { ok: true }, error: null });
    });
  };

  const pendingResponse = run(h);
  await releaseStarted;

  assertEquals(h.rpc.to('release_analysis').length, 1, 'the failed reservation was never released');
  assertEquals(
    h.rpc.to('record_ai_call').length,
    0,
    'ledger recording must wait until quota release has completed, not merely started'
  );

  finishRelease();
  const res = await pendingResponse;

  assertEquals(res.status, 503);
  assertEquals(h.rpc.to('record_ai_call').length, 1, 'ledger recording runs after release resolves');
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
// A fully valid all-not-assessed result is still an honest model result. Every tier releases it
// uncharged; Free's repeated-submission risk is bounded by the cooldown below instead.
// ===========================================================================

/** A fully valid but ADVERSARIAL zero-pillar response: every pillar honestly not-assessed, yet the
 * model still attached flags/drills to one of them. Structurally legal (`pace.ts` never forbids
 * flags/drills on a not-assessed pillar) and exactly the kind of paid-tier content Free must never
 * render regardless of what the model attaches them to. */
function allNotAssessedWithStrayContent(): ModelCallResult {
  return ok({
    pillars: {
      posture: {
        score: null,
        band: null,
        feedback: null,
        notAssessedReason: 'angle',
        safety: NO_SAFETY_SIGNAL,
        flags: [{ pattern: 'Overstriding', detail: 'Cannot confirm from this angle.' }],
        drills: [{ name: 'Wall Forward-Lean Drill', instructions: 'Lean from the ankles.' }],
      },
      armSwing: notAssessedPillar('angle'),
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    },
    overall: { score: null, band: null },
  });
}

Deno.test('zero-pillar policy: Free RELEASES a fully valid result with zero assessed pillars', async () => {
  const h = harness([allNotAssessedWithStrayContent()]);
  // `reserve_analysis` is the ONLY source of tier — there is no pre-reserve lookup to disagree
  // with it. Its 'free' is the value the settlement policy must use.
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'free' },
    error: null,
  });

  const res = await run(h, {
    mediaType: 'photo',
    frames: ['AAAA'],
    timestamps: [0],
    idempotencyKey: 'free-zero-pillars',
  });

  assertEquals(res.status, 200);
  assertEquals(res.body.analysisId, ANALYSIS_ID, 'Free receives the reservation id with the result body');
  assertEquals(h.rpc.to('settle_analysis').length, 0, 'an empty result never consumes the lifetime slot');
  const releases = h.rpc.to('release_analysis');
  assertEquals(releases.length, 1, 'Free receives the same zero-pillar refund as paid tiers');
  assertEquals(releases[0].args.p_reason, 'zero_pillars_assessed');

  const result = res.body.result as {
    pillars: Record<string, { score: number | null; flags: unknown[]; drills: unknown[] }>;
    overall: { score: number | null; band: string | null };
  };
  for (const id of ['posture', 'armSwing', 'cadence', 'elasticity']) {
    assertEquals(result.pillars[id].score, null, `${id}: still honestly not-assessed`);
    assertEquals(result.pillars[id].flags, [], `${id}: Free strips flags even when the model attached them`);
    assertEquals(result.pillars[id].drills, [], `${id}: Free strips drills even when the model attached them`);
  }
  assertEquals(result.overall, { score: null, band: null }, 'no pillar survived, so overall stays null');
});

function cooldownHarness(remainingSeconds: unknown, tier = 'free') {
  const h = harness([ok()]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
    error: null,
  });
  h.rpc.handlers.pace_zero_pillar_cooldown_remaining = () => ({ data: remainingSeconds, error: null });
  return h;
}

Deno.test('cooldown: Free retry is rate-limited before model spend and is not charged', async () => {
  const h = cooldownHarness(420);
  const res = await run(h, {
    mediaType: 'photo',
    frames: ['AAAA'],
    timestamps: [0],
    idempotencyKey: 'free-cooldown',
  });

  assertEquals(res.status, 429);
  assertEquals(res.body.code, 'zero_pillar_cooldown');
  assertEquals(res.body.retryAfterSeconds, 420);
  assertEquals(h.rpc.to('pace_zero_pillar_cooldown_remaining')[0].args, { p_user_id: CALLER });
  assertEquals(h.model.requests.length, 0, 'the model is never called inside the cooldown');
  assertEquals(h.rpc.to('settle_analysis').length, 0, 'the lifetime slot is never charged');
  assertEquals(h.rpc.to('release_analysis')[0].args.p_reason, 'zero_pillar_cooldown');
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1);
  assertEquals(records[0].args.p_status, 'cancelled', 'the pre-model AI gate hold is cancelled at $0');
});

Deno.test('cooldown: expiry lets Free run, and paid tiers never query the Free throttle', async () => {
  const free = cooldownHarness(0);
  assertEquals((await run(free)).status, 200);
  assertEquals(free.model.requests.length, 1);

  const pro = cooldownHarness(600, 'pro');
  assertEquals((await run(pro)).status, 200);
  assertEquals(pro.rpc.to('pace_zero_pillar_cooldown_remaining').length, 0);
});

Deno.test('cooldown: an unavailable lookup fails open to the existing spend caps', async () => {
  const h = cooldownHarness(0);
  h.rpc.handlers.pace_zero_pillar_cooldown_remaining = () => ({
    data: null,
    error: { message: 'function does not exist' },
  });

  assertEquals((await run(h)).status, 200);
  assertEquals(h.model.requests.length, 1);
});

Deno.test('zero-pillar policy: Pro and Elite RELEASE a fully valid result with zero assessed pillars', async () => {
  for (const tier of ['pro', 'elite'] as const) {
    const h = harness([allNotAssessed()]);
    h.rpc.handlers.reserve_analysis = () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
      error: null,
    });

    const res = await run(h);

    assertEquals(res.status, 200, `${tier} still receives the honest empty result`);
    assertEquals(h.rpc.to('settle_analysis').length, 0, `${tier} must not charge an empty result`);
    const release = h.rpc.to('release_analysis');
    assertEquals(release.length, 1, `${tier} must hand the quota slot back`);
    assertEquals(release[0].args.p_reason, 'zero_pillars_assessed');
    assertNotEquals(release[0].args.p_reason, 'validation_failed');
  }
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

Deno.test('rule 5: a per-user cap denial is a 429 about the caller, not a 503 about us', async () => {
  const h = harness([]);
  h.rpc.handlers.gate_ai_call = () => ({
    data: {
      allowed: false,
      reason: 'user_daily_cap',
      spent_usd: 3.9,
      cap_usd: 4.0,
      tier: 'elite',
    },
    error: null,
  });

  const res = await run(h);

  // 429, not 503: the service is up and serving everybody else — this one caller has used their
  // own tier's daily allowance. See the per-user-cap migration (20260907120000).
  assertEquals(res.status, 429);
  assertEquals(res.body.code, 'user_daily_cap');
  // Same ordering guarantee as any other gate denial: nothing is reserved, nothing is released,
  // nothing is sent to the model.
  assertEquals(h.rpc.to('reserve_analysis').length, 0);
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(h.model.sent.length, 0);
  // Our per-tier dollar ceilings are a farming aid; they must not reach the caller. Assert on the
  // SERIALIZED body — that is what actually goes over the wire, and it is what drops the
  // `detail: undefined` key `gateDenyResponseBody` leaves on the object.
  const wire = JSON.parse(JSON.stringify(res.body));
  assertEquals(Object.keys(wire).sort(), ['code', 'error']);
  assertEquals(wire.error.includes('4'), false, 'the cap value must not leak through the copy');
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

Deno.test('rule 5: gate -> reserve -> model -> settle -> attach, with tier derived by reserve', async () => {
  const h = harness([ok()]);
  await run(h);

  assertEquals(h.rpc.names(), [
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

Deno.test('rule 5: the call whose output was DELIVERED is the "fallback"; the other is the failure it was', async () => {
  // Both attempts salvage equally, so attempt 1's is the one delivered. Attempt 2 was still a
  // real, billed call that produced nothing usable, and it settles as `validation_failed` — a
  // salvageable `invalid_shape` partial is retry-eligible exactly like any other content failure
  // (see `flow.ts`'s `isRetryEligibleFailure`), not skipped just because attempt 1 already had
  // something to deliver.
  //
  // This composes correctly with the circuit breaker, which opens only when the last N settled
  // calls ALL carry 'model_error'/'validation_failed': while we are still DELIVERING results, every
  // request contributes at least one non-failure ('fallback'/'success'), so the breaker stays shut —
  // which is the behaviour `ai_breaker_state`'s own comment asks for ("a prompt that degrades
  // gracefully into partial-but-useful results should not [trip the breaker]"). But the moment we
  // stop delivering (both attempts fail), every recent call IS a failure and the breaker opens.
  // Blanket-labelling both calls 'fallback' would have made a total collapse of the model's tool
  // calling invisible to the breaker forever, while silently doubling spend on every request.
  const h = harness([partial(['posture', 'armSwing']), partial(['posture', 'armSwing'])]);

  const res = await run(h);

  assertEquals(res.body.isFallback, true);
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-1')?.args.p_status, 'fallback');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-2')?.args.p_status, 'validation_failed');
});

Deno.test('rule 5: a partial delivered from the RETRY marks the retry as the fallback', async () => {
  const h = harness([prose(), partial(['posture', 'armSwing'])]);

  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-1')?.args.p_status, 'validation_failed');
  assertEquals(records.find((r) => r.args.p_call_id === 'call-2')?.args.p_status, 'fallback');
});

Deno.test('rule 5: a DENIED retry gate does not fail the request — attempt 1\'s partial is still delivered', async () => {
  let gateCalls = 0;
  const h = harness([partial(['posture', 'armSwing', 'cadence'])]);
  h.rpc.handlers.gate_ai_call = () => {
    gateCalls += 1;
    if (gateCalls === 1) {
      return { data: { allowed: true, call_id: 'call-1', estimated_usd: 0.09 }, error: null };
    }
    return { data: { allowed: false, reason: 'daily_cap' }, error: null };
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(res.body.isFallback, true);
  assertEquals(gateCalls, 2, 'the partial was eligible for a retry and reached its gate');
  assertEquals(h.model.sent.length, 1, 'the denied retry gate prevented a second model call');

  const settles = h.rpc.to('settle_analysis');
  assertEquals(settles.length, 1, 'the delivered partial consumes and settles the reservation');
  assertEquals(settles[0].args.p_is_fallback, true);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1, 'a denied retry gate creates no call ledger row to settle');
  assertEquals(records[0].args.p_call_id, 'call-1');
  assertEquals(records[0].args.p_status, 'fallback');
  assertEquals(records[0].args.p_analysis_id, ANALYSIS_ID);
  assertEquals(h.rpc.to('release_analysis').length, 0, 'a delivered partial must not refund quota');
});

Deno.test('rule 5: a clean validation failure is recorded as validation_failed', async () => {
  const h = harness([prose(), prose()]);
  await run(h);

  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 2, 'both gated calls must be settled');
  for (const record of records) {
    assertEquals(record.args.p_status, 'validation_failed');
  }
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

Deno.test('an allowed fresh reservation with an unknown tier fails closed before model work and is released', async () => {
  // `toString` is intentionally a prototype key: without an explicit closed-union check it indexes
  // both tier tables successfully enough to reach the model, then bypasses `tier === "free"`
  // normalization. A random string merely crashes accidentally and would make this test toothless.
  const h = harness([ok()]);
  h.rpc.handlers.reserve_analysis = () => ({
    data: {
      allowed: true,
      existing: false,
      id: ANALYSIS_ID,
      status: 'reserved',
      tier: 'toString',
    },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(res.body.code, 'internal_error');
  assertEquals(h.model.sent.length, 0, 'an untrusted tier must never reach prompt/token lookup');
  assertEquals(h.rpc.to('settle_analysis').length, 0);
  assertEquals(releaseReasonFrom(h.rpc), 'internal_error', 'the fresh reservation must not be stranded');
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

Deno.test('model window: 20 seconds of preflight still leaves the full 80-second first attempt', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 0, result: ok() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  h.rpc.handlers.reserve_analysis = () => {
    clock.advance(20_000);
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    };
  };

  const response = await run(h);

  assertEquals(response.status, 200);
  assertEquals(model.timeoutBudgets, [80_000]);
});

Deno.test('request envelope: 30 seconds of preflight caps model work at the remaining 75 seconds', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 76_000, result: ok() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  h.rpc.handlers.reserve_analysis = () => {
    clock.advance(30_000);
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    };
  };

  const response = await run(h);

  assertEquals(model.timeoutBudgets, [75_000]);
  assertEquals(response.status, 503);
  assertEquals(response.body.code, 'provider_timeout');
  assertEquals(releaseReasonFrom(h.rpc), 'provider_timeout');
});

Deno.test('request envelope: flow honors a handler-supplied start time from before auth/body parsing', async () => {
  const clock = new VirtualClock();
  clock.advance(30_000);
  const model = new VirtualClockModel(clock, [{ durationMs: 76_000, result: ok() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await runAnalyzeForm(h.deps, {
    callerUserId: CALLER,
    rawBody: VIDEO_BODY,
    requestStartedAt: 0,
  });

  assertEquals(model.timeoutBudgets, [75_000]);
  assertEquals(response.status, 503);
  assertEquals(response.body.code, 'provider_timeout');
  assertEquals(releaseReasonFrom(h.rpc), 'provider_timeout');
});

Deno.test('request envelope: exhausted preflight never issues a zero-budget provider call', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 0, result: ok() }]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  h.rpc.handlers.reserve_analysis = () => {
    clock.advance(106_000);
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    };
  };

  const response = await run(h);

  assertEquals(model.timeoutBudgets, [], 'an expired request must not invoke the provider at all');
  assertEquals(response.status, 503);
  assertEquals(response.body.code, 'provider_timeout');
  assertEquals(releaseReasonFrom(h.rpc), 'provider_timeout');
  const records = h.rpc.to('record_ai_call');
  assertEquals(records.length, 1);
  assertEquals(records[0].args.p_call_id, 'call-1');
  assertEquals(records[0].args.p_status, 'cancelled', 'the unused gate reservation was not billable');
});

Deno.test('request envelope: a request that dispatched nothing logs zero attempts, not a phantom one', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [{ durationMs: 0, result: ok() }]);
  const logs: Record<string, unknown>[] = [];
  const h = harness([], { now: clock.now });
  h.deps.model = model;
  h.deps.log = (event) => logs.push(event as unknown as Record<string, unknown>);
  h.rpc.handlers.reserve_analysis = () => {
    clock.advance(106_000);
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'pro' },
      error: null,
    };
  };

  await run(h);

  assertEquals(model.timeoutBudgets, [], 'the provider was never invoked');
  assertEquals(logs.length, 1);
  // The summary line describes provider calls that HAPPENED. `callModel` still returns a synthetic
  // failed attempt so the failure path has something to decide on, but counting it here would make
  // every "attempts" dashboard over-report an expired request as one real call.
  assertEquals(logs[0].attempts, 0);
  assertEquals(logs[0].retried, false);
  assertEquals(logs[0].stopReasons, []);
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

Deno.test('transport retry budget: exactly 80 seconds remaining still runs the retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    {
      durationMs: 5_000,
      result: { ok: false, kind: 'error', message: 'transport error at the retry boundary' },
    },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  assertEquals(response.status, 200);
  assertEquals(model.timeoutBudgets, [80_000, 80_000]);
});

Deno.test('transport retry budget: 79,999 milliseconds remaining skips the retry', async () => {
  const clock = new VirtualClock();
  const model = new VirtualClockModel(clock, [
    {
      durationMs: 5_001,
      result: { ok: false, kind: 'error', message: 'transport error just below the retry floor' },
    },
    { durationMs: 0, result: ok() },
  ]);
  const h = harness([], { now: clock.now });
  h.deps.model = model;

  const response = await run(h);

  assertEquals(response.status, 503);
  assertEquals(response.body.code, 'model_error');
  assertEquals(model.timeoutBudgets, [80_000]);
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

  assertEquals(logs[0].releaseReason, 'validation_failed');
  assertEquals(logs[0].status, 422);
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
// FREE-TIER REAL ANALYSIS — one genuine, persisted lifetime result, then quota denial.
// ===========================================================================

/** An ADVERSARIAL Free-tier model response — exactly the shape the retired fabricated sample
 * promised and the launch audit condemned: a confident cadence figure, flags, and drills on a
 * ONE-FRAME (photo) submission. If normalization is missing or incomplete, this fixture is what
 * would leak to the caller. */
function adversarialFreePhotoResult(): ModelCallResult {
  return ok({
    pillars: {
      posture: {
        score: 78,
        band: 'good',
        feedback: 'Tall through mid-stance.',
        safety: NO_SAFETY_SIGNAL,
        flags: [{ pattern: 'Overstriding', detail: 'Foot lands ahead of the hip.' }],
        drills: [{ name: 'Wall Forward-Lean Drill', instructions: 'Lean from the ankles.' }],
      },
      armSwing: {
        score: 66,
        band: 'mid',
        feedback: 'Some cross-body swing.',
        safety: NO_SAFETY_SIGNAL,
        flags: [],
        drills: [{ name: 'Elbow Drive Drill', instructions: 'Drive elbows straight back.' }],
      },
      // A single photo cannot show this — a hallucinated cadence figure of the exact kind the
      // launch audit flagged ("mid-170s spm"). Normalization must overwrite this entirely.
      cadence: {
        score: 62,
        band: 'mid',
        feedback: 'Cadence looks to be in the mid-170s spm, on the low side.',
        safety: NO_SAFETY_SIGNAL,
        flags: [{ pattern: 'Low cadence', detail: 'Overstriding risk.' }],
        drills: [{ name: 'Metronome Drill', instructions: 'Run to a 180bpm click.' }],
      },
      // Ditto — a fabricated left/right ground-contact comparison, the other shape the audit named.
      elasticity: {
        score: 58,
        band: 'mid',
        feedback: 'Left ground contact runs longer than right.',
        safety: NO_SAFETY_SIGNAL,
        flags: [],
        drills: [],
      },
    },
    overall: { score: 66, band: 'mid' },
  });
}

Deno.test('free tier: one supported result runs reserve -> model -> settle, then a fresh key is denied before model', async () => {
  const h = harness([adversarialFreePhotoResult()]);
  let deliveredRows = 0;

  h.rpc.handlers.reserve_analysis = () => {
    if (deliveredRows === 1) {
      return {
        data: { allowed: false, reason: 'quota_exceeded', tier: 'free', used: 1, limit: 1 },
        error: null,
      };
    }
    return {
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'free' },
      error: null,
    };
  };
  h.rpc.handlers.settle_analysis = () => {
    deliveredRows += 1;
    return { data: { ok: true, id: ANALYSIS_ID, status: 'delivered' }, error: null };
  };

  const first = await run(h, {
    mediaType: 'photo',
    frames: ['AAAA'],
    timestamps: [0],
    idempotencyKey: 'free-first',
  });

  assertEquals(first.status, 200);
  assertEquals(first.body.analysisId, ANALYSIS_ID, 'Free receives the persisted row id');
  assert(!('isSample' in first.body), 'the retired sample marker must never ship');
  assertEquals(h.model.sent.length, 1, 'the first Free allowance funds exactly one model call');
  assertEquals(h.rpc.to('settle_analysis').length, 1, 'the supported result is persisted as delivered');
  assertEquals(deliveredRows, 1, 'the fake backing store contains exactly one delivered row');

  // THE NORMALIZATION CONTRACT — every field the retired sample fabricated must come back honest,
  // not merely "different": exact values, not a shape check.
  const result = first.body.result as {
    pillars: Record<string, { score: number | null; band: string | null; notAssessedReason?: string; flags: unknown[]; drills: unknown[] }>;
    overall: { score: number | null; band: string | null };
  };
  assertEquals(result.pillars.posture.score, 78, 'a real assessed pillar is not touched');
  assertEquals(result.pillars.posture.flags, [], 'Free strips flags even off a real, assessed pillar');
  assertEquals(result.pillars.posture.drills, [], 'Free strips drills even off a real, assessed pillar');
  assertEquals(result.pillars.armSwing.score, 66);
  assertEquals(result.pillars.armSwing.flags, []);
  assertEquals(result.pillars.armSwing.drills, []);
  assertEquals(result.pillars.cadence.score, null, 'a one-frame submission can never carry a cadence figure');
  assertEquals(result.pillars.cadence.band, null);
  assertEquals(result.pillars.cadence.notAssessedReason, 'needsVideo');
  assertEquals(result.pillars.cadence.flags, []);
  assertEquals(result.pillars.cadence.drills, []);
  assertEquals(result.pillars.elasticity.score, null, 'a one-frame submission can never carry a ground-contact comparison');
  assertEquals(result.pillars.elasticity.band, null);
  assertEquals(result.pillars.elasticity.notAssessedReason, 'needsVideo');
  assertEquals(result.pillars.elasticity.flags, []);
  assertEquals(result.pillars.elasticity.drills, []);
  // overall is RECOMPUTED from the two surviving real pillars (78, 66), never the model's own 66/'mid'
  // over four pillars it no longer gets credit for.
  assertEquals(result.overall.score, 72, 'overall must be recomputed from only the surviving pillars');
  assertEquals(result.overall.band, 'good');

  const settledResult = h.rpc.to('settle_analysis')[0].args.p_result as typeof result;
  assertEquals(settledResult, result, 'exactly what was returned is exactly what was persisted');

  const reserveIndex = h.events.indexOf('rpc:reserve_analysis');
  const modelIndex = h.events.indexOf('model');
  const settleIndex = h.events.indexOf('rpc:settle_analysis');
  assert(reserveIndex >= 0 && reserveIndex < modelIndex, 'reserve must precede the paid model call');
  assert(modelIndex < settleIndex, 'the validated model result must exist before settlement');

  const second = await run(h, {
    mediaType: 'photo',
    frames: ['BBBB'],
    timestamps: [0],
    idempotencyKey: 'free-second-fresh-key',
  });

  assertEquals(second.status, 402);
  assertEquals(second.body.code, 'quota_exceeded');
  assertEquals(h.model.sent.length, 1, 'the denied second request must not call the model');
  assertEquals(h.rpc.to('settle_analysis').length, 1, 'the denied request must not create another delivery');
  assertEquals(deliveredRows, 1, 'the first delivered row is the only delivered row');
});

Deno.test('all-users override: a normally-free account runs the full Elite path through the additive RPCs', async () => {
  const h = harness([ok()]);
  h.deps.allUsersUnlimitedAccess = true;
  h.rpc.handlers.pace_current_tier_unlimited = () => ({ data: 'elite', error: null });
  h.rpc.handlers.gate_ai_call_unlimited = () => ({
    data: { allowed: true, call_id: 'call-1', estimated_usd: 0.23 },
    error: null,
  });
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
  assertEquals(h.rpc.names().includes('pace_current_tier_unlimited'), false);
  assertEquals(h.rpc.names().includes('reserve_analysis_unlimited'), true);
  // The spend gate takes the same override route as tier and reserve — and, per that migration,
  // it still CAPS (at Elite), it does not go uncapped.
  assertEquals(h.rpc.names().includes('gate_ai_call'), false);
  assertEquals(h.rpc.names().includes('gate_ai_call_unlimited'), true);
});

Deno.test('all-users override: the RETRY gate takes the override route too, not the default one', async () => {
  const h = harness([prose(), ok()]);
  h.deps.allUsersUnlimitedAccess = true;
  h.rpc.handlers.pace_current_tier_unlimited = () => ({ data: 'elite', error: null });
  let gateSeq = 0;
  h.rpc.handlers.gate_ai_call_unlimited = () => {
    gateSeq += 1;
    return { data: { allowed: true, call_id: `call-${gateSeq}`, estimated_usd: 0.23 }, error: null };
  };
  h.rpc.handlers.reserve_analysis_unlimited = () => ({
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'elite' },
    error: null,
  });

  await run(h);

  // `prose()` is a retry-eligible failure, so this request gates TWICE. Both gates must go
  // through the override sibling — a single default-route gate would silently apply the Free cap
  // to a caller the rest of the request is treating as Elite.
  assertEquals(h.rpc.to('gate_ai_call').length, 0);
  assertEquals(h.rpc.to('gate_ai_call_unlimited').length, 2);
});

Deno.test('pro/elite tiers still run the real persisted-result path', async () => {
  for (const tier of ['pro', 'elite']) {
    const h = harness([ok()]);
    h.rpc.handlers.reserve_analysis = () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
      error: null,
    });

    const res = await run(h);

    assertEquals(res.status, 200);
    assertEquals(h.model.sent.length, 1, `${tier} must still call the model exactly once`);
    assertEquals(h.rpc.to('settle_analysis').length, 1, `${tier} must still persist the result`);
    assert(!('isSample' in res.body), `${tier} response must never carry isSample`);
  }
});


// ===========================================================================
// ONE FRAME IS ONE INSTANT, whatever produced it — and a STOP-RUNNING SIGNAL survives that,
// structurally. Free's frame cap is 1, so a VIDEO submission routinely arrives as a single frame:
// the path where normalization discards every claim the model made about Cadence/Elasticity, and
// where the certified `safety` declaration is the one thing that must come through untouched.
// ===========================================================================

const ONE_FRAME_VIDEO_BODY = {
  mediaType: 'video',
  frames: ['AAAA'],
  timestamps: [0],
  idempotencyKey: 'one-frame-video',
};

const ONE_FRAME_PHOTO_BODY = {
  mediaType: 'photo',
  frames: ['AAAA'],
  timestamps: [0],
  idempotencyKey: 'one-frame-photo',
};

function freeReserve() {
  return {
    data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier: 'free' },
    error: null,
  };
}

function systemText(request: AnalyzeFormRequest): string {
  return request.system.map((block) => block.text).join('\n');
}

/** The three stop-running signals of `knowledge/injury_flags.md`, phrased the way a coach actually
 * writes them. NONE of these sentences shares vocabulary with a keyword list — that is the point:
 * preservation must not depend on recognising the words. */
const SAFETY_CASES = [
  {
    label: 'guarding, in the reviewer’s own words',
    signal: 'swellingLimpOrFavouringOneSide',
    note: 'The left leg cannot take even weight and she is guarding it — see someone before your next run.',
  },
  {
    label: 'bone-stress language with no clinical vocabulary',
    signal: 'sharpOrWorseningPain',
    note: 'You describe a hot, worsening ache along the shin that builds as you go — please have that assessed before your next session.',
  },
  {
    label: 'heel-cord language',
    signal: 'achillesOrHeelCordPain',
    note: 'What you describe at the back of the heel gets worse when pushed through; hold off on speed work and have it checked.',
  },
] as const;

const SAFETY_FIXTURE_COACHING = 'Contact time looks springy and the cadence sits in the mid-170s spm.';

function pillarWithSafety(
  signal: string,
  note: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    score: 71,
    band: 'good',
    feedback: SAFETY_FIXTURE_COACHING,
    safety: { signal, note },
    flags: [],
    drills: [],
    ...extra,
  };
}

function safeSignal() {
  return NO_SAFETY_SIGNAL;
}

for (const testCase of SAFETY_CASES) {
  Deno.test(`a stop-running signal survives the one-frame strip: ${testCase.label}`, async () => {
    const h = harness([
      ok({
        pillars: {
          posture: { ...scoredPillar(78, 'good'), safety: safeSignal() },
          armSwing: { ...scoredPillar(66, 'mid'), safety: safeSignal() },
          cadence: { ...scoredPillar(70, 'good'), safety: safeSignal() },
          elasticity: pillarWithSafety(testCase.signal, testCase.note),
        },
        overall: { score: 71, band: 'good' },
      }),
    ]);
    h.rpc.handlers.reserve_analysis = () => freeReserve();

    const res = await run(h, ONE_FRAME_VIDEO_BODY);

    assertEquals(res.status, 200);
    const result = res.body.result as {
      pillars: Record<
        string,
        {
          score: number | null;
          band: string | null;
          feedback: string | null;
          notAssessedReason?: string;
          safety?: { signal: string; note: string } | null;
          flags: unknown[];
          drills: unknown[];
        }
      >;
    };
    const elasticity = result.pillars.elasticity;

    // THE WARNING IS THERE, in the runner's face, and unaltered.
    assertEquals(elasticity.feedback, testCase.note);
    assertEquals(elasticity.safety, { signal: testCase.signal, note: testCase.note });

    // AND THE ASSESSMENT CLAIM IS GONE — score, band, and the model's prose about a bounce cycle
    // and a cadence figure a single frame cannot support.
    assertEquals(elasticity.score, null);
    assertEquals(elasticity.band, null);
    assertEquals(elasticity.notAssessedReason, 'singleFrameFromVideo');
    assertEquals(elasticity.flags, []);
    assertEquals(elasticity.drills, []);
    assertEquals(
      (elasticity.feedback ?? '').includes('mid-170s spm'),
      false,
      'a cadence figure must never survive on a pillar one frame cannot assess'
    );

    // And it is what was PERSISTED, not just what was returned.
    const settled = h.rpc.to('settle_analysis')[0].args.p_result as typeof result;
    assertEquals(settled.pillars.elasticity.feedback, testCase.note);
    assertEquals(settled.pillars.elasticity.score, null);
  });
}

Deno.test('no pillar tells a VIDEO submitter to send a video', async () => {
  const h = harness([
    ok({
      pillars: {
        posture: {
          score: null,
          band: null,
          feedback: null,
          notAssessedReason: 'needsVideo',
          safety: NO_SAFETY_SIGNAL,
          flags: [],
          drills: [],
        },
        armSwing: {
          score: null,
          band: null,
          feedback: null,
          notAssessedReason: 'needsVideo',
          safety: NO_SAFETY_SIGNAL,
          flags: [],
          drills: [],
        },
        cadence: { ...scoredPillar(70, 'good'), notAssessedReason: 'needsVideo' },
        elasticity: { ...scoredPillar(74, 'good'), notAssessedReason: 'needsVideo' },
      },
      overall: { score: 72, band: 'good' },
    }),
  ]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_VIDEO_BODY);

  assertEquals(res.status, 200);
  const pillars = (res.body.result as {
    pillars: Record<string, { notAssessedReason?: string }>;
  }).pillars;

  for (const id of ['posture', 'armSwing', 'cadence', 'elasticity']) {
    assertEquals(
      pillars[id].notAssessedReason,
      'singleFrameFromVideo',
      `${id} must not ask a video submitter for a video`
    );
  }

  const settled = h.rpc.to('settle_analysis')[0].args.p_result as {
    pillars: Record<string, { notAssessedReason?: string }>;
  };
  assertEquals(settled.pillars.posture.notAssessedReason, 'singleFrameFromVideo');
});

Deno.test('a PHOTO submission keeps needsVideo, which is true there', async () => {
  const h = harness([
    ok({
      pillars: {
        posture: {
          score: null,
          band: null,
          feedback: null,
          notAssessedReason: 'needsVideo',
          safety: NO_SAFETY_SIGNAL,
          flags: [],
          drills: [],
        },
        armSwing: scoredPillar(66, 'mid'),
        cadence: scoredPillar(70, 'good'),
        elasticity: scoredPillar(74, 'good'),
      },
      overall: { score: 70, band: 'good' },
    }),
  ]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_PHOTO_BODY);

  assertEquals(res.status, 200);
  const pillars = (res.body.result as {
    pillars: Record<string, { notAssessedReason?: string }>;
  }).pillars;
  assertEquals(pillars.posture.notAssessedReason, 'needsVideo');
  assertEquals(pillars.cadence.notAssessedReason, 'needsVideo');
});

Deno.test('a certified safety note LEADS every pillar\'s feedback on every tier and frame path', async () => {
  const paths = [
    { tier: 'free', body: ONE_FRAME_VIDEO_BODY },
    { tier: 'pro', body: ONE_FRAME_VIDEO_BODY },
    { tier: 'elite', body: ONE_FRAME_VIDEO_BODY },
    { tier: 'pro', body: VIDEO_BODY },
    { tier: 'elite', body: VIDEO_BODY },
  ] as const;
  const notes = {
    posture: 'Posture safety note from the certified declaration.',
    armSwing: 'Arm-swing safety note from the certified declaration.',
    cadence: 'Cadence safety note from the certified declaration.',
    elasticity: 'Elasticity safety note from the certified declaration.',
  } as const;
  // The two motion pillars are forced not-assessed on a one-frame submission, which discards their
  // prose outright; the warning then stands alone. Everywhere else the prose is supportable and
  // must survive UNDER the warning.
  const MOTION = ['cadence', 'elasticity'] as const;

  for (const { tier, body } of paths) {
    const h = harness([
      ok({
        pillars: {
          posture: pillarWithSafety('sharpOrWorseningPain', notes.posture),
          armSwing: pillarWithSafety('swellingLimpOrFavouringOneSide', notes.armSwing),
          cadence: pillarWithSafety('achillesOrHeelCordPain', notes.cadence),
          elasticity: pillarWithSafety('sharpOrWorseningPain', notes.elasticity),
        },
        overall: { score: 71, band: 'good' },
      }),
    ]);
    h.rpc.handlers.reserve_analysis = () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
      error: null,
    });

    const res = await run(h, body);

    assertEquals(res.status, 200, `${tier}/${body.frames.length} frame(s)`);
    const result = res.body.result as {
      pillars: Record<string, { feedback: string | null; safety?: { note: string } | null }>;
    };
    const oneFrame = body.frames.length === 1;
    for (const id of ['posture', 'armSwing', 'cadence', 'elasticity'] as const) {
      const label = `${tier}/${body.frames.length} frame(s)/${id}`;
      const feedback = result.pillars[id].feedback ?? '';
      const strippedByNormalization = oneFrame && (MOTION as readonly string[]).includes(id);

      assertEquals(
        feedback.startsWith(notes[id]),
        true,
        `${label}: the certified warning must come FIRST, not after the coaching`
      );
      assertEquals(
        feedback.includes(SAFETY_FIXTURE_COACHING),
        !strippedByNormalization,
        strippedByNormalization
          ? `${label}: prose one frame cannot support must stay discarded`
          : `${label}: supportable coaching must survive under the warning`
      );
      if (!strippedByNormalization) {
        assertEquals(
          feedback,
          `${notes[id]}\n\n${SAFETY_FIXTURE_COACHING}`,
          `${label}: warning, blank line, then the coaching`
        );
      } else {
        assertEquals(feedback, notes[id], `${label}: the warning stands alone`);
      }
      assertEquals(result.pillars[id].safety?.note, notes[id]);
    }
    assertEquals(
      h.rpc.to('settle_analysis')[0].args.p_result,
      result,
      `${tier}/${body.frames.length} frame(s): persisted output must match visible output`
    );
  }
});

Deno.test('a pillar with no stop-running signal keeps no prose at all after the one-frame strip', async () => {
  const h = harness([
    ok({
      pillars: {
        posture: { ...scoredPillar(78, 'good'), safety: safeSignal() },
        armSwing: { ...scoredPillar(66, 'mid'), safety: safeSignal() },
        cadence: pillarWithSafety('none', ''),
        elasticity: pillarWithSafety('none', ''),
      },
      overall: { score: 71, band: 'good' },
    }),
  ]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_PHOTO_BODY);
  const result = res.body.result as {
    pillars: Record<string, { feedback: string | null; score: number | null; notAssessedReason?: string }>;
  };

  assertEquals(result.pillars.cadence.feedback, null, 'no safety signal means no surviving prose');
  assertEquals(result.pillars.cadence.score, null);
  assertEquals(
    result.pillars.cadence.notAssessedReason,
    'needsVideo',
    'a photo submitter is told a video would unlock these pillars'
  );
  assertEquals(result.pillars.elasticity.feedback, null);
});

Deno.test('an UNGROUNDED safety signal fails closed: no salvage, no delivery, no charge', async () => {
  // A signal id outside injury_flags.md's certified list. Salvaging around it would hand the
  // runner a complete-looking analysis with an unreadable warning quietly dropped.
  const ungrounded = () =>
    ok({
      pillars: {
        posture: { ...scoredPillar(78, 'good'), safety: { signal: 'runnersKnee', note: 'Stop running.' } },
        armSwing: { ...scoredPillar(66, 'mid'), safety: safeSignal() },
        cadence: { ...scoredPillar(70, 'good'), safety: safeSignal() },
        elasticity: { ...scoredPillar(71, 'good'), safety: safeSignal() },
      },
      overall: { score: 71, band: 'good' },
    });
  const h = harness([ungrounded(), ungrounded()]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_VIDEO_BODY);

  assertEquals(res.status, 503);
  assertEquals(res.body.code, 'model_error');
  assertEquals(h.rpc.to('settle_analysis').length, 0, 'nothing may be delivered around a dropped warning');
  assertEquals(
    releaseReasonFrom(h.rpc),
    'invalid_safety',
    'an unusable safety field is OUR contract failing — its own reason, never a farming strike'
  );
  assertEquals(h.model.sent.length, 2, 'the model got its full second chance first');
});

Deno.test('a real signal on a pillar the salvage would DROP also fails closed', async () => {
  // Elasticity is unreadable garbage, so a salvage would replace it with the all-null dropped
  // pillar — taking its declared stop-running signal with it. That must abort the salvage.
  const withDroppedWarning = () =>
    ok({
      pillars: {
        posture: { ...scoredPillar(78, 'good'), safety: safeSignal() },
        armSwing: { ...scoredPillar(66, 'mid'), safety: safeSignal() },
        cadence: { ...scoredPillar(70, 'good'), safety: safeSignal() },
        elasticity: {
          score: 'not a number',
          safety: { signal: 'swellingLimpOrFavouringOneSide', note: 'Get that ankle looked at first.' },
        },
      },
    });
  const h = harness([withDroppedWarning(), withDroppedWarning()]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_VIDEO_BODY);

  assertEquals(res.status, 422);
  assertEquals(h.rpc.to('settle_analysis').length, 0);
  assertEquals(h.rpc.to('release_analysis').length, 1);
});

Deno.test('the prompt states what the runner SENT and what we RECEIVED as two separate facts', async () => {
  const fromVideo = harness([ok()]);
  fromVideo.rpc.handlers.reserve_analysis = () => freeReserve();
  await run(fromVideo, ONE_FRAME_VIDEO_BODY);
  const videoPrompt = systemText(fromVideo.model.requests[0]);

  assert(
    videoPrompt.includes('THE MEDIA: A SINGLE FRAME FROM A VIDEO'),
    'their own upload must not be renamed'
  );
  assert(
    videoPrompt.includes('They ALREADY sent a video. NEVER tell them to submit one'),
    'one frame is one instant, but the runner still sent a video'
  );
  assertEquals(
    videoPrompt.includes('Tell the runner a short video would unlock'),
    false,
    'never advise a video submitter to submit a video'
  );
  assertEquals(
    videoPrompt.includes('Across these frames you can assess all four pillars'),
    false,
    'one attached frame must never get the cross-frame rules'
  );

  const fromPhoto = harness([ok()]);
  fromPhoto.rpc.handlers.reserve_analysis = () => freeReserve();
  await run(fromPhoto, ONE_FRAME_PHOTO_BODY);
  const photoPrompt = systemText(fromPhoto.model.requests[0]);

  assert(photoPrompt.includes('THE MEDIA: A SINGLE PHOTO'));
  assert(
    photoPrompt.includes('Tell the runner a short video would unlock'),
    'a photo submitter IS told what would help'
  );

  const multiFrame = harness([ok()]);
  await run(multiFrame, VIDEO_BODY);
  assert(
    systemText(multiFrame.model.requests[0]).includes(
      'Across these frames you can assess all four pillars'
    ),
    'the multi-frame path is unchanged'
  );
});

// ===========================================================================
// ABSENT IS INVALID. `PACE_RESULT_SCHEMA` marks `safety` required, but a schema is a request to
// the model, not a guarantee — so a pillar that arrives without one, or with one we cannot use,
// takes the same fail-closed path as an ungrounded signal. Reading "absent" as "no signal" would
// discard a warning written in the prose with more confidence than any classifier ever did.
// ===========================================================================

const WARNING_IN_THE_PROSE =
  'She is favouring the left leg and it looks swollen — get it looked at before running again.';

/** Fully valid in every respect EXCEPT the safety declaration on Cadence, which is `broken`.
 * Its prose carries a real warning, which is precisely what must not be silently dropped. */
function cadenceSafety(broken: Record<string, unknown>): ModelCallResult {
  return ok({
    pillars: {
      posture: scoredPillar(78, 'good'),
      armSwing: scoredPillar(66, 'mid'),
      cadence: {
        score: 70,
        band: 'good',
        feedback: WARNING_IN_THE_PROSE,
        flags: [],
        drills: [],
        ...broken,
      },
      elasticity: scoredPillar(71, 'good'),
    },
    overall: { score: 71, band: 'good' },
  });
}

const UNUSABLE_SAFETY: { label: string; broken: Record<string, unknown> }[] = [
  { label: 'the field is absent entirely', broken: {} },
  { label: 'the field is malformed (wrong shape)', broken: { safety: 'she is limping' } },
  { label: 'the field is null', broken: { safety: null } },
  {
    label: 'the signal is outside injury_flags.md',
    broken: { safety: { signal: 'runnersKnee', note: 'Stop running.' } },
  },
  {
    label: 'a declared signal carries a blank note',
    broken: { safety: { signal: 'swellingLimpOrFavouringOneSide', note: '   ' } },
  },
];

for (const { label, broken } of UNUSABLE_SAFETY) {
  Deno.test(`fail closed when ${label}: retry, release, deliver nothing`, async () => {
    const h = harness([cadenceSafety(broken), cadenceSafety(broken)]);
    h.rpc.handlers.reserve_analysis = () => freeReserve();

    const res = await run(h, ONE_FRAME_VIDEO_BODY);

    assertEquals(res.status, 503, 'an unusable safety declaration is never deliverable');
    assertEquals(res.body.code, 'model_error');
    assertEquals(h.model.sent.length, 2, 'the model gets its full second chance');
    assertEquals(h.rpc.to('settle_analysis').length, 0, 'nothing is delivered and nothing is persisted');
    assertEquals(
      releaseReasonFrom(h.rpc),
      'invalid_safety',
      'the quota slot is handed back under our own reason, without a farming strike'
    );
    assertEquals(
      h.rpc.to('record_ai_call').map((call) => call.args.p_status),
      ['model_error', 'model_error'],
      'provider/model safety omissions must be observable as our fault in the call ledger too'
    );
  });
}

Deno.test('a well-formed "none" declaration on every pillar is the ordinary, deliverable case', async () => {
  const h = harness([cadenceSafety({ safety: { signal: 'none', note: '' } })]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_VIDEO_BODY);

  assertEquals(res.status, 200, 'the fail-closed rule must not reject an honest response');
  assertEquals(h.rpc.to('settle_analysis').length, 1);
});

// ===========================================================================
// `overall` belongs to the model unless WE changed the pillars it was computed over.
// ===========================================================================

Deno.test('a multi-frame paid analysis keeps the model\'s own overall, untouched', async () => {
  for (const tier of ['pro', 'elite'] as const) {
    const h = harness([
      ok({
        pillars: {
          posture: scoredPillar(80, 'good'),
          armSwing: scoredPillar(72, 'good'),
          cadence: scoredPillar(60, 'mid'),
          elasticity: scoredPillar(90, 'strong'),
        },
        // Deliberately NOT the mean of the four (which is 75.5 -> 76): if this survives, the
        // model's headline was kept; if it becomes 76, we silently replaced it.
        overall: { score: 71, band: 'good' },
      }),
    ]);
    h.rpc.handlers.reserve_analysis = () => ({
      data: { allowed: true, existing: false, id: ANALYSIS_ID, status: 'reserved', tier },
      error: null,
    });

    const res = await run(h, VIDEO_BODY);
    const result = res.body.result as { overall: { score: number | null; band: string | null } };

    assertEquals(result.overall, { score: 71, band: 'good' }, `${tier}: the model's overall is not ours to rewrite`);
    assertEquals(
      (h.rpc.to('settle_analysis')[0].args.p_result as typeof result).overall,
      { score: 71, band: 'good' }
    );
  }
});

Deno.test('a one-frame analysis DOES recompute overall — the model computed it over pillars we removed', async () => {
  const h = harness([
    ok({
      pillars: {
        posture: scoredPillar(78, 'good'),
        armSwing: scoredPillar(66, 'mid'),
        cadence: scoredPillar(60, 'mid'),
        elasticity: scoredPillar(90, 'strong'),
      },
      overall: { score: 73, band: 'good' },
    }),
  ]);
  h.rpc.handlers.reserve_analysis = () => freeReserve();

  const res = await run(h, ONE_FRAME_PHOTO_BODY);
  const result = res.body.result as { overall: { score: number | null } };

  // mean(78, 66) = 72 — Cadence and Elasticity were zeroed, so the model's 73 no longer describes
  // anything that survived.
  assertEquals(result.overall.score, 72);
});
