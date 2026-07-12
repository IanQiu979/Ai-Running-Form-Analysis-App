/**
 * PACE — the four pillars (Posture, Arm swing, Cadence, Elasticity) and the analysis result
 * shape. The single source of truth for both the Expo app and the `analyze-form` Supabase edge
 * function (CLAUDE.md: "Shared PACE types... belong in one place... imported by both the app and
 * the edge functions" — issue #43). #44, #45, #46, #56, and #60 all build against this shape.
 *
 * SHARING CONSTRAINT (issue #90, unresolved — read before adding an import here). The app
 * resolves the `@/*` alias and extensionless TypeScript via Metro; Deno resolves neither alias
 * nor extensionless specifiers, and has no `react-native`. So this file:
 *   - has ZERO runtime dependencies — no npm package, no React/React Native, no Node or Deno
 *     built-in (`process.env` included), and no import of anything that itself pulls one in;
 *   - uses only relative, non-aliased import specifiers (nothing goes through `@/*`);
 *   - is pure TypeScript — types, constants, and pure functions only, no I/O.
 * The one exception is the `import type { ScoreBand }` below: the issue is explicit that bands
 * are already defined in `constants/theme.ts` and must be imported, not re-declared. `import
 * type` is erased before either toolchain runs a byte of it — Metro/Babel strips it because a
 * type can never be a value, and a single-file TypeScript transpiler (the kind #90 will need for
 * Deno) elides an `import type` statement on sight, with no module resolution at all — so this
 * does NOT pull `constants/theme.ts`'s own runtime import (`react-native`, for `SystemFont`) into
 * either bundle. Do not change it to a value import (`import { ScoreBand }`) — that forces full
 * evaluation of `theme.ts`, including its `react-native` import, which cannot resolve in Deno.
 * `ScoreBandRange`/`ScoreBandLabel` are VALUES, not types, and are deliberately NOT imported here
 * for the same reason — see the validator section below for how this file avoids needing them.
 *
 * Whatever mechanism #90 eventually picks for the edge function's copy of this file will still
 * need to either (a) prove its Deno toolchain also elides `import type` without resolving the
 * specifier, or (b) replace that one line with an inline, locally-scoped copy of the same four
 * string literals. Nothing else in this file needs to change either way.
 *
 * VALIDATION PHILOSOPHY (CLAUDE.md): structural, not strict-content. `isPaceResult` and
 * `isPaceAnalysisOutcome` below check that the shape holds — the right keys, the right JS types,
 * and the one cross-field rule the honest-failure contract actually depends on (see
 * `isValidScoreBandPair`) — and never judge whether a feedback string, a flag, or a drill is any
 * good. Analysis quality is a grounding problem (the certified `knowledge/` files), not a type
 * problem — over-tight content validation is a known Echo V1 mistake this file does not repeat.
 */

import type { ScoreBand } from '../constants/theme';

// -------------------------------------------------------------------------------------------
// The four pillars
// -------------------------------------------------------------------------------------------

/** The four PACE pillars. camelCase to match `docs/design/copy-deck.md`'s key suffixes
 * (`result.pillar.armSwing.label`, etc.) and the `analyses.result` JSONB keys. Human-readable
 * labels are UI copy, not a PACE concept — they belong in `constants/copy.ts` (M6, issue #56),
 * not here. */
export type PacePillarId = 'posture' | 'armSwing' | 'cadence' | 'elasticity';

/** Canonical P-A-C-E order. Any consumer that iterates all four pillars (the readout, the
 * compare-delta view, a future prompt builder) should use this instead of `Object.keys` on a
 * `Record`, whose iteration order is an implementation detail, not a contract. */
export const PACE_PILLARS: readonly PacePillarId[] = ['posture', 'armSwing', 'cadence', 'elasticity'];

// -------------------------------------------------------------------------------------------
// Injury-risk flags & drills — `knowledge/injury_flags.md` / `knowledge/drills.md`
// -------------------------------------------------------------------------------------------

/**
 * One visible-pattern injury-risk flag against a pillar — `injury_flags.md`'s own template:
 * "what you see -> what it's associated with -> the safe next step," kept as one coaching-prose
 * field rather than split into sub-fields the model would have to hit exactly (see the file's
 * validation philosophy above). Paid-tier content: Free always renders `[]`, never omits it
 * (`docs/design/frontend-design-brief.md` §3, "Free ... No flags.").
 */
export interface PaceInjuryFlag {
  /** Short label for the observed pattern, e.g. "Overstriding" — usually matches an
   * `injury_flags.md` heading, but not structurally constrained to that exact list. */
  pattern: string;
  /** The coaching prose: what was seen, what it's associated with, and the safe next step. */
  detail: string;
}

/** One corrective drill (`knowledge/drills.md`). Paid-tier content: Free always renders `[]`. */
export interface PaceDrill {
  /** e.g. "Wall Forward-Lean Drill". */
  name: string;
  /** The instructions/cue text. */
  instructions: string;
}

// -------------------------------------------------------------------------------------------
// The result shape
// -------------------------------------------------------------------------------------------

/** Why a pillar could not be scored — the two "not assessed" strings in
 * `docs/design/copy-deck.md` (`result.pillar.notAssessed.angle` / `.needsVideo`). Optional, and
 * NOT structurally required to be exactly one of these two (see `isPacePillarResult`) — the
 * model may report a reason the copy deck hasn't named a string for yet, and rejecting an
 * otherwise-honest response over that would be exactly the over-tight content validation
 * CLAUDE.md bans. */
export type PaceNotAssessedReason = 'angle' | 'needsVideo';

/**
 * One pillar's slice of a result. The honest-failure contract lives here: `score: number | null`
 * — never a fabricated number for a pillar the model could not assess (CLAUDE.md; issue #45's
 * contract; the reason issue #43 exists). `score: null` covers BOTH a medium limitation (a photo
 * can't show Cadence) and a model parse gap — the UI renders both identically as "not assessed";
 * see `isPaceAnalysisOutcome`'s doc comment for why that ambiguity is intentional and not
 * resolved by this file.
 */
export interface PacePillarResult {
  /** 0–100, or null when this pillar could not be assessed from the given media. */
  score: number | null;
  /** The band `score` falls in (`constants/theme.ts`'s `ScoreBand`), or null exactly when
   * `score` is null — see `isValidScoreBandPair`. This file does not check that `band` is the
   * numerically "correct" band for `score`; only that the two are present or absent together. */
  band: ScoreBand | null;
  /** Coaching feedback for this pillar. Free: one line. Pro/Elite: fuller. Typically null when
   * the pillar is not assessed, but not structurally required to be — a model that adds a short
   * explanatory note alongside `score: null` is not a shape violation. */
  feedback: string | null;
  /** Present only when `score` is null — why this pillar could not be assessed. */
  notAssessedReason?: PaceNotAssessedReason;
  /** Injury-risk flags raised against this pillar. Paid tiers only; Free and not-assessed
   * pillars are always `[]`, never omitted. */
  flags: PaceInjuryFlag[];
  /** Corrective drills for this pillar. Paid tiers only; Free and not-assessed pillars are
   * always `[]`, never omitted. */
  drills: PaceDrill[];
}

/** The four-pillar average, rendered as the result's headline number
 * (`docs/design/frontend-design-brief.md` §3, "the four pillars average into one headline
 * number + band"). Null when every pillar is not assessed — never a fabricated overall built
 * from zero real data. Computing this average from the four pillar scores is left to whichever
 * side produces the result — this file defines the shape, not the arithmetic (CLAUDE.md:
 * `lib/pace.ts` is types + shape validation, not business policy). */
export interface PaceOverall {
  score: number | null;
  band: ScoreBand | null;
}

/** The full PACE analysis payload — what `settle_analysis`'s `p_result` stores in
 * `analyses.result` JSONB (`docs/architecture.md` "Current — DB schema": `result jsonb, -- 4
 * PACE pillars + flags + drills`). Does not carry `isFallback`: that is a sibling DB column
 * (`analyses.is_fallback`) and a sibling field in the API response (`{ result, analysisId,
 * isFallback }`), not nested inside the analysis content itself — see `PaceAnalysisOutcome`
 * below for the combined shape most call sites actually want. */
export interface PaceResult {
  pillars: Record<PacePillarId, PacePillarResult>;
  overall: PaceOverall;
}

/**
 * A settled analysis attempt: the result plus the honest-partial/fallback flag (CLAUDE.md;
 * issue #45's `is_fallback` contract; `docs/design/copy-deck.md`'s `result.partial.banner.*`).
 * `true` only for a clearly-labelled partial result produced by the retry-then-fallback path —
 * never true for a response that validated in full on its own. Mirrors the API's `{ result,
 * isFallback }` pair (`analysisId` is a DB row id, not a PACE concept, so it is not part of this
 * type).
 */
export interface PaceAnalysisOutcome {
  result: PaceResult;
  isFallback: boolean;
}

// -------------------------------------------------------------------------------------------
// Tier frame caps & payload budget — docs/architecture.md "Planned — media pipeline"
// -------------------------------------------------------------------------------------------

/** The three analysis tiers (matches `analyses.tier_at_run`'s DB enum). Scoped to this file's
 * own need (the frame cap below) — the general subscription/tier concept belongs to the planned
 * `lib/subscription.ts` (M5), not here. */
export type PaceTier = 'free' | 'pro' | 'elite';

/**
 * Max frames sent to one vision call, per tier (`docs/architecture.md` "Planned — media
 * pipeline" Caps: "Frame count per tier: Free 1 / Pro 5 / Elite 8"; a photo submission is always
 * exactly 1 frame regardless of tier). Descriptive data only, not the enforcement point —
 * `reserve_analysis` (`SECURITY DEFINER`, service-role only) is the sole authority (CLAUDE.md:
 * "No business rules in the client"). The client imports this only to know how many frames to
 * extract; a client that sends more is still capped server-side.
 */
export const PACE_FRAME_CAP: Record<PaceTier, number> = {
  free: 1,
  pro: 5,
  elite: 8,
};

/**
 * Max size, in bytes, of the `analyze-form` request body — base64 frame data plus metadata
 * (`docs/architecture.md` "Planned — media pipeline": "total request body ≤5MB, enforced
 * client-side and re-checked server-side"). The frame-extraction caps that produce a body this
 * size (clip length, downscale target, JPEG quality) belong to the planned `lib/frames.ts` (M2),
 * not here — this is the one number both the client (to stop building an oversize request) and
 * the edge function (to reject one) need to agree on exactly.
 */
export const PACE_MAX_REQUEST_BODY_BYTES = 5 * 1024 * 1024;

/**
 * The `analyze-form` retry-then-fallback threshold (issue #45's decision table): a response that
 * still fails full structural validation after one retry becomes a partial result
 * (`isFallback: true`) when at least this many of the four pillars parsed; fewer than this is a
 * clean failure instead (`release_analysis` — no result is stored at all, and this constant
 * never appears in a persisted row). A retry-policy constant, not something `isPaceResult`/
 * `isPaceAnalysisOutcome` can check on their own — see `isPaceAnalysisOutcome`'s doc comment for
 * why a pillar being `null` does not, by itself, prove or disprove `isFallback`.
 */
export const PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL = 2;

// -------------------------------------------------------------------------------------------
// Structural validator — shape only, per the file's validation philosophy above
// -------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isScoreInRange(value: number): boolean {
  return value >= 0 && value <= 100;
}

/**
 * `score` and `band` must be null together or non-null together. This is the one cross-field
 * rule this file enforces, because it is the visual carrier of "not assessed" — a hollow,
 * colorless bar — versus "assessed" — a colored, banded bar (`docs/design/frontend-design-brief
 * .md` §3). A score with no band, or a band with no score, is a shape a result screen cannot
 * render, not a content judgment call.
 */
function isValidScoreBandPair(score: unknown, band: unknown): boolean {
  if (score === null) {
    return band === null;
  }
  return isFiniteNumber(score) && isScoreInRange(score) && typeof band === 'string' && band.length > 0;
}

function isPaceInjuryFlag(value: unknown): value is PaceInjuryFlag {
  return isRecord(value) && typeof value.pattern === 'string' && typeof value.detail === 'string';
}

function isPaceDrill(value: unknown): value is PaceDrill {
  return isRecord(value) && typeof value.name === 'string' && typeof value.instructions === 'string';
}

function isPacePillarResult(value: unknown): value is PacePillarResult {
  if (!isRecord(value)) {
    return false;
  }
  if (!isValidScoreBandPair(value.score, value.band)) {
    return false;
  }
  if (value.feedback !== null && typeof value.feedback !== 'string') {
    return false;
  }
  if (value.notAssessedReason !== undefined && typeof value.notAssessedReason !== 'string') {
    return false;
  }
  if (!Array.isArray(value.flags) || !value.flags.every(isPaceInjuryFlag)) {
    return false;
  }
  if (!Array.isArray(value.drills) || !value.drills.every(isPaceDrill)) {
    return false;
  }
  return true;
}

/**
 * Structural check for a `PaceResult` — the four pillars (each individually valid, see
 * `isPacePillarResult`) plus a valid `overall`. Unknown extra keys on `pillars` or the result
 * itself are ignored, not rejected — additive fields are forward-compatible, and rejecting on
 * them would be exactly the over-tight validation CLAUDE.md warns against.
 */
export function isPaceResult(value: unknown): value is PaceResult {
  if (!isRecord(value) || !isRecord(value.pillars) || !isRecord(value.overall)) {
    return false;
  }

  for (const id of PACE_PILLARS) {
    if (!isPacePillarResult(value.pillars[id])) {
      return false;
    }
  }

  return isValidScoreBandPair(value.overall.score, value.overall.band);
}

/**
 * Structural check for a `PaceAnalysisOutcome` — a valid `result` plus a boolean `isFallback`.
 *
 * Deliberately does NOT cross-check `isFallback` against how many pillars are assessed. A
 * legitimate first-try, no-retry result can validly have several pillars `null` — a photo
 * submission always reports Cadence and Elasticity as not-assessed (`needsVideo`), and a
 * badly-angled clip can validly report Posture as not-assessed (`angle`) — with `isFallback:
 * false`, because nothing failed; the model just accurately described what it could see. A count
 * of null pillars in the final shape cannot distinguish that case from a genuine retry-then-
 * partial fallback (issue #45), because both produce byte-identical `PacePillarResult` shapes by
 * design — the UI is not supposed to be able to tell the difference either. So `isFallback` is
 * trusted as provenance information from whichever side produced the outcome, not something this
 * function re-derives from pillar counts.
 */
export function isPaceAnalysisOutcome(value: unknown): value is PaceAnalysisOutcome {
  return isRecord(value) && typeof value.isFallback === 'boolean' && isPaceResult(value.result);
}
