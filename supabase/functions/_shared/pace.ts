/**
 * PACE — the four pillars (Posture, Arm swing, Cadence, Elasticity) and the analysis result
 * shape. The single source of truth for both the Expo app and the `analyze-form` Supabase edge
 * function (CLAUDE.md: "Shared PACE types... belong in one place... imported by both the app and
 * the edge functions" — issue #43). #44, #45, #46, #56, and #60 all build against this shape.
 *
 * SHARING MECHANISM (issue #90, decided): this file lives here, under
 * `supabase/functions/_shared/`, not in `lib/`, and there is no copy, codegen, or symlink of it
 * anywhere else — this location IS the single source of truth. `supabase functions deploy` only
 * bundles `supabase/functions/`, so a `lib/`-resident copy could never reach the edge function;
 * living here instead makes that structurally impossible to get wrong. The app imports it via
 * the `@shared/*` tsconfig path alias (`@shared/pace`, mapped to
 * `./supabase/functions/_shared/*` in `tsconfig.json`) — `jest-expo`'s preset derives its Jest
 * `moduleNameMapper` from the same `tsconfig.json` `paths`, so the alias resolves identically
 * under Metro and Jest with no separate config. `tsconfig.json` excludes `supabase/functions/**`
 * from automatic inclusion (Deno-only syntax elsewhere under that tree would break `tsc`), but an
 * `include`d file importing this one still pulls it into the TS program — `exclude` blocks
 * automatic inclusion, not reachability via the import graph — so `npm run typecheck` still
 * checks this file in full. Deno, separately, resolves and checks it via `deno check` (see
 * `supabase/functions/deno.json`, wired as `npm run typecheck:edge`).
 *
 * This file keeps the constraints that sharing requires either way:
 *   - has ZERO runtime dependencies — no npm package, no React/React Native, no Node or Deno
 *     built-in (`process.env` included), and no import of anything that itself pulls one in;
 *   - uses only relative, non-aliased import specifiers (nothing goes through `@/*`/`@shared/*`
 *     from inside this file itself — Deno resolves neither alias);
 *   - is pure TypeScript — types, constants, and pure functions only, no I/O — which is also
 *     exactly what keeps it valid, uncomplicated Deno source with zero Deno-only syntax.
 * `ScoreBand` below is a deliberate INLINE COPY of `constants/theme.ts`'s type of the same name,
 * not an import of it — Deno cannot resolve an extensionless, non-aliased specifier, and
 * `constants/theme.ts` sits outside the deploy bundle (and pulls in `react-native`) regardless.
 * Drift between the two is structurally possible now that they're two declarations, so it is
 * caught by a test instead: `supabase/functions/_shared/__tests__/pace.test.ts`'s "ScoreBand
 * parity with constants/theme.ts" suite fails if this union and `constants/theme.ts`'s
 * `ScoreBandOrder` ever disagree. `ScoreBandRange`/`ScoreBandLabel` are VALUES, not types, and
 * are deliberately NOT duplicated here — see the validator section below for how this file avoids
 * needing them.
 *
 * VALIDATION PHILOSOPHY (CLAUDE.md): structural, not strict-content. `isPaceResult` and
 * `isPaceAnalysisOutcome` below check that the shape holds — the right keys, the right JS types,
 * and the one cross-field rule the honest-failure contract actually depends on (see
 * `isValidScoreBandPair`) — and never judge whether a feedback string, a flag, or a drill is any
 * good. Analysis quality is a grounding problem (the certified `knowledge/` files), not a type
 * problem — over-tight content validation is a known Echo V1 mistake this file does not repeat.
 */

// -------------------------------------------------------------------------------------------
// Score bands — inline copy of constants/theme.ts's ScoreBand; see the file header for why this
// is a copy, not an import, and supabase/functions/_shared/__tests__/pace.test.ts for the test
// that fails if the two ever diverge.
// -------------------------------------------------------------------------------------------

export type ScoreBand = 'low' | 'mid' | 'good' | 'strong';

/** Runtime companion to the `ScoreBand` type above, worst-to-best, same order as
 * `constants/theme.ts`'s `ScoreBandOrder` — the one artifact
 * `supabase/functions/_shared/__tests__/pace.test.ts`'s "ScoreBand parity" suite can actually
 * compare at runtime (a type has no runtime representation to diff against). Exists solely to
 * make the drift test possible; nothing in this file's own logic reads it. */
export const SCORE_BAND_VALUES: readonly ScoreBand[] = ['low', 'mid', 'good', 'strong'];

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

/** Why a pillar could not be scored. `'angle'` and `'needsVideo'` are the two the MODEL may
 * report (`docs/design/copy-deck.md`'s `result.pillar.notAssessed.angle` / `.needsVideo`).
 * `'singleFrameFromVideo'` is written only by the server's own normalization
 * (`analyze-form/flow.ts`), for the case the other two cannot describe honestly: the runner DID
 * submit a video, and exactly one frame of it reached the analysis. The reason deliberately says
 * nothing about WHY only one arrived — telling them their plan caused it would be false whenever
 * the device fell back after a quota lookup failure, while telling them to "submit a video" would
 * be advice about something they already did.
 * Optional, and NOT structurally required to be one of these three (see `isPacePillarResult`) —
 * the model may report a reason the copy deck hasn't named a string for yet, and rejecting an
 * otherwise-honest response over that would be exactly the over-tight content validation
 * CLAUDE.md bans. */
export type PaceNotAssessedReason = 'angle' | 'needsVideo' | 'singleFrameFromVideo';

/**
 * The stop-running signals of `knowledge/injury_flags.md` — its "Stop-running signals (shown to
 * ALL tiers when visibly present or reported in the note)" section, one id per certified bullet,
 * plus `'none'` for "nothing of the kind is visible", which is the overwhelmingly common answer.
 *
 * WHY THIS IS AN ENUM AND NOT PROSE. `analyze-form-prompt.ts`'s SAFETY_RULES make a stop-running
 * signal undroppable at every tier including Free, and `analyze-form/flow.ts`'s normalization has
 * to strip an unassessable pillar's claims without stripping its warning. Classifying free-form
 * prose to tell those apart cannot work in either direction — a paraphrase the classifier does not
 * know drops a real warning, and a coaching sentence that happens to share vocabulary readmits a
 * fabricated claim. So the two are separated AT THE SOURCE: the model declares the signal in this
 * closed, certified vocabulary, and normalization copies that declaration across structurally,
 * with no reading of the prose at all.
 */
export const PACE_SAFETY_SIGNALS = [
  'none',
  'sharpOrWorseningPain',
  'swellingLimpOrFavouringOneSide',
  'achillesOrHeelCordPain',
] as const;

export type PaceSafetySignalId = (typeof PACE_SAFETY_SIGNALS)[number];

/**
 * A pillar's safety declaration. `signal` is grounded in the certified list above — anything else
 * is a shape violation, not a content judgment (see `isPaceSafety`). `note` is the calm,
 * plain-language sentence `injury_flags.md`'s own language template asks for, and is the ONE piece
 * of a not-assessed pillar's prose the server carries across verbatim.
 */
export interface PaceSafety {
  signal: PaceSafetySignalId;
  note: string;
}

/** Does this pillar carry a real stop-running signal (as opposed to none, or none declared)? */
export function hasSafetySignal(safety: PaceSafety | null | undefined): safety is PaceSafety {
  return !!safety && safety.signal !== 'none' && safety.note.trim().length > 0;
}

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
  /** The pillar's stop-running declaration, in the certified vocabulary — see `PaceSafety`.
   * Additive and optional: a response that predates the field, or a salvaged pillar, simply has
   * none. What is NOT optional is that a MALFORMED one fails closed rather than being ignored
   * (`analyze-form-validation.ts`), and that the production output schema
   * (`analyze-form-prompt.ts`'s `PACE_RESULT_SCHEMA`) lists it as `required`, so a
   * grammar-constrained response always carries it. */
  safety?: PaceSafety | null;
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
// Tier frame caps & payload budget — docs/architecture.md "Current — media pipeline"
// -------------------------------------------------------------------------------------------

/** The three analysis tiers (matches `analyses.tier_at_run`'s DB enum). Scoped to this file's
 * own need (the frame cap below) — the general subscription/tier concept belongs to the planned
 * `lib/subscription.ts` (M5), not here. */
export type PaceTier = 'free' | 'pro' | 'elite';

/**
 * Max frames sent to one vision call, per tier (`docs/architecture.md` "Current — media
 * pipeline" Caps: "Frame count per tier: Free 5 / Pro 5 / Elite 8"; a photo submission is always
 * exactly 1 frame regardless of tier). Descriptive data only, not the enforcement point —
 * `reserve_analysis` (`SECURITY DEFINER`, service-role only) is the sole authority (CLAUDE.md:
 * "No business rules in the client"). The client imports this only to know how many frames to
 * extract; a client that sends more is still capped server-side.
 *
 * FREE IS 5, NOT 1, SINCE 2026-09-19 (issue #89, captain's decision). A VIDEO analysis on Free
 * uses the SAME stride burst as the paid tiers (`lib/frames.ts`'s `sampleTimestamps`, one centred
 * ~700ms window) at Pro's density, so Cadence and Elasticity — motion over time, unscoreable from
 * one still by certified rule — can be assessed on the free trial. What Free still does NOT get is
 * unchanged: one lifetime analysis, no flags, no drills. The number is Pro's burst rather than a
 * new one because Pro/5 is the smaller paid burst measured live to score all four pillars
 * (`docs/change_log.md` 2026-09-07). The SQL side of this table lives in
 * `supabase/migrations/20260919120000_free_video_stride_burst_frame_cap.sql` and the two are
 * locked together by `lib/__tests__/frames.test.ts`.
 */
export const PACE_FRAME_CAP: Record<PaceTier, number> = {
  free: 5,
  pro: 5,
  elite: 8,
};

/**
 * Max size, in bytes, of the `analyze-form` request body — base64 frame data plus metadata
 * (`docs/architecture.md` "Current — media pipeline": "total request body ≤5MB, enforced
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

/**
 * The one place a safety declaration's CONTENT is checked, and the one exception to this file's
 * structural-only rule — deliberately, because `signal` is not prose: it is an id the model picks
 * from `knowledge/injury_flags.md`'s certified stop-running list, exactly as `band` is picked from
 * `ScoreBand`. An id outside that list is an ungrounded safety claim, which is precisely what the
 * closed vocabulary exists to make impossible.
 */
export function isPaceSafety(value: unknown): value is PaceSafety {
  return (
    isRecord(value) &&
    typeof value.signal === 'string' &&
    (PACE_SAFETY_SIGNALS as readonly string[]).includes(value.signal) &&
    typeof value.note === 'string'
  );
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
  if (value.safety !== undefined && value.safety !== null && !isPaceSafety(value.safety)) {
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
