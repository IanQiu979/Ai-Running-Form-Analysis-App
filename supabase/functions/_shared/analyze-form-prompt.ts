/**
 * The grounded `analyze-form` prompt: certified knowledge + the tier verbosity dial + the
 * structured-output contract (issue #41). This is M4's blocker — #44 (the edge function) and #45
 * (validation/retry/fallback) both build on what this file defines.
 *
 * PURE, BY DESIGN — same split as `ai-guard.ts`/`ai-guard-client.ts`: this module touches no
 * `Deno` global, no `fetch`, no env var, and never calls Anthropic. It turns
 * (tier, media, frames) into a request body. #44 owns sending it; #45 owns validating what comes
 * back. That keeps the part most likely to change (prompt wording) unit-testable with zero
 * network and zero API spend.
 *
 * FOUR THINGS THIS FILE IS RESPONSIBLE FOR:
 *
 * 1. GROUNDING. The system prompt carries the three certified `knowledge/*.md` files verbatim,
 *    imported from `knowledge.generated.ts` (#90) — never inlined, never paraphrased, never
 *    fetched at runtime. Every constant there is wrapped in `assertNonEmptyKnowledge()`, which
 *    throws at module load, so importing this file at all proves the knowledge is non-empty. An
 *    empty knowledge string does not crash a model call; it just makes the model invent fluent,
 *    confident biomechanics from its general knowledge. That is the one failure this product
 *    must never ship.
 *
 * 2. THE TIER DIAL. ONE prompt with a verbosity parameter — not three prompts, not three calls
 *    (`docs/architecture.md` step 7). `TIER_VERBOSITY` below is the entire difference between
 *    Free, Pro, and Elite. It scales DEPTH (how much prose, whether flags/drills are included).
 *    It is structurally incapable of scaling CERTAINTY: the scoring rules, the not-assessed
 *    rules, the medical boundary, and the timestamp-approximation rules are assembled OUTSIDE
 *    the dial and are byte-identical at every tier. See `INVARIANT_RULES`.
 *
 * 3. THE #112 TIMESTAMP TRUTH. The timestamps this prompt receives are the times the client
 *    ASKED `expo-video-thumbnails` for, not the times it actually decoded. Android's
 *    `MediaMetadataRetriever` snaps to the nearest keyframe and exposes no PTS; iOS computes
 *    `actualTime` and throws it away. On Android the error can be HUNDREDS OF MILLISECONDS. Two
 *    of the four pillars — Cadence and Elasticity — are derived from motion over time, so a
 *    prompt that presents these intervals as exact would have the model reason about a rhythm
 *    the runner does not have and produce confident, wrong advice. It would not crash. See
 *    `TIMESTAMP_RULES` and `formatFrameManifest()`: intervals are always labelled approximate,
 *    the model is told the error bar, precise SPM/GCT/VO figures are forbidden at EVERY tier, and
 *    any Cadence/Elasticity judgement that leans on the timing must carry that uncertainty into
 *    the user-visible `feedback` — a hedge the runner never sees is not a hedge. The field is
 *    named `requestedTimestampMs` so a future caller cannot casually mistake it for a measured
 *    one. And because `pace_framework.md` is CERTIFIED CONTENT that itself conditions on timing
 *    ("only if frame timestamps are known", "across evenly-spaced frames"), the last block of
 *    `TIMESTAMP_RULES` AMENDS HOW THOSE TWO CLAUSES ARE READ instead of editing the certified file
 *    — the same prompt-layer mechanism `INPUT_CHANNEL_RULES` uses for #40's runner's-note clauses.
 *
 * 4. THE OUTPUT CONTRACT. A strict, forced tool call whose `input_schema` is exactly
 *    `PaceResult` from `./pace.ts` (#43) — the same shape the app renders and `settle_analysis`
 *    persists. There is no second definition of the result shape anywhere, and no adapter: what
 *    the model emits IS a `PaceResult`, checked by `isPaceResult` on the way out (#45).
 *
 * MODEL BEHAVIOUR THIS FILE PINS DOWN (verified against Anthropic's docs 2026-07-12, not
 * recalled — every one of these is a silent 400 or a silent quality regression if you get it
 * wrong):
 *
 *   a. `claude-sonnet-5` runs ADAPTIVE THINKING BY DEFAULT. Omitting `thinking` does not mean
 *      "off" on this model; it means "adaptive". We set `{type: 'adaptive'}` EXPLICITLY, because
 *      this call — multi-step visual reasoning over up to 8 frames against a 25KB rubric — is
 *      exactly the work thinking is for, and because an explicit value cannot be misread later as
 *      an oversight. `thinking` and `tool_choice` are INDEPENDENT options here, deliberately not
 *      coupled: see `BuildRequestOptions` for the one genuinely unsettled question (whether the
 *      first-party API accepts a FORCED tool call alongside thinking, or whether that is
 *      Bedrock-only) and why the default is the configuration that is correct either way.
 *   b. Thinking tokens COUNT against `max_tokens` ("a hard limit on total output — thinking plus
 *      response text"). Two consequences, both handled: `max_tokens` comes from
 *      `MAX_OUTPUT_TOKENS_BY_TIER` (`ai-pricing.ts`), the SAME constant `gate_ai_call` reserved
 *      output budget against, so the reservation is a true upper bound on billed output even
 *      with thinking on; and because the budget is tight (4-8k), `ANALYZE_FORM_EFFORT` is set to
 *      `medium` rather than the default `high` — see that constant. #44 MUST treat
 *      `stop_reason: 'max_tokens'` as a truncation (a mostly-thinking, cut-off answer), not as a
 *      usable response. That was Echo V1's 1024/1500-ceiling failure, and Sonnet 5's new
 *      tokenizer (~30% more tokens for the same text) makes it easier to hit, not harder.
 *   c. `claude-sonnet-5` REJECTS non-default `temperature`, `top_p`, and `top_k` with a 400, on
 *      every request, thinking or not. So this builder sets NONE of them. Do not "make the JSON
 *      deterministic" by adding `temperature: 0` — that is a 400, not a determinism win. The
 *      determinism comes from `strict: true` (grammar-constrained sampling), which is a stronger
 *      guarantee than a temperature could ever be.
 */

import { DRILLS_MD, INJURY_FLAGS_MD, PACE_FRAMEWORK_MD } from './knowledge.generated.ts';
import { MAX_OUTPUT_TOKENS_BY_TIER } from './ai-pricing.ts';
import { PACE_FRAME_CAP, PACE_PILLARS, SCORE_BAND_VALUES } from './pace.ts';
import type { PaceTier } from './pace.ts';

// -------------------------------------------------------------------------------------------
// Inputs
// -------------------------------------------------------------------------------------------

/** What the runner submitted. A photo is exactly one frame; a video is 2..PACE_FRAME_CAP[tier]
 * frames extracted client-side (`lib/frames.ts`, #34). The original video never leaves the
 * device (Ruling 1), so "video" here always means "a handful of stills from one." */
export type PaceMediaKind = 'photo' | 'video';

/** Image MIME types Anthropic's vision API accepts. `lib/frames.ts` emits JPEG. */
export type PaceFrameMediaType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/**
 * One extracted frame, as it rides in the `analyze-form` request body (base64, per #88 — the
 * client never writes to the bucket).
 */
export interface PaceFrame {
  /** Raw base64 of the image bytes — NO `data:` URI prefix, which the API rejects. */
  base64: string;
  mediaType: PaceFrameMediaType;
  /**
   * The timestamp the client REQUESTED from the frame extractor — deliberately NOT named
   * `timestampMs`, because it is not the time of the frame you are looking at.
   *
   * `expo-video-thumbnails` cannot report the decoded time on either platform (issue #112):
   * Android snaps to the nearest keyframe (error can be hundreds of ms) and exposes no PTS; iOS
   * discards `AVAssetImageGenerator`'s `actualTime` out-parameter. Every consumer of this field
   * — above all the prompt text built from it — must treat it as approximate and say so. Do NOT
   * "fix" this by evenly spacing values and calling them actual: that looks precise, is wrong,
   * and signals nothing.
   */
  requestedTimestampMs: number;
}

export interface AnalyzeFormPromptInput {
  /** Server-derived, from `reserve_analysis`'s return — NEVER taken from the client (#41). */
  tier: PaceTier;
  media: PaceMediaKind;
  /** In capture order. Photo: exactly 1. Video: >= 2, up to `PACE_FRAME_CAP[tier]`. */
  frames: PaceFrame[];
}

// -------------------------------------------------------------------------------------------
// Anthropic Messages API shapes — the narrow slice this builder emits.
//
// Hand-declared rather than imported from `@anthropic-ai/sdk`: this module must stay free of any
// npm/Deno-only import so it unit-tests under both runners (the `ai-guard.ts` split, again).
// #44 passes the object straight to the SDK or to `fetch`; both accept this shape.
// -------------------------------------------------------------------------------------------

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

export interface AnthropicImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: PaceFrameMediaType; data: string };
}

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicTool {
  name: string;
  description: string;
  /** Grammar-constrained sampling: the tool input is GUARANTEED to match `input_schema`. */
  strict: true;
  input_schema: Record<string, unknown>;
}

export type AnthropicToolChoice =
  | { type: 'tool'; name: string; disable_parallel_tool_use?: boolean }
  | { type: 'auto'; disable_parallel_tool_use?: boolean };

/** On `claude-sonnet-5`, OMITTING this field means ADAPTIVE, not off — so it is always set
 * explicitly here. Manual thinking (`{type:'enabled', budget_tokens}`) is a 400 on this model. */
export type AnthropicThinkingConfig = { type: 'disabled' } | { type: 'adaptive' };

/**
 * STRUCTURED OUTPUTS — `output_config.format` (verified against the live docs 2026-07-13:
 * `/docs/en/build-with-claude/structured-outputs`). Grammar-constrained sampling applied to the
 * RESPONSE ITSELF, not to a tool's input. GA on `claude-sonnet-5` on the first-party Claude API,
 * which is what this project calls. This is the mechanism the analysis uses — see
 * `buildAnalyzeFormRequest`'s header for why it replaced the forced-tool-call approach.
 */
export interface AnthropicOutputFormat {
  type: 'json_schema';
  schema: Record<string, unknown>;
}

export interface AnalyzeFormRequest {
  model: string;
  max_tokens: number;
  system: AnthropicTextBlock[];
  messages: [{ role: 'user'; content: AnthropicContentBlock[] }];
  /** Omitted by default — structured outputs (`output_config.format`) carries the output contract
   * instead. Present only when a caller explicitly opts back in via `BuildRequestOptions.includeTool`
   * (kept for #42's evals, which may want to compare the two mechanisms head to head). */
  tools?: [AnthropicTool];
  tool_choice?: AnthropicToolChoice;
  thinking: AnthropicThinkingConfig;
  output_config: { effort: PaceEffort; format?: AnthropicOutputFormat };
}

/** The model `analyze-form` calls. Matches `ai-pricing.ts`'s `AI_MODEL_PRICING` key and
 * `gate_ai_call`'s default `p_model` — all three must name the same model or the spend gate
 * prices a call that never happened. */
export const ANALYZE_FORM_MODEL = 'claude-sonnet-5';

/**
 * `output_config.effort` — how eagerly the model spends tokens (thinking included).
 * Sonnet 5 supports `low | medium | high | xhigh | max` and defaults to `high`.
 */
export type PaceEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * THE EFFORT DIAL — a named constant, not a magic value, so #42 can sweep it.
 *
 * Chosen: `medium`. This is a real trade-off and the reasoning matters:
 *
 * FOR `high` (the API default): this call IS the product, and a hard multi-step vision-reasoning
 * task over up to 8 frames is exactly the kind of work thinking helps with.
 *
 * FOR `medium` (chosen), which wins on three concrete grounds:
 *   1. `medium` is not a weak setting. Anthropic's own cross-model mapping: "Claude Sonnet 5 at
 *      medium is comparable in intelligence to Claude Sonnet 4.6 at high." We are not shipping a
 *      degraded analyzer; we are shipping last-generation-flagship-at-high.
 *   2. Our `max_tokens` is deliberately tight (4-8k, `MAX_OUTPUT_TOKENS_BY_TIER`) and thinking
 *      tokens COUNT AGAINST IT. The docs name this exact failure — "if the budget is tight, you
 *      may see a response that is almost entirely thinking followed by a truncated answer and
 *      `stop_reason: max_tokens`" — and name the exact remedy: "Raising `max_tokens` or dropping
 *      to `medium` effort resolves this." A truncated response is not a cheap failure: it fails
 *      validation, triggers #45's retry, and bills TWICE.
 *   3. Thinking bills as OUTPUT ($15/Mtok, 5x input), so effort is the single biggest lever on
 *      real spend — and Ian's credits are a hard ceiling with auto-reload off.
 *
 * The docs' own guidance if this proves too low: "If you observe shallow reasoning on complex
 * problems, raise effort to `high` or `xhigh` rather than prompting around it." That is #42's
 * call to make against a real eval, not one to guess at here. Raising it is a one-line change —
 * but raise `MAX_OUTPUT_TOKENS_BY_TIER` (and with it the gate's reservation) in the same commit,
 * or you will simply buy truncations.
 */
export const ANALYZE_FORM_EFFORT: PaceEffort = 'medium';

// -------------------------------------------------------------------------------------------
// The structured-output contract — `input_schema` IS `PaceResult` (./pace.ts, #43)
// -------------------------------------------------------------------------------------------

export const PACE_ANALYSIS_TOOL_NAME = 'submit_pace_analysis';

/**
 * Score bands, machine value -> the human label the certified rubric uses. This table is the
 * translation layer between `pace_framework.md`'s prose ("Solid", "Developing") and
 * `ScoreBand`'s enum (`'good'`, `'mid'`) — WITHOUT it the model has to guess which enum value
 * "Solid" means, and a wrong guess renders a correctly-scored pillar in the wrong colour.
 * Ranges and labels are restated from the certified rubric, which is itself in the system prompt
 * (and from `constants/theme.ts`'s `ScoreBandLabel`/`ScoreBandRange`, which this file cannot
 * import — it pulls in react-native and is outside the deploy bundle; `pace.test.ts` guards
 * theme.ts <-> pace.ts drift, and `analyze-form-prompt.deno.test.ts` guards this table against
 * both the certified text and `SCORE_BAND_VALUES`).
 */
export const SCORE_BAND_RUBRIC: Record<string, { label: string; range: string }> = {
  strong: { label: 'Strong', range: '85-100' },
  good: { label: 'Solid', range: '70-84' },
  mid: { label: 'Developing', range: '50-69' },
  low: { label: 'Needs work', range: '0-49' },
};

const SCORE_DESCRIPTION =
  'Integer 0-100 for this pillar, or null if the pillar could not be assessed from this media. ' +
  'NEVER invent a number to fill this field: null is always the correct answer when you cannot ' +
  'see what you would need to see. Bands: ' +
  SCORE_BAND_VALUES.map((b) => `${SCORE_BAND_RUBRIC[b].range} = ${SCORE_BAND_RUBRIC[b].label}`)
    .reverse()
    .join(', ') +
  '.';

const BAND_DESCRIPTION =
  'The band `score` falls in, or null EXACTLY when score is null (never one without the other). ' +
  SCORE_BAND_VALUES.map((b) => `"${b}" = ${SCORE_BAND_RUBRIC[b].label} (${SCORE_BAND_RUBRIC[b].range})`)
    .reverse()
    .join('; ') +
  '.';

/**
 * JSON Schema for one pillar. Mirrors `PacePillarResult` exactly.
 *
 * SCHEMA LIMITS THAT SHAPED THIS (Anthropic structured outputs, verified 2026-07-12):
 *   - Numerical constraints (`minimum`/`maximum`) are NOT supported, so 0-100 cannot be enforced
 *     here. It lives in the description, and `isPaceResult`'s `isScoreInRange` enforces it at
 *     runtime. Shape is guaranteed by the schema; range is guaranteed by code.
 *   - `additionalProperties: false` is required on every object.
 *   - Union-typed (`anyOf`) params are capped at 16 per request. This schema uses 10 (score and
 *     band x 4 pillars, plus overall's two) — `feedback` is deliberately a plain required
 *     `string` rather than `string | null`, which is both within `PacePillarResult`'s type
 *     (`string` satisfies `string | null`) and better product behaviour: a not-assessed pillar
 *     should still say WHY, and what shot would fix it.
 */
function pillarSchema(pillarLabel: string): Record<string, unknown> {
  return {
    type: 'object',
    description: `The ${pillarLabel} pillar.`,
    properties: {
      score: {
        anyOf: [{ type: 'integer' }, { type: 'null' }],
        description: SCORE_DESCRIPTION,
      },
      band: {
        anyOf: [{ type: 'string', enum: [...SCORE_BAND_VALUES] }, { type: 'null' }],
        description: BAND_DESCRIPTION,
      },
      feedback: {
        type: 'string',
        description:
          'Coaching feedback for this pillar, tied to what is actually visible in the frames. ' +
          'Length is set by the tier instruction in the prompt. When score is null, use this to ' +
          'say plainly that it could not be assessed and what shot would fix it.',
      },
      notAssessedReason: {
        type: 'string',
        enum: ['angle', 'needsVideo'],
        description:
          'Include ONLY when score is null. "needsVideo": the pillar is motion over time and ' +
          'this is a single photo (Cadence and Elasticity always take this on a photo). ' +
          '"angle": the camera angle, framing, lighting, or crop does not show what this pillar ' +
          'needs.',
      },
      flags: {
        type: 'array',
        description:
          'Injury-risk flags raised against this pillar, taken ONLY from injury_flags.md and ' +
          'ONLY when you can actually see the marker. [] when none, when the pillar is not ' +
          'assessed, or when the tier instruction says no flags. Never invent a flag.',
        items: {
          type: 'object',
          properties: {
            pattern: {
              type: 'string',
              description: 'Short label for the observed pattern, e.g. "Overstriding".',
            },
            detail: {
              type: 'string',
              description:
                "injury_flags.md's own template: what you see -> what it is associated with -> " +
                'the safe next step. Describe a visible pattern associated with risk. NEVER ' +
                'name a condition as present and never diagnose.',
            },
          },
          required: ['pattern', 'detail'],
          additionalProperties: false,
        },
      },
      drills: {
        type: 'array',
        description:
          'Corrective drills for this pillar, taken ONLY from drills.md, 1-2 per flagged issue, ' +
          'matched to what you saw. [] when none, when the pillar is not assessed, or when the ' +
          'tier instruction says no drills. Never invent a drill.',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'The drill\'s name as written in drills.md, e.g. "Pogo Hops".',
            },
            instructions: {
              type: 'string',
              description: 'The cue/instructions for it, from drills.md.',
            },
          },
          required: ['name', 'instructions'],
          additionalProperties: false,
        },
      },
    },
    required: ['score', 'band', 'feedback', 'flags', 'drills'],
    additionalProperties: false,
  };
}

const PILLAR_LABELS: Record<string, string> = {
  posture: 'Posture (P)',
  armSwing: 'Arm swing (A)',
  cadence: 'Cadence (C)',
  elasticity: 'Elasticity (E)',
};

/**
 * THE OUTPUT CONTRACT, as one JSON Schema: exactly `PaceResult` from `./pace.ts` (#43) — the
 * identical shape the app renders and `analyses.result` stores. There is no parallel definition
 * and no adapter.
 *
 * ONE definition, TWO possible carriers. It is sent as `output_config.format.schema` (structured
 * outputs — the default, see `buildAnalyzeFormRequest`) and, when a caller opts in with
 * `includeTool`, as `PACE_ANALYSIS_TOOL.input_schema` as well. Both are the same
 * grammar-constrained-sampling pipeline on Anthropic's side, and both are fed from this single
 * constant, so the two carriers can never describe different shapes.
 *
 * WHAT THIS SCHEMA CANNOT ENFORCE, and why `isPaceResult` still runs on the way out (#45):
 * numerical constraints (`minimum`/`maximum`) are NOT in the supported JSON Schema subset, so
 * "score is 0-100" is unenforceable here and lives in the descriptions plus a runtime check. The
 * schema guarantees the SHAPE; code guarantees the RANGE. This is not belt-and-braces, it is a
 * documented hole.
 */
export const PACE_RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    pillars: {
      type: 'object',
      description: 'All four PACE pillars. Every pillar is always present, even when not assessed.',
      properties: Object.fromEntries(
        PACE_PILLARS.map((id) => [id, pillarSchema(PILLAR_LABELS[id])])
      ),
      required: [...PACE_PILLARS],
      additionalProperties: false,
    },
    overall: {
      type: 'object',
      description:
        'The headline number: the average of the pillar scores you actually assessed. Null ' +
        '(with a null band) when NO pillar could be assessed — never a fabricated overall ' +
        'built from zero real data.',
      properties: {
        score: {
          anyOf: [{ type: 'integer' }, { type: 'null' }],
          description:
            'Average of the non-null pillar scores, rounded to an integer. Do not count ' +
            'not-assessed pillars as zeros — that would silently punish the runner for a ' +
            'camera angle. Null only when every pillar is null. ' +
            SCORE_DESCRIPTION,
        },
        band: {
          anyOf: [{ type: 'string', enum: [...SCORE_BAND_VALUES] }, { type: 'null' }],
          description: BAND_DESCRIPTION,
        },
      },
      required: ['score', 'band'],
      additionalProperties: false,
    },
  },
  required: ['pillars', 'overall'],
  additionalProperties: false,
};

/** The `output_config.format` payload — the default carrier for the schema above. */
export const PACE_OUTPUT_FORMAT: AnthropicOutputFormat = {
  type: 'json_schema',
  schema: PACE_RESULT_SCHEMA,
};

/** The tool form of the same contract. NO LONGER SENT BY DEFAULT (see `buildAnalyzeFormRequest`) —
 * structured outputs carries the contract instead. Kept, exported, and tested because #42's evals
 * may want to compare the two mechanisms, and because `strict: true` on it is still the correct
 * configuration if anyone ever does send it. */
export const PACE_ANALYSIS_TOOL: AnthropicTool = {
  name: PACE_ANALYSIS_TOOL_NAME,
  description:
    'Submit the completed PACE running-form analysis. Call this exactly once, as your entire ' +
    'response, for every submission — including one where most pillars could not be assessed ' +
    '(report those with score: null, never a guessed number). This is the only way to return a ' +
    'result; do not answer in prose.',
  strict: true,
  input_schema: PACE_RESULT_SCHEMA,
};

// -------------------------------------------------------------------------------------------
// The tier verbosity dial — ONE prompt, one parameter (docs/architecture.md step 7)
// -------------------------------------------------------------------------------------------

interface TierVerbosity {
  /** Rendered into the prompt as the tier's depth instruction. */
  readonly depth: string;
}

/**
 * The ENTIRE difference between the three tiers. Note what is absent: nothing here can change a
 * score, un-null a not-assessed pillar, soften the medical boundary, or license a precise
 * cadence figure. Those rules live in `INVARIANT_RULES` and are appended identically for every
 * tier — so "higher tier" can only ever buy more words, never more certainty. That separation is
 * the point (issue #112: "Higher tier buys more depth, never more false precision").
 *
 * The Pro -> Elite gap is deliberately tiny (`docs/architecture.md`: "the same analysis as Pro
 * plus a small verbosity/depth bump").
 */
export const TIER_VERBOSITY: Record<PaceTier, TierVerbosity> = {
  free: {
    depth: [
      'TIER: FREE.',
      '- `feedback`: exactly ONE sentence per pillar. The single most useful thing you can see.',
      '- `flags`: ALWAYS the empty array `[]` for every pillar. Injury-risk flags are paid-tier',
      '  content. (The one exception is the stop-running safety signal — see SAFETY below, which',
      '  overrides this and every other verbosity instruction.)',
      '- `drills`: ALWAYS the empty array `[]` for every pillar. Drills are paid-tier content.',
      '- Still score every pillar you can actually assess, to the same standard as any other',
      '  tier. Free means shorter, never sloppier, and never more confident.',
    ].join('\n'),
  },
  pro: {
    depth: [
      'TIER: PRO.',
      '- `feedback`: 2-4 sentences per pillar — what you see, why it matters, and the fix.',
      '- `flags`: raise every injury-risk flag from injury_flags.md whose marker you can actually',
      '  SEE in these frames, on the pillar it belongs to. [] if you see none — an empty array is',
      '  a fine and common answer, and much better than a stretched one.',
      '- `drills`: 1-2 drills from drills.md per flagged issue, matched to what you saw. Never',
      '  dump the library. Respect the plyometric safety gates in drills.md.',
    ].join('\n'),
  },
  elite: {
    depth: [
      'TIER: ELITE.',
      '- Everything Pro gets, judged to exactly the same standard. The step up from Pro is small,',
      '  and it is purely depth of cueing — no extra certainty, no extra flags, no extra drills.',
      '- `feedback`: 3-5 sentences per pillar. Spend the extra room on the HOW: the specific cue,',
      '  what it should feel like, and how this pillar is feeding the others.',
      '- `flags`: same rule as Pro. A higher tier does not lower the bar for raising one.',
      '- `drills`: same 1-2 per issue as Pro, with a little more detail on execution.',
    ].join('\n'),
  },
};

// -------------------------------------------------------------------------------------------
// The invariant rules — identical at every tier, assembled outside the dial
// -------------------------------------------------------------------------------------------

/**
 * The medical boundary. Unconditional: it is appended for Free exactly as for Elite, and no
 * verbosity instruction can reach it.
 *
 * NOTE ON THE DISCLAIMER: the "not medical advice" disclaimer text is NOT model output. It ships
 * as a static UI footer (`components/result-disclaimer.tsx` rendering
 * `result.disclaimer.footer`, issue #68) on EVERY result screen, EVERY tier, no exceptions —
 * which is a far stronger guarantee than asking a model to remember it, because a static footer
 * cannot be omitted, reworded, or hallucinated. The model's half of that contract is what is
 * below: never diagnose, never prescribe treatment, never claim a condition is present, and do
 * NOT re-emit the disclaimer text into `feedback` (it would double-render under the footer).
 */
const SAFETY_RULES = [
  'SAFETY AND THE MEDICAL BOUNDARY (absolute; identical at every tier):',
  '- You are NOT diagnosing. You flag VISIBLE MOVEMENT PATTERNS ASSOCIATED WITH elevated injury',
  '  risk. "This landing pattern is associated with higher knee load" — NEVER "you have runner\'s',
  '  knee." Never name a condition as present. Never prescribe treatment.',
  '- STOP-RUNNING SIGNALS OVERRIDE THE TIER DIAL. If the frames plainly show a stop-running',
  '  signal from injury_flags.md (visible swelling, a limp, clear favouring of one side), say so',
  "  FIRST, in the `feedback` of the pillar it shows up in, at EVERY tier including Free — in",
  '  calm, plain language, telling the runner to get it looked at before running on it. It is',
  '  never buried under form feedback and never withheld because a tier is cheap.',
  '- Do NOT write the "not medical advice" disclaimer into any field. The app renders it under',
  '  every single result already, on every tier. Writing it again would double it on screen.',
].join('\n');

/**
 * The honest-failure rules. `score: null` is a first-class, correct answer — not a failure state.
 * `PacePillarResult.score` is `number | null` precisely so this is representable (#43).
 */
const NOT_ASSESSED_RULES = [
  'WHEN YOU CANNOT SEE IT, SAY SO (this is the rule that matters most):',
  '- NEVER fabricate a score. A pillar you cannot assess from THIS media gets `score: null`,',
  '  `band: null`, and a `notAssessedReason`. A null score is a correct, expected, honest answer',
  '  and costs you nothing. A guessed number is the worst thing you can return: it is confident,',
  '  fluent, and wrong, and the runner cannot tell.',
  '- `score` and `band` are null TOGETHER or non-null TOGETHER. Never one without the other.',
  '- A not-assessed pillar still gets `feedback`: say plainly that it could not be assessed and',
  '  what shot would fix it (usually: "film side-on, full body, level camera, ~10 m away, in',
  '  good light"). Its `flags` and `drills` are `[]`.',
  '- Assess ONLY what is actually visible. Camera angle, framing, lighting, or crop can all make',
  '  a pillar unscoreable — that is an `angle` reason, not an invitation to guess. A side-on',
  '  (sagittal) view is required for Posture, Cadence, and Elasticity.',
  '- Do not count not-assessed pillars as zeros in `overall`. Average only what you scored.',
].join('\n');

/**
 * ISSUE #112, THE LOAD-BEARING ONE. Every word here is doing work.
 *
 * `pace_framework.md` says a cadence range may be estimated "only if frame timestamps are
 * known". They are known only APPROXIMATELY — so the certified clause has to be read that way,
 * and the model has to be told, or it will read "timestamps: [0, 400, 800]" as ground truth and
 * compute a step rate off a rhythm that never happened.
 *
 * The escape hatch that keeps the product useful: the visible signature of low cadence
 * (overstriding — foot landing ahead of the COM with a near-straight knee) and of poor
 * elasticity (heavy, stiff, collapsing contact; big torso rise) are BOTH readable from a single
 * frame's geometry and do NOT depend on timestamps at all. So the prompt pushes the model onto
 * the timestamp-independent evidence as primary, and demotes anything timing-derived to a hedged
 * secondary. That is not a downgrade — it is what `pace_framework.md` already says is the most
 * important thing you can see.
 *
 * THE CERTIFIED-CLAUSE AMENDMENT (the last block below) uses the SAME MECHANISM as
 * `INPUT_CHANNEL_RULES` does for issue #40's runner's-note clauses, and for the same reason:
 * `pace_framework.md` is CERTIFIED CONTENT shipping under Ian's name and is not editable without
 * his certification review (#39/#40). It contains exactly two clauses that presuppose a timing
 * precision this deployment does not have — "**Only if frame timestamps are known** may you
 * estimate a cadence *range*" (which a model reading the frame manifest would score as SATISFIED,
 * because timestamps are visibly present) and "Across evenly-spaced frames you can estimate …
 * vertical bounce" (which the frames are NOT reliably). Both are quoted back verbatim and re-read
 * at the prompt layer: "known" becomes "known approximately", "evenly-spaced" becomes "not
 * reliably evenly spaced". The certified file is shipped byte-for-byte and unedited; only its
 * reading is amended, and the amendment can only ever TIGHTEN (it licenses nothing the certified
 * file forbids). `analyze-form-prompt.deno.test.ts` § 5 asserts both quoted clauses still exist
 * in `PACE_FRAMEWORK_MD` byte-for-byte — so if a future certification pass rewords them, the
 * suite fails loudly instead of leaving an amendment that silently points at nothing.
 */
const TIMESTAMP_RULES = [
  'FRAME TIMESTAMPS ARE APPROXIMATE — READ THIS BEFORE SCORING CADENCE OR ELASTICITY:',
  '- The times given with the frames below are the times the app ASKED the video decoder for.',
  '  They are NOT the times of the frames you are actually looking at. The decoder returns the',
  '  nearest frame it can (on Android, the nearest keyframe) and does not report which one it',
  '  gave back. The true gap between two frames can differ from the stated gap by HUNDREDS OF',
  '  MILLISECONDS, and the frames are not necessarily evenly spaced in time even when the stated',
  '  times are.',
  '- Cadence and Elasticity are both motion over time, so both are exposed to this. Therefore:',
  '  * Score them PRIMARILY from evidence that does not depend on timing at all — which is also',
  '    the evidence pace_framework.md calls the most important thing you can see. For Cadence:',
  '    the OVERSTRIDING SIGNATURE (foot landing clearly ahead of the centre of mass, near-',
  '    straight knee at contact, shin angled forward, aggressive heel-first strike). For',
  '    Elasticity: the LOOK of the contact and the landing (stiff/collapsing/heavy vs compliant',
  '    and springy; knee and ankle give that reloads; how far the torso rises between frames).',
  '    None of that needs a clock.',
  '  * Treat any interval-derived quantity as a WIDE, EXPLICITLY APPROXIMATE estimate, and say in',
  '    the `feedback` that it is approximate. Widen your confidence accordingly — if the timing',
  '    is the only thing pointing at a fault, that is not enough to call the fault.',
  '  * SAY IT IN THE OUTPUT, NOT JUST IN YOUR HEAD. Any Cadence or Elasticity judgement that leans',
  '    on the frame timing AT ALL must carry that uncertainty in the `feedback` the runner',
  '    actually reads — they never see your reasoning, only `score`, `band`, and `feedback`. Name',
  '    it plainly: "roughly 160-170 SPM — approximate, estimated from frames whose timing is not',
  '    exact". A hedge you kept to yourself is not a hedge; it is just a confident number with a',
  '    private doubt attached.',
  '- FORBIDDEN AT EVERY TIER, INCLUDING ELITE — these are false precision, and a paying tier buys',
  '  more DEPTH, never more CERTAINTY:',
  '  * A single precise cadence figure ("your cadence is 164 SPM"). A labelled approximate RANGE',
  '    ("roughly 160-170 SPM, approximate — estimated from frames whose timing is not exact") is',
  '    the most you may ever give, and only when the frames genuinely support it.',
  '  * Any ground-contact-time figure in milliseconds. GCT is a lab metric; from a phone video',
  '    you are inferring lightness vs heaviness, not measuring. Say it that way.',
  '  * Any vertical-oscillation figure in centimetres. Same reason: describe the bounce, do not',
  '    measure it.',
  '- If you cannot support a Cadence or Elasticity judgement from the visible geometry, the',
  '  honest answer is `score: null` — not a number propped up by timings you cannot trust.',
  '',
  'HOW TO READ pace_framework.md\'s TWO TIMING CLAUSES. The certified framework above was written',
  'assuming a timing precision this deployment does not have. It is reproduced unedited, and these',
  'two clauses — and ONLY these two — are amended in how you READ them. The amendment can only',
  'ever TIGHTEN: it licenses nothing the certified file forbids.',
  '- It says: "**Only if frame timestamps are known** may you estimate a cadence *range* from',
  '  steps-per-second across frames — and label it approximate." READ "known" AS "KNOWN',
  '  APPROXIMATELY". The condition is met only in that weak sense — the timestamps below are',
  '  requested, not measured — so what the clause licenses is a WIDE range, labelled approximate,',
  '  and NEVER a point figure. Where a steps-per-second count off these frames disagrees with what',
  '  the geometry plainly shows, believe the geometry.',
  '- It says: "Across evenly-spaced frames you can estimate ... vertical bounce (torso height',
  '  change between frames)." THESE FRAMES ARE NOT RELIABLY EVENLY SPACED, whatever their stated',
  '  times suggest. The torso height CHANGE between frames is still real evidence — you can see it',
  '  with your own eyes — but its RATE is not, so judge the bounce by how big it looks, never by',
  '  dividing it by a stated interval.',
  '- Every other rule in pace_framework.md stands unchanged and in full — above all "Never',
  '  fabricate a number" and "Never state a precise SPM you cannot derive", which this amendment',
  '  reinforces rather than relaxes.',
].join('\n');

/**
 * THE INPUT CHANNEL. Closes the note-shaped hole in the certified files (issue #40, still open;
 * `docs/status.md` Known Issue #10, resolved as "dropped for MVP").
 *
 * `injury_flags.md` and `drills.md` are certified content and repeatedly say things like "if the
 * runner's note reports it" / "only if the note volunteers it". No note field ships in the MVP —
 * `analyze-form` takes frames and nothing else. Those clauses are therefore DORMANT, and a model
 * reading them without being told would be free to invent what the runner "reported" in order to
 * satisfy them. This neutralises them at the prompt layer rather than by editing certified text
 * (which needs Ian's certification review — #39/#40), which is exactly where the fix belongs.
 */
const INPUT_CHANNEL_RULES = [
  'WHAT YOU HAVE, AND WHAT YOU DO NOT:',
  '- You have the frames below. That is the entire input. There is NO runner\'s note, no reported',
  '  symptoms, no pain report, no age, no injury history, no mileage, no training log, no',
  '  surface, and no prior analysis.',
  '- The certified files below contain instructions conditioned on a runner\'s note ("if the note',
  '  reports pain", "only if the note volunteers it", the special-population weighting). This',
  '  product ships no note field, so EVERY one of those conditions is FALSE. Follow the rest of',
  '  those files exactly; treat the note-conditional clauses as inactive.',
  '- Never state or imply that the runner told you anything. You have never spoken to them.',
  '- Because you cannot know about pain, an Achilles problem, or a return from injury, apply',
  "  drills.md's plyometric safety gates conservatively: introduce the Elasticity ladder at its",
  '  entry level, with its cautions attached.',
].join('\n');

/** Everything the tier dial cannot touch, in one place. Assembled identically for free, pro, and
 * elite — the property `analyze-form-prompt.deno.test.ts` asserts directly. */
const INVARIANT_RULES = [INPUT_CHANNEL_RULES, NOT_ASSESSED_RULES, TIMESTAMP_RULES, SAFETY_RULES].join(
  '\n\n'
);

// -------------------------------------------------------------------------------------------
// Assembly
// -------------------------------------------------------------------------------------------

const ROLE_PREAMBLE = [
  'You are the PACE running-form analyzer: a certified running coach reading a runner\'s form',
  'from a photo or a few frames of video, and returning a structured, grounded assessment of the',
  'four PACE pillars — Posture, Arm swing, Cadence, Elasticity.',
  '',
  'Your authority is the three certified documents below and NOTHING ELSE. Every rubric, band,',
  'cue, drill, and injury-risk flag you use must come from them. Do not supplement them with',
  'general running knowledge, do not invent biomechanics that sound right, and do not import',
  'coaching advice from anywhere else — ungrounded advice that reads fluently is the single worst',
  'thing this system can produce, because nobody can tell it is wrong.',
].join('\n');

const MEDIUM_RULES: Record<PaceMediaKind, string> = {
  photo: [
    'THE MEDIA: A SINGLE PHOTO. One frame, one instant.',
    '- You CAN assess: Posture (trunk lean, head, shoulders, pelvis) and Arm swing POSITION',
    '  (elbow angle, where the hands are, whether they cross the midline).',
    '- You CANNOT assess Cadence or Elasticity from one frame. Both are motion over time; a still',
    '  cannot show step rate, vertical oscillation, or contact quality. Do not infer them from a',
    '  single pose, however suggestive it looks.',
    '  => Cadence and Elasticity MUST both be `score: null`, `band: null`, `notAssessedReason:',
    '     "needsVideo"`. This is not a failure — it is the correct, honest result for a photo.',
    '     Tell the runner a short video would unlock those two pillars.',
    '- Arm swing RANGE (the arc) is also motion over time. Judge position only, and say so.',
  ].join('\n'),
  video: [
    'THE MEDIA: FRAMES FROM A SHORT VIDEO, in capture order.',
    '- Across frames you can assess all four pillars: trunk/pelvis alignment, arm-swing arc and',
    '  symmetry, where the foot lands relative to the centre of mass, and how much the torso',
    '  rises and falls.',
    '- Read the frames as a sequence: the same runner, moments apart. Compare them to each other',
    '  — that comparison, not any single frame, is the analysis.',
    '- The timing between them is approximate. Read the FRAME TIMESTAMPS section before you use',
    '  it for anything.',
  ].join('\n'),
};

/**
 * The system message: role, then the three certified documents verbatim, then the operating
 * rules for THIS deployment.
 *
 * `cache_control: {type: 'ephemeral'}` on the last block: the certified knowledge is ~25KB of
 * markdown and is byte-identical on every call, so caching it turns a large repeated input cost
 * into a 0.1x cache read (`ai-pricing.ts` already models `cacheReadMultiplier`). The cache
 * breakpoint sits after the invariant rules so everything above it — knowledge AND rules — is
 * cached; only the tier line and the frames differ per call, and those live in the user turn.
 */
export function buildSystemPrompt(input: AnalyzeFormPromptInput): AnthropicTextBlock[] {
  const text = [
    ROLE_PREAMBLE,
    '',
    '='.repeat(88),
    'CERTIFIED DOCUMENT 1 of 3 — THE PACE FRAMEWORK (the scoring rubric, and the four hard rules)',
    '='.repeat(88),
    '',
    PACE_FRAMEWORK_MD,
    '',
    '='.repeat(88),
    'CERTIFIED DOCUMENT 2 of 3 — INJURY-RISK FLAGS (the only flags you may ever raise)',
    '='.repeat(88),
    '',
    INJURY_FLAGS_MD,
    '',
    '='.repeat(88),
    'CERTIFIED DOCUMENT 3 of 3 — CORRECTIVE DRILLS (the only drills you may ever prescribe)',
    '='.repeat(88),
    '',
    DRILLS_MD,
    '',
    '='.repeat(88),
    'OPERATING RULES FOR THIS ANALYSIS',
    '='.repeat(88),
    '',
    MEDIUM_RULES[input.media],
    '',
    INVARIANT_RULES,
  ].join('\n');

  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

/**
 * The frame manifest. Every timestamp is rendered with `~` and the word "requested", and every
 * interval with "approximately" — there is no code path that prints a bare, authoritative-looking
 * millisecond value (issue #112).
 */
export function formatFrameManifest(frames: PaceFrame[]): string {
  if (frames.length === 1) {
    return 'FRAME MANIFEST: 1 frame (a single photo — no timing information applies).';
  }

  const lines = frames.map((frame, i) => {
    const requested = Math.round(frame.requestedTimestampMs);
    if (i === 0) {
      return `- Frame ${i + 1}: requested at ~${requested} ms (start of the sampled window).`;
    }
    const gap = Math.round(frame.requestedTimestampMs - frames[i - 1].requestedTimestampMs);
    return `- Frame ${i + 1}: requested at ~${requested} ms — approximately ${gap} ms after frame ${i} (NOT an exact interval).`;
  });

  return [
    `FRAME MANIFEST: ${frames.length} frames, in capture order.`,
    ...lines,
    '',
    'Every time above is a REQUESTED time, not a measured one. The real intervals may differ by',
    'hundreds of milliseconds and may not be evenly spaced. Use them only as a rough ordering and',
    'a rough sense of elapsed time — never as the basis for a precise rate.',
  ].join('\n');
}

/**
 * THE OUTPUT CONTRACT — deliberately the LAST thing in the prompt.
 *
 * Instructions at the very end of a long prompt are followed more reliably than ones buried in
 * the middle, and this is the one that determines whether the response is parseable at all. The
 * knowledge (25KB of it) is in the middle, where it belongs: it is reference material the model
 * reads, not an instruction competing for the last word.
 */
function buildOutputContract(input: AnalyzeFormPromptInput): string {
  return [
    '='.repeat(88),
    'NOW ANALYZE — AND HOW TO RETURN IT',
    '='.repeat(88),
    '',
    'Work through the frames against the certified framework: Posture, then Arm swing, then',
    'Cadence, then Elasticity. Score only what you can see. Name, in the priority pillar\'s',
    'feedback, the one pillar whose fix would most improve the others, and lead the runner there',
    '(pace_framework.md: "How the four pillars work together").',
    '',
    TIER_VERBOSITY[input.tier].depth,
    '',
    'Depth is the ONLY thing the tier changes. It does not change a score, does not un-null a',
    'pillar you could not assess, does not soften the medical boundary, and does not buy a more',
    'precise cadence figure. A paid analysis is longer, not more certain.',
    '',
    'RETURN THE RESULT AS A SINGLE JSON OBJECT MATCHING THE REQUIRED OUTPUT SCHEMA. That object is',
    'your entire response — no prose before or after it, no markdown fence. The schema is the',
    'contract:',
    '- `pillars`: all four (`posture`, `armSwing`, `cadence`, `elasticity`), always all four,',
    '  every one with `score`, `band`, `feedback`, `flags`, `drills`.',
    '- `score`: an integer 0-100, or `null` if you could not assess it. `band` is null exactly',
    '  when `score` is null. Add `notAssessedReason` whenever `score` is null.',
    `- Bands: ${SCORE_BAND_VALUES.map((b) => `${SCORE_BAND_RUBRIC[b].range} -> "${b}" (${SCORE_BAND_RUBRIC[b].label})`)
      .reverse()
      .join('; ')}.`,
    '- `overall`: the average of the pillars you actually scored, rounded to an integer, with its',
    '  band. Both null only if you assessed nothing at all.',
    '',
    'Be calibrated: most healthy recreational runners land in Solid/Developing. Do not flatter,',
    'and do not manufacture severity to sound useful.',
  ].join('\n');
}

/**
 * The user turn: the frame manifest, then the image blocks each labelled with its (approximate)
 * requested time, then the output contract last. This is `docs/architecture.md` step 7's ordering
 * — "system message = the certified PACE knowledge..., then the image block(s) plus their
 * timestamps, then the PACE scoring instruction."
 */
export function buildUserContent(input: AnalyzeFormPromptInput): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];

  blocks.push({
    type: 'text',
    text: [
      input.media === 'photo'
        ? 'Here is the runner\'s submission: one photo.'
        : `Here is the runner's submission: ${input.frames.length} frames from a short video.`,
      '',
      formatFrameManifest(input.frames),
    ].join('\n'),
  });

  input.frames.forEach((frame, i) => {
    blocks.push({
      type: 'text',
      text:
        input.media === 'photo'
          ? 'The photo:'
          : `Frame ${i + 1} of ${input.frames.length} — requested at ~${Math.round(
              frame.requestedTimestampMs
            )} ms (approximate):`,
    });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: frame.mediaType, data: frame.base64 },
    });
  });

  blocks.push({ type: 'text', text: buildOutputContract(input) });

  return blocks;
}

// -------------------------------------------------------------------------------------------
// Request assembly
// -------------------------------------------------------------------------------------------

/**
 * HOW THE OUTPUT CONTRACT IS ENFORCED — settled 2026-07-13 against the live docs, replacing an
 * earlier note here that was WRONG in a way that mattered. Read this before changing any of it.
 *
 * THE CORRECTION. This comment used to say that Anthropic's docs state, "with NO platform
 * scoping", that a forced `tool_choice` is incompatible with extended thinking, and that a report
 * of the restriction being Amazon-Bedrock-only "could not be confirmed". That was wrong, and it
 * was load-bearing: it talked #44 out of a guarantee it could have had, and it very nearly got
 * hardened into a permanent "you can never force the tool call" rule. **The restriction is
 * BEDROCK-ONLY.** On Amazon Bedrock, a forced `tool_choice` requires `thinking: {type:
 * 'disabled'}`; **the first-party Claude API and Vertex AI do not require this.** This project
 * calls the first-party Claude API (`api.anthropic.com`, `x-api-key`, from the `analyze-form` edge
 * function — see `analyze-form/deps.ts`), so the restriction never applied to us at all.
 *
 * THE MECHANISM WE ACTUALLY USE, AND WHY IT IS NEITHER OF THE TWO WE WERE ARGUING ABOUT:
 * **structured outputs** (`output_config.format`, GA on `claude-sonnet-5` on the Claude API).
 * Grammar-constrained sampling applied to the RESPONSE ITSELF, against `PACE_RESULT_SCHEMA`.
 *
 * Why this, rather than settling the forced-tool-call question:
 *   1. It is a STRONGER guarantee. A forced tool call guarantees "some tool was invoked"; the
 *      schema then constrains that tool's input. Structured outputs constrain the answer itself —
 *      the response is schema-conformant by construction, with no tool-call indirection at all.
 *   2. It makes the whole dispute MOOT. With no `tools` and no `tool_choice` in the request, there
 *      is nothing for a platform-specific tool-choice rule to be incompatible with. The request is
 *      correct on the Claude API, on Bedrock, and on Vertex, under every reading of every doc.
 *      That is a better place to be than "we picked the right side of an argument."
 *   3. It is documented compatible with extended thinking, so we keep adaptive thinking — which is
 *      the thing we could never afford to lose on a multi-step vision task over 8 frames.
 *   4. It is cheaper. `tools` is billed as input like everything else (~13k characters of schema
 *      descriptions here), and a forced tool call adds a ~474-token tool-use system prompt on top.
 *      Dropping both removes that from every call. Structured outputs injects a system prompt of
 *      its own, so this is a reduction, not an elimination — but it is a reduction.
 *
 * WHAT STRUCTURED OUTPUTS DOES *NOT* GUARANTEE (verified, and it is why #45's fallback path stays
 * exactly where it is — do not delete it on the theory that the schema makes failure impossible):
 *   - `stop_reason: 'refusal'` — "the output may not match your schema because the refusal message
 *     takes precedence over schema constraints."
 *   - `stop_reason: 'max_tokens'` — "the output may be incomplete and not match your schema."
 *     Thinking tokens count against `max_tokens`, so this is a live risk on every call.
 *   - Numerical constraints (`minimum`/`maximum`) are NOT in the supported JSON Schema subset, so
 *     "score is an integer 0-100" is UNENFORCEABLE by the schema. `isPaceResult` enforces the
 *     range at runtime.
 *   - Enum casing is best-effort, not exact.
 * So the response is *usually* schema-perfect and *occasionally* not, in exactly the situations
 * where a runner's analysis is most likely to go wrong. Validate anyway.
 *
 * UNCHANGED AND STILL CORRECT: `thinking` is set to `{type: 'adaptive'}` EXPLICITLY (on
 * `claude-sonnet-5`, omitting it also means adaptive, but an explicit value cannot be misread
 * later as an oversight), and NO `temperature`/`top_p`/`top_k` is sent (this model 400s on any
 * non-default value of them, on every request).
 */
export interface BuildRequestOptions {
  /**
   * Defaults to `{type: 'adaptive'}` — thinking ON, which is what this call needs. Structured
   * outputs is compatible with it, so there is no longer any reason to trade one for the other.
   */
  thinking?: AnthropicThinkingConfig;
  /**
   * Send the `submit_pace_analysis` TOOL alongside/instead of structured outputs. Defaults to
   * `false`: the output contract travels in `output_config.format`, and adding a tool that
   * describes the same shape a second time is redundant, more expensive, and reintroduces the
   * platform-specific `tool_choice` question for no benefit. Exists for #42, which may want to
   * eval the two mechanisms head to head.
   */
  includeTool?: boolean;
  /**
   * Only meaningful with `includeTool`. Forces `tool_choice: {type: 'tool'}` instead of `auto`.
   * This is LEGAL alongside adaptive thinking on the first-party Claude API — the incompatibility
   * is Bedrock-only (see the note above).
   */
  forceToolCall?: boolean;
  /** Defaults to `ANALYZE_FORM_EFFORT` (`medium`) — see that constant for the reasoning. */
  effort?: PaceEffort;
  /** Defaults to `ANALYZE_FORM_MODEL`. */
  model?: string;
}

/**
 * Validates the frames against what the tier is actually allowed to send. NOT the enforcement
 * point — `reserve_analysis` (SECURITY DEFINER, service-role) is the sole authority on tier and
 * frame cap (CLAUDE.md: "No business rules in the client", and the caps are re-checked
 * server-side). This is a defensive assertion so a bug in the caller becomes a local throw
 * instead of an oversized, overpriced vision call.
 */
function assertFramesValid(input: AnalyzeFormPromptInput): void {
  const { frames, media, tier } = input;

  if (frames.length === 0) {
    throw new RangeError('analyze-form prompt requires at least one frame; got none.');
  }
  if (media === 'photo' && frames.length !== 1) {
    throw new RangeError(
      `A photo submission is exactly 1 frame; got ${frames.length}. (Use media: 'video' for a sequence.)`
    );
  }
  const cap = PACE_FRAME_CAP[tier];
  if (frames.length > cap) {
    throw new RangeError(
      `Tier "${tier}" allows at most ${cap} frame(s); got ${frames.length}. reserve_analysis is ` +
        'the authority on this cap — a request this size should never have been built.'
    );
  }
  for (const [i, frame] of frames.entries()) {
    if (frame.base64.length === 0) {
      throw new RangeError(`Frame ${i + 1} has empty base64 data.`);
    }
    if (frame.base64.startsWith('data:')) {
      throw new RangeError(
        `Frame ${i + 1} carries a \`data:\` URI prefix. The API wants raw base64 only; strip it.`
      );
    }
    if (!Number.isFinite(frame.requestedTimestampMs) || frame.requestedTimestampMs < 0) {
      throw new RangeError(
        `Frame ${i + 1} has a non-finite or negative requestedTimestampMs (${frame.requestedTimestampMs}).`
      );
    }
  }
}

/**
 * Build the complete `messages.create` body for one `analyze-form` vision call.
 *
 * Sets no `temperature`, `top_p`, or `top_k` ON PURPOSE — `claude-sonnet-5` returns a 400 for any
 * non-default value of those, on every request. Output determinism comes from `strict: true`
 * (grammar-constrained sampling), which is a stronger guarantee than temperature ever was.
 *
 * `max_tokens` is `MAX_OUTPUT_TOKENS_BY_TIER[tier]` (4k/6k/8k) — the SAME constant the AI spend
 * gate estimated this call against (`ai-pricing.ts`, #91). Reusing it, rather than restating a
 * number here, is what keeps `gate_ai_call`'s reservation and the real request from drifting
 * apart. Note it is a ceiling on thinking + text TOGETHER on this model, which is why Echo V1's
 * 1024/1500 ceilings would truncate a thinking response into a mostly-empty partial.
 */
export function buildAnalyzeFormRequest(
  input: AnalyzeFormPromptInput,
  options: BuildRequestOptions = {}
): AnalyzeFormRequest {
  assertFramesValid(input);

  const thinking: AnthropicThinkingConfig = options.thinking ?? { type: 'adaptive' };

  const request: AnalyzeFormRequest = {
    model: options.model ?? ANALYZE_FORM_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS_BY_TIER[input.tier],
    system: buildSystemPrompt(input),
    messages: [{ role: 'user', content: buildUserContent(input) }],
    thinking,
    // The output contract. `format` is the whole reason `tools` is absent below.
    output_config: {
      effort: options.effort ?? ANALYZE_FORM_EFFORT,
      format: PACE_OUTPUT_FORMAT,
    },
  };

  if (options.includeTool) {
    request.tools = [PACE_ANALYSIS_TOOL];
    request.tool_choice = options.forceToolCall
      ? { type: 'tool', name: PACE_ANALYSIS_TOOL_NAME, disable_parallel_tool_use: true }
      : { type: 'auto', disable_parallel_tool_use: true };
  }

  return request;
}
