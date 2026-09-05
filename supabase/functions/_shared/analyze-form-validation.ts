/**
 * ISSUE #45 — structural validation, retry-once, and the honest-partial fallback.
 * The single rule this file exists to enforce: **NEVER FABRICATE A SCORE.**
 *
 * Echo V1's "tolerant parser" filled a missing pillar with score 75 + "No feedback available".
 * That is banned. A pillar the model did not return, or returned in a shape we cannot read, is
 * reported as `score: null` / `band: null` — not assessed — and the whole result is flagged
 * `isFallback: true` so the UI can say so out loud (#56's "Partial read" banner). There is no
 * code path in this file that invents a number.
 *
 * PURE, BY DESIGN — the same split as `ai-guard.ts` / `analyze-form-prompt.ts`: no `Deno` global,
 * no `fetch`, no env var, no npm import. `analyze-form/flow.ts` owns the orchestration (gate,
 * reserve, call, upload, settle/release); this module owns the single question "is what came back
 * usable, and if only partly, how much of it?" That keeps the decision that must never be wrong
 * unit-testable with zero network and zero API spend.
 *
 * ── STRUCTURAL, NOT STRICT-CONTENT (CLAUDE.md; the known Echo V1 mistake) ───────────────────
 * Everything here checks SHAPE: are the four pillar keys present, is `score` a finite number in
 * 0-100 or null, is `band` null exactly when `score` is, are `flags`/`drills` arrays of the right
 * shape. Nothing here judges CONTENT: not whether the feedback prose is any good, not whether a
 * band is the numerically "right" one for its score, not whether a drill name appears in
 * `drills.md`, not whether a `notAssessedReason` is one the copy deck has a string for. Rejecting
 * an honest, well-scored analysis because its wording surprised us is precisely how a working
 * feature becomes a broken one — and it is the mistake this project has already made once.
 *
 * The per-pillar shape rules are NOT restated here. `isStructurallyValidPillar()` below delegates
 * to `pace.ts`'s own `isPaceResult`, so there is exactly one definition of "a valid pillar" in the
 * codebase and this file cannot drift from it. See that function's comment for the mechanism.
 *
 * ── THE DECISION TABLE (issue #45, verbatim) ───────────────────────────────────────────────
 *   | Outcome                        | What the DB does                                      |
 *   | Valid (structurally complete)  | settle_analysis(..., is_fallback = false)             |
 *   | Honest partial (>=2 parsed)    | settle_analysis(..., is_fallback = true)              |
 *   | Clean failure (<2 parsed)      | release_analysis(...) — the quota slot is refunded    |
 *
 * `decideOutcome()` is the whole table, as one pure function over the attempts that were made.
 * `flow.ts` does what it says; it does not re-derive the decision.
 *
 * ── release_reason: 'model_error' vs 'validation_failed' IS LOAD-BEARING ────────────────────
 * `20260712220000_anti_farm_release_reason_fix.sql` pins `release_reason` to a closed set and
 * classifies exactly one member of it as a farming signal:
 *   - SERVER FAULT, excluded from the 3-strike anti-farm cap:
 *       'model_error'      — the Anthropic call errored, was truncated, or was refused
 *       'provider_timeout' — the Anthropic call timed out
 *       'internal_error'   — our own code raised
 *   - FARMING SIGNAL, counted (3 within 24h on free -> `too_many_failed_attempts`):
 *       'validation_failed' — the response came back and failed structural validation twice
 *
 * `classifyReleaseReason()` below leans deliberately toward SERVER FAULT, and does so on TWO axes:
 *   1. KIND of failure. A truncation or a refusal anywhere in the attempt pair yields
 *      `'model_error'`, even if the other attempt was a prose reply. Only when EVERY response we
 *      actually received was a content failure (a prose reply, or a tool call whose input we could
 *      not read) is `'validation_failed'` even on the table.
 *   2. WHETHER THE RETRY RAN. `'validation_failed'` additionally requires that the model was given
 *      its full second chance — `retryRan === true` — and STILL only produced content failures.
 *      The migration's own wording is "failed structural validation **after retry**", and #44's
 *      flow does not always run the retry: it SKIPS it when too little of the deadline is left
 *      (attempt 1 was slow under adaptive thinking) and it is DENIED when the retry's own spend
 *      gate returns `!allowed` (the daily cap is near, or the circuit breaker just tripped under
 *      load). In BOTH of those sub-cases only one attempt exists, and it was WE who cut the second
 *      one — so a lone prose reply there is our degradation, not the user's attack, and must
 *      release as `'model_error'` (refunds quota, does NOT tick the farming counter). Without this,
 *      a model that degrades to prose exactly when the breaker is open — precisely the moment the
 *      retry is denied — would strike three unlucky Free users out of their one lifetime analysis
 *      in 24h, for an outage that was entirely ours. That is the exact harm issue #6 exists to
 *      close, and the promise this header opens with.
 *
 * A user with an odd camera angle never produces `'validation_failed'` either way: the model still
 * returns a schema-valid result and honestly reports `score: null`, which VALIDATES and is
 * delivered as a success. The farming signal is reserved for the one case that actually looks like
 * an attack: the model was asked twice, and twice refused to honor the schema.
 */

import {
  PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL,
  PACE_PILLARS,
  hasSafetySignal,
  isPaceResult,
  isPaceSafety,
  type PaceSafety,
  type PacePillarId,
  type PacePillarResult,
  type PaceResult,
  type ScoreBand,
} from './pace.ts';
import { PACE_ANALYSIS_TOOL_NAME } from './analyze-form-prompt.ts';

// -------------------------------------------------------------------------------------------
// The narrow slice of Anthropic's Messages *response* this module reads.
//
// Hand-declared, not imported from `@anthropic-ai/sdk` — same discipline as
// `analyze-form-prompt.ts`'s request types, and for the same reason: this module must stay free of
// every npm/Deno-only import so it unit-tests under either runner with no network.
//
// Verified against the live Messages API docs 2026-07-12 (platform.claude.com/docs/en/api/messages
// and .../build-with-claude/adaptive-thinking), not recalled:
//   - `content` is a heterogeneous block array. With adaptive thinking ON (Sonnet 5's default) a
//     `thinking` block normally precedes everything else; with `display: "omitted"` (also Sonnet
//     5's default) its `thinking` field is an empty string. We never read thinking blocks — we
//     look past them for the tool_use block. That is why `AnthropicResponseBlock` is a loose
//     `{ type: string }` with optional fields rather than a closed union: an unknown future block
//     type must be skipped, never treated as a parse failure.
//   - `stop_reason` is one of 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' |
//     'pause_turn' | 'refusal'.
//   - `usage` carries input_tokens, output_tokens, cache_creation_input_tokens,
//     cache_read_input_tokens — the exact four fields `recordAiCall()` bills against.
// -------------------------------------------------------------------------------------------

export interface AnthropicResponseBlock {
  type: string;
  /** `text` blocks. With structured outputs, THIS is where the result lives: the response text is
   * grammar-constrained to `PACE_RESULT_SCHEMA`, so it is the JSON object itself. */
  text?: string;
  /** `tool_use` blocks — only possible when the caller opted into `includeTool`. */
  name?: string;
  input?: unknown;
}

export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface AnthropicMessageResponse {
  content?: AnthropicResponseBlock[];
  stop_reason?: string | null;
  usage?: AnthropicUsage;
}

// -------------------------------------------------------------------------------------------
// Failure taxonomy
// -------------------------------------------------------------------------------------------

/**
 * Why one attempt did not yield a fully-valid `PaceResult`.
 *
 * `'truncated'` and `'refusal'` are OUR problem (a `max_tokens` budget the thinking ate, or a
 * policy refusal); `'no_tool_use'` and `'invalid_shape'` are content failures — the two that,
 * together and alone, mean `'validation_failed'`. See `classifyReleaseReason()`.
 */
export type AttemptFailure =
  | 'truncated'
  | 'refusal'
  | 'no_tool_use'
  | 'invalid_shape'
  /** The call itself never produced a response body (HTTP error, network error, abort). */
  | 'call_failed';

/** The `release_reason` strings `analyses_release_reason_known_values` permits. A value outside
 * this set is rejected by the DB's CHECK constraint — so this type is not a convention, it is the
 * schema.
 *
 * `'zero_pillars_assessed'` (audit-v23-r1-decision-zero-pillar-charge-policy, added by
 * `20260819120000_zero_pillar_release_reason.sql`) is set only by `flow.ts`, not by anything in
 * this file: it covers a response that VALIDATED in full — `decideOutcome` never even sees it,
 * because it returns `kind: 'valid'` — but in which every pillar was honestly reported not
 * assessed. Nothing useful was delivered, so the captain's decision is to refund the quota slot
 * rather than charge it, while still handing the (empty) result back to the caller. It is
 * deliberately excluded from `pace_is_farming_signal` (20260712220000): an honest "I could not
 * assess anything in this clip" is not a farming signal, and must never tick the 3-strike cap. */
export type ReleaseReason =
  | 'model_error'
  | 'provider_timeout'
  | 'internal_error'
  | 'validation_failed'
  | 'zero_pillars_assessed';

// -------------------------------------------------------------------------------------------
// Score bands — the ONE piece of arithmetic this module does, and why it is not fabrication
// -------------------------------------------------------------------------------------------

/**
 * Band floors, best-to-worst. These are `pace_framework.md`'s certified bands, restated as
 * numbers: 85-100 Strong, 70-84 Solid, 50-69 Developing, 0-49 Needs work. They also appear as
 * range STRINGS in `analyze-form-prompt.ts`'s `SCORE_BAND_RUBRIC` (which is what the model is
 * told) and as a `ScoreBandRange` record in `constants/theme.ts` (which is what the UI colours
 * with). Three declarations is two too many, but the alternatives are worse: `theme.ts` pulls in
 * react-native and is outside the deploy bundle, and `SCORE_BAND_RUBRIC`'s values are prose
 * ("85-100") intended for a prompt, not for arithmetic.
 *
 * Drift is caught instead of prevented: `analyze-form-validation.deno.test.ts` parses
 * `SCORE_BAND_RUBRIC`'s range strings and asserts `bandForScore()` agrees with them at every
 * integer 0-100. If anyone edits either table, that test fails.
 */
const BAND_FLOORS: readonly (readonly [ScoreBand, number])[] = [
  ['strong', 85],
  ['good', 70],
  ['mid', 50],
  ['low', 0],
];

/** The band a 0-100 score falls in. Throws on an out-of-range score rather than clamping — every
 * caller here has already run the score through `isPaceResult`'s 0-100 check, so an out-of-range
 * value reaching this function is a bug in THIS file, and a silent clamp would hide it. */
export function bandForScore(score: number): ScoreBand {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError(`bandForScore expects a 0-100 score; got ${score}.`);
  }
  for (const [band, floor] of BAND_FLOORS) {
    if (score >= floor) {
      return band;
    }
  }
  // Unreachable: 'low' has floor 0 and score >= 0 is checked above.
  throw new RangeError(`No band for score ${score}.`);
}

/**
 * The headline number for a SALVAGED result: the mean of the pillar scores that survived, rounded
 * to an integer, with its band. Null (with a null band) when nothing survived with a score.
 *
 * THIS IS NOT FABRICATION, and the distinction is the whole point of issue #45. Every input to
 * this average is a real score the model itself produced for a pillar we are actually showing.
 * Dropped pillars are not counted as zeros (which would silently punish the runner for a camera
 * angle — the prompt forbids the model from doing that, so we must not do it either); they are
 * simply not in the average. What we never do is invent a pillar score. Recomputing `overall`
 * from the surviving pillars, rather than keeping whatever `overall` the model sent, is required
 * for internal consistency: the model computed its `overall` over pillars that included the ones
 * we just dropped, so keeping it would show a headline number that does not match the bars under
 * it. `pace.ts` explicitly leaves this arithmetic "to whichever side produces the result" — on
 * the fallback path, that side is us.
 */
export function deriveOverall(pillars: Record<PacePillarId, PacePillarResult>): PaceResult['overall'] {
  const scores = PACE_PILLARS.map((id) => pillars[id].score).filter(
    (score): score is number => score !== null
  );

  if (scores.length === 0) {
    return { score: null, band: null };
  }

  const mean = Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
  return { score: mean, band: bandForScore(mean) };
}

// -------------------------------------------------------------------------------------------
// Per-attempt reading
// -------------------------------------------------------------------------------------------

/** What a not-assessed pillar looks like when WE produce it (a salvage drop), as opposed to when
 * the model honestly reports one.
 *
 * `notAssessedReason` is deliberately OMITTED. The two values the type allows — 'angle' and
 * 'needsVideo' — are both claims about the runner's media, and neither is true here: the reason
 * this pillar is missing is that the model's own output for it was unreadable. Asserting 'angle'
 * would be a small, plausible-sounding lie about the runner's video, which is the same species of
 * dishonesty as a fabricated score. Saying nothing is the honest option, and `pace.ts` makes the
 * field optional precisely so that saying nothing is representable. `feedback: null` for the same
 * reason: the UI renders its own "not assessed" copy (#56, `result.pillar.notAssessed.*`), and
 * "No feedback available" — V1's actual string — is not something we will write again. */
const DROPPED_PILLAR: PacePillarResult = {
  score: null,
  band: null,
  feedback: null,
  flags: [],
  drills: [],
};

/**
 * Is this raw value a structurally valid `PacePillarResult`?
 *
 * Delegates to `pace.ts`'s `isPaceResult` rather than restating its per-pillar rules, because
 * `pace.ts` deliberately does not export a per-pillar validator and a second copy of those rules
 * here would be free to drift from the one the app and the DB agree on. The trick: a `PaceResult`
 * is valid exactly when all four of its pillars are valid and its `overall` is a valid score/band
 * pair — so wrapping ONE candidate pillar into all four slots, alongside a known-good
 * `{score: null, band: null}` overall, makes `isPaceResult` answer a question about that single
 * pillar and nothing else.
 */
function isStructurallyValidPillar(value: unknown): value is PacePillarResult {
  const probe = {
    pillars: Object.fromEntries(PACE_PILLARS.map((id) => [id, value])),
    overall: { score: null, band: null },
  };
  return isPaceResult(probe);
}

/** A best-effort reconstruction of a response that failed full validation: the pillars that were
 * individually readable, kept EXACTLY as the model wrote them, and a freshly-derived `overall`. */
export interface Salvage {
  result: PaceResult;
  /** Pillars whose shape we could read at all — including a pillar the model honestly reported as
   * not-assessed. This is the count issue #45's ">= 2 pillars parsed" threshold is measured on. */
  parsedPillars: PacePillarId[];
  /** Of those, the ones carrying a real (non-null) score. A partial with none of these is not a
   * result — see `decideOutcome()`. */
  assessedPillars: PacePillarId[];
}

/** Everything one model attempt yielded. `result` non-null means it validated in full — nothing
 * else in this object matters then. */
export interface AttemptOutcome {
  result: PaceResult | null;
  failure: AttemptFailure | null;
  salvage: Salvage | null;
  usage: AnthropicUsage;
  stopReason: string | null;
}

/** An attempt whose HTTP call never returned a usable body (network error, non-2xx, abort). It
 * carries no usage, contributes no salvage, and is a SERVER fault. */
export function callFailedAttempt(): AttemptOutcome {
  return { result: null, failure: 'call_failed', salvage: null, usage: {}, stopReason: null };
}

/**
 * Read one Anthropic response into an `AttemptOutcome`. Never throws — a malformed response is a
 * failure value, not an exception, so a missed `catch` upstream can never turn model garbage into
 * a 500 (or, worse, into a delivered result).
 *
 * TRUNCATION IS NEVER USABLE, even if a tool_use block appears to be present. `stop_reason:
 * 'max_tokens'` on this model means thinking + text together hit the ceiling (the live docs:
 * "Use `max_tokens` as a hard limit on total output (thinking + response text)"), so the tool
 * input we are looking at was cut off mid-write — the classic Echo V1 failure, and
 * `docs/architecture.md` step 8 binds #44 to treat it as truncation, "never as a usable response."
 * We honour that literally: we do not even look at the content.
 */
export function readAttempt(response: AnthropicMessageResponse): AttemptOutcome {
  const usage = response.usage ?? {};
  const stopReason = response.stop_reason ?? null;

  if (stopReason === 'max_tokens') {
    return { result: null, failure: 'truncated', salvage: null, usage, stopReason };
  }
  if (stopReason === 'refusal') {
    return { result: null, failure: 'refusal', salvage: null, usage, stopReason };
  }

  const payload = extractPayload(response);

  if (payload === NOT_FOUND) {
    // No schema-conformant JSON object and no tool call anywhere in the response: a prose reply, an
    // empty response, or an answer that ignored the output contract entirely. This is what a
    // successful prompt injection looks like, and it is also what a model having a bad day looks
    // like — we cannot tell them apart, and do not try to.
    return { result: null, failure: 'no_tool_use', salvage: null, usage, stopReason };
  }

  if (isPaceResult(payload) && everyPillarSafetyIsDeliverable(payload)) {
    return { result: payload, failure: null, salvage: null, usage, stopReason };
  }

  return {
    result: null,
    failure: 'invalid_shape',
    salvage: salvagePillars(payload),
    usage,
    stopReason,
  };
}

/** Distinguishes "no payload at all" from "a payload that happens to BE `null`" — the latter is a
 * real thing a model can emit, and it is an `invalid_shape`, not a missing answer. */
const NOT_FOUND = Symbol('no-payload');

/**
 * Find the result in the response, accepting BOTH carriers of the output contract:
 *
 *   1. STRUCTURED OUTPUTS (the default — `output_config.format`): the payload IS the response text,
 *      grammar-constrained to `PACE_RESULT_SCHEMA`. We `JSON.parse` the first text block that
 *      parses to anything.
 *   2. TOOL USE: a `submit_pace_analysis` block, reachable only when a caller opted into
 *      `includeTool` (#42's evals may, to compare the two mechanisms).
 *
 * Reading both is deliberate insurance, not indecision. This project cannot make a live Anthropic
 * call before shipping (zero-spend constraint), so the parser is written to be correct under either
 * response envelope rather than to bet everything on one. Whichever mechanism the request used, the
 * result lands in the same place and the rest of this module cannot tell the difference.
 */
function extractPayload(response: AnthropicMessageResponse): unknown {
  const blocks = response.content ?? [];

  const toolBlock = blocks.find(
    (block) => block?.type === 'tool_use' && block?.name === PACE_ANALYSIS_TOOL_NAME
  );
  if (toolBlock) {
    return toolBlock.input;
  }

  for (const block of blocks) {
    if (block?.type !== 'text' || typeof block.text !== 'string') {
      continue;
    }
    const parsed = parseJsonPayload(block.text);
    if (parsed !== NOT_FOUND) {
      return parsed;
    }
  }

  return NOT_FOUND;
}

function parseJsonPayload(text: string): unknown {
  let candidate = text.trim();
  if (candidate.length === 0) {
    // Sonnet 5 defaults `thinking.display` to `"omitted"`, which returns thinking blocks with an
    // empty body. An empty text block is not a payload.
    return NOT_FOUND;
  }

  // Tolerate a markdown fence even though the prompt forbids one and grammar-constrained sampling
  // should make it impossible. Four lines, and it means a perfectly good analysis is never thrown
  // away over a code fence — rejecting one would be exactly the over-tight parsing CLAUDE.md bans.
  const fenced = candidate.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) {
    candidate = fenced[1].trim();
  }

  try {
    return JSON.parse(candidate);
  } catch {
    // Prose. Not a payload — and emphatically not something to go regex a score out of.
    return NOT_FOUND;
  }
}

/**
 * Pull whatever pillars are individually readable out of a tool input that failed full
 * validation, and rebuild a valid `PaceResult` around them.
 *
 * Kept pillars are copied VERBATIM — their score, band, feedback, flags, and drills are the
 * model's words and numbers, untouched. Unreadable ones become `DROPPED_PILLAR` (all-null, no
 * invented reason). `overall` is recomputed from what survived. Returns `null` when the input is
 * not even an object with a `pillars` record — there is nothing to salvage from a string, an
 * array, or a null.
 */
/**
 * FAIL CLOSED ON SAFETY — ABSENT IS INVALID, NEVER "no signal".
 *
 * `PACE_RESULT_SCHEMA` marks `safety` `required`, but a schema is a request to the model, not a
 * grammar guarantee we can lean on: an older deployment, a tool-use envelope, or a model having a
 * bad day can all hand us a pillar with no `safety` key at all. Reading that absence as "no
 * stop-running signal was seen" is the single worst available default — a pillar whose PROSE
 * carries a real warning would then have that warning discarded with more confidence than the
 * keyword classifier this design replaced ever had.
 *
 * So all four unusable states — ABSENT, malformed, ungrounded `signal`, and a declared signal with
 * a blank `note` — take the identical path: the response is not deliverable, the salvage is
 * abandoned, the retry runs, and a second failure releases the reservation without charging the
 * user. A missing analysis is recoverable; a missing warning is not.
 */
function isDeliverableSafety(raw: unknown): raw is PaceSafety {
  if (!isPaceSafety(raw)) {
    return false;
  }
  return raw.signal === 'none' || hasSafetySignal(raw);
}

/** Every pillar of a fully-valid payload must carry a usable declaration — otherwise `readAttempt`
 * cannot call the response deliverable, however well-formed the rest of it is. */
function everyPillarSafetyIsDeliverable(payload: PaceResult): boolean {
  return PACE_PILLARS.every((id) => isDeliverableSafety(payload.pillars[id].safety));
}

function safetyBlocksSalvage(rawPillar: unknown, kept: boolean): boolean {
  if (typeof rawPillar !== 'object' || rawPillar === null || Array.isArray(rawPillar)) {
    // Not even an object: there is no `feedback` here either, so there is no warning this salvage
    // could be discarding. The pillar is dropped on its own merits by `isStructurallyValidPillar`.
    return false;
  }
  const raw = (rawPillar as { safety?: unknown }).safety;
  if (!isDeliverableSafety(raw)) {
    return true;
  }
  // A usable declaration that says something — on a pillar this salvage is about to replace with
  // the all-null dropped constant. Dropping it would take the warning with it.
  return !kept && hasSafetySignal(raw);
}

function salvagePillars(input: unknown): Salvage | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const rawPillars = (input as { pillars?: unknown }).pillars;
  if (typeof rawPillars !== 'object' || rawPillars === null || Array.isArray(rawPillars)) {
    return null;
  }

  const source = rawPillars as Record<string, unknown>;
  const parsedPillars: PacePillarId[] = [];
  const assessedPillars: PacePillarId[] = [];
  const pillars = {} as Record<PacePillarId, PacePillarResult>;

  for (const id of PACE_PILLARS) {
    const candidate = source[id];
    const kept = isStructurallyValidPillar(candidate);
    if (safetyBlocksSalvage(candidate, kept)) {
      return null;
    }
    if (kept) {
      pillars[id] = candidate;
      parsedPillars.push(id);
      if (candidate.score !== null) {
        assessedPillars.push(id);
      }
    } else {
      pillars[id] = DROPPED_PILLAR;
    }
  }

  if (parsedPillars.length === 0) {
    return null;
  }

  const result: PaceResult = { pillars, overall: deriveOverall(pillars) };

  // Belt and braces: a salvage that does not itself pass `isPaceResult` is a bug in this file, and
  // must never reach `settle_analysis`. Nothing here can produce one — every kept pillar already
  // passed `isStructurallyValidPillar`, every dropped one is the all-null constant, and
  // `deriveOverall` always returns a valid pair — but the assertion costs nothing and the thing it
  // guards against (persisting a malformed result) is unrecoverable.
  if (!isPaceResult(result)) {
    return null;
  }

  return { result, parsedPillars, assessedPillars };
}

// -------------------------------------------------------------------------------------------
// The decision — issue #45's table, as one pure function
// -------------------------------------------------------------------------------------------

export type AnalyzeFormDecision =
  /** Structurally complete on some attempt. `settle_analysis(..., is_fallback = false)`. */
  | { kind: 'valid'; result: PaceResult; sourceAttempt: number }
  /** >= 2 pillars parsed, at least one of them scored. `settle_analysis(..., is_fallback = true)`.
   * Missing pillars are null / "not assessed" — never zero, never guessed. */
  | {
      kind: 'partial';
      result: PaceResult;
      parsedPillars: PacePillarId[];
      assessedPillars: PacePillarId[];
      sourceAttempt: number;
    }
  /** Nothing deliverable. `release_analysis(..., releaseReason)` — the quota slot is refunded. */
  | { kind: 'failed'; releaseReason: ReleaseReason };

/**
 * THE GATE ISSUE #45 EXISTS TO BE. Given every attempt made (one, or two after a retry), decide
 * what the user gets and what the database does.
 *
 * Rules, in order:
 *  1. Any attempt that validated in full wins outright — deliver it, `isFallback: false`.
 *  2. Otherwise take the BEST salvage across the attempts (most pillars actually scored; ties
 *     broken on most pillars parsed). Pillars are never mixed ACROSS attempts: a result must be
 *     one coherent reading of the clip, not a chimera stitched from two different ones. Preferring
 *     the better of two attempts we already paid for is free and strictly better for the user.
 *  3. That salvage is delivered as an honest partial only if it clears BOTH bars:
 *       - `parsedPillars >= PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL` (2) — issue #45's threshold;
 *       - `assessedPillars >= 1`.
 *     The second bar is not in #45's text and is a deliberate addition: a "partial" in which every
 *     pillar is not-assessed carries no information, yet settling it would spend the user's
 *     analysis (on Free, their ONE lifetime analysis) on nothing. A clean failure refunds the slot
 *     instead. Nothing about that trade fabricates anything; it only refuses to charge for an
 *     empty result. (A response in which the model *validly* reports all four pillars as
 *     not-assessed is a different thing entirely — it validates, so it never reaches this
 *     function, and it is delivered as a real result with real "here's the shot that would fix
 *     it" feedback.)
 *  4. Otherwise: clean failure, with `releaseReason` from `classifyReleaseReason()`.
 *
 * `retryRan` is passed straight through to `classifyReleaseReason` and matters ONLY on the clean-
 * failure branch — it is the "did the model get its full second chance?" signal that separates a
 * genuine farmer (asked twice, refused twice) from our own suppressed-retry degradation. It does
 * not, and must not, affect whether a result is valid or partial: a delivered analysis is judged on
 * its content, never on how many attempts produced it.
 */
export function decideOutcome(
  attempts: readonly AttemptOutcome[],
  retryRan: boolean
): AnalyzeFormDecision {
  for (let i = 0; i < attempts.length; i += 1) {
    const result = attempts[i].result;
    if (result) {
      return { kind: 'valid', result, sourceAttempt: i };
    }
  }

  const best = bestSalvage(attempts);

  if (
    best &&
    best.salvage.parsedPillars.length >= PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL &&
    best.salvage.assessedPillars.length >= 1
  ) {
    return {
      kind: 'partial',
      result: best.salvage.result,
      parsedPillars: best.salvage.parsedPillars,
      assessedPillars: best.salvage.assessedPillars,
      sourceAttempt: best.index,
    };
  }

  return { kind: 'failed', releaseReason: classifyReleaseReason(attempts, retryRan) };
}

/** `sourceAttempt` is not decoration: `flow.ts` settles the AI-spend ledger PER GATED CALL, and a
 * call whose output we actually delivered is a `'success'`/`'fallback'` while the other one is the
 * failure it really was. Marking a failed attempt `'success'` because a later retry saved the
 * request would hide a genuine model degradation from the circuit breaker (which opens only when
 * the last N settled calls ALL carry `'model_error'`/`'validation_failed'`) and would bill its
 * tokens to the wrong ledger row. */
function bestSalvage(attempts: readonly AttemptOutcome[]): { salvage: Salvage; index: number } | null {
  let best: { salvage: Salvage; index: number } | null = null;
  for (let i = 0; i < attempts.length; i += 1) {
    const candidate = attempts[i].salvage;
    if (!candidate) {
      continue;
    }
    if (
      !best ||
      candidate.assessedPillars.length > best.salvage.assessedPillars.length ||
      (candidate.assessedPillars.length === best.salvage.assessedPillars.length &&
        candidate.parsedPillars.length > best.salvage.parsedPillars.length)
    ) {
      best = { salvage: candidate, index: i };
    }
  }
  return best;
}

/**
 * Whose fault was this failure? Read the header's `release_reason` section before changing a line
 * of this: the answer decides whether the user's 3-strike anti-farming counter ticks.
 *
 * `'validation_failed'` — the ONLY farming signal — requires ALL THREE of:
 *   1. at least one response was actually received (`attempts.length > 0`);
 *   2. EVERY response received was a content failure (a prose reply, or a tool/JSON payload we
 *      could not read) — no truncation, no refusal, no dead call in the mix; and
 *   3. the retry ACTUALLY RAN (`retryRan`). If #44's flow suppressed the retry — too little of the
 *      deadline left, or the retry's spend gate denied it — a lone content failure is our
 *      degradation, not the user's attack.
 * Anything else is a server fault: `'model_error'`. A timeout is classified by `flow.ts`, the only
 * layer that knows an abort happened, and passed as `'provider_timeout'` directly.
 *
 * `retryRan` is threaded in rather than inferred from `attempts.length >= 2` on purpose: the two
 * happen to coincide today (the flow pushes exactly one attempt per issued call), but "the model
 * was given its second chance" is a decision the flow makes, not a property of the attempts list,
 * and coupling the anti-farming rule to an array length would silently break if the retry logic
 * ever changed.
 */
export function classifyReleaseReason(
  attempts: readonly AttemptOutcome[],
  retryRan: boolean
): ReleaseReason {
  const responded = attempts.filter(
    (attempt) => attempt.failure === 'no_tool_use' || attempt.failure === 'invalid_shape'
  );

  const everyResponseWasContentFailure =
    attempts.length > 0 && responded.length === attempts.length;

  return everyResponseWasContentFailure && retryRan ? 'validation_failed' : 'model_error';
}
