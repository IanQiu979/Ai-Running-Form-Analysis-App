/**
 * ISSUE #42 — THE M3 GROUNDING PROOF HARNESS (fixtures + graders).
 *
 * M3's gate is "the prompt provably includes the PACE framework text; the output references the
 * PACE pillars." This file is what turns that from a claim into a proof. It is PURE: fixtures,
 * deterministic graders, and nothing else — no `fetch`, no `Deno.env`, no API key, no spend. The
 * live runner (`grounding-eval.live.ts`) supplies the model responses; this file judges them, and
 * `grounding-eval.deno.test.ts` proves the judging actually works by feeding it known-bad output.
 *
 * ── WHAT IT PROVES, AND AT WHAT COST ────────────────────────────────────────────────────────
 *
 *   GATE 1 — the certified knowledge is VERBATIM in the assembled prompt.   FREE. No model call.
 *            Asserted in `grounding-eval.deno.test.ts`, which runs in `npm test`. A string
 *            comparison against `knowledge.generated.ts` is a total proof of grounding-at-the-
 *            input; nothing about it needs a model, so nothing about it should cost money.
 *   GATE 2 — the output names the four pillars and parses.                  PAID. One call/case.
 *   GATE 3 — it degrades honestly: never a fabricated score, never a pillar
 *            the input cannot support.                                      PAID.
 *   GATE 4 — tier verbosity is respected (Free gets no drills).             PAID.
 *
 * ── EVERY GRADER IS DETERMINISTIC. THERE IS NO MODEL-GRADED RUBRIC HERE. ────────────────────
 *
 * That is a deliberate and load-bearing choice. A rubric model would be a second stochastic
 * system grading the first, it would drift silently as the grader model changed under us, it would
 * cost money on every run, and — worst — it would be unfalsifiable: nobody can tell whether the
 * grader or the analyzer regressed. Every property this harness checks turns out to be checkable
 * in code:
 *
 *   - "never invents a flag or drill" == the emitted `pattern`/`name` traces to the certified
 *     corpus. The certified list is PARSED FROM `knowledge.generated.ts` AT RUNTIME
 *     (`certifiedFlagPatterns` / `certifiedDrillNames`), not hardcoded here — so when Ian certifies
 *     a new drill, the grader learns it in the same commit and cannot drift from the corpus it is
 *     grading against. This is the single strongest grounding signal in the harness: a fluent,
 *     plausible, INVENTED drill name is exactly what an ungrounded model produces, and it is
 *     exactly what this check fails on.
 *   - "never fabricates a score" == `score === null` for every pillar the input cannot support, and
 *     `overall` is the mean of the pillars actually scored (recomputed and compared, so an
 *     `overall` conjured from nothing is caught).
 *   - "respects the tier dial" == Free emits zero flags and zero drills, and one sentence per
 *     pillar.
 *   - "no false precision" (#112) == regexes for a point SPM figure, a GCT in ms, a vertical
 *     oscillation in cm.
 *
 * ── THE ONE PLACE A NAIVE GRADER WOULD BE WRONG (read before touching `checkNoFalsePrecision`) ──
 *
 * The certified corpus ITSELF contains bare numbers that look like false precision:
 *     drills.md:24  "Stand facing a wall, feet ~30 cm back."          (a drill SETUP)
 *     drills.md:64  "Raise by ~2 SPM every 2 weeks"                   (a drill PRESCRIPTION)
 *     pace_framework.md:134 "180 SPM is not a universal target."      (a NORM, stated to be rejected)
 * The prompt tells the model to quote drill instructions from `drills.md` verbatim. So a regex for
 * `\d+ *(SPM|cm)` over the whole response would fail the model for OBEYING the prompt — the grader
 * would be the bug. `checkNoFalsePrecision` therefore scopes itself to the two fields where a
 * measurement CLAIM ABOUT THIS RUNNER can live (`feedback` and `flags[].detail`) and exempts
 * `drills[].instructions` entirely. `grounding-eval.deno.test.ts` asserts both directions: the
 * forbidden claims fail, and the three certified strings above do NOT.
 *
 * ── WHAT THIS HARNESS DOES NOT PROVE ────────────────────────────────────────────────────────
 *
 * That the coaching is any GOOD — that a 72 for posture is the right 72. The fixtures are drawn
 * figures (see `grounding-eval-images.ts` for why), so they can prove grounding, structure, and
 * honesty, and they cannot prove accuracy on a real human body. That is a different eval, needs
 * real consented clips with a coach's ground-truth label, and is not this issue. Do not read a
 * green run as "the analysis is accurate."
 */

import {
  buildAnalyzeFormRequest,
  buildSystemPrompt,
  buildUserContent,
  type AnalyzeFormPromptInput,
  type AnalyzeFormRequest,
  type PaceFrame,
  type PaceMediaKind,
} from '../analyze-form-prompt.ts';
import { readAttempt, type AttemptOutcome } from '../analyze-form-validation.ts';
import { DRILLS_MD, INJURY_FLAGS_MD, PACE_FRAMEWORK_MD } from '../knowledge.generated.ts';
import { AI_MODEL_PRICING, computeCostUsd } from '../ai-pricing.ts';
import {
  isPaceSafety,
  PACE_FRAME_CAP,
  PACE_PILLARS,
  type PaceNotAssessedReason,
  type PacePillarId,
  type PacePillarResult,
  type PaceResult,
  type PaceTier,
} from '../pace.ts';
import {
  POSE_OVERSTRIDE,
  POSES_STRIDE,
  renderBlankPng,
  renderRunnerPng,
  toBase64,
} from './grounding-eval-images.ts';

// -------------------------------------------------------------------------------------------
// The certified corpus, parsed from the SHIPPED bundle — never hardcoded
// -------------------------------------------------------------------------------------------

/**
 * Normalise a flag/drill name for comparison: lowercase, punctuation to spaces, runs of space
 * collapsed. This is what lets "Hip/Glute Stability block" (how `drills.md`'s fault->drill map
 * writes it) and "Hip / Glute Stability block" (how its heading writes it) compare equal, and what
 * stops the grader from failing an obedient model over a hyphen.
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words that carry no identifying weight — dropped before comparing, so "Heavy heel strike with
 * an extended knee" and "Heavy heel strike, extended knee" are the same pattern. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'with', 'for', 'of', 'in', 'on', 'to', 'at', 'is', 'as',
]);

/**
 * DEGREE words — dropped, because they describe HOW MUCH of a fault was seen, not WHICH fault.
 *
 * The live runs are what taught this. Sonnet grades the severity into the label itself:
 *     "Overstriding (mild)"                      vs certified "Overstriding"
 *     "Elevated vertical oscillation (moderate)" vs certified "Excessive vertical oscillation"
 * Both are the certified fault, seen to a lesser degree and honestly labelled as such. Treating
 * "elevated" as a different fault from "excessive" would fail a model for being MORE calibrated
 * than the corpus, which is precisely backwards.
 */
const DEGREE_WORDS = new Set([
  'excessive', 'elevated', 'moderate', 'mild', 'mildly', 'severe', 'slight', 'slightly',
  'significant', 'significantly', 'minor', 'notable', 'marked', 'pronounced', 'very',
  'somewhat', 'moderately', 'some', 'possible', 'potential',
  // DELIBERATELY NOT HERE: "high" and "low". They read like degree words and they are not — they
  // are CONTENT words inside certified drill proper nouns ("High Knees", "Low Bounding"). Listing
  // them here reduced "High Knees" to the single token "knee", which is under the distinctive-token
  // floor, and the grader then called a verbatim certified drill an invention. Caught by the
  // regression test; left as a warning to the next person who extends this list.
]);

/**
 * Crude suffix stemming: -ing, -ed, -s. Applied to BOTH sides identically, so an over-stem
 * ("running" -> "runn", "valgus" -> "valgu") is HARMLESS — it cannot create a mismatch, only a
 * consistently odd token on both sides of the comparison.
 *
 * Each suffix here was forced by a real live run, not anticipated:
 *   -s   "hiked-SHOULDER"  vs certified "hiked SHOULDERS"
 *   -ing "waist BEND"      vs certified "BENDING at the waist"
 *   -ed  (defensive; the same morphology, and the next one would have cost another live run)
 * The model re-titles a flag differently on every single run. It is not being sloppy — `pace.ts`
 * says the label is not constrained — so the matcher has to be robust to English, or it will keep
 * crying wolf on correct output.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function tokens(text: string): string[] {
  return normalizeName(text)
    .split(' ')
    .filter((word) => word.length > 0 && !STOPWORDS.has(word) && !DEGREE_WORDS.has(word))
    .map(stem);
}

/** Headings of the form `### Name *(fixes: ...)*` — the italic suffix is metadata, not the name. */
function headings(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^###\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    out.push(match[1].replace(/\s*\*\(.*\)\*\s*$/, '').trim());
  }
  return out;
}

/**
 * The ONLY injury-risk flags the model may ever raise (`injury_flags.md`'s "Visible risk flags"
 * headings). The heading carries the pattern and then a dash and a description — "Overstriding —
 * foot lands well ahead of the centre of mass" — and the pattern is the part before the dash, which
 * is also what `PaceInjuryFlag.pattern` is documented to hold ("Short label for the observed
 * pattern, e.g. 'Overstriding'").
 */
export function certifiedFlagPatterns(): string[] {
  return headings(INJURY_FLAGS_MD).map((h) => h.split(/\s+[—–-]\s+/)[0].trim());
}

/** The ONLY drills the model may ever prescribe (`drills.md`'s `###` headings). */
export function certifiedDrillNames(): string[] {
  return headings(DRILLS_MD);
}

/**
 * A compound certified heading is a SET of patterns, not one pattern. `injury_flags.md` has
 *   "Tense, hiked shoulders / crossing-midline arms"
 * which is two distinct faults sharing a heading, and `drills.md` has
 *   "Running Drills — High Knees / A-Skips / Butt Kicks".
 * Splitting on the slash is what lets a model name ONE of them and still be grounded.
 */
function alternatives(name: string): string[] {
  return name
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** How many content tokens two labels must share before one is judged to name the other's fault. */
const MIN_SHARED_TOKENS = 2;
/** ...unless the single shared token is distinctive enough to stand alone ("overstriding"). */
const DISTINCTIVE_TOKEN_LENGTH = 6;

/**
 * Does an emitted flag/drill name trace to the certified corpus?
 *
 * ── THIS IS THE THIRD VERSION, AND EACH REWRITE WAS FORCED BY A LIVE RUN. Read before touching it.
 *
 * v1 — whole-string containment. Live run 2 failed it: the model returned the flag "Tense,
 *      hiked/high-carried arms" for the certified "Tense, hiked shoulders / crossing-midline arms".
 * v2 — split on `/`, token containment. Live run 3 failed it TWICE: "Tense, hiked-SHOULDER" (a
 *      plural) and "ELEVATED vertical oscillation (moderate)" for the certified "EXCESSIVE vertical
 *      oscillation" (a severity adjective). Live run 4 failed it again: "Waist BEND / rounded
 *      posture" for the certified "Anterior pelvic tilt / BENDING at the waist" (verb morphology).
 * v3 — this one. Stem suffixes, drop degree words, and match on SHARED CONTENT TOKENS.
 *
 * Every one of those failures was the GRADER being wrong, not the model. That matters, and it is
 * worth being uncomfortable about: a harness iterated against the output it grades can be tuned
 * until it is green, which would make it worthless. What keeps this honest is that the loosening is
 * justified by the CONTRACT, not by the observation —
 *
 *     `pace.ts`: "pattern — Short label for the observed pattern, e.g. 'Overstriding' — usually
 *      matches an injury_flags.md heading, BUT NOT STRUCTURALLY CONSTRAINED TO THAT EXACT LIST."
 *
 * The label was never the contract. Grading a flag on the exact WORDING of its title was testing a
 * promise the product deliberately does not make, and the model was right to paraphrase. What the
 * product DOES promise is that the flag names one of the seven certified faults — which is what
 * this now checks, and which survives "(mild)", "elevated", and a dropped plural. (Verified by
 * hand: the `detail` of every paraphrased flag across five live runs was a faithful restatement of
 * the certified section it named.)
 *
 * ── THE ASYMMETRY THAT MAKES THE GROUNDING PROOF STILL BITE ─────────────────────────────────
 *
 * DRILLS are proper nouns and the model reproduces them EXACTLY — across five live runs it
 * returned "Arm-Swing Box Drill", "Metronome Runs", "Strides" and "Ankle Bounces (Ankling)", every
 * one a verbatim `drills.md` heading, and `grounded-drills` passed 5/5 with no leniency needed. A
 * drill is a specific protocol a runner will actually go and DO, so an invented one is a real
 * hazard, and it is the strongest grounding signal in the harness. FLAGS are free-text labels over
 * a `detail` field that carries the substance, so they are matched on the fault, not the wording.
 * Strict where the contract is strict; lenient exactly where the contract says it is lenient.
 *
 * The guard rails are in `grounding-eval.deno.test.ts` and they are the thing that stops this
 * function rotting into a rubber stamp: "Lazy glutes", "Cadence Ladder Drill", "Glute Activation
 * Circuit", "Hip Thrusts" and six more must all still be REJECTED. If a future loosening passes one
 * of those, it has gone too far.
 */
export function isCertified(emitted: string, certified: readonly string[]): boolean {
  const emittedAlts = alternatives(emitted).map(tokens).filter((t) => t.length > 0);
  const certifiedAlts = certified.flatMap((name) => alternatives(name).map(tokens));

  return emittedAlts.some((needle) =>
    certifiedAlts.some((hay) => {
      const shared = needle.filter((token) => hay.includes(token));
      if (shared.length >= MIN_SHARED_TOKENS) return true;
      // A lone shared word is only enough when it is distinctive. Without this floor the bare token
      // "hip" — an alternative of the certified "Hip / Glute Stability block" — would certify an
      // invented "Hip Thrusts", and the grounding proof would become a rubber stamp.
      return shared.length === 1 && shared[0].length >= DISTINCTIVE_TOKEN_LENGTH;
    })
  );
}

// -------------------------------------------------------------------------------------------
// The fixtures
// -------------------------------------------------------------------------------------------

export interface CaseExpectations {
  /** Pillars this input STRUCTURALLY cannot support. Each MUST come back `score: null`. A number
   * here is a fabrication — the Echo V1 mistake, and the whole reason this harness exists. */
  unsupportedPillars: PacePillarId[];
  /**
   * The reason each withheld pillar should give, PER PILLAR — because the reason genuinely differs
   * per pillar, and a single expectation for the whole case is wrong.
   *
   * The blank fixture is the case that proves it. Posture and Arm swing are unassessable there
   * because there is nothing in the frame (`angle`). But Cadence and Elasticity are unassessable
   * for a STRONGER and quite separate reason — they are motion over time, and this is one still, so
   * they would be `needsVideo` even if the frame held a perfect runner. The first live run flagged
   * exactly this: the model labelled them `needsVideo` and the harness warned, because the harness
   * expected `angle` for all four. The model was right and the expectation was wrong.
   *
   * Checked at WARN level only. The honest `null` score is what matters; which label it carries is
   * copy, and failing an otherwise-perfect result over it would be the over-tight content
   * validation CLAUDE.md bans.
   */
  expectedReasons?: Partial<Record<PacePillarId, PaceNotAssessedReason>>;
  /** This input supports NO pillar at all. Every score AND `overall` must be null, or the model
   * fabricated a result out of an empty field. */
  nothingAssessable: boolean;
}

export interface GroundingCase {
  id: string;
  tier: PaceTier;
  media: PaceMediaKind;
  /** Printed in the report — why this fixture is in the set at all. */
  intent: string;
  /** Which of issue #42's four gates this case carries. */
  proves: readonly string[];
  frames: PaceFrame[];
  expect: CaseExpectations;
}

/** `lib/frames.ts` asks the decoder for evenly-spaced times across the sampled window. They are
 * REQUESTED times, not measured ones (#112) — which the prompt says out loud, and which this
 * harness then checks the model did not quietly treat as a clock (`checkNoFalsePrecision`). */
const STRIDE_TIMESTAMPS_MS = [0, 200, 400, 600, 800];

async function pngFrame(bytes: Uint8Array, requestedTimestampMs: number): Promise<PaceFrame> {
  return { base64: toBase64(bytes), mediaType: 'image/png', requestedTimestampMs };
}

/**
 * FIVE CASES, FIVE LIVE CALLS. This is the minimum set that proves all four gates plus the safety
 * contract — not a matrix. Each call is billed, so every case here has to earn its place, and one
 * that proves nothing the others do not should be deleted rather than kept for symmetry.
 *
 * THE ELITE CASE WAS ADDED FOR THE SAFETY CONTRACT, and only for it. This set deliberately had no
 * Elite case before, on the sound reasoning that Elite and Pro run the same prompt path and differ
 * only in a depth string `analyze-form-prompt.deno.test.ts` asserts for free. That reasoning does
 * not extend to `checkPillarSafety`: `analyze-form-validation.ts` now refuses to deliver ANY
 * response whose pillar `safety` is missing or unusable, so "does the model actually comply" is an
 * outage question, and the tier dial does change the prompt the model complies with. A merge
 * condition that says "every tier" cannot be met by two of three. It runs the stride video, so all
 * four pillars are genuinely assessed — the case where the most safety declarations are in play.
 */
export async function buildCases(): Promise<GroundingCase[]> {
  const overstride = await renderRunnerPng(POSE_OVERSTRIDE);
  const blank = await renderBlankPng();
  const stride = await Promise.all(POSES_STRIDE.map((pose) => renderRunnerPng(pose)));

  const stillFrame = await pngFrame(overstride, 0);
  const blankFrame = await pngFrame(blank, 0);
  const strideFrames = await Promise.all(
    stride.map((bytes, i) => pngFrame(bytes, STRIDE_TIMESTAMPS_MS[i]))
  );

  return [
    {
      id: 'still-free',
      tier: 'free',
      media: 'photo',
      intent:
        'The free tier as it actually ships: ONE frame (PACE_FRAME_CAP.free === 1). A runner with ' +
        'a plain overstride. Cadence and Elasticity are motion over time and CANNOT be scored from ' +
        'one still — the model must say so rather than guess. This is issue #89 in the flesh.',
      proves: ['gate 2 (pillars + parse)', 'gate 3 (no unsupported pillar)', 'gate 4 (Free: no drills)'],
      frames: [stillFrame],
      expect: {
        unsupportedPillars: ['cadence', 'elasticity'],
        expectedReasons: { cadence: 'needsVideo', elasticity: 'needsVideo' },
        nothingAssessable: false,
      },
    },
    {
      id: 'still-pro',
      tier: 'pro',
      media: 'photo',
      intent:
        'THE CONTROLLED TIER CONTRAST: byte-identical input to `still-free`, only the tier differs. ' +
        'Any difference in the output is the tier dial and nothing else. Pro may spend more words ' +
        'and may prescribe drills — and must STILL report Cadence/Elasticity as not assessed. A ' +
        'paid tier buys depth, never certainty (#112); if money could unlock a pillar the media ' +
        'cannot support, the dial would be selling a fabrication.',
      proves: ['gate 3 (paid tier cannot unlock an unsupported pillar)', 'gate 4 (Pro: drills allowed)'],
      frames: [stillFrame],
      expect: {
        unsupportedPillars: ['cadence', 'elasticity'],
        expectedReasons: { cadence: 'needsVideo', elasticity: 'needsVideo' },
        nothingAssessable: false,
      },
    },
    {
      id: 'blank-pro',
      tier: 'pro',
      media: 'photo',
      intent:
        'THE DELIBERATELY UNSUPPORTABLE INPUT — an empty field with no runner in it. There is ' +
        'nothing here to score. The only honest answers are four null pillars or a clean refusal. ' +
        'Any number that comes back is a fabricated number, and this is the assertion whose failure ' +
        'mode is invisible to a user: confident, fluent, and wrong. The banned Echo V1 mistake.',
      proves: ['gate 3 (never a fabricated score)'],
      frames: [blankFrame],
      expect: {
        unsupportedPillars: [...PACE_PILLARS],
        // Two DIFFERENT reasons, and the distinction is real. Posture and Arm swing are out of
        // reach because the frame is empty (`angle`). Cadence and Elasticity are out of reach for a
        // stronger, separate reason — they are motion over time and this is one still, so they
        // would be `needsVideo` even if the frame held a flawless runner. The first live run is
        // what taught the harness this: the model labelled them `needsVideo`, the harness expected
        // `angle` for all four and warned. The model was right.
        expectedReasons: {
          posture: 'angle',
          armSwing: 'angle',
          cadence: 'needsVideo',
          elasticity: 'needsVideo',
        },
        nothingAssessable: true,
      },
    },
    {
      id: 'stride-video-pro',
      tier: 'pro',
      media: 'video',
      intent:
        'Five frames of a stride cycle, torso rising and falling. THE COMPLEMENT OF #89: with ' +
        'motion across frames, all four pillars become assessable — which is what makes the ' +
        "free tier's one-frame cap a product decision rather than a law of physics. Also the only " +
        'case that can prove the flag->drill path: a flag raised must bring a certified drill with it.',
      proves: [
        'gate 2 (all four pillars scoreable with motion)',
        'gate 4 (flags -> certified drills)',
        '#112 (no false precision from approximate timestamps)',
      ],
      frames: strideFrames,
      expect: { unsupportedPillars: [], nothingAssessable: false },
    },
    {
      id: 'stride-video-elite',
      tier: 'elite',
      media: 'video',
      intent:
        'THE THIRD TIER, added for the safety contract. Same stride burst as `stride-video-pro`, ' +
        'at the top of the tier dial, so all four pillars are assessed and every one of them has ' +
        'to carry a usable `safety` declaration. Production refuses to deliver a response that ' +
        'omits one, so a model that does not comply at this tier is a total outage for it — and ' +
        'no offline test can settle whether it complies. Also the only live check that Elite\'s ' +
        'deeper feedback does not come at the cost of the grounding rules Pro obeys.',
      proves: [
        'the safety contract at the top tier (`invalid_safety` is not reachable in practice)',
        'gate 3 (Elite depth still cannot unlock a fabrication)',
      ],
      frames: strideFrames,
      expect: { unsupportedPillars: [], nothingAssessable: false },
    },
  ];
}

/** The exact request the edge function would send for this case — built by PRODUCTION's builder
 * (`buildAnalyzeFormRequest`), never a copy of it. If the eval built its own request, it would be
 * grading a prompt that does not ship. */
export function requestForCase(kase: GroundingCase): AnalyzeFormRequest {
  const input: AnalyzeFormPromptInput = {
    tier: kase.tier,
    media: kase.media,
    frames: kase.frames,
  };
  return buildAnalyzeFormRequest(input);
}

/** The whole prompt as one string — system + the user turn's text blocks. What the model reads,
 * minus the images. Gate 1 searches this. */
export function promptTextForCase(kase: GroundingCase): string {
  const input: AnalyzeFormPromptInput = {
    tier: kase.tier,
    media: kase.media,
    frames: kase.frames,
  };
  const system = buildSystemPrompt(input)
    .map((block) => block.text)
    .join('\n');
  const user = buildUserContent(input)
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
  return `${system}\n${user}`;
}

// -------------------------------------------------------------------------------------------
// GATE 1 — the certified knowledge is verbatim in the prompt. Free. No model call.
// -------------------------------------------------------------------------------------------

export interface KnowledgeGateResult {
  ok: boolean;
  missing: string[];
  promptChars: number;
}

/**
 * The M3 gate proper, and the only one that is FREE: is the certified text in the prompt, byte for
 * byte? Not "does the prompt mention posture" — the ENTIRE file, verbatim. A truncating or escaping
 * bug in the knowledge bundle would sail past an anchor-phrase check and fail this one, and its
 * consequence is the one failure the product cannot ship: an empty knowledge string does not crash
 * a model call, it just makes the model invent fluent, confident biomechanics from its own general
 * knowledge, and nobody can tell.
 */
export function checkKnowledgeInPrompt(kase: GroundingCase): KnowledgeGateResult {
  const prompt = promptTextForCase(kase);
  const missing: string[] = [];

  const corpus: [string, string][] = [
    ['pace_framework.md', PACE_FRAMEWORK_MD],
    ['injury_flags.md', INJURY_FLAGS_MD],
    ['drills.md', DRILLS_MD],
  ];
  for (const [name, text] of corpus) {
    if (!prompt.includes(text)) missing.push(name);
  }

  return { ok: missing.length === 0, missing, promptChars: prompt.length };
}

// -------------------------------------------------------------------------------------------
// The graders — every one deterministic
// -------------------------------------------------------------------------------------------

export type CheckId =
  | 'structure'
  | 'four-pillars'
  | 'no-unsupported-pillar'
  | 'no-fabricated-score'
  | 'grounded-flags'
  | 'grounded-drills'
  | 'tier-verbosity'
  | 'no-false-precision'
  | 'no-disclaimer-echo'
  | 'pillar-safety';

/** `warn` never fails a run. It is for the things that are worth a human's eye but whose failure is
 * a copy nit, not a broken promise — failing the build on one would be over-tight validation. */
export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface Check {
  id: CheckId;
  status: CheckStatus;
  detail: string;
}

function sentenceCount(text: string): number {
  return text
    .split(/[.!?]+(?:\s|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;
}

function pillarEntries(result: PaceResult): [PacePillarId, PacePillarResult][] {
  return PACE_PILLARS.map((id) => [id, result.pillars[id]]);
}

/**
 * THE SAFETY CONTRACT, LIVE — the merge prerequisite for the safety-field work. `PACE_RESULT_SCHEMA`
 * marks `safety` required on every pillar, but a schema is a REQUEST to the model, not a guarantee:
 * `analyze-form-validation.ts` treats a missing or unusable declaration as `invalid_safety` and
 * refuses to deliver anything at all, which is the correct fail-closed behaviour and also a total
 * outage if the model does not in fact comply. Only a real call can settle that, and only across
 * every tier — the tier dial changes the prompt.
 *
 * WHAT "USABLE" MEANS here is deliberately the SERVER's definition, imported rather than restated:
 * `isPaceSafety` (a grounded `signal` from `injury_flags.md` plus a string note) and, for a
 * declared signal, `hasSafetySignal` (a non-blank note). A grader with its own looser idea of
 * usable would pass a payload production refuses.
 *
 * Note what this check does NOT do: it does not require any pillar to RAISE a signal. `'none'` is
 * the ordinary, correct answer for a runner with nothing alarming about them, and demanding a
 * warning would be pressuring the model to invent one. The contract is that the field is present
 * and usable on every pillar that says anything — not that it is alarming.
 */
export function checkPillarSafety(result: PaceResult): Check {
  const unusable: string[] = [];
  const signals: string[] = [];

  for (const [id, pillar] of pillarEntries(result)) {
    // Read as `unknown` on purpose. The declared type says this is already a valid `PaceSafety` —
    // `isPaceResult` checked it — but the whole point of a LIVE grader is to inspect what the model
    // actually sent rather than to restate what the type system was told.
    const raw: unknown = pillar?.safety;
    if (raw === undefined || raw === null) {
      unusable.push(`${id}: absent`);
      continue;
    }
    if (!isPaceSafety(raw)) {
      unusable.push(`${id}: not a grounded declaration (${JSON.stringify(raw)})`);
      continue;
    }
    // `hasSafetySignal`'s second clause, written out rather than called: it is a type guard, and
    // `raw` is already `PaceSafety` here, so invoking it would narrow the failure branch to `never`
    // and make its own diagnostic unprintable. `isPaceSafety` above is the clause that matters and
    // IS the server's own function; this one is a one-line trim check that cannot drift meaningfully.
    if (raw.signal !== 'none' && raw.note.trim().length === 0) {
      unusable.push(`${id}: declared "${raw.signal}" with a blank note`);
      continue;
    }
    signals.push(`${id}=${raw.signal}`);
  }

  if (unusable.length > 0) {
    return {
      id: 'pillar-safety',
      status: 'fail',
      detail:
        `Pillar safety is unusable on ${unusable.length} pillar(s): ${unusable.join('; ')}. ` +
        'Production would classify this whole response as `invalid_safety`, release the ' +
        'reservation, and deliver nothing.',
    };
  }

  return {
    id: 'pillar-safety',
    status: 'pass',
    detail: `Every pillar carries a usable safety declaration (${signals.join(', ')}).`,
  };
}

/** GATE 2 — all four pillars, each with something to say. A not-assessed pillar STILL gets
 * feedback (what shot would fix it); silence is not an honest answer, it is an empty one. */
export function checkFourPillars(result: PaceResult): Check {
  const missing = PACE_PILLARS.filter((id) => !result.pillars[id]);
  if (missing.length > 0) {
    return { id: 'four-pillars', status: 'fail', detail: `Missing pillar(s): ${missing.join(', ')}.` };
  }
  const silent = pillarEntries(result)
    .filter(([, pillar]) => typeof pillar.feedback !== 'string' || pillar.feedback.trim().length === 0)
    .map(([id]) => id);
  if (silent.length > 0) {
    return {
      id: 'four-pillars',
      status: 'fail',
      detail: `Pillar(s) with empty feedback: ${silent.join(', ')}. Even a not-assessed pillar must say why.`,
    };
  }
  return {
    id: 'four-pillars',
    status: 'pass',
    detail: 'All four PACE pillars present, each with feedback.',
  };
}

/** GATE 3a — it never emits a pillar the input cannot support (Cadence from a single still). */
export function checkNoUnsupportedPillar(kase: GroundingCase, result: PaceResult): Check[] {
  const fabricated: string[] = [];
  const wrongReason: string[] = [];

  for (const id of kase.expect.unsupportedPillars) {
    const pillar = result.pillars[id];
    if (pillar.score !== null || pillar.band !== null) {
      fabricated.push(`${id}=${pillar.score}/${pillar.band}`);
      continue;
    }
    const expected = kase.expect.expectedReasons?.[id];
    if (expected && pillar.notAssessedReason !== expected) {
      wrongReason.push(`${id}=${pillar.notAssessedReason ?? 'none'} (expected "${expected}")`);
    }
  }

  const checks: Check[] = [];
  checks.push(
    fabricated.length > 0
      ? {
          id: 'no-unsupported-pillar',
          status: 'fail',
          detail:
            `Scored a pillar this input CANNOT support: ${fabricated.join(', ')}. ` +
            `Expected score: null for [${kase.expect.unsupportedPillars.join(', ')}].`,
        }
      : {
          id: 'no-unsupported-pillar',
          status: 'pass',
          detail:
            kase.expect.unsupportedPillars.length === 0
              ? 'No pillar is out of reach for this input; nothing to withhold.'
              : `Correctly withheld: ${kase.expect.unsupportedPillars.join(', ')} (score: null).`,
        }
  );

  if (wrongReason.length > 0) {
    checks.push({
      id: 'no-unsupported-pillar',
      status: 'warn',
      detail:
        `Withheld correctly, but the reason label reads ${wrongReason.join(', ')}. ` +
        'The null score is what matters; the label is copy.',
    });
  }

  return checks;
}

/**
 * GATE 3b — IT NEVER FABRICATES A NUMBER. The single rule the product is built around.
 *
 * Three ways a fabrication shows up, all checked:
 *   1. a score without a band, or a band without a score — a half-invented pillar;
 *   2. any score at all on an input with nothing in it (the blank fixture);
 *   3. an `overall` that is not the mean of the pillars actually scored — a headline number
 *      conjured from thin air, or one that silently counted a not-assessed pillar as a zero
 *      (which would punish the runner for a camera angle, and which the prompt explicitly forbids).
 */
export function checkNoFabricatedScore(kase: GroundingCase, result: PaceResult): Check {
  for (const [id, pillar] of pillarEntries(result)) {
    if ((pillar.score === null) !== (pillar.band === null)) {
      return {
        id: 'no-fabricated-score',
        status: 'fail',
        detail: `Pillar "${id}" has score=${pillar.score} but band=${pillar.band}. They are null together or not at all.`,
      };
    }
  }

  const scored = pillarEntries(result).filter(([, p]) => p.score !== null);

  if (kase.expect.nothingAssessable) {
    if (scored.length > 0) {
      return {
        id: 'no-fabricated-score',
        status: 'fail',
        detail:
          `FABRICATED ${scored.length} score(s) from an input with no runner in it: ` +
          scored.map(([id, p]) => `${id}=${p.score}`).join(', ') +
          '. This is the Echo V1 mistake: confident, fluent, and wrong.',
      };
    }
    if (result.overall.score !== null) {
      return {
        id: 'no-fabricated-score',
        status: 'fail',
        detail: `Every pillar is null, yet overall.score = ${result.overall.score}. An overall built from zero real data.`,
      };
    }
    return {
      id: 'no-fabricated-score',
      status: 'pass',
      detail: 'Nothing was assessable and nothing was scored. Honest.',
    };
  }

  if (scored.length === 0) {
    return result.overall.score === null
      ? {
          id: 'no-fabricated-score',
          status: 'pass',
          detail: 'No pillar scored, and overall is correctly null.',
        }
      : {
          id: 'no-fabricated-score',
          status: 'fail',
          detail: `No pillar scored, yet overall.score = ${result.overall.score}.`,
        };
  }

  // The headline number must be the mean of what was ACTUALLY scored — not counting the
  // not-assessed pillars as zeros. Recomputed and compared; ±1 for the model's rounding.
  const mean = scored.reduce((sum, [, p]) => sum + (p.score ?? 0), 0) / scored.length;
  const expected = Math.round(mean);
  if (result.overall.score === null) {
    return {
      id: 'no-fabricated-score',
      status: 'fail',
      detail: `${scored.length} pillar(s) scored, yet overall.score is null (expected ~${expected}).`,
    };
  }
  if (Math.abs(result.overall.score - expected) > 1) {
    return {
      id: 'no-fabricated-score',
      status: 'fail',
      detail:
        `overall.score = ${result.overall.score}, but the mean of the ${scored.length} pillar(s) ` +
        `actually scored is ${expected} (${scored.map(([id, p]) => `${id}=${p.score}`).join(', ')}). ` +
        'A headline number that does not match the bars under it is fabricated — or it counted a ' +
        'not-assessed pillar as a zero, which punishes the runner for a camera angle.',
    };
  }

  return {
    id: 'no-fabricated-score',
    status: 'pass',
    detail: `overall=${result.overall.score} is the mean of the ${scored.length} pillar(s) actually scored.`,
  };
}

/**
 * THE GROUNDING PROOF. Every flag raised and every drill prescribed must trace to the certified
 * corpus. An invented-but-plausible drill name is precisely what an ungrounded model produces —
 * fluent, confident, and untraceable to anything Ian certified — so this is the check that
 * distinguishes "read the knowledge" from "sounds like a running coach."
 */
export function checkGroundedFlags(result: PaceResult): Check {
  const certified = certifiedFlagPatterns();
  const invented: string[] = [];

  for (const [id, pillar] of pillarEntries(result)) {
    for (const flag of pillar.flags) {
      if (!isCertified(flag.pattern, certified)) invented.push(`${id}: "${flag.pattern}"`);
    }
  }

  if (invented.length > 0) {
    return {
      id: 'grounded-flags',
      status: 'fail',
      detail:
        `INVENTED injury flag(s) with no basis in injury_flags.md: ${invented.join('; ')}. ` +
        `Certified: [${certified.join(' | ')}].`,
    };
  }

  const total = pillarEntries(result).reduce((n, [, p]) => n + p.flags.length, 0);
  return {
    id: 'grounded-flags',
    status: 'pass',
    detail: `${total} flag(s), every one traceable to injury_flags.md.`,
  };
}

export function checkGroundedDrills(result: PaceResult): Check {
  const certified = certifiedDrillNames();
  const invented: string[] = [];

  for (const [id, pillar] of pillarEntries(result)) {
    for (const drill of pillar.drills) {
      if (!isCertified(drill.name, certified)) invented.push(`${id}: "${drill.name}"`);
    }
  }

  if (invented.length > 0) {
    return {
      id: 'grounded-drills',
      status: 'fail',
      detail:
        `INVENTED drill(s) with no basis in drills.md: ${invented.join('; ')}. ` +
        `Certified: [${certified.join(' | ')}].`,
    };
  }

  const total = pillarEntries(result).reduce((n, [, p]) => n + p.drills.length, 0);
  return {
    id: 'grounded-drills',
    status: 'pass',
    detail: `${total} drill(s), every one traceable to drills.md.`,
  };
}

/**
 * GATE 4 — the tier dial. Note the ASYMMETRY, which is deliberate:
 *
 *   Free emits NO flags and NO drills            -> HARD FAIL if violated. Paid content leaking to
 *                                                   the free tier is a real product bug.
 *   Free writes ONE sentence per pillar          -> HARD FAIL above 2 (the prompt says exactly one;
 *                                                   one sentence of slack, then it is not a "dial").
 *   Pro/Elite raised a flag => prescribed a drill -> HARD FAIL if violated. This is the conditional
 *                                                   form, and it is the only honest one: the prompt
 *                                                   itself says an empty flag list is "a fine and
 *                                                   common answer", so "Pro must always produce
 *                                                   drills" would fail a model for correctly telling
 *                                                   a good runner that nothing is wrong. Grading a
 *                                                   clean runner as a regression is exactly the
 *                                                   over-tight content validation CLAUDE.md bans.
 */
export function checkTierVerbosity(kase: GroundingCase, result: PaceResult): Check {
  const entries = pillarEntries(result);
  const flags = entries.reduce((n, [, p]) => n + p.flags.length, 0);
  const drills = entries.reduce((n, [, p]) => n + p.drills.length, 0);

  if (kase.tier === 'free') {
    const leaked = entries
      .filter(([, p]) => p.flags.length > 0 || p.drills.length > 0)
      .map(([id, p]) => `${id}(${p.flags.length} flags, ${p.drills.length} drills)`);
    if (leaked.length > 0) {
      return {
        id: 'tier-verbosity',
        status: 'fail',
        detail: `PAID-TIER CONTENT LEAKED TO FREE: ${leaked.join(', ')}. Free must emit [] for both.`,
      };
    }

    const verbose = entries
      .filter(([, p]) => sentenceCount(p.feedback ?? '') > 2)
      .map(([id, p]) => `${id}=${sentenceCount(p.feedback ?? '')} sentences`);
    if (verbose.length > 0) {
      return {
        id: 'tier-verbosity',
        status: 'fail',
        detail: `Free is one sentence per pillar; got ${verbose.join(', ')}. The dial is not moving.`,
      };
    }

    return {
      id: 'tier-verbosity',
      status: 'pass',
      detail: `Free: 0 flags, 0 drills, <=2 sentences per pillar (${meanSentences(result)} mean).`,
    };
  }

  if (flags > 0 && drills === 0) {
    return {
      id: 'tier-verbosity',
      status: 'fail',
      detail: `${kase.tier} raised ${flags} flag(s) but prescribed 0 drills. Paid tiers get drills for what they flag.`,
    };
  }

  return {
    id: 'tier-verbosity',
    status: 'pass',
    detail:
      `${kase.tier}: ${flags} flag(s), ${drills} drill(s), ${meanSentences(result)} mean sentences/pillar` +
      (flags === 0 ? ' (no flags raised, so no drills owed — a legitimate answer).' : '.'),
  };
}

export function meanSentences(result: PaceResult): string {
  const counts = PACE_PILLARS.map((id) => sentenceCount(result.pillars[id].feedback ?? ''));
  return (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1);
}

/**
 * ISSUE #112 — FALSE PRECISION, forbidden AT EVERY TIER including Elite.
 *
 * SCOPE IS THE WHOLE TRICK HERE. This runs over `feedback` and `flags[].detail` — the fields where
 * a claim ABOUT THIS RUNNER lives — and NOT over `drills[].instructions`, which the prompt tells
 * the model to quote from `drills.md`, and which certifiably contain "Raise by ~2 SPM every 2
 * weeks" and "feet ~30 cm back". A grader that scanned the drill text would fail the model for
 * doing exactly what it was told, and the grader would be the bug. See the file header.
 *
 * The three forbidden things, from `analyze-form-prompt.ts`'s TIMESTAMP_RULES:
 *   - a single precise cadence figure ("your cadence is 164 SPM") — a labelled RANGE is allowed;
 *   - any ground-contact-time figure in milliseconds;
 *   - any vertical-oscillation figure in centimetres.
 *
 * NOTE (live run 5): this check FIRED on a real response that wrote "200ms" into Elasticity's
 * feedback. Whether that is a true #112 violation or a legitimate reference to the FRAME INTERVAL
 * (the manifest really does say ~200 ms) was never resolved — the worktree was destroyed before it
 * could be read. RESOLVE IT BEFORE TRUSTING THIS CHECK: if the model was citing the frame spacing
 * rather than measuring ground contact, the regex needs to exempt that, and the prompt may want to
 * say so explicitly. If it really did state a ground-contact time in ms, this is a genuine prompt
 * finding and #112's rule is being violated at Pro.
 */
export function checkNoFalsePrecision(result: PaceResult): Check {
  const claims = pillarEntries(result)
    .flatMap(([, p]) => [p.feedback ?? '', ...p.flags.map((f) => f.detail)])
    .join('\n');

  const violations: string[] = [];

  // GCT in ms — SCOPED TO THE CLAIM, not to the unit, exactly as the cadence check below is
  // scoped to the possessive/copular form. This used to be a bare `/\d+\s*ms/`, and the live run
  // of 2026-09-07 showed what that costs: it failed an Elite response for the phrase "any
  // steps-per-minute figure I could estimate from the ~200ms-apart timestamps would be a wide,
  // approximate range only ... treat that number as a rough sense of pace, not a measurement".
  // That sentence is the prompt's TIMESTAMP_RULES being obeyed almost verbatim — the model was
  // describing the FRAME SPACING it was handed in the manifest, hedging it, and refusing to
  // measure. Failing it is the over-tight content validation CLAUDE.md names as a known Echo V1
  // mistake, and a grader that cries wolf on obedience is worse than no grader: it trains a reader
  // to skip the red.
  //
  // What IS forbidden is a figure attributed to the RUNNER's time on the ground. So a millisecond
  // figure only counts when a ground-contact term sits near it.
  const GCT_TERMS = /ground[-\s]?contact|contact\s+time|time\s+on\s+the\s+ground|ground\s+time|stance\s+time|\bGCT\b/i;
  const GCT_CONTEXT_CHARS = 60;
  const msFigures = [...claims.matchAll(/\d+(?:\.\d+)?\s*(?:ms\b|milliseconds?\b)/gi)];
  const gct = msFigures
    .filter((match) => {
      const at = match.index ?? 0;
      const window = claims.slice(
        Math.max(0, at - GCT_CONTEXT_CHARS),
        at + match[0].length + GCT_CONTEXT_CHARS
      );
      return GCT_TERMS.test(window);
    })
    .map((match) => match[0]);
  if (gct.length > 0) violations.push(`ground-contact time in ms: ${JSON.stringify(gct)}`);

  // Vertical oscillation in cm.
  const vo = claims.match(/\d+(?:\.\d+)?\s*(?:cm\b|centimet(?:re|er)s?\b)/gi);
  if (vo) violations.push(`vertical oscillation in cm: ${JSON.stringify(vo)}`);

  // A cadence figure ATTRIBUTED TO THIS RUNNER as a point value. Scoped to the possessive/copular
  // form ("your cadence is 164", "their cadence sits at 168") so it cannot fire on the certified
  // norm "180 SPM is not a universal target", which a model may legitimately quote to REJECT it.
  // An en-dashed or hyphenated RANGE ("roughly 160-170 SPM") is explicitly allowed by the prompt
  // and is excluded by the negative lookahead.
  const point =
    /\b(?:your|their|his|her|the runner'?s)\s+cadence\s+(?:is|was|of|sits at|comes out at|measures|appears to be|looks like)\s*(?:about|around|roughly|approximately|~)?\s*(\d{2,3})(?!\s*[-–—]\s*\d)/gi;
  const attributed = claims.match(point);
  if (attributed) violations.push(`a point cadence figure for this runner: ${JSON.stringify(attributed)}`);

  if (violations.length > 0) {
    return {
      id: 'no-false-precision',
      status: 'fail',
      detail:
        `FALSE PRECISION (#112) — forbidden at every tier: ${violations.join('; ')}. ` +
        'The frame timestamps are REQUESTED, not measured; a figure derived from them is a rhythm ' +
        'the runner does not have.',
    };
  }

  // Not a failure, but worth an eye: any other bare 3-digit SPM mention.
  const looseSpm = claims.match(/\b\d{3}\s*(?:spm|steps per minute)\b/gi);
  if (looseSpm) {
    return {
      id: 'no-false-precision',
      status: 'warn',
      detail:
        `No forbidden claim, but a 3-digit SPM figure appears: ${JSON.stringify(looseSpm)}. ` +
        'Legitimate if it is the certified "180 SPM is not a universal target" norm; check it is.',
    };
  }

  return {
    id: 'no-false-precision',
    status: 'pass',
    detail: 'No point cadence figure, no GCT in ms, no vertical oscillation in cm.',
  };
}

/** The app renders the "not medical advice" disclaimer as a static footer under EVERY result
 * (#68). A model that writes it into `feedback` too would double it on screen. Warn-level: it is a
 * rendering nit, not a broken promise. */
export function checkNoDisclaimerEcho(result: PaceResult): Check {
  const text = pillarEntries(result)
    .map(([, p]) => p.feedback ?? '')
    .join('\n');
  if (/not\s+medical\s+advice/i.test(text)) {
    return {
      id: 'no-disclaimer-echo',
      status: 'warn',
      detail: 'The model wrote the "not medical advice" disclaimer into feedback; the app already renders it (#68).',
    };
  }
  return { id: 'no-disclaimer-echo', status: 'pass', detail: 'No disclaimer echoed into feedback.' };
}

// -------------------------------------------------------------------------------------------
// One case, graded
// -------------------------------------------------------------------------------------------

export interface CaseReport {
  caseId: string;
  tier: PaceTier;
  media: PaceMediaKind;
  frameCount: number;
  intent: string;
  proves: readonly string[];
  /** Did the response parse into a full `PaceResult` via PRODUCTION's own reader? */
  parsed: boolean;
  failure: string | null;
  stopReason: string | null;
  checks: Check[];
  /** No `fail` check anywhere. `warn` does not sink a case. */
  passed: boolean;
  result: PaceResult | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUsd: number;
  latencyMs: number;
}

/**
 * Grade one model response against one fixture.
 *
 * The response is read by `readAttempt` — the SAME function `analyze-form/flow.ts` uses in
 * production (#45). The eval therefore proves the real parser can read the real model's real
 * output, rather than proving that a parser written for the eval can read it.
 *
 * ASSERTION 3 ACCEPTS TWO HONEST ANSWERS, exactly as issue #42 words it ("a clean failure OR an
 * honest partial, never a fabricated score"): for an input with nothing in it, a refusal that
 * yields no result at all is just as honest as four null pillars, and the flow would release the
 * reservation and refund the quota. What is never acceptable is a number.
 */
export function gradeCase(
  kase: GroundingCase,
  attempt: AttemptOutcome,
  latencyMs: number,
  model: string
): CaseReport {
  const checks: Check[] = [];
  const result = attempt.result;

  if (result) {
    checks.push({ id: 'structure', status: 'pass', detail: 'Parsed as a complete PaceResult.' });
    checks.push(checkFourPillars(result));
    checks.push(checkPillarSafety(result));
    checks.push(...checkNoUnsupportedPillar(kase, result));
    checks.push(checkNoFabricatedScore(kase, result));
    checks.push(checkGroundedFlags(result));
    checks.push(checkGroundedDrills(result));
    checks.push(checkTierVerbosity(kase, result));
    checks.push(checkNoFalsePrecision(result));
    checks.push(checkNoDisclaimerEcho(result));
  } else if (kase.expect.nothingAssessable) {
    // A clean failure on an unsupportable input is an HONEST outcome, not a broken one: the flow
    // releases the reservation and the user is not charged. The salvage path is the one thing that
    // must still be checked — a "partial" that invented a score is a fabrication whatever the
    // stop_reason says.
    const salvaged = attempt.salvage?.assessedPillars ?? [];
    checks.push({
      id: 'structure',
      status: salvaged.length > 0 ? 'fail' : 'pass',
      detail:
        salvaged.length > 0
          ? `Clean failure (${attempt.failure}), but the salvage still carries scores for ` +
            `${salvaged.join(', ')} on an input with nothing in it. That is a fabricated partial.`
          : `Clean failure (${attempt.failure}) on an unsupportable input — honest. Issue #42 accepts ` +
            'a clean failure here; the flow would release the reservation and refund the quota.',
    });
  } else {
    checks.push({
      id: 'structure',
      status: 'fail',
      detail: `No usable result: ${attempt.failure} (stop_reason: ${attempt.stopReason ?? 'none'}).`,
    });
    if (attempt.failure === 'invalid_safety') {
      // Named separately from `structure` so the merge prerequisite reads off the report directly
      // instead of being inferred from a generic parse failure.
      checks.push({
        id: 'pillar-safety',
        status: 'fail',
        detail:
          'The response was payload-shaped but at least one pillar\'s `safety` was absent, ' +
          'malformed, ungrounded, or a declared signal with a blank note. Production refuses to ' +
          'deliver this.',
      });
    }
  }

  const usage = {
    inputTokens: attempt.usage.input_tokens ?? 0,
    outputTokens: attempt.usage.output_tokens ?? 0,
    cacheCreationInputTokens: attempt.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: attempt.usage.cache_read_input_tokens ?? 0,
  };

  const pricing = AI_MODEL_PRICING[model];
  const costUsd = pricing ? computeCostUsd(pricing, usage) : 0;

  return {
    caseId: kase.id,
    tier: kase.tier,
    media: kase.media,
    frameCount: kase.frames.length,
    intent: kase.intent,
    proves: kase.proves,
    parsed: result !== null,
    failure: attempt.failure,
    stopReason: attempt.stopReason,
    checks,
    passed: !checks.some((c) => c.status === 'fail'),
    result,
    usage,
    costUsd,
    latencyMs,
  };
}

/** Read an Anthropic response with production's own reader. Re-exported so the live runner and the
 * offline tests cannot accidentally use two different parsers. */
export { readAttempt };

// -------------------------------------------------------------------------------------------
// #89 — the free tier's structural ceiling, provable with NO model call at all
// -------------------------------------------------------------------------------------------

export interface FreeTierCeiling {
  frameCap: number;
  /** Pillars a free submission can never have scored, given the cap. */
  unreachablePillars: PacePillarId[];
  /** e.g. "2 of 4". */
  bestCase: string;
}

/**
 * ISSUE #89, AS ARITHMETIC. No model, no images, no spend — just the repo's own constants.
 *
 * `PACE_FRAME_CAP.free` is 1. A one-frame submission is a single still. `analyze-form-prompt.ts`'s
 * MEDIUM_RULES.photo says a still "CANNOT assess Cadence or Elasticity ... Both are motion over
 * time" and requires `score: null` for both. Therefore a Free user — even one who submits a
 * flawless side-on clip — can be scored on AT MOST 2 of the 4 pillars in the product's own name.
 * Every time. By construction.
 *
 * That is not a bug in the model and this harness must not "fix" it: it is the expected, correct
 * behaviour of an honest analyzer under a product decision nobody has made yet. #89 is blocked on
 * Ian (raise Free's cap to ~3 frames, or keep the cap and sell the limitation honestly in the
 * paywall copy). What this harness owes the decision is EVIDENCE, and this function is it — plus
 * the `still-free` fixture, which shows the live model doing exactly this.
 */
export function freeTierCeiling(): FreeTierCeiling {
  const frameCap = PACE_FRAME_CAP.free;
  // A cap of 1 frame is a photo, and a photo cannot carry motion-over-time.
  const unreachablePillars: PacePillarId[] = frameCap < 2 ? ['cadence', 'elasticity'] : [];
  const reachable = PACE_PILLARS.length - unreachablePillars.length;
  return {
    frameCap,
    unreachablePillars,
    bestCase: `${reachable} of ${PACE_PILLARS.length}`,
  };
}
