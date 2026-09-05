/**
 * Tests for the grounded `analyze-form` prompt (issue #41).
 *
 * These are the tests that stand in for a live model call. Ian's Anthropic credits are a hard
 * ceiling, and #41's whole job is to be RIGHT BEFORE the first call is ever made — so everything
 * checkable without the API is checked here: the knowledge is really in the prompt, the tier dial
 * moves depth and only depth, the not-assessed path is instructed, the medical boundary is
 * unconditional, the #112 timestamp hedging is present at every tier, and a response shaped to
 * the tool schema really does satisfy `isPaceResult`. What is left for a live call (#42's
 * grounding harness, #44/#45's integration) is whether the model OBEYS — not whether we asked.
 *
 * DENO-ONLY (`.deno.test.ts`, excluded from Jest by `jest.config.js`'s `testPathIgnorePatterns`):
 * the module imports `knowledge.generated.ts`, whose `.ts`-suffixed relative import is Deno's
 * resolution style, and it is edge-only code the app never bundles.
 *
 * Importing this file at all is itself the first assertion: `knowledge.generated.ts` runs
 * `assertNonEmptyKnowledge()` at module load, so an empty knowledge bundle fails the suite before
 * a single test body executes.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import {
  ANALYZE_FORM_EFFORT,
  ANALYZE_FORM_MODEL,
  PACE_ANALYSIS_TOOL,
  PACE_ANALYSIS_TOOL_NAME,
  SCORE_BAND_RUBRIC,
  TIER_VERBOSITY,
  buildAnalyzeFormRequest,
  buildSystemPrompt,
  buildUserContent,
  formatFrameManifest,
} from '../analyze-form-prompt.ts';
import type {
  AnalyzeFormPromptInput,
  BuildRequestOptions,
  PaceFrame,
} from '../analyze-form-prompt.ts';
import { DRILLS_MD, INJURY_FLAGS_MD, PACE_FRAMEWORK_MD } from '../knowledge.generated.ts';
import { MAX_OUTPUT_TOKENS_BY_TIER, SYSTEM_PROMPT_TOKENS_ESTIMATE } from '../ai-pricing.ts';
import { PACE_FRAME_CAP, PACE_PILLARS, SCORE_BAND_VALUES, isPaceResult } from '../pace.ts';
import type { PacePillarResult, PaceResult, PaceTier } from '../pace.ts';

// -------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------

const TIERS: readonly PaceTier[] = ['free', 'pro', 'elite'];

function frame(requestedTimestampMs: number): PaceFrame {
  return { base64: 'ZmFrZS1qcGVn', mediaType: 'image/jpeg', requestedTimestampMs };
}

/**
 * A genuine stride burst — frames spanning `MAX_STRIDE_BURST_SPAN_MS`'s (900ms) safe zone,
 * matching what `lib/frames.ts`'s post-#199 `sampleTimestamps` actually produces (a ~700ms window).
 * `videoInput` uses this by default so every test exercising some OTHER property of the video
 * prompt (tier depth, medical boundary, flag naming, ...) keeps getting the full four-pillar
 * `STRIDE_BURST_VIDEO_RULES` text it was written against. Tests of the burst/legacy classification
 * itself use `legacySparseVideoInput` below instead.
 */
function burstFrames(frameCount: number): PaceFrame[] {
  if (frameCount <= 1) {
    return Array.from({ length: Math.max(frameCount, 0) }, () => frame(0));
  }
  const step = 700 / (frameCount - 1);
  return Array.from({ length: frameCount }, (_, i) => frame(Math.round(i * step)));
}

function videoInput(tier: PaceTier, frameCount = 5): AnalyzeFormPromptInput {
  return {
    tier,
    media: 'video',
    frames: burstFrames(frameCount),
  };
}

/**
 * Frames spread across a whole clip the way the pre-#199 sampler used to (1.3-2.2s apart) — wide
 * enough that `isStrideBurst` must classify them as LEGACY/SPARSE. Exists so the classification
 * itself, and `LEGACY_SPARSE_VIDEO_RULES`'s forced not-assessed treatment of Cadence/Elasticity,
 * has dedicated coverage independent of every other video-prompt test's default burst input.
 */
function legacySparseVideoInput(tier: PaceTier, frameCount = 5): AnalyzeFormPromptInput {
  return {
    tier,
    media: 'video',
    frames: Array.from({ length: frameCount }, (_, i) => frame(i * 1_600)),
  };
}

function photoInput(tier: PaceTier): AnalyzeFormPromptInput {
  return { tier, media: 'photo', frames: [frame(0)] };
}

/** The whole prompt as one string — system + every text block of the user turn. This is what the
 * model actually reads (minus the images), so it is what the assertions below search. */
function fullPromptText(input: AnalyzeFormPromptInput): string {
  const system = buildSystemPrompt(input)
    .map((b) => b.text)
    .join('\n');
  const user = buildUserContent(input)
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  return `${system}\n${user}`;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

/** Collapse every whitespace run to a single space. The prompt is hard-wrapped for readability,
 * so a rule like "...that is not enough to call the fault" spans a line break in the source. The
 * MODEL does not care where the newlines are, and neither should these assertions — otherwise
 * re-wrapping a paragraph breaks a test that has nothing to do with wrapping. */
function norm(text: string): string {
  return text.replace(/\s+/g, ' ');
}

function assertIncludes(haystack: string, needle: string, message: string): void {
  assert(norm(haystack).includes(norm(needle)), `${message}\n  Missing: ${JSON.stringify(needle)}`);
}

/**
 * Walk only the SCHEMA nodes of a JSON Schema tree — the root, each value of a `properties` map,
 * each `items`, and each `anyOf` branch.
 *
 * Deliberately does NOT treat a `properties` map itself as a schema node: `PaceInjuryFlag` has a
 * field literally named `pattern`, and a naive walk would see that key and "discover" the
 * unsupported JSON-Schema `pattern` keyword. A property NAME is not a schema KEYWORD.
 */
function walkSchema(node: unknown, visit: (schema: Record<string, unknown>) => void): void {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return;

  const schema = node as Record<string, unknown>;
  visit(schema);

  const properties = schema.properties;
  if (typeof properties === 'object' && properties !== null) {
    for (const child of Object.values(properties as Record<string, unknown>)) {
      walkSchema(child, visit);
    }
  }
  walkSchema(schema.items, visit);
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) walkSchema(branch, visit);
  }
}

// -------------------------------------------------------------------------------------------
// 1. GROUNDING — the certified knowledge is really in the prompt, not silently empty
// -------------------------------------------------------------------------------------------

Deno.test('the assembled system prompt carries all three certified documents VERBATIM', () => {
  const system = buildSystemPrompt(videoInput('pro'))
    .map((b) => b.text)
    .join('\n');

  // Not "contains an anchor phrase" — the ENTIRE file, byte for byte. A truncating or escaping
  // bug in the bundle or in assembly would pass an anchor check and fail this one.
  assertIncludes(system, PACE_FRAMEWORK_MD, 'pace_framework.md is not present verbatim.');
  assertIncludes(system, INJURY_FLAGS_MD, 'injury_flags.md is not present verbatim.');
  assertIncludes(system, DRILLS_MD, 'drills.md is not present verbatim.');
});

Deno.test('the knowledge in the prompt is substantive, not a degenerate non-empty string', () => {
  const system = buildSystemPrompt(videoInput('pro'))
    .map((b) => b.text)
    .join('\n');

  // The guard in knowledge-guard.ts only rejects empty/whitespace. A bundle that regressed to a
  // single stray character would pass it — and produce confident, ungrounded advice. Anchor on
  // real load-bearing content from each file instead.
  assertIncludes(
    system,
    'The four hard rules for the analyzer',
    'The four hard rules are missing from the prompt.'
  );
  assertIncludes(system, 'Never fabricate a number', 'The never-fabricate rule is missing.');
  assertIncludes(system, 'Overstriding', 'The overstriding flag is missing from the prompt.');
  assertIncludes(system, 'Pogo Hops', 'The drills library is missing from the prompt.');
  assert(
    system.length > 20_000,
    `The system prompt is suspiciously short (${system.length} chars) — the certified knowledge is ~25KB. ` +
      'A short prompt here is exactly what an empty/partial knowledge bundle looks like.'
  );
});

Deno.test('every band in SCORE_BAND_RUBRIC is grounded in the certified framework text', () => {
  // Guards the one translation this file has to make on its own: the certified rubric speaks in
  // labels ("Solid"), the ScoreBand enum speaks in codes ("good"). If a label here drifts from
  // the certified text, the model is being handed a mapping to a band that does not exist.
  for (const band of SCORE_BAND_VALUES) {
    const rubric = SCORE_BAND_RUBRIC[band];
    assert(rubric !== undefined, `SCORE_BAND_RUBRIC has no entry for the band "${band}".`);
    assertIncludes(
      PACE_FRAMEWORK_MD,
      rubric.label,
      `Band "${band}" claims the label "${rubric.label}", which does not appear in pace_framework.md.`
    );
  }
  assert(
    Object.keys(SCORE_BAND_RUBRIC).length === SCORE_BAND_VALUES.length,
    'SCORE_BAND_RUBRIC and SCORE_BAND_VALUES have drifted apart.'
  );
});

// -------------------------------------------------------------------------------------------
// 2. THE TIER DIAL — one prompt, one parameter: it moves DEPTH and only depth
// -------------------------------------------------------------------------------------------

Deno.test('the tier dial changes the prompt (one prompt, one parameter — not three prompts)', () => {
  const [free, pro, elite] = TIERS.map((tier) => fullPromptText(videoInput(tier)));

  assert(free !== pro && pro !== elite, 'The tier dial produced identical prompts.');

  // Free: no flags, no drills.
  assertIncludes(free, 'TIER: FREE', 'Free prompt does not identify its tier.');
  assertIncludes(free, 'ONE sentence per pillar', 'Free is missing its one-line-per-pillar rule.');
  assert(
    free.includes('`drills`: ALWAYS the empty array'),
    'Free must be told drills are paid-tier content and to emit [].'
  );

  // Pro: flags + drills.
  assertIncludes(pro, 'TIER: PRO', 'Pro prompt does not identify its tier.');
  assertIncludes(pro, '2-4 sentences per pillar', 'Pro is missing its feedback depth.');
  assertIncludes(pro, '1-2 drills from drills.md', 'Pro is missing its drill prescription rule.');

  // Elite: Pro + a small depth bump, explicitly not more certainty.
  assertIncludes(elite, 'TIER: ELITE', 'Elite prompt does not identify its tier.');
  assertIncludes(elite, '3-5 sentences per pillar', 'Elite is missing its depth bump.');
  assertIncludes(
    elite,
    'no extra certainty',
    'Elite must be told its bump is depth only, never certainty.'
  );
});

Deno.test('the Pro -> Elite gap is deliberately tiny: more prose, ZERO new entitlements', () => {
  const pro = TIER_VERBOSITY.pro.depth;
  const elite = TIER_VERBOSITY.elite.depth;

  // The product claim (docs/architecture.md: "the Pro->Elite gap is intentionally tiny") is about
  // what the runner GETS, so test that — not a character count, which would pass just as happily
  // if Elite quietly granted itself a new entitlement in a shorter sentence.

  // 1. Elite grants nothing Pro does not have: it defers to Pro's rules for both paid features.
  assertIncludes(elite, '`flags`: same rule as Pro', 'Elite must not widen the flag rules.');
  assertIncludes(elite, '`drills`: same 1-2 per issue as Pro', 'Elite must not grant more drills.');
  assertIncludes(elite, 'no extra certainty', 'Elite must be told the bump is not certainty.');

  // 2. The only difference is a one-sentence bump in feedback depth.
  assertIncludes(pro, '2-4 sentences per pillar', 'Pro depth changed; update this test.');
  assertIncludes(elite, '3-5 sentences per pillar', 'Elite depth changed; update this test.');

  // 3. And a ballooning guard: Elite's instruction stays in the same weight class as Pro's. If a
  //    future edit makes Elite a substantially bigger ask, that is a product change, not a tweak.
  assert(
    elite.length < pro.length * 1.5,
    `Elite's depth instruction (${elite.length} chars) has ballooned past Pro's (${pro.length}). ` +
      'The Pro->Elite gap is supposed to be a small depth bump, not a different product.'
  );
});

Deno.test('THE INVARIANT: the tier dial can never buy certainty — only depth', () => {
  const prompts = TIERS.map((tier) => fullPromptText(videoInput(tier)));

  // Every rule that governs CERTAINTY (as opposed to depth) must appear at every single tier,
  // identically. This is the property that stops "Elite gets more" from ever becoming "Elite gets
  // a confident SPM figure" (issue #112).
  const certaintyRules = [
    // Honest failure.
    'NEVER fabricate a score',
    '`score` and `band` are null TOGETHER or non-null TOGETHER',
    'Assess ONLY what is actually visible',
    // Timestamp approximation (#112).
    'FRAME TIMESTAMPS ARE APPROXIMATE',
    'FORBIDDEN AT EVERY TIER, INCLUDING ELITE',
    'A single precise cadence figure',
    'Any ground-contact-time figure in milliseconds',
    'Any vertical-oscillation figure in centimetres',
    // The #112 amendment to pace_framework.md's timing clauses, and the runner-visible hedge.
    'READ "known" AS "KNOWN APPROXIMATELY"',
    'THESE FRAMES ARE NOT RELIABLY EVENLY SPACED',
    'SAY IT IN THE OUTPUT, NOT JUST IN YOUR HEAD',
    // The medical boundary.
    'SAFETY AND THE MEDICAL BOUNDARY',
    'You are NOT diagnosing',
    'STOP-RUNNING SIGNALS OVERRIDE THE TIER DIAL',
    // The no-note neutralisation.
    "There is NO runner's note",
    // The explicit statement of the invariant itself.
    'Depth is the ONLY thing the tier changes',
    'A paid analysis is longer, not more certain.',
  ];

  for (const [i, prompt] of prompts.entries()) {
    for (const rule of certaintyRules) {
      assertIncludes(
        prompt,
        rule,
        `Tier "${TIERS[i]}" is missing a certainty rule that must be present at EVERY tier.`
      );
    }
  }
});

/**
 * Both of the tests below were forced by the FIRST live grounding-eval run after #42's workflow was
 * armed with an API key (2026-07-25, run 30151889372). It failed two of four cases, and neither
 * failure was a grader bug:
 *
 *   still-pro :: grounded-flags — the model named an arm-swing flag "High, tense-looking arm
 *                                 carriage" for the certified heading "Tense, hiked shoulders /
 *                                 crossing-midline arms". A renamed certified fault.
 *   blank-pro :: four-pillars   — on the deliberately unsupportable blank input, `posture` came
 *                                 back with an EMPTY `feedback` string. It correctly withheld
 *                                 every score; it just said nothing about one of them.
 *
 * Both fixes are prompt-layer, for the same reason issue #40's and #112's were: the certified files
 * ship byte-for-byte under Ian's name and are not editable without his review (#39/#40).
 */
Deno.test('the flag-naming rule reaches every tier — a certified fault may not be renamed', () => {
  const namingRules = [
    "NAMING A FLAG OR A DRILL — USE THE CERTIFIED FILE'S OWN WORDS",
    'copied as written',
    'Do not paraphrase it, do not blend two headings into one',
    'Everything you OBSERVED goes in `detail`, never in `pattern`',
    'If what you see matches NO certified heading, raise no flag at all',
  ];

  for (const tier of TIERS) {
    const prompt = fullPromptText(videoInput(tier));
    for (const rule of namingRules) {
      assertIncludes(
        prompt,
        rule,
        `Tier "${tier}" is missing the flag-naming rule. Grounding is not a paid-tier entitlement.`
      );
    }
  }
});

/**
 * The naming rule teaches by contrast: it quotes one real certified heading as the RIGHT answer and
 * the model's paraphrase as the wrong one. That only teaches anything while the quoted heading is
 * genuinely in the certified file — so assert it byte-for-byte, exactly as § 5 does for the #112
 * timing clauses. If a future certification pass rewords the heading, this fails loudly instead of
 * leaving the prompt citing an example that no longer exists.
 */
Deno.test('the heading the naming rule quotes as correct really exists in injury_flags.md', () => {
  const quoted = 'Tense, hiked shoulders / crossing-midline arms';

  assert(
    INJURY_FLAGS_MD.includes(quoted),
    `The naming rule holds up ${JSON.stringify(quoted)} as the correct label for a certified ` +
      `fault, but that heading is no longer in injury_flags.md. Re-point the example in ` +
      `GROUNDED_NAMING_RULES at the heading's current wording.`
  );

  // ...and the counter-example must NOT be, or the rule would be teaching the wrong lesson.
  assert(
    !INJURY_FLAGS_MD.includes('High, tense-looking arm carriage'),
    'The paraphrase the naming rule cites as WRONG has appeared in the certified file. The ' +
      'example is now backwards and must be rewritten.'
  );
});

Deno.test('`feedback` may never be empty — at any tier, including an all-null result', () => {
  const emptyFeedbackRules = [
    '`feedback` is NEVER an empty string, and never whitespace only, for ANY pillar at ANY tier',
    'a silent pillar renders as a blank space the runner cannot interpret',
    'This holds even when EVERY pillar is not-assessed',
  ];

  // Both media types: the blank-input case that failed was a photo, but an unusable video is just
  // as capable of leaving every pillar null.
  for (const tier of TIERS) {
    for (const input of [videoInput(tier), photoInput(tier)]) {
      const prompt = fullPromptText(input);
      for (const rule of emptyFeedbackRules) {
        assertIncludes(
          prompt,
          rule,
          `Tier "${tier}" (${input.media}) is missing the never-empty-feedback rule.`
        );
      }
    }
  }
});

Deno.test('max_tokens matches the gate\'s OUTPUT reservation — which is what bounds thinking', () => {
  // With thinking ON, thinking tokens are billed as OUTPUT — so the obvious worry is that the
  // spend gate's output reservation now under-counts the same way its input estimate did.
  //
  // It does not, and this equality is exactly why. On Sonnet 5, `max_tokens` is "a hard limit on
  // total output (thinking plus response text)". We send max_tokens = MAX_OUTPUT_TOKENS_BY_TIER,
  // which is the very number `estimateTokensForCall` reserves as `outputTokens`. So billed output
  // <= max_tokens = reserved output, thinking included. The reservation is a true upper bound.
  //
  // If these two ever drift apart, that guarantee silently evaporates. Hence this test.
  for (const tier of TIERS) {
    const request = buildAnalyzeFormRequest(videoInput(tier, 1));
    assert(
      request.max_tokens === MAX_OUTPUT_TOKENS_BY_TIER[tier],
      `max_tokens for "${tier}" is ${request.max_tokens}, but gate_ai_call reserved ` +
        `${MAX_OUTPUT_TOKENS_BY_TIER[tier]} output tokens. Drift here means thinking tokens can be ` +
        'billed beyond what the gate reserved.'
    );
    assert(
      request.max_tokens >= 4000 && request.max_tokens <= 8000,
      `max_tokens for "${tier}" (${request.max_tokens}) is outside docs/architecture.md's 4-8k band.`
    );
  }
});

// -------------------------------------------------------------------------------------------
// 3. THE NOT-ASSESSED PATH — never fabricate a score
// -------------------------------------------------------------------------------------------

Deno.test('a photo is instructed to report Cadence and Elasticity as needsVideo, never a guess', () => {
  for (const tier of TIERS) {
    const prompt = fullPromptText(photoInput(tier));

    assertIncludes(prompt, 'WHAT THE RUNNER SENT: a photo', `Photo medium not declared for tier "${tier}".`);
    assertIncludes(prompt, 'WHAT YOU RECEIVED: ONE FRAME', `Frame count not declared for tier "${tier}".`);
    assertIncludes(
      prompt,
      'You CANNOT assess Cadence or Elasticity from one frame',
      `Photo prompt for "${tier}" does not forbid inferring Cadence/Elasticity.`
    );
    assertIncludes(
      prompt,
      'notAssessedReason:',
      `Photo prompt for "${tier}" does not instruct the needsVideo reason.`
    );
    assertIncludes(
      prompt,
      '"needsVideo"',
      `Photo prompt for "${tier}" does not name the needsVideo reason value.`
    );
    assertIncludes(
      prompt,
      'This is not a failure',
      `Photo prompt for "${tier}" should frame a null score as the correct, honest result.`
    );
  }
});

Deno.test('a video prompt still instructs the not-assessed path (angle can kill any pillar)', () => {
  const prompt = fullPromptText(videoInput('pro'));

  assertIncludes(prompt, 'WHEN YOU CANNOT SEE IT, SAY SO', 'The not-assessed section is missing.');
  assertIncludes(prompt, 'A null score is a correct, expected, honest answer', 'Missing framing.');
  assertIncludes(prompt, '`angle`', 'The angle not-assessed reason is not instructed.');
  assertIncludes(
    prompt,
    'Do not count not-assessed pillars as zeros',
    'The overall average must not punish a runner for a camera angle.'
  );
});

// -------------------------------------------------------------------------------------------
// 4. THE DISCLAIMER / MEDICAL BOUNDARY — unconditional
// -------------------------------------------------------------------------------------------

Deno.test('the medical boundary is unconditional — every tier, both media', () => {
  const inputs: AnalyzeFormPromptInput[] = [
    ...TIERS.map((t) => videoInput(t)),
    ...TIERS.map((t) => photoInput(t)),
  ];

  for (const input of inputs) {
    const prompt = fullPromptText(input);
    const where = `${input.tier}/${input.media}`;

    assertIncludes(prompt, 'You are NOT diagnosing', `Missing the no-diagnosis rule (${where}).`);
    assertIncludes(
      prompt,
      'Never name a condition as present',
      `Missing the never-name-a-condition rule (${where}).`
    );
    assertIncludes(
      prompt,
      'Never prescribe treatment',
      `Missing the no-treatment rule (${where}).`
    );
    // The certified disclaimer text itself is in both knowledge files, and both are in the
    // prompt verbatim — so the model always reads it, at every tier.
    assertIncludes(
      prompt,
      'This is not medical advice.',
      `The certified disclaimer text is not in the prompt (${where}).`
    );
  }
});

Deno.test('the model is told NOT to re-emit the disclaimer (the app renders it on every result)', () => {
  // The shipped disclaimer is a static UI footer (components/result-disclaimer.tsx, #68), which
  // is a stronger guarantee than model output: it cannot be omitted, reworded, or hallucinated.
  // The model's job is the boundary, not the footer — and a model that also writes the footer
  // into `feedback` would double it on screen.
  for (const tier of TIERS) {
    const prompt = fullPromptText(videoInput(tier));
    assertIncludes(
      prompt,
      'Do NOT write the "not medical advice" disclaimer into any field',
      `Tier "${tier}" does not tell the model the app already renders the disclaimer.`
    );
  }
});

Deno.test('stop-running safety signals reach Free, overriding the paid-tier flag gate', () => {
  const free = fullPromptText(videoInput('free'));

  // injury_flags.md: the stop-running language is "shown to ALL tiers". Free's flags[] is always
  // empty (paid-tier content), so the signal has to arrive as safety prose in `feedback` instead
  // — the one thing the verbosity dial is not allowed to suppress.
  assertIncludes(free, 'STOP-RUNNING SIGNALS OVERRIDE THE TIER DIAL', 'Free can suppress a safety signal.');
  assertIncludes(free, 'at EVERY tier including Free', 'The override does not name Free explicitly.');
  assertIncludes(
    free,
    'never withheld because a tier is cheap',
    'The safety override is not stated as unconditional.'
  );
});

// -------------------------------------------------------------------------------------------
// 5. ISSUE #112 — timestamps are approximate client-reported values, and the prompt must say so
// -------------------------------------------------------------------------------------------

Deno.test('every rendered timestamp is marked approximate — no bare, authoritative value', () => {
  const manifest = formatFrameManifest([frame(0), frame(400), frame(800)]);

  assertIncludes(
    manifest,
    'client-reported timestamp ~0 ms',
    'Frame 1 timestamp is not marked as client-reported/approximate.'
  );
  assertIncludes(manifest, 'approximately 400 ms after frame 1', 'Interval is not marked approximate.');
  assertIncludes(manifest, 'NOT an exact interval', 'Interval is not explicitly disclaimed.');
  assertIncludes(
    manifest,
    'APPROXIMATE CLIENT-REPORTED value',
    'The manifest does not state the timestamp certainty truthfully.'
  );
  assertIncludes(
    manifest,
    'may be the time requested from the decoder or the decoder estimate returned to the client',
    'The manifest does not explain the two possible timestamp provenances.'
  );
  assertIncludes(
    manifest,
    'the server cannot tell which',
    'The manifest does not state that timestamp provenance is unknown.'
  );
  assertIncludes(
    manifest,
    'hundreds of milliseconds',
    'The manifest does not quantify the error bar (Android keyframe snapping).'
  );
  assertIncludes(
    manifest,
    'may not be evenly spaced',
    'The manifest does not warn that even spacing is not guaranteed.'
  );

  // The specific failure #112 warns about: a value that LOOKS precise with nothing signalling
  // otherwise. Every ms figure in the manifest must be adjacent to a hedge.
  assert(
    !/(?<![~\d])\b\d+ ms\b/.test(manifest.replace(/approximately \d+ ms/g, '')),
    'The manifest prints a bare "<n> ms" value with no "~" and no "approximately" — that is ' +
      'exactly the false precision issue #112 exists to prevent.'
  );
});

Deno.test('an updated stride burst is labelled with provenance-neutral client-reported timestamps', () => {
  const text = buildUserContent(videoInput('pro', 3))
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  assertIncludes(
    text,
    'STRIDE BURST (approximate client-reported timestamps)',
    'A burst manifest must describe what the server actually knows, not assert decoder provenance.'
  );
  assertIncludes(
    text,
    'client-reported timestamp ~350 ms (approximate)',
    'Each frame label must use the same provenance-neutral timestamp description.'
  );
  assert(
    !text.includes('decoder-reported'),
    'Generated user content still makes a decoder-only provenance claim.'
  );
  assert(
    !text.includes('requested at ~'),
    'A generated frame label still makes a requested-only provenance claim.'
  );
  assert(
    !text.includes('Every time above is a REQUESTED time'),
    'The generated manifest still makes a requested-only provenance claim.'
  );
});

Deno.test('a photo manifest claims no timing at all', () => {
  const manifest = formatFrameManifest([frame(0)]);
  assertIncludes(manifest, 'no timing information applies', 'A single photo should assert no timing.');
  assert(!manifest.includes('after frame'), 'A single photo cannot have an inter-frame interval.');
});

Deno.test('the image blocks themselves label their timestamps as approximate', () => {
  const blocks = buildUserContent(videoInput('elite', 3));
  const text = blocks
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  assertIncludes(
    text,
    'Frame 1 of 3 — client-reported timestamp ~0 ms (approximate)',
    'Frame label lost its neutral provenance or hedge.'
  );
  assertIncludes(
    text,
    'Frame 2 of 3 — client-reported timestamp ~350 ms (approximate)',
    'Frame label lost its neutral provenance or hedge.'
  );

  // Ordering (docs/architecture.md step 7): manifest, then each label immediately before its
  // image, then the scoring instruction LAST.
  const types = blocks.map((b) => b.type);
  assert(types[0] === 'text', 'The frame manifest must come first.');
  assert(types.at(-1) === 'text', 'The scoring instruction must come last.');
  assert(blocks.filter((b) => b.type === 'image').length === 3, 'Expected one image block per frame.');
  for (const [i, block] of blocks.entries()) {
    if (block.type === 'image') {
      assert(blocks[i - 1]?.type === 'text', 'Every image must be preceded by its label block.');
    }
  }
});

Deno.test('the tier dial can never turn an approximate range into a confident SPM figure', () => {
  // The core of #112: "Higher tier buys more depth, never more false precision." Elite gets the
  // longest feedback of any tier, so Elite is where a confident number would appear first.
  const elite = fullPromptText(videoInput('elite'));

  assertIncludes(elite, 'FORBIDDEN AT EVERY TIER, INCLUDING ELITE', 'Elite is not explicitly bound.');
  assertIncludes(elite, 'your cadence is 164 SPM', 'The forbidden example of false precision is missing.');
  assertIncludes(elite, 'approximate', 'Elite is not told to label estimates approximate.');
  assertIncludes(
    elite,
    'a paying tier buys',
    'Elite is not told that paying buys depth, not certainty.'
  );
  assertIncludes(
    elite,
    'the honest answer is `score: null`',
    'Elite is not told that null beats a number propped up by untrustworthy timings.'
  );
});

Deno.test('Cadence and Elasticity are steered onto timestamp-INDEPENDENT evidence', () => {
  // The resolution that keeps the product useful despite #112: the visible signature of low
  // cadence (overstriding) and of poor elasticity (contact quality) are readable from geometry,
  // with no clock involved. pace_framework.md already calls overstriding "the single most
  // important thing you can see".
  const prompt = fullPromptText(videoInput('pro'));

  assertIncludes(prompt, 'OVERSTRIDING SIGNATURE', 'Cadence is not steered onto visible geometry.');
  assertIncludes(prompt, 'None of that needs a clock', 'The timestamp-independent path is not stated.');
  assertIncludes(
    prompt,
    'if the timing is the only thing pointing at a fault, that is not enough to call the fault',
    'The prompt does not stop a timing-only fault call.'
  );
});

/**
 * THE TWO CERTIFIED CLAUSES THE PROMPT AMENDS. `pace_framework.md` ships under Ian's name and is
 * not editable without a certification review (#39/#40), so #112 is neutralised at the PROMPT
 * layer — exactly as #41 neutralised #40's runner's-note clauses. That only works while the
 * certified text still says what the amendment quotes it as saying: an amendment aimed at a
 * sentence that has since been reworded is dead text, and the model would be back to reading
 * "only if frame timestamps are known" as a satisfied condition.
 *
 * So these are asserted BYTE-FOR-BYTE against the shipped bundle, the same way the whole file is
 * asserted present byte-for-byte in § 1. If a future certification pass rewords either clause,
 * this test fails loudly and the amendment has to be re-aimed — it cannot rot in silence.
 */
const AMENDED_CERTIFIED_CLAUSES = [
  '**Only if frame timestamps are known** may you estimate a cadence *range*',
  'Across evenly-spaced frames you can estimate',
  'vertical bounce (torso',
  'Never state a precise SPM you cannot derive',
];

Deno.test('the certified timing clauses the prompt amends still EXIST in the certified file', () => {
  for (const clause of AMENDED_CERTIFIED_CLAUSES) {
    assertIncludes(
      PACE_FRAMEWORK_MD,
      clause,
      'TIMESTAMP_RULES quotes this clause from pace_framework.md and amends how it is read, but ' +
        'the clause is no longer in the certified file. Re-aim the amendment (do NOT delete it): ' +
        'the timestamps are still approximate and not measured, so whatever replaced this clause still ' +
        'needs neutralising.'
    );
  }
});

Deno.test('pace_framework.md\'s timing clauses are NEUTRALISED at the prompt layer, not edited', () => {
  // The #40 precedent, applied to #112. Two things have to be true at once, and this asserts both:
  //   1. The certified file is in the prompt UNEDITED (§ 1 asserts it verbatim; re-asserted here
  //      because the amendment is only legitimate if the original is what shipped).
  //   2. The prompt tells the model how to READ the two timing clauses, quoting them back so the
  //      instruction cannot be mistaken for a different rule about a different sentence.
  for (const tier of TIERS) {
    const prompt = fullPromptText(videoInput(tier));

    assertIncludes(prompt, PACE_FRAMEWORK_MD, 'The certified framework is not shipped verbatim.');

    assertIncludes(
      prompt,
      'HOW TO READ pace_framework.md\'s TWO TIMING CLAUSES',
      `Tier "${tier}" never tells the model how to read the certified timing clauses.`
    );
    // The cadence clause: "known" must be re-read as "known APPROXIMATELY" — otherwise the model
    // sees timestamps in the manifest, scores the condition as met, and computes a step rate off a
    // rhythm that never happened. This is the single sentence issue #112 turns on.
    assertIncludes(
      prompt,
      'READ "known" AS "KNOWN APPROXIMATELY"',
      `Tier "${tier}" leaves "only if frame timestamps are known" readable as a satisfied condition.`
    );
    assertIncludes(
      prompt,
      'NEVER a point figure',
      `Tier "${tier}" does not cap the amended cadence clause at a wide range.`
    );
    // The elasticity clause: the certified file assumes evenly-spaced frames. They are not.
    assertIncludes(
      prompt,
      'THESE FRAMES ARE NOT RELIABLY EVENLY SPACED',
      `Tier "${tier}" leaves pace_framework.md's evenly-spaced-frames assumption standing.`
    );
    assertIncludes(
      prompt,
      'never by dividing it by a stated interval',
      `Tier "${tier}" does not stop a rate being derived from a stated interval.`
    );
    // An amendment to certified content may only ever tighten. If it could loosen, the prompt
    // layer would have become a way to route around certification.
    assertIncludes(
      prompt,
      'it licenses nothing the certified file forbids',
      `Tier "${tier}" does not bound the amendment to tightening only.`
    );
    assertIncludes(
      prompt,
      'Every other rule in pace_framework.md stands unchanged and in full',
      `Tier "${tier}" does not scope the amendment to just the two timing clauses.`
    );
  }
});

Deno.test('the uncertainty must reach the RUNNER — hedged in `feedback`, not just in the head', () => {
  // #112's requirement (b): the model must SAY SO in its output. A model that privately widens its
  // confidence and then writes "your cadence is low" has produced the same confident, fluent,
  // unfalsifiable claim the issue is about — the runner sees score/band/feedback and nothing else.
  for (const tier of TIERS) {
    const prompt = fullPromptText(videoInput(tier));

    assertIncludes(
      prompt,
      'SAY IT IN THE OUTPUT, NOT JUST IN YOUR HEAD',
      `Tier "${tier}" does not require the timing hedge to be surfaced to the runner.`
    );
    assertIncludes(
      prompt,
      'must carry that uncertainty in the `feedback` the runner',
      `Tier "${tier}" does not name \`feedback\` as where the hedge goes.`
    );
    // The worked example — the format the hedge should take. Two examples beat five hundred words.
    assertIncludes(
      prompt,
      'approximate, estimated from frames whose timing is not exact',
      `Tier "${tier}" gives no example of a correctly hedged cadence claim.`
    );
  }
});

// -------------------------------------------------------------------------------------------
// 5b. ISSUE #199 — the stride-burst / legacy-sparse split (the core-purpose audit's structural
//     ceiling finding: frames sampled far apart cannot show motion, no matter what the prompt says)
// -------------------------------------------------------------------------------------------

Deno.test('a genuine stride burst unlocks all four pillars and is labelled STRIDE BURST', () => {
  const prompt = fullPromptText(videoInput('pro'));

  assertIncludes(prompt, 'A STRIDE BURST', 'A tight burst is not described as a stride burst.');
  assertIncludes(
    prompt,
    'Across these frames you can assess all four pillars',
    'A stride burst does not unlock all four pillars.'
  );
  assertIncludes(
    prompt,
    'STRIDE BURST (approximate client-reported timestamps)',
    'The frame manifest header does not classify a tight burst as a stride burst.'
  );
  assertIncludes(
    prompt,
    'Compare them to each other — that comparison, not any single frame, is the analysis.',
    'A stride burst is not explicitly treated as motion evidence across frames.'
  );
});

Deno.test('frames spread across a whole clip are classified LEGACY/SPARSE and lose Cadence/Elasticity', () => {
  const prompt = fullPromptText(legacySparseVideoInput('pro'));

  assertIncludes(
    prompt,
    'SEVERAL VIDEO FRAMES, SPREAD ACROSS THE CLIP — NOT A STRIDE BURST',
    'Widely-spaced frames are not described as legacy/sparse.'
  );
  assertIncludes(
    prompt,
    'LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)',
    'The frame manifest header does not classify widely-spaced frames as legacy/sparse.'
  );
  assertIncludes(
    prompt,
    'not a motion sequence — it is a coincidence dressed up as one',
    'Legacy/sparse frames are not told they cannot be read as motion.'
  );
  assertIncludes(
    prompt,
    'Cadence and Elasticity MUST both be `score: null`, `band: null`, `notAssessedReason:',
    'Legacy/sparse frames do not explicitly null both motion-derived pillars.'
  );
  assertIncludes(
    prompt,
    '"needsVideo"',
    'Legacy/sparse frames do not use the required needsVideo reason.'
  );
  assert(
    !prompt.includes('Across these frames you can assess all four pillars'),
    'Legacy/sparse frames must not be told all four pillars are assessable.'
  );
});

Deno.test('a single video frame is treated like a photo, not a burst and not legacy/sparse', () => {
  const prompt = fullPromptText(videoInput('free', 1));

  assertIncludes(
    prompt,
    'A SINGLE FRAME FROM A VIDEO',
    'A one-frame video does not get the single-frame video rules.'
  );
  assertIncludes(
    prompt,
    '"needsVideo"',
    'A one-frame video does not require the needsVideo not-assessed reason.'
  );
  assert(!prompt.includes('A STRIDE BURST'), 'A single frame cannot be a stride burst.');
  assert(
    !prompt.includes('SEVERAL VIDEO FRAMES, SPREAD ACROSS THE CLIP'),
    'A single frame is not "several frames".'
  );
});

Deno.test('the burst/legacy split is a server-side property of the frames, not the tier or count', () => {
  // The whole point of #199's server-side classification (see `isStrideBurst`'s header): the edge
  // function deploys instantly, a native app update does not, so a request built by an
  // un-updated client with 5 widely-spaced frames must classify the same as any other 5
  // widely-spaced frames — Elite's extra depth never buys back missing motion evidence.
  for (const tier of TIERS) {
    const sparsePrompt = fullPromptText(legacySparseVideoInput(tier));
    assertIncludes(
      sparsePrompt,
      'LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)',
      `Tier "${tier}" with widely-spaced frames is not classified as legacy/sparse.`
    );

    const burstPrompt = fullPromptText(videoInput(tier));
    assertIncludes(
      burstPrompt,
      'STRIDE BURST (approximate client-reported timestamps)',
      `Tier "${tier}" with a tight burst is not classified as a stride burst.`
    );
  }
});

Deno.test('a non-increasing or NaN-spanning frame sequence is never classified as a stride burst', () => {
  // Defense in depth: `lib/frames.ts` rejects a non-increasing sequence before it is ever sent
  // (`FrameExtractionError`), but this file must not silently trust that a request arriving here
  // was built by the current client — see `isStrideBurst`'s own header.
  const nonIncreasing: AnalyzeFormPromptInput = {
    tier: 'pro',
    media: 'video',
    frames: [frame(0), frame(0), frame(350)],
  };
  const prompt = fullPromptText(nonIncreasing);

  assertIncludes(
    prompt,
    'LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)',
    'A non-increasing frame sequence must not be trusted as a stride burst.'
  );
});

Deno.test('an infinite-spanning frame sequence is never classified as a stride burst', () => {
  // The other half of "non-increasing or NaN/non-finite-spanning": strictly increasing but with a
  // non-finite value still fails `Number.isFinite(span)` rather than being trusted as a burst.
  const infiniteSpan: AnalyzeFormPromptInput = {
    tier: 'pro',
    media: 'video',
    frames: [frame(0), frame(Number.POSITIVE_INFINITY)],
  };
  const prompt = fullPromptText(infiniteSpan);

  assertIncludes(
    prompt,
    'LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)',
    'A non-finite frame span must not be trusted as a stride burst.'
  );
});

Deno.test('the stride-burst span boundary is exact: 900ms is a burst, 901ms is legacy/sparse', () => {
  const atBoundary: AnalyzeFormPromptInput = {
    tier: 'pro',
    media: 'video',
    frames: [frame(0), frame(900)],
  };
  const overBoundary: AnalyzeFormPromptInput = {
    tier: 'pro',
    media: 'video',
    frames: [frame(0), frame(901)],
  };

  assertIncludes(
    fullPromptText(atBoundary),
    'STRIDE BURST (approximate client-reported timestamps)',
    'A 900ms span (the documented MAX_STRIDE_BURST_SPAN_MS) must classify as a stride burst.'
  );
  assertIncludes(
    fullPromptText(overBoundary),
    'LEGACY/SPARSE VIDEO FRAMES (not a motion sequence)',
    'A 901ms span must classify as legacy/sparse, one millisecond over the documented ceiling.'
  );
});

// -------------------------------------------------------------------------------------------
// 6. THE STRUCTURED-OUTPUT CONTRACT — it IS PaceResult (#43), not a parallel shape
// -------------------------------------------------------------------------------------------

Deno.test('the tool schema mirrors PaceResult exactly — same pillars, same fields, same bands', () => {
  const schema = PACE_ANALYSIS_TOOL.input_schema as {
    properties: {
      pillars: { properties: Record<string, unknown>; required: string[] };
      overall: { required: string[] };
    };
    required: string[];
  };

  assert(PACE_ANALYSIS_TOOL.name === PACE_ANALYSIS_TOOL_NAME, 'Tool name drifted from its constant.');
  assert(PACE_ANALYSIS_TOOL.strict === true, 'The tool must be strict — schema conformance is the point.');

  // PaceResult = { pillars, overall }
  assert(
    JSON.stringify(schema.required.slice().sort()) === JSON.stringify(['overall', 'pillars']),
    'The tool schema does not require exactly PaceResult\'s two top-level keys.'
  );

  // pillars: Record<PacePillarId, ...> — all four, no extras, canonical P-A-C-E order.
  assert(
    JSON.stringify(Object.keys(schema.properties.pillars.properties)) === JSON.stringify([...PACE_PILLARS]),
    'The tool schema\'s pillars do not match PACE_PILLARS exactly (or are out of P-A-C-E order).'
  );
  assert(
    JSON.stringify(schema.properties.pillars.required) === JSON.stringify([...PACE_PILLARS]),
    'The tool schema does not require all four pillars.'
  );

  // PacePillarResult's required fields.
  for (const pillar of PACE_PILLARS) {
    const pillarSchema = schema.properties.pillars.properties[pillar] as {
      required: string[];
      properties: { band: { anyOf: [{ enum: string[] }, unknown] } };
    };
    assert(
      JSON.stringify(pillarSchema.required.slice().sort()) ===
        JSON.stringify(['band', 'drills', 'feedback', 'flags', 'safety', 'score']),
      `Pillar "${pillar}" does not require exactly PacePillarResult's fields.`
    );
    assert(
      JSON.stringify(pillarSchema.properties.band.anyOf[0].enum) === JSON.stringify([...SCORE_BAND_VALUES]),
      `Pillar "${pillar}"'s band enum has drifted from ScoreBand.`
    );
  }

  // PaceOverall = { score, band }
  assert(
    JSON.stringify(schema.properties.overall.required.slice().sort()) === JSON.stringify(['band', 'score']),
    'The overall schema does not match PaceOverall.'
  );
});

Deno.test('ROUND TRIP: a response built to the tool schema satisfies isPaceResult', () => {
  // The proof that the contract and the validator agree. If this ever fails, #45 would reject a
  // perfectly obedient model response — the "over-strict validator rejecting a fine response"
  // failure that CLAUDE.md's structural-validation rule exists to prevent.
  const fullyAssessed: PaceResult = {
    pillars: {
      posture: {
        score: 72,
        band: 'good',
        feedback: 'Lean comes from the ankles, not the waist.',
        flags: [],
        drills: [{ name: 'Posture Reset', instructions: 'Drop the shoulders, level the head.' }],
      },
      armSwing: {
        score: 61,
        band: 'mid',
        feedback: 'Hands drift across the midline.',
        flags: [{ pattern: 'Crossing-midline arms', detail: 'Associated with rotational load.' }],
        drills: [{ name: 'Arm-Swing Box Drill', instructions: 'Elbows drive straight back.' }],
      },
      cadence: {
        score: 44,
        band: 'low',
        feedback: 'Foot lands well ahead of the hips with a near-straight knee.',
        flags: [{ pattern: 'Overstriding', detail: 'Associated with amplified braking force.' }],
        drills: [{ name: 'Metronome Runs', instructions: '+2-3 SPM above baseline.' }],
      },
      elasticity: {
        score: 55,
        band: 'mid',
        feedback: 'Contact looks heavy; the torso rises a long way between frames.',
        flags: [],
        drills: [{ name: 'Pogo Hops', instructions: 'Quick, rhythmic bounce. The floor is hot.' }],
      },
    },
    overall: { score: 58, band: 'mid' },
  };
  assert(isPaceResult(fullyAssessed), 'A fully-assessed schema-shaped response failed isPaceResult.');

  // THE EDGE CASE THAT MATTERS: the photo result. Cadence and Elasticity honestly not assessed.
  // This is the shape the prompt asks for on every single photo submission, so if the validator
  // rejected it, the product's most common honest answer would be a hard failure.
  const photoResult: PaceResult = {
    pillars: {
      posture: { score: 78, band: 'good', feedback: 'Tall and stable.', flags: [], drills: [] },
      armSwing: { score: 65, band: 'mid', feedback: 'Elbows a touch high.', flags: [], drills: [] },
      cadence: {
        score: null,
        band: null,
        feedback: 'Not assessed — a photo cannot show step rate. A short video would unlock this.',
        notAssessedReason: 'needsVideo',
        flags: [],
        drills: [],
      },
      elasticity: {
        score: null,
        band: null,
        feedback: 'Not assessed — bounce and contact quality are motion over time.',
        notAssessedReason: 'needsVideo',
        flags: [],
        drills: [],
      },
    },
    overall: { score: 72, band: 'good' },
  };
  assert(isPaceResult(photoResult), 'The honest photo result (2 pillars null) failed isPaceResult.');

  // And the total-failure shape: nothing assessable at all. Never a fabricated overall.
  const unassessable: PacePillarResult = {
    score: null,
    band: null,
    feedback: 'Not assessed — the runner is not visible from a usable angle.',
    notAssessedReason: 'angle',
    flags: [],
    drills: [],
  };
  const nothingAssessed: PaceResult = {
    pillars: {
      posture: unassessable,
      armSwing: unassessable,
      cadence: unassessable,
      elasticity: unassessable,
    },
    overall: { score: null, band: null },
  };
  assert(isPaceResult(nothingAssessed), 'The all-null result failed isPaceResult.');
});

Deno.test('the schema obeys Anthropic\'s structured-output limits (or strict mode 400s)', () => {
  // These limits are documented, load-bearing, and invisible until the API rejects the request.
  // Encoding them as a test means a future edit to the schema fails here instead of in prod.
  let unionCount = 0;

  walkSchema(PACE_ANALYSIS_TOOL.input_schema, (node) => {
    if (node.type === 'object') {
      assert(
        node.additionalProperties === false,
        'Every object in a strict schema must set additionalProperties: false.'
      );
    }
    if (Array.isArray(node.anyOf)) {
      unionCount += 1;
    }
    for (const unsupported of ['minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'pattern']) {
      assert(
        !(unsupported in node),
        `Strict schemas do not support "${unsupported}" — it must live in a description instead. ` +
          '(The 0-100 score range is enforced at runtime by isPaceResult, not by the schema.)'
      );
    }
  });

  assert(
    unionCount <= 16,
    `The schema uses ${unionCount} anyOf unions; Anthropic caps a request at 16. Make a nullable ` +
      'field non-nullable (feedback already is) before adding another.'
  );
});

Deno.test('the score range lives in the description, since the schema cannot enforce it', () => {
  const json = JSON.stringify(PACE_ANALYSIS_TOOL.input_schema);
  assertIncludes(json, '0-100', 'The 0-100 range is not communicated anywhere in the schema.');
  assertIncludes(json, 'NEVER invent a number', 'The schema does not forbid fabricating a score.');
  assertIncludes(json, 'null is always the correct answer', 'The schema does not bless the null path.');
});

// -------------------------------------------------------------------------------------------
// 7. REQUEST ASSEMBLY — the combination the API rejects must be unbuildable
// -------------------------------------------------------------------------------------------

Deno.test('THINKING IS ON BY DEFAULT, and set explicitly — this call is the product', () => {
  const request = buildAnalyzeFormRequest(videoInput('pro'));

  assert(request.model === ANALYZE_FORM_MODEL, 'Wrong model.');
  assert(
    request.thinking.type === 'adaptive',
    'The core vision call must run WITH thinking. Multi-step reasoning over up to 8 frames against ' +
      'a 25KB rubric is exactly the work thinking is for, and running it with thinking off is a ' +
      'material quality regression on the one call this product exists to make.'
  );
  // Explicit, not omitted: on Sonnet 5 an absent `thinking` field also runs adaptive, so omitting
  // it would behave identically but read like nobody considered it.
  assert('thinking' in request, 'thinking must be set explicitly, not left to the model default.');
});

Deno.test('the output contract travels in output_config.format — NOT in a tool (settled 2026-07-13)', () => {
  // WHAT CHANGED AND WHY. This module used to send a `submit_pace_analysis` tool with
  // `tool_choice: auto`, because a comment here claimed Anthropic's docs said — "with no platform
  // scoping" — that a FORCED tool_choice is incompatible with extended thinking, and that the
  // report of it being Bedrock-only "could not be confirmed". That was wrong. The restriction IS
  // Bedrock-only: on Bedrock a forced tool_choice requires `thinking: {type: 'disabled'}`, and the
  // first-party Claude API (what this project calls) does not require that at all.
  //
  // But the fix is not "force the tool call now". It is to use the mechanism that makes the whole
  // question moot: STRUCTURED OUTPUTS. With no `tools` and no `tool_choice` in the request, there
  // is nothing left for a platform-specific tool-choice rule to be incompatible with — the request
  // is correct on the Claude API, Bedrock, and Vertex under every reading of every doc. And it is a
  // STRONGER guarantee: the response itself is grammar-constrained to the schema, rather than "some
  // tool got called and we then constrain its input".
  const request = buildAnalyzeFormRequest(videoInput('pro'));

  assert(request.output_config.format !== undefined, 'The schema must ride in output_config.format.');
  assert(request.output_config.format?.type === 'json_schema', 'Structured outputs is json_schema.');
  assert(
    request.tools === undefined && request.tool_choice === undefined,
    'No tool, no tool_choice — that is what makes the platform question moot.'
  );
  assert(request.thinking.type === 'adaptive', 'Structured outputs is compatible with thinking; keep it.');

  // ONE definition of the shape, two possible carriers — never two definitions.
  assert(
    request.output_config.format?.schema === PACE_ANALYSIS_TOOL.input_schema,
    'output_config.format.schema and the tool input_schema must be the SAME object (PACE_RESULT_SCHEMA).'
  );

  const blocks = request.messages[0].content;
  const contract = blocks[blocks.length - 1];
  if (contract === undefined || contract.type !== 'text') {
    throw new Error('The output contract must be the last block of the user turn.');
  }
  assertIncludes(
    contract.text,
    'RETURN THE RESULT AS A SINGLE JSON OBJECT MATCHING THE REQUIRED OUTPUT SCHEMA',
    'The prompt must ask for the JSON object, not a tool call.'
  );
  assertIncludes(
    contract.text,
    'no prose before or after it',
    'The prompt must still forbid a prose answer — grammar-constrained sampling is not an excuse to stop asking.'
  );
});

Deno.test('the tool remains constructible for #42 to eval, and forcing it is now legal', () => {
  // Kept as an OPTION, not the default: the tool describes the same shape a second time, is billed
  // as input, and reintroduces the platform-specific tool_choice question for no benefit. But
  // `forceToolCall` alongside adaptive thinking is legal on the first-party Claude API (the
  // incompatibility is Bedrock-only), so #42 can sweep both mechanisms head to head.
  const combos: Array<[BuildRequestOptions, 'adaptive' | 'disabled', 'auto' | 'tool']> = [
    [{ includeTool: true }, 'adaptive', 'auto'],
    [{ includeTool: true, forceToolCall: true }, 'adaptive', 'tool'],
    [{ includeTool: true, thinking: { type: 'disabled' } }, 'disabled', 'auto'],
    [{ includeTool: true, thinking: { type: 'disabled' }, forceToolCall: true }, 'disabled', 'tool'],
  ];

  for (const [options, expectedThinking, expectedChoice] of combos) {
    const request = buildAnalyzeFormRequest(videoInput('pro'), options);
    assert(
      request.thinking.type === expectedThinking,
      `Expected thinking "${expectedThinking}" for ${JSON.stringify(options)}.`
    );
    assert(
      request.tool_choice?.type === expectedChoice,
      `Expected tool_choice "${expectedChoice}" for ${JSON.stringify(options)}.`
    );
    assert(request.tools?.[0].strict === true, 'The tool must stay strict whenever it is sent.');
  }
});

Deno.test('effort is an explicit, named constant — not a magic value or a silent default', () => {
  const request = buildAnalyzeFormRequest(videoInput('pro'));

  assertEquals(ANALYZE_FORM_EFFORT, 'low');
  assertEquals(request.thinking, { type: 'adaptive' });
  assertEquals(request.output_config.effort, 'low');
  assertEquals(request.max_tokens, MAX_OUTPUT_TOKENS_BY_TIER.pro);

  // #42 sweeps it by passing an override; the seam must exist.
  const swept = buildAnalyzeFormRequest(videoInput('pro'), { effort: 'high' });
  assert(swept.output_config.effort === 'high', 'Effort must be overridable for #42 to sweep it.');
});

Deno.test('the request sets NO temperature / top_p / top_k (Sonnet 5 rejects non-defaults)', () => {
  const request = buildAnalyzeFormRequest(videoInput('elite')) as unknown as Record<string, unknown>;

  for (const banned of ['temperature', 'top_p', 'top_k']) {
    assert(
      !(banned in request),
      `The request sets "${banned}". claude-sonnet-5 returns a 400 for any non-default value of ` +
        'it. Determinism comes from strict: true, not from a sampling parameter.'
    );
  }
});

Deno.test('the certified knowledge is cached, and the cache breakpoint covers all of it', () => {
  const system = buildSystemPrompt(videoInput('pro'));

  assert(system.length === 1, 'Expected one system block.');
  assert(
    system[0].cache_control?.type === 'ephemeral',
    'The ~25KB certified knowledge is byte-identical on every call — it must be cached, or every ' +
      'analysis pays full input price for it (ai-pricing.ts models a 0.1x cache read).'
  );
});

Deno.test('the frame guard rejects requests that should never have been built', () => {
  const cases: Array<[string, () => unknown]> = [
    ['no frames', () => buildAnalyzeFormRequest({ tier: 'pro', media: 'video', frames: [] })],
    [
      'a photo with more than one frame',
      () => buildAnalyzeFormRequest({ tier: 'pro', media: 'photo', frames: [frame(0), frame(1)] }),
    ],
    ['more frames than the tier cap', () => buildAnalyzeFormRequest(videoInput('free', 2))],
    ['a frame over Elite\'s cap of 8', () => buildAnalyzeFormRequest(videoInput('elite', 9))],
    [
      'a data: URI instead of raw base64',
      () =>
        buildAnalyzeFormRequest({
          tier: 'pro',
          media: 'photo',
          frames: [{ base64: 'data:image/jpeg;base64,AAA', mediaType: 'image/jpeg', requestedTimestampMs: 0 }],
        }),
    ],
    [
      'a NaN timestamp',
      () =>
        buildAnalyzeFormRequest({
          tier: 'pro',
          media: 'photo',
          frames: [{ base64: 'AAA', mediaType: 'image/jpeg', requestedTimestampMs: Number.NaN }],
        }),
    ],
  ];

  for (const [name, build] of cases) {
    let threw = false;
    try {
      build();
    } catch {
      threw = true;
    }
    assert(threw, `Expected the builder to reject: ${name}.`);
  }
});

Deno.test('a valid Pro video request carries every frame as an image block', () => {
  const request = buildAnalyzeFormRequest(videoInput('pro', 5));
  const images = request.messages[0].content.filter((b) => b.type === 'image');

  assert(images.length === 5, `Expected 5 image blocks, got ${images.length}.`);
  // No tool by default — the output contract is `output_config.format` (structured outputs).
  assert(request.tools === undefined, 'The default request must carry no tool.');
  assert(request.output_config.format?.type === 'json_schema', 'The schema must ride in output_config.');

  const withTool = buildAnalyzeFormRequest(videoInput('pro', 5), { includeTool: true });
  assert(withTool.tools?.length === 1, 'Exactly one tool should be offered when opted in.');
  assert(withTool.tools?.[0].name === PACE_ANALYSIS_TOOL_NAME, 'The wrong tool is offered.');
});

// -------------------------------------------------------------------------------------------
// 8. THE SPEND GATE'S ESTIMATE MUST COVER THE PROMPT IT IS PAYING FOR
// -------------------------------------------------------------------------------------------

Deno.test("the spend gate's estimate still covers the real prompt (it did not, at 6000)", () => {
  // `gate_ai_call` reserves daily-cap headroom BEFORE the model is called, using
  // `estimateTokensForCall` = SYSTEM_PROMPT_TOKENS_ESTIMATE + frames * TOKENS_PER_FRAME. If the
  // prompt outgrows that constant, every call quietly costs more than the gate reserved — and on
  // an account with a hard ceiling and auto-reload off, "quietly costs more" is how you find out
  // by running out of credit mid-analysis.
  //
  // This is not hypothetical: the constant shipped at 6000 as a placeholder for a prompt that did
  // not exist yet, and the real prompt measures ~16.7k. Building it is what moved the number, so
  // guarding it belongs here, next to the thing that moves it.
  // NOT the familiar ~3.5-4 chars/token: that heuristic predates Claude Sonnet 5's new tokenizer,
  // which produces "approximately 30% more tokens for the same text". 3.5 / 1.3 ~= 2.7. Using the
  // old ratio here would under-count the prompt by ~30% and hand the spend gate a second, quieter
  // version of the exact bug this test exists to catch.
  const CHARS_PER_TOKEN = 2.7;
  // Structured outputs injects a system prompt of its own ("Additional system prompt injected
  // (increases token cost)"). Its exact size is not published, so we keep the same conservative
  // 474-token allowance that the forced-tool-use system prompt carried — the mechanism changed,
  // the need to budget for an injected preamble did not.
  const STRUCTURED_OUTPUT_SYSTEM_OVERHEAD = 474;

  // Worst case across every tier, since one constant has to cover all three.
  let worst = 0;
  for (const tier of TIERS) {
    const input = videoInput(tier, PACE_FRAME_CAP[tier] === 1 ? 1 : PACE_FRAME_CAP[tier]);
    const request = buildAnalyzeFormRequest(
      input.frames.length === 1 ? photoInput(tier) : input
    );

    const systemChars = request.system.map((b) => b.text).join('\n').length;
    const userTextChars = request.messages[0].content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n').length;
    // The schema is billed as input whichever carrier it rides in — as `tools` before, as
    // `output_config.format` now. Same ~13k characters of descriptions, same cost.
    const schemaChars = JSON.stringify(request.output_config.format).length;

    const nonFrameTokens =
      Math.round((systemChars + userTextChars + schemaChars) / CHARS_PER_TOKEN) +
      STRUCTURED_OUTPUT_SYSTEM_OVERHEAD;

    worst = Math.max(worst, nonFrameTokens);
  }

  assert(
    worst <= SYSTEM_PROMPT_TOKENS_ESTIMATE,
    `The assembled prompt is ~${worst} non-frame input tokens, but the AI spend gate reserves ` +
      `against SYSTEM_PROMPT_TOKENS_ESTIMATE = ${SYSTEM_PROMPT_TOKENS_ESTIMATE}. The gate is now ` +
      'under-reserving every analyze-form call. Raise the constant in ai-pricing.ts (erring high ' +
      'is safe — it only makes the gate stricter) or shrink the prompt.'
  );
});
