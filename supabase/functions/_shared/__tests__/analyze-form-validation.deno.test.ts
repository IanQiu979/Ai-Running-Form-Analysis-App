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
import {
  PACE_ANALYSIS_TOOL,
  PACE_ANALYSIS_TOOL_NAME,
  PACE_OUTPUT_FORMAT,
  PACE_RESULT_SCHEMA,
  SCORE_BAND_RUBRIC,
} from '../analyze-form-prompt.ts';
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
    safety: { signal: 'none', note: '' },
    flags: [],
    drills: [],
  };
}

function notAssessedPillar(reason: string): Record<string, unknown> {
  return {
    score: null,
    band: null,
    feedback: 'Needs a video.',
    notAssessedReason: reason,
    safety: { signal: 'none', note: '' },
    flags: [],
    drills: [],
  };
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

Deno.test('never fabricates: an unreadable pillar assessment comes back null, not 75', () => {
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = {
    safety: { signal: 'none', note: '' },
  };

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.result, null, 'a response missing a pillar assessment must not validate in full');
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
  (input.pillars as Record<string, unknown>).cadence = {
    totally: 'malformed',
    safety: { signal: 'none', note: '' },
  };

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
    safety: { signal: 'none', note: '' },
    flags: [],
    drills: [],
  };
  assertEquals(readAttempt(toolResponse(scoreNoBand)).salvage?.result.pillars.posture.score, null);

  const bandNoScore = fullToolInput();
  (bandNoScore.pillars as Record<string, unknown>).posture = {
    score: null,
    band: 'good',
    feedback: 'x',
    safety: { signal: 'none', note: '' },
    flags: [],
    drills: [],
  };
  assertEquals(readAttempt(toolResponse(bandNoScore)).salvage?.result.pillars.posture.score, null);
});

Deno.test('never fabricates: not-assessed pillars are NOT counted as zeros in the derived overall', () => {
  // The prompt forbids the model from counting a not-assessed pillar as a zero ("that would
  // silently punish the runner for a camera angle"). The fallback path must not do it either.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = { junk: true, safety: { signal: 'none', note: '' } };
  (input.pillars as Record<string, unknown>).elasticity = { junk: true, safety: { signal: 'none', note: '' } };
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

  const decision = decideOutcome([readAttempt(toolResponse(input))], false);

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
    safety: { signal: 'none', note: '' },
    flags: [{ pattern: 'A pattern not in injury_flags.md', detail: 'prose' }],
    drills: [{ name: 'A drill not in drills.md', instructions: 'prose' }],
  };

  assert(readAttempt(toolResponse(input)).result, 'grounding is a prompt problem, not a type problem');
});

// ---------------------------------------------------------------------------
// 2b. STRUCTURED OUTPUTS — the response is now a JSON text block, not a tool call.
// ---------------------------------------------------------------------------

/** The structured-outputs response envelope: the answer IS the text, grammar-constrained to
 * `PACE_RESULT_SCHEMA`. Thinking blocks (empty-bodied on Sonnet 5, whose `display` defaults to
 * `"omitted"`) sit in front of it. */
function structuredResponse(
  payload: unknown,
  overrides: Partial<AnthropicMessageResponse> = {}
): AnthropicMessageResponse {
  return {
    content: [
      { type: 'thinking' },
      { type: 'text', text: JSON.stringify(payload) },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 25_000, output_tokens: 1_200 },
    ...overrides,
  };
}

Deno.test('structured outputs: a JSON text block validates exactly like a tool call did', () => {
  const attempt = readAttempt(structuredResponse(fullToolInput()));

  assert(attempt.result, 'the schema-constrained response text IS the result');
  assertEquals(attempt.failure, null);
  assertEquals(attempt.result.pillars.posture.score, 80);
  assertEquals(attempt.result.overall.score, 76);
});

Deno.test('structured outputs: a malformed JSON payload still salvages its readable pillars', () => {
  // The schema makes this rare, NOT impossible — `stop_reason: refusal` and `max_tokens` both
  // explicitly "may not match your schema", and numerical constraints (score 0-100) are not even in
  // the supported JSON Schema subset. #45's fallback path is not dead code.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = { garbage: true, safety: { signal: 'none', note: '' } };
  delete input.overall;

  const attempt = readAttempt(structuredResponse(input));

  assertEquals(attempt.failure, 'invalid_shape');
  assertEquals(attempt.salvage?.parsedPillars.length, 3);
  assertEquals(attempt.salvage?.result.pillars.cadence.score, null);
});

Deno.test('structured outputs: an out-of-range score is caught in CODE, since the schema cannot express it', () => {
  // `minimum`/`maximum` are NOT in Anthropic's supported JSON Schema subset. The schema guarantees
  // the SHAPE (integer or null); `isPaceResult` guarantees the RANGE. This test is the proof that
  // the runtime check still earns its place now that a schema is enforcing the rest.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).posture = scoredPillar(140, 'strong');

  const attempt = readAttempt(structuredResponse(input));

  assertEquals(attempt.result, null, 'a schema-valid but out-of-range score must not be delivered');
  assertEquals(attempt.salvage?.result.pillars.posture.score, null);
});

Deno.test('structured outputs: a markdown fence around the JSON is tolerated, not rejected', () => {
  const attempt = readAttempt({
    content: [{ type: 'text', text: '```json\n' + JSON.stringify(fullToolInput()) + '\n```' }],
    stop_reason: 'end_turn',
  });

  assert(attempt.result, 'throwing away a perfect analysis over a code fence would be absurd');
});

Deno.test('structured outputs: a prose reply is still a content failure, not a crash', () => {
  const attempt = readAttempt({
    content: [{ type: 'text', text: 'Sure! Your running form looks great.' }],
    stop_reason: 'end_turn',
  });

  assertEquals(attempt.failure, 'no_tool_use');
  assertEquals(attempt.salvage, null);
});

Deno.test('structured outputs: an empty (thinking-only) response is a content failure', () => {
  const attempt = readAttempt({
    content: [{ type: 'thinking' }, { type: 'text', text: '' }],
    stop_reason: 'end_turn',
  });

  assertEquals(attempt.failure, 'no_tool_use');
});

Deno.test('structured outputs: a truncated JSON response is a truncation, never salvaged', () => {
  const attempt = readAttempt({
    content: [{ type: 'text', text: '{"pillars":{"posture":{"score":80,' }],
    stop_reason: 'max_tokens',
  });

  assertEquals(attempt.failure, 'truncated');
  assertEquals(attempt.result, null);
});

Deno.test('the schema and the TypeScript type cannot drift: one shape, two carriers', () => {
  // `output_config.format.schema` and `PACE_ANALYSIS_TOOL.input_schema` must be the SAME object
  // (`PACE_RESULT_SCHEMA`), and that object must describe exactly `PaceResult` from pace.ts. If
  // anyone adds a pillar to the type, or a band to the enum, without touching the schema — or vice
  // versa — this fails.
  assertEquals(
    PACE_OUTPUT_FORMAT.schema,
    PACE_ANALYSIS_TOOL.input_schema,
    'the two carriers must share one schema object, never two copies'
  );

  const schema = PACE_RESULT_SCHEMA as {
    required: string[];
    properties: {
      pillars: { required: string[]; properties: Record<string, {
        required: string[];
        properties: { band: { anyOf: [{ enum: string[] }, unknown] } };
      }> };
      overall: { required: string[] };
    };
  };

  // HARDCODED LITERALS on purpose. Comparing the schema against `[...PACE_PILLARS]` /
  // `[...SCORE_BAND_VALUES]` would be circular — the schema is BUILT from those constants, so the
  // two sides move together and detect nothing. Pinning the expectation to literals means ANY
  // change to `PacePillarId`/`ScoreBand` (via those constants) forces a human to update this test
  // and re-confirm that the schema, the tool input, and the TypeScript type still agree.
  assertEquals(schema.required.sort(), ['overall', 'pillars']);
  assertEquals(schema.properties.pillars.required.sort(), ['armSwing', 'cadence', 'elasticity', 'posture']);
  assertEquals(
    Object.keys(schema.properties.pillars.properties).sort(),
    ['armSwing', 'cadence', 'elasticity', 'posture']
  );
  assertEquals(schema.properties.overall.required.sort(), ['band', 'score']);

  for (const id of ['armSwing', 'cadence', 'elasticity', 'posture'] as const) {
    const pillar = schema.properties.pillars.properties[id];
    assertEquals(
      pillar.required.sort(),
      ['band', 'drills', 'feedback', 'flags', 'safety', 'score'],
      `pillar ${id}'s required keys drifted from PacePillarResult`
    );
    assertEquals(
      pillar.properties.band.anyOf[0].enum.sort(),
      ['good', 'low', 'mid', 'strong'],
      `pillar ${id}'s band enum drifted from ScoreBand`
    );
  }

  // And the round trip: a canonical valid PaceResult must satisfy the schema's own required keys.
  const canonical = readAttempt(structuredResponse(fullToolInput())).result;
  assert(canonical, 'the fixture the schema describes must itself be a valid PaceResult');
  assertEquals(Object.keys(canonical.pillars).sort(), [...PACE_PILLARS].sort());
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

Deno.test('an unusable safety declaration is a provider/model failure, never generic invalid_shape', () => {
  const cases: Array<[string, unknown, boolean]> = [
    ['absent', undefined, true],
    ['null', null, false],
    ['malformed', 'she is limping', false],
    ['uncertified signal', { signal: 'runnersKnee', note: 'Stop running.' }, false],
    ['blank note', { signal: 'swellingLimpOrFavouringOneSide', note: '   ' }, false],
  ];

  for (const [label, safety, omit] of cases) {
    const input = fullToolInput();
    const posture = (input.pillars as Record<string, Record<string, unknown>>).posture;
    if (omit) {
      delete posture.safety;
    } else {
      posture.safety = safety;
    }

    const attempt = readAttempt(toolResponse(input));

    assertEquals(attempt.failure, 'invalid_safety', label);
    assertEquals(attempt.result, null, label);
    assertEquals(attempt.salvage, null, `${label}: fail closed rather than dropping a warning`);
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
    pillars[id] = parsed.includes(id) ? scoredPillar(80, 'good') : { garbage: true, safety: { signal: 'none', note: '' } };
  }
  // No `overall` at all — so the response cannot validate in full and must go through salvage.
  return readAttempt(toolResponse({ pillars }));
}

Deno.test('decision: a valid attempt wins outright, even if the other attempt was garbage', () => {
  const decision = decideOutcome(
    [
      readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' }),
      readAttempt(toolResponse(fullToolInput())),
    ],
    true
  );

  assertEquals(decision.kind, 'valid');
});

Deno.test('decision: >=2 pillars parsed -> honest partial (is_fallback = true)', () => {
  // retryRan does not affect a partial (a delivered result is judged on content, not attempt count).
  const decision = decideOutcome([partialResponse(['posture', 'armSwing'])], false);

  assert(decision.kind === 'partial');
  assertEquals(decision.parsedPillars, ['posture', 'armSwing']);
  assertEquals(decision.assessedPillars, ['posture', 'armSwing']);
  assertEquals(decision.result.pillars.cadence.score, null);
  assertEquals(decision.result.pillars.elasticity.score, null);
  assert(isPaceResult(decision.result), 'a partial must still be a structurally valid PaceResult');
});

Deno.test('decision: exactly 1 pillar parsed after a REAL retry -> clean failure, validation_failed', () => {
  // Both attempts came back with content but only one readable pillar each — below the 2-pillar
  // partial threshold, and the retry genuinely ran, so this is the farming-signal case.
  const decision = decideOutcome([partialResponse(['posture']), partialResponse(['posture'])], true);

  assert(decision.kind === 'failed', 'one pillar is below PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL');
  assertEquals(decision.releaseReason, 'validation_failed');
});

Deno.test('decision: 0 pillars parsed -> clean failure', () => {
  const decision = decideOutcome(
    [readAttempt(toolResponse({ pillars: { posture: 'junk' } }))],
    false
  );

  assertEquals(decision.kind, 'failed');
});

Deno.test('decision: a "partial" with no pillar actually SCORED is a clean failure, not a delivery', () => {
  // Two pillars parsed, but both honestly not-assessed and the rest unreadable. Settling this would
  // spend a Free user's ONE lifetime analysis on a result carrying zero information. A clean
  // failure refunds the slot instead. (This is a deliberate addition to issue #45's literal table —
  // see decideOutcome's doc comment. Note a response where the model VALIDLY reports all four as
  // not-assessed never reaches here: it validates, and is delivered as a real result.)
  const decision = decideOutcome(
    [
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
    ],
    false
  );

  assertEquals(decision.kind, 'failed');
});

Deno.test('decision: the BETTER of two salvages is used, and pillars are never mixed across attempts', () => {
  const weak = partialResponse(['posture', 'armSwing']);
  const strong = partialResponse(['posture', 'armSwing', 'cadence']);

  const decision = decideOutcome([weak, strong], true);

  assert(decision.kind === 'partial');
  assertEquals(decision.assessedPillars.length, 3, 'the richer attempt wins');

  // And the reverse order gives the same answer — the choice is by quality, not by recency.
  const reversed = decideOutcome([strong, weak], true);
  assert(reversed.kind === 'partial');
  assertEquals(reversed.assessedPillars.length, 3);
});

Deno.test('decision: no attempts at all is a clean failure, never a delivery', () => {
  assertEquals(decideOutcome([], false).kind, 'failed');
});

// ---------------------------------------------------------------------------
// 5. release_reason — the string that decides whether a user gets locked out.
// ---------------------------------------------------------------------------

Deno.test('release_reason: two content failures AFTER A REAL RETRY = validation_failed (the farming signal)', () => {
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });
  const junk = readAttempt(toolResponse({ nonsense: true }));

  assertEquals(classifyReleaseReason([prose, junk], true), 'validation_failed');
  assertEquals(classifyReleaseReason([prose, prose], true), 'validation_failed');
});

Deno.test('release_reason: a failure of OUR safety contract gets its own non-farming reason', () => {
  // Review r4-4. Our own added requirement not being honoured is neither the user farming
  // (`validation_failed`, the sole reason `pace_is_farming_signal` counts) nor the Anthropic call
  // erroring (`model_error`) — the call returned a perfectly good response. It gets its own reason.
  const withoutSafety = fullToolInput();
  delete ((withoutSafety.pillars as Record<string, Record<string, unknown>>).posture).safety;
  const omission = readAttempt(toolResponse(withoutSafety));
  const noPayload = readAttempt({ content: [{ type: 'thinking' }], stop_reason: 'end_turn' });
  const junk = readAttempt(toolResponse({ nonsense: true }));

  assertEquals(omission.failure, 'invalid_safety');
  assertEquals(classifyReleaseReason([omission, omission], true), 'invalid_safety');
  assertEquals(
    classifyReleaseReason([noPayload, omission], true),
    'invalid_safety',
    'one safety-contract omission makes the whole failure ours, not a farming strike'
  );
  assertEquals(
    classifyReleaseReason([junk, omission], true),
    'invalid_safety',
    'a safety-contract omission outranks a content failure — it must never become a strike'
  );
});

Deno.test('a MISSING pillar is ordinary schema drift, not a safety failure', () => {
  // Review r5-2. Before this scoping, any absent pillar was re-labelled `invalid_safety`, which
  // pulled ordinary schema drift out of the anti-farming signal entirely. A pillar that is not
  // there declared nothing about the runner — there is no warning it could have dropped.
  for (const missing of [undefined, null, 'cadence went walkabout', 42]) {
    const input = fullToolInput();
    const pillars = input.pillars as Record<string, unknown>;
    if (missing === undefined) {
      delete pillars.cadence;
    } else {
      pillars.cadence = missing;
    }

    const attempt = readAttempt(toolResponse(input));

    assertEquals(attempt.failure, 'invalid_shape', String(missing));
    assertEquals(
      classifyReleaseReason([attempt, attempt], true),
      'validation_failed',
      `${String(missing)}: schema drift after a real retry stays the farming signal it always was`
    );
  }
});

Deno.test('a MISSING pillar does not abort the honest-partial salvage of the readable ones', () => {
  // Review r5-3. The #45 fallback has to survive real model output, where the pillar that failed
  // is simply absent rather than carrying a well-formed `{signal: 'none', note: ''}` block.
  const input = fullToolInput();
  const pillars = input.pillars as Record<string, unknown>;
  delete pillars.cadence;
  pillars.elasticity = {};

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.failure, 'invalid_shape');
  const salvage = attempt.salvage;
  if (!salvage) {
    throw new Error('an absent pillar must not abort the salvage of the readable ones');
  }
  assertEquals(salvage.parsedPillars.sort(), ['armSwing', 'posture']);
  assertEquals(salvage.result.pillars.cadence.score, null);
  assertEquals(salvage.result.pillars.elasticity.score, null);
  assertEquals(salvage.result.pillars.posture.score, 80);
});

Deno.test('a PRESENT pillar that declared something but no usable safety still fails closed', () => {
  // The other half of r5-2/r5-3: narrowing must not reopen the hole the captain closed. A pillar
  // that asserted a score/prose about the runner, with no usable declaration, is still invalid.
  const input = fullToolInput();
  const pillars = input.pillars as Record<string, Record<string, unknown>>;
  delete pillars.cadence.safety;
  pillars.cadence.score = 'not a number';

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.failure, 'invalid_safety');
  assertEquals(attempt.salvage, null);
});

Deno.test('an off-contract pillar carrying REAL PROSE is a declaration, not an empty slot', () => {
  // Review r6-3. The old rule asked "does this pillar carry one of the six schema key names?", so
  // a pillar that wrote a real sentence under a key the schema never named counted as an empty
  // slot: its safety obligation vanished, and `salvagePillars` replaced the whole thing with the
  // all-null dropped constant — discarding prose that could have been a warning while the other
  // three pillars were delivered as an honest partial. Presence of substantive TEXT now decides
  // it, structurally: no keywords are read and no meaning is judged.
  const input = fullToolInput();
  const pillars = input.pillars as Record<string, unknown>;
  pillars.cadence = {
    summary: 'The left leg cannot take even weight and she is guarding it — see someone before your next run.',
  };

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.failure, 'invalid_safety', 'a declaration with no usable safety fails closed');
  assertEquals(attempt.salvage, null, 'and it is never salvaged around');
  assertEquals(
    classifyReleaseReason([attempt, attempt], true),
    'invalid_safety',
    'our own contract failing is our fault, and is released uncharged rather than counted as farming'
  );
});

Deno.test('a pillar with no substantive text anywhere stays ordinary schema drift', () => {
  // The other half of r6-3, and the r4-1 ruling it must not overturn. `{garbage: true}`, empty
  // strings, nulls and short schema-shaped tokens assert nothing a runner could be harmed by
  // missing, so they stay `invalid_shape` — the anti-farming signal — and salvage away.
  const meaningless: unknown[] = [
    { garbage: true },
    { note: '   ' },
    { summary: '', detail: null },
    { status: 'ok' },
  ];

  for (const candidate of meaningless) {
    const input = fullToolInput();
    (input.pillars as Record<string, unknown>).cadence = candidate;

    const attempt = readAttempt(toolResponse(input));

    assertEquals(attempt.failure, 'invalid_shape', JSON.stringify(candidate));
    assertEquals(
      classifyReleaseReason([attempt, attempt], true),
      'validation_failed',
      `${JSON.stringify(candidate)}: schema drift after a real retry stays the farming signal`
    );
    const salvage = attempt.salvage;
    if (!salvage) {
      throw new Error(`${JSON.stringify(candidate)}: an empty slot must not abort the salvage`);
    }
    assertEquals(salvage.result.pillars.cadence.score, null);
    assertEquals(salvage.result.pillars.posture.score, 80);
  }
});

Deno.test('substantive text is found at DEPTH, not only on the pillar\'s own keys', () => {
  // The check is recursive on purpose: a model that wraps its prose one level down
  // (`{observations: {left: '...'}}`) has still declared something about the runner.
  const input = fullToolInput();
  (input.pillars as Record<string, unknown>).cadence = {
    observations: { left: 'She is favouring that side through every contact in this clip.' },
  };

  const attempt = readAttempt(toolResponse(input));

  assertEquals(attempt.failure, 'invalid_safety');
  assertEquals(attempt.salvage, null);
});

Deno.test('release_reason: a LONE content failure with the retry SUPPRESSED is model_error, not a strike', () => {
  // THE FINDING-1 CASE. When #44's flow suppresses the retry — too little deadline left, or the
  // retry's spend gate denied it (daily cap / open breaker) — only one attempt exists. A prose
  // reply there is OUR degradation, not the user's attack: charging it as validation_failed would
  // tick the 3-strike anti-farming cap for something we did, and three such in 24h locks a Free
  // user out of their one lifetime analysis (issue #6). `retryRan: false` => model_error.
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });
  const junk = readAttempt(toolResponse({ nonsense: true }));

  assertEquals(classifyReleaseReason([prose], false), 'model_error');
  assertEquals(classifyReleaseReason([junk], false), 'model_error');
});

Deno.test('release_reason: a truncation anywhere makes it model_error, NOT the user\'s fault', () => {
  const truncated = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'max_tokens' }));
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });

  // A truncation is OUR max_tokens budget being too tight for the thinking the model did. Counting
  // it as a farming signal would tick a free user toward a 24h lockout for something we did — the
  // exact harm issue #6 exists to close. (retryRan is true here — it is the KIND of failure, not
  // the retry, that disqualifies these from the farming signal.)
  assertEquals(classifyReleaseReason([truncated, prose], true), 'model_error');
  assertEquals(classifyReleaseReason([prose, truncated], true), 'model_error');
  assertEquals(classifyReleaseReason([truncated, truncated], true), 'model_error');
});

Deno.test('release_reason: a refusal is model_error', () => {
  const refusal = readAttempt(toolResponse(fullToolInput(), { stop_reason: 'refusal' }));

  assertEquals(classifyReleaseReason([refusal, refusal], true), 'model_error');
});

Deno.test('release_reason: a call that never returned is model_error', () => {
  assertEquals(classifyReleaseReason([callFailedAttempt(), callFailedAttempt()], true), 'model_error');
  assertEquals(classifyReleaseReason([], false), 'model_error', 'no evidence is never a farming signal');
});

Deno.test('release_reason: only validation_failed is a farming signal, per the live CHECK constraint', () => {
  // `analyses_release_reason_known_values` permits exactly these four, and
  // `pace_is_farming_signal()` returns true for exactly one of them
  // (20260712220000_anti_farm_release_reason_fix.sql). Anything this module emits that is not in
  // this set would be rejected by Postgres at release time — turning a clean failure into a
  // stranded 'reserved' row that eats a quota slot forever.
  const permitted = ['model_error', 'provider_timeout', 'internal_error', 'validation_failed'];
  const prose = readAttempt({ content: [{ type: 'text' }], stop_reason: 'end_turn' });

  const cases: Array<[AttemptOutcome[], boolean]> = [
    [[prose, prose], true],
    [[prose], false],
    [[callFailedAttempt()], false],
    [[], false],
  ];
  for (const [attempts, retryRan] of cases) {
    assert(permitted.includes(classifyReleaseReason(attempts, retryRan)));
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
