/**
 * Regression locks for `_shared/analyze-form-validation.ts` (issue #45) — the module whose entire
 * job is to never fabricate a score.
 *
 * The suites below are organised around the failures this code exists to prevent, not around its
 * function list:
 *
 *   1. "never fabricates" — the Echo V1 bug, stated as executable tests. A missing pillar, a
 *      malformed pillar, an out-of-range score, a band with no score: every one of them must come
 *      out as `score: null`, and NEVER as 75 + "No feedback available".
 *   2. "structural, not strict-content" — the OPPOSITE failure, which is just as real: a valid,
 *      honest response must not be rejected because its prose, its band choice, or its
 *      `notAssessedReason` surprised us. Over-tight content validation is the other known Echo V1
 *      mistake.
 *   3. The decision table (>=2 parsed -> partial, <2 -> clean failure) and the `release_reason`
 *      classification, which decides whether a user's anti-farming counter ticks.
 *   4. Band-table parity against `analyze-form-prompt.ts`'s certified `SCORE_BAND_RUBRIC`, so the
 *      numbers we score with can never drift from the numbers the model was told to score by.
 *
 * DENO-ONLY (issue #90's convention): named `.deno.test.ts` so `jest.config.js`'s
 * `testPathIgnorePatterns` skips it and only `deno test` (`npm run test:edge`) runs it.
 */
import { assert, assertEquals, assertThrows } from 'jsr:@std/assert@1';
import {
  bandForScore,
  callFailedAttempt,
  classifyReleaseReason,
  decideOutcome,
  deriveOverall,
  readAttempt,
  type AnthropicMessageResponse,
  type AttemptOutcome,
} from '../analyze-form-validation.ts';
import { PACE_ANALYSIS_TOOL_NAME, SCORE_BAND_RUBRIC } from '../analyze-form-prompt.ts';
import {
  PACE_PILLARS,
  SCORE_BAND_VALUES,
  isPaceResult,
  type PacePillarId,
  type PacePillarResult,
} from '../pace.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function scoredPillar(score: number, band: string): Record<string, unknown> {
  return {
    score,
    band,
    feedback: 'Trunk stays tall through mid-stance.',
    flags: [],
    drills: [],
  };
}

function notAssessedPillar(reason: string): Record<string, unknown> {
  return { score: null, band: null, feedback: 'Needs a video.', notAssessedReason: reason, flags: [], drills: [] };
}

/** A complete, structurally valid tool input — all four pillars scored. */
function fullToolInput(): Record<string, unknown> {
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

function toolResponse(
  input: unknown,
  overrides: Partial<AnthropicMessageResponse> = {}
): AnthropicMessageResponse {
  return {
    content: [{ type: 'tool_use', name: PACE_ANALYSIS_TOOL_NAME, input }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 25_000, output_tokens: 1_200 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. THE RULE: never fabricate a score.
// ---------------------------------------------------------------------------

Deno.test('never fabricates: a pillar missing from the response comes back null, not 75', () => {
  const input = fullToolInput();
  delete (input.pillars as Record<string, unknown>).cadence;

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.result, null, 'a response missing a pillar must not validate in full');
  assert(attempt.salvage, 'the other three pillars are still salvageable');
  assertEquals(attempt.salvage.parsedPillars.sort(), ['armSwing', 'elasticity', 'posture']);

  const cadence = attempt.salvage.result.pillars.cadence;
  assertEquals(cadence.score, null, 'THE bug: a missing pillar must never be given a number');
  assertEquals(cadence.band, null);
  assertEquals(cadence.feedback, null, 'and never "No feedback available"');
  assertEquals(cadence.flags, []);
  assertEquals(cadence.drills, []);
});

Deno.test('never fabricates: a dropped pillar claims no notAssessedReason it cannot know', () => {
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = { totally: 'malformed' };

  const attempt = readAttempt(toolResponse(input));

  // 'angle' and 'needsVideo' are both claims about the RUNNER'S MEDIA. Neither is true here — the
  // pillar is missing because the MODEL's output was unreadable. Asserting one would be a small,
  // plausible-sounding lie about their video, which is the same species of dishonesty as a
  // fabricated score.
  assertEquals(attempt.salvage?.result.pillars.cadence.notAssessedReason, undefined);
});

Deno.test('never fabricates: an out-of-range score is dropped, never clamped into a plausible one', () => {
  for (const bogus of [150, -1, 101]) {
    const input = fullToolInput();
    (input.pillars as Record<string, unknown>).posture = scoredPillar(bogus, 'strong');

    const attempt = readAttempt(toolResponse(input));

    assertEquals(attempt.result, null, `${bogus} must not validate`);
    assertEquals(
      attempt.salvage?.result.pillars.posture.score,
      null,
      `${bogus} must be dropped, not clamped to 100 or 0 — a clamp is an invented score`
    );
  }
});

Deno.test('never fabricates: a score with no band (or a band with no score) is dropped', () => {
  const scoreNoBand = fullToolInput();
  (scoreNoBand.pillars as Record<string, unknown>).posture = {
    score: 80,
    band: null,
    feedback: 'x',
    flags: [],
    drills: [],
  };
  assertEquals(readAttempt(toolResponse(scoreNoBand)).salvage?.result.pillars.posture.score, null);

  const bandNoScore = fullToolInput();
  (bandNoScore.pillars as Record<string, unknown>).posture = {
    score: null,
    band: 'good',
    feedback: 'x',
    flags: [],
    drills: [],
  };
  assertEquals(readAttempt(toolResponse(bandNoScore)).salvage?.result.pillars.posture.score, null);
});

Deno.test('never fabricates: not-assessed pillars are NOT counted as zeros in the derived overall', () => {
  // The prompt forbids the model from counting a not-assessed pillar as a zero ("that would
  // silently punish the runner for a camera angle"). The fallback path must not do it either.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = { junk: true };
  (input.pillars as Record<string, unknown>).elasticity = { junk: true };
  delete input.overall;

  const attempt = readAttempt(toolResponse(input));
  const overall = attempt.salvage?.result.overall;

  // Kept: posture 80, armSwing 72. Mean of the TWO real scores = 76. Counting the two dropped
  // pillars as zeros would give 38 — a much worse, entirely invented number.
  assertEquals(overall?.score, 76);
  assertEquals(overall?.band, 'good');
});

Deno.test('never fabricates: an all-null salvage yields a null overall, never a 0', () => {
  assertEquals(
    deriveOverall({
      posture: { score: null, band: null, feedback: null, flags: [], drills: [] },
      armSwing: { score: null, band: null, feedback: null, flags: [], drills: [] },
      cadence: { score: null, band: null, feedback: null, flags: [], drills: [] },
      elasticity: { score: null, band: null, feedback: null, flags: [], drills: [] },
    }),
    { score: null, band: null }
  );
});

// ---------------------------------------------------------------------------
// 2. THE OPPOSITE RULE: structural, not strict-content.
// ---------------------------------------------------------------------------

Deno.test('structural not strict: a complete response validates and is returned verbatim', () => {
  const attempt = readAttempt(toolResponse(fullToolInput()));

  assert(attempt.result, 'a well-formed response must validate');
  assertEquals(attempt.failure, null);
  assertEquals(attempt.result.pillars.posture.score, 80);
  assertEquals(attempt.result.overall.score, 76, "the model's own overall is kept, not recomputed");
  assertEquals(attempt.usage.output_tokens, 1_200);
});

Deno.test('structural not strict: a photo response with two honestly-null pillars is a FULL success', () => {
  // The single most common real response in the product: a photo can never show Cadence or
  // Elasticity. If this were treated as a partial, every photo analysis would carry a "Partial
  // read" banner and — worse — would be marked `is_fallback` in the database forever.
  const input = {
    pillars: {
      posture: scoredPillar(78, 'good'),
      armSwing: scoredPillar(66, 'mid'),
      cadence: notAssessedPillar('needsVideo'),
      elasticity: notAssessedPillar('needsVideo'),
    },
    overall: { score: 72, band: 'good' },
  };

  const decision = decideOutcome([readAttempt(toolResponse(input))]);

  assertEquals(decision.kind, 'valid');
});

Deno.test('structural not strict: a band that disagrees with its score is NOT rejected', () => {
  // 30 is "low" by the rubric, but the model said "strong". That is a CONTENT error, and judging it
  // here is exactly the over-tight validation that made Echo V1 reject good responses. The shape is
  // valid; ship it.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).posture = scoredPillar(30, 'strong');

  const attempt = readAttempt(toolResponse(input));

  assert(attempt.result, 'a numerically odd band is a content judgment, not a shape violation');
  assertEquals(attempt.result.pillars.posture.band, 'strong');
});

Deno.test('structural not strict: unknown extra keys and unfamiliar prose are accepted', () => {
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).posture = {
    ...scoredPillar(80, 'good'),
    feedback: '',
    confidence: 0.4,
    somethingNewAnthropicAdded: true,
  };
  (input as Record<string, unknown>).apiVersion = 'v9';

  assert(readAttempt(toolResponse(input)).result, 'forward-compatible extra fields must not reject');
});

Deno.test('structural not strict: a notAssessedReason outside the copy deck is accepted', () => {
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = notAssessedPillar('lighting');

  const attempt = readAttempt(toolResponse(input));

  assert(attempt.result, 'the model naming a reason we have no string for yet is not a shape error');
});

Deno.test('structural not strict: flags and drills are accepted as-is, never checked against the library', () => {
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).posture = {
    score: 55,
    band: 'mid',
    feedback: 'x',
    flags: [{ pattern: 'A pattern not in injury_flags.md', detail: 'prose' }],
    drills: [{ name: 'A drill not in drills.md', instructions: 'prose' }],
  };

  assert(readAttempt(toolResponse(input)).result, 'grounding is a prompt problem, not a type problem');
});

// ---------------------------------------------------------------------------
// 3. Reading a response: the failure taxonomy.
// ---------------------------------------------------------------------------

Deno.test('a prose reply (no tool_use block) is no_tool_use, with nothing to salvage', () => {
  const attempt = readAttempt({
    content: [{ type: 'text' }],
    stop_reason: 'end_turn',
  });

  assertEquals(attempt.failure, 'no_tool_use');
  assertEquals(attempt.result, null);
  assertEquals(attempt.salvage, null);
});

Deno.test('a call to some other tool is no_tool_use', () => {
  const attempt = readAttempt({
    content: [{ type: 'tool_use', name: 'some_injected_tool', input: fullToolInput() }],
    stop_reason: 'tool_use',
  });

  assertEquals(attempt.failure, 'no_tool_use');
});

Deno.test('thinking blocks are skipped, not mistaken for a failure', () => {
  // Sonnet 5 runs adaptive thinking by default with `display: "omitted"`, so a thinking block with
  // an empty body precedes the tool call on essentially every real response.
  const attempt = readAttempt({
    content: [
      { type: 'thinking' },
      { type: 'text' },
      { type: 'tool_use', name: PACE_ANALYSIS_TOOL_NAME, input: fullToolInput() },
    ],
    stop_reason: 'tool_use',
  });

  assert(attempt.result, 'the tool block must be found past any number of other blocks');
});

Deno.test('stop_reason "max_tokens" is a truncation and is NEVER usable, even with a tool block', () => {
  // Echo V1's exact bug, one layer up: thinking tokens count against max_tokens, so a tight ceiling
  // returns a mostly-thinking, cut-off answer. `docs/architecture.md` step 8 binds #44 to treat
  // this as truncation, "never as a usable response" — so we do not even look at the content.
  const attempt = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'max_tokens' }));

  assertEquals(attempt.failure, 'truncated');
  assertEquals(attempt.result, null, 'a truncated response must never be delivered');
  assertEquals(attempt.salvage, null);
});

Deno.test('stop_reason "refusal" is a refusal, not a validation failure', () => {
  const attempt = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'refusal' }));

  assertEquals(attempt.failure, 'refusal');
  assertEquals(attempt.result, null);
});

Deno.test('a tool input that is not an object salvages nothing (and does not throw)', () => {
  for (const input of ['a string', 42, null, [], { pillars: 'not an object' }, { pillars: [] }]) {
    const attempt = readAttempt(toolResponse(input));
    assertEquals(attempt.failure, 'invalid_shape');
    assertEquals(attempt.salvage, null);
  }
});

Deno.test('usage is carried through on every attempt shape', () => {
  const attempt = readAttempt(
    toolResponse(fullToolInput(), {
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 4,
      },
    })
  );

  assertEquals(attempt.usage, {
    input_tokens: 1,
    output_tokens: 2,
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 4,
  });
});

// ---------------------------------------------------------------------------
// 4. The decision table (issue #45).
// ---------------------------------------------------------------------------

/** A malformed response whose first `parsed` pillars survive salvage. */
function partialResponse(parsed: PacePillarId[]): AttemptOutcome {
  const pillars: Record<string, unknown> = {};
  for (const id of PACE_PILLARS) {
    pillars[id] = parsed.includes(id) ? scoredPillar(80, 'good') : { garbage: true };
  }
  // No `overall` at all — so the response cannot validate in full and must go through salvage.
  return readAttempt(toolResponse({ pillars }));
}

Deno.test('decision: a valid attempt wins outright, even if the other attempt was garbage', () => {
  const decision = decideOutcome([
    readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' }),
    readAttempt(toolResponse(fullToolInput())),
  ]);

  assertEquals(decision.kind, 'valid');
});

Deno.test('decision: >=2 pillars parsed -> honest partial (is_fallback = true)', () => {
  const decision = decideOutcome([partialResponse(['posture', 'armSwing'])]);

  assert(decision.kind === 'partial');
  assertEquals(decision.parsedPillars, ['posture', 'armSwing']);
  assertEquals(decision.assessedPillars, ['posture', 'armSwing']);
  assertEquals(decision.result.pillars.cadence.score, null);
  assertEquals(decision.result.pillars.elasticity.score, null);
  assert(isPaceResult(decision.result), 'a partial must still be a structurally valid PaceResult');
});

Deno.test('decision: exactly 1 pillar parsed -> clean failure, quota refunded', () => {
  const decision = decideOutcome([partialResponse(['posture'])]);

  assert(decision.kind === 'failed', 'one pillar is below PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL');
  assertEquals(decision.releaseReason, 'validation_failed');
});

Deno.test('decision: 0 pillars parsed -> clean failure', () => {
  const decision = decideOutcome([readAttempt(toolResponse({ pillars: { posture: 'junk' } }))]);

  assertEquals(decision.kind, 'failed');
});

Deno.test('decision: a "partial" with no pillar actually SCORED is a clean failure, not a delivery', () => {
  // Two pillars parsed, but both honestly not-assessed and the rest unreadable. Settling this would
  // spend a Free user's ONE lifetime analysis on a result carrying zero information. A clean
  // failure refunds the slot instead. (This is a deliberate addition to issue #45's literal table —
  // see decideOutcome's doc comment. Note a response where the model VALIDLY reports all four as
  // not-assessed never reaches here: it validates, and is delivered as a real result.)
  const decision = decideOutcome([
    readAttempt(
      toolResponse({
        pillars: {
          posture: notAssessedPillar('angle'),
          armSwing: notAssessedPillar('angle'),
          cadence: { junk: true },
          elasticity: { junk: true },
        },
      })
    ),
  ]);

  assertEquals(decision.kind, 'failed');
});

Deno.test('decision: the BETTER of two salvages is used, and pillars are never mixed across attempts', () => {
  const weak = partialResponse(['posture', 'armSwing']);
  const strong = partialResponse(['posture', 'armSwing', 'cadence']);

  const decision = decideOutcome([weak, strong]);

  assert(decision.kind === 'partial');
  assertEquals(decision.assessedPillars.length, 3, 'the richer attempt wins');

  // And the reverse order gives the same answer — the choice is by quality, not by recency.
  const reversed = decideOutcome([strong, weak]);
  assert(reversed.kind === 'partial');
  assertEquals(reversed.assessedPillars.length, 3);
});

Deno.test('decision: no attempts at all is a clean failure, never a delivery', () => {
  assertEquals(decideOutcome([]).kind, 'failed');
});

// ---------------------------------------------------------------------------
// 5. release_reason — the string that decides whether a user gets locked out.
// ---------------------------------------------------------------------------

Deno.test('release_reason: two content failures = validation_failed (the farming signal)', () => {
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });
  const junk = readAttempt(toolResponse({ nonsense: true }));

  assertEquals(classifyReleaseReason([prose, junk]), 'validation_failed');
  assertEquals(classifyReleaseReason([prose, prose]), 'validation_failed');
});

Deno.test('release_reason: a truncation anywhere makes it model_error, NOT the user\'s fault', () => {
  const truncated = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'max_tokens' }));
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });

  // A truncation is OUR max_tokens budget being too tight for the thinking the model did. Counting
  // it as a farming signal would tick a free user toward a 24h lockout for something we did — the
  // exact harm issue #6 exists to close.
  assertEquals(classifyReleaseReason([truncated, prose]), 'model_error');
  assertEquals(classifyReleaseReason([prose, truncated]), 'model_error');
  assertEquals(classifyReleaseReason([truncated, truncated]), 'model_error');
});

Deno.test('release_reason: a refusal is model_error', () => {
  const refusal = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'refusal' }));

  assertEquals(classifyReleaseReason([refusal, refusal]), 'model_error');
});

Deno.test('release_reason: a call that never returned is model_error', () => {
  assertEquals(classifyReleaseReason([callFailedAttempt(), callFailedAttempt()]), 'model_error');
  assertEquals(classifyReleaseReason([]), 'model_error', 'no evidence is never a farming signal');
});

Deno.test('release_reason: only validation_failed is a farming signal, per the live CHECK constraint', () => {
  // `analyses_release_reason_known_values` permits exactly these four, and
  // `pace_is_farming_signal()` returns true for exactly one of them
  // (20260712220000_anti_farm_release_reason_fix.sql). Anything this module emits that is not in
  // this set would be rejected by Postgres at release time — turning a clean failure into a
  // stranded 'reserved' row that eats a quota slot forever.
  const permitted = ['model_error', 'provider_timeout', 'internal_error', 'validation_failed'];
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });

  for (const attempts of [[prose, prose], [callFailedAttempt()], []]) {
    assert(permitted.includes(classifyReleaseReason(attempts)));
  }
});

// ---------------------------------------------------------------------------
// 6. Band arithmetic, and parity with the certified rubric the MODEL was given.
// ---------------------------------------------------------------------------

Deno.test('bandForScore agrees with analyze-form-prompt.ts\'s SCORE_BAND_RUBRIC at every integer 0-100', () => {
  // The bands exist in three places (theme.ts for colour, SCORE_BAND_RUBRIC as prose for the
  // prompt, BAND_FLOORS as numbers here). This test is what makes that survivable: if anyone edits
  // the certified rubric's ranges without editing this module's floors, it fails here rather than
  // shipping a result whose bar is the wrong colour.
  const ranges = SCORE_BAND_VALUES.map((band) => {
    const [min, max] = SCORE_BAND_RUBRIC[band].range.split('-').map(Number);
    return { band, min, max };
  });

  for (let score = 0; score <= 100; score += 1) {
    const expected = ranges.find((r) => score >= r.min && score <= r.max);
    assert(expected, `SCORE_BAND_RUBRIC has no band covering ${score}`);
    assertEquals(bandForScore(score), expected.band, `score ${score}`);
  }
});

Deno.test('bandForScore throws rather than silently clamping an impossible score', () => {
  assertThrows(() => bandForScore(101), RangeError);
  assertThrows(() => bandForScore(-1), RangeError);
  assertThrows(() => bandForScore(Number.NaN), RangeError);
});

Deno.test('deriveOverall rounds the mean of the scored pillars only', () => {
  const pillar = (score: number | null): PacePillarResult => ({
    score,
    band: score === null ? null : bandForScore(score),
    feedback: null,
    flags: [],
    drills: [],
  });

  // 80 + 71 = 151 / 2 = 75.5 -> 76 ("good"), and the two null pillars are simply absent from the
  // average rather than dragging it to 38.
  assertEquals(
    deriveOverall({
      posture: pillar(80),
      armSwing: pillar(71),
      cadence: pillar(null),
      elasticity: pillar(null),
    }),
    { score: 76, band: 'good' }
  );
});
