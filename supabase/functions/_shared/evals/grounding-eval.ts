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
 *   - "no false precision" (#112) == a clause-level classifier (#208) that finds every SPM, ms
 *     and cm figure, attributes each SPM figure to this runner / runners at large / a
 *     prescription, and fails only the ones claimed about this runner — plus any GCT in ms or
 *     vertical oscillation in cm.
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
 * SIX CASES, SIX LIVE CALLS. This is the minimum set that proves all four gates plus the safety
 * contract — not a matrix. Each call is billed, so every case here has to earn its place, and one
 * that proves nothing the others do not should be deleted rather than kept for symmetry. The sixth
 * (`stride-video-free`) was added when #89 was decided: it is the only case that can show the
 * free tier scoring Cadence/Elasticity from a burst while still withholding paid content.
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
        'A free-tier PHOTO: one frame, on every tier. A runner with a plain overstride. Cadence ' +
        'and Elasticity are motion over time and CANNOT be scored from one still — the model must ' +
        'say so rather than guess. Since #89 was decided (2026-09-19) this is the honest 2-of-4 ' +
        'shape a PHOTO keeps; a Free VIDEO now runs the stride burst (see `stride-video-free`).',
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
        'Five frames of a stride cycle, torso rising and falling. With motion across frames, all ' +
        'four pillars become assessable — the observation that made the free tier\'s old one-frame ' +
        'cap a product decision rather than a law of physics (#89, decided 2026-09-19: Free video ' +
        'now extracts this same burst). Also the only case that can prove the flag->drill path: a ' +
        'flag raised must bring a certified drill with it.',
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
    {
      id: 'stride-video-free',
      tier: 'free',
      media: 'video',
      intent:
        'ISSUE #89 AS DECIDED (2026-09-19): the free tier\'s ONE lifetime VIDEO analysis runs the ' +
        'same stride burst as Pro (PACE_FRAME_CAP.free === PACE_FRAME_CAP.pro), so Cadence and ' +
        'Elasticity CAN be assessed on the free trial — byte-identical frames to `stride-video-pro`, ' +
        'only the tier differs. What Free still must not get is unchanged: no flags, no drills, one ' +
        'sentence per pillar (gate 4). No pillar is out of reach here; a null Cadence/Elasticity on ' +
        'this input is not dishonesty, but a scored one is what the decision exists to make possible.',
      proves: [
        'gate 2 (all four pillars scoreable with motion, ON FREE)',
        'gate 4 (Free: no flags, no drills, even with motion evidence)',
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
 * ISSUE #112 — FALSE PRECISION, forbidden AT EVERY TIER including Elite. Redesigned by #208.
 *
 * SCOPE IS HALF THE TRICK. This runs over `feedback` and `flags[].detail` — the fields where a
 * claim ABOUT THIS RUNNER lives — and NOT over `drills[].instructions`, which the prompt tells the
 * model to quote from `drills.md`, and which certifiably contain "Raise by ~2 SPM every 2 weeks"
 * and "feet ~30 cm back". A grader that scanned the drill text would fail the model for doing
 * exactly what it was told, and the grader would be the bug. See the file header.
 *
 * ATTRIBUTION IS THE OTHER HALF. The rule is "never claim a number about THIS runner that the
 * evidence does not support" (`analyze-form-prompt.ts`'s TIMESTAMP_RULES), and the same figure can
 * be a violation or a legitimate sentence depending only on WHO it is about. So the grader is a
 * small clause-level classifier, not a lattice of lookaheads (#208: six regex rounds on the
 * stride-burst PR each surfaced a new case instead of converging). Each field is split into
 * sentences, the numeric figures in a sentence are found FIRST and masked (so a typographic dash
 * inside "160–170 SPM" can never be mistaken for a clause break), the masked sentence is split
 * into clauses, and each figure is then judged by its clause's subject:
 *
 *   subject          | a steps-per-minute figure or range is...
 *   -----------------+------------------------------------------------------------------------
 *   this runner      | FAIL, hedged or not ("your cadence is 164 SPM", "across the burst you are
 *                    | running at 168 spm", "this burst looks closer to roughly 158 spm")
 *   general norm     | PASS, even with a second-person word in a modifier ("most runners at your
 *                    | level sit around 165 to 180 steps per minute")
 *   prescription     | PASS, relative or absolute ("raise it 5-10 SPM", "aim for about 170 spm")
 *                    | — the captain ruled an absolute target is prescription, not a claim
 *   unattributed     | FAIL when hedged ("Roughly 160–170 SPM — approximate": a hedge with no
 *                    | other subject is an estimate of this runner's rate); otherwise WARN, the
 *                    | fall-through a human reads ("180 SPM is not a universal target")
 *
 * A clause's subject is the EARLIEST runner or general-population marker in it, so a modifier
 * ("at your level", "like you") never outranks the noun phrase it modifies, and a marker after a
 * comparison word ("than most runners", "like most runners") is not a subject at all. A clause
 * with no marker of its own inherits the previous clause's subject in the same sentence — which is
 * how "For most recreational runners, cadence sits around 165 to 180" stays a norm, and why a
 * clause that names its own subject ("…; this burst looks closer to…") can never be sheltered by
 * the norm before it. A prescription verb ("aim for", "work toward", "should") governs only the
 * figures after it in its own clause. A DELTA ("raise it by 5-10 SPM", "10 to 15 steps per minute
 * more") is a change, not a rate, whoever it is about.
 *
 * GCT in ms and vertical oscillation in cm are NOT subject-scoped: TIMESTAMP_RULES forbids ANY
 * such figure at every tier. What IS scoped is what a millisecond figure measures: the model's own
 * refusals cite the burst's FRAME SPACING or WINDOW ("at ~100 ms (approximate, unreliable)
 * intervals", "from ~700ms of footage"), which is obedience, not a ground-contact claim. A ms
 * figure that is qualified as an interval/window passes; one in a sentence about ground contact
 * fails; any other ms figure warns.
 *
 * DELIBERATELY NARROWER THAN THE STRIDE-BURST HARNESS. `stride-burst-latency.live.ts` flags ANY SPM
 * number in a burst result, because `STRIDE_BURST_VIDEO_RULES` forbids the figure outright for that
 * one media shape. This grader runs over EVERY media kind and every tier, where a certified norm
 * and a prescription are both legitimate, so it judges attribution instead. The two scopes are not
 * a duplication to be unified — unifying them breaks one of the two. Only `SPM_UNIT` is shared.
 *
 * The regression corpus for every rule above — the 11 edge cases the six regex rounds surfaced and
 * the gaps they left live — is the table in `grounding-eval.deno.test.ts`. Change a rule here and
 * measure it against all of it at once.
 */

/** "SPM", "steps per minute", "steps/min", "steps a minute". Exported because the stride-burst
 * latency harness scans for the same UNITS — but deliberately not for the same CLAIM; see above. */
export const SPM_UNIT = String.raw`(?:spm\b|steps\s*(?:per|a|\/)\s*min(?:ute)?s?\b)`;

/** Who a clause's numbers are about. */
export type ClaimSubject = 'runner' | 'general' | 'prescription' | 'unattributed';

/** One numeric figure found in runner-facing prose, and how the classifier judged it. */
export interface NumericFigure {
  /** The figure as written ("160–170 SPM", "~200ms", "12 cm"). */
  text: string;
  kind: 'spm' | 'ms' | 'cm';
  /** The subject the figure was attributed to. Only decides the verdict for `spm`. */
  subject: ClaimSubject;
  verdict: 'fail' | 'warn' | 'pass';
  /** Why — one short phrase, printed in the check's detail. */
  reason: string;
  /** The clause the figure sits in, with the figure restored, so a reader can judge the judgement. */
  clause: string;
}

const NUM = String.raw`\d{1,3}(?:\.\d+)?`;
/** A range separator. The dashes are INSIDE a figure, which is why figures are masked before any
 * clause is split — #208's round-7 gap was "160–170" being cut in two by the clause splitter. */
const RANGE_SEP = String.raw`\s*(?:[-–—]|\bto\b|\band\b)\s*`;
const HEDGE_WORD = String.raw`(?:about|around|roughly|approximately|approx\.?|near|nearly|close\s+to|closer\s+to|something\s+like|somewhere\s+(?:around|near|between)|in\s+the\s+region\s+of|on\s+the\s+order\s+of|between|from)`;
const CADENCE_NOUN = String.raw`(?:cadence|step\s+rate|stride\s+rate|turnover)`;

/** A point or range with a steps-per-minute unit ("164 SPM", "160 to 170 steps/min"). */
const SPM_FIGURE = new RegExp(
  String.raw`\b${NUM}(?:\s*${SPM_UNIT})?(?:${RANGE_SEP}${NUM})?\s*${SPM_UNIT}`,
  'gi'
);
/** The same figure without a unit, recognisable only by the cadence noun it is the value of
 * ("your cadence is 164", "their cadence sits at roughly 160-170"). */
const UNITLESS_CADENCE_FIGURE = new RegExp(
  String.raw`(?<=\b${CADENCE_NOUN}\s+(?:is|was|of|at|sits\s+(?:at|around|near)|comes\s+out\s+at|measures|lands\s+at|(?:appears|looks|seems)\s+(?:to\s+be|like))\s+(?:${HEDGE_WORD}\s+|~\s*)?)${NUM}(?:${RANGE_SEP}${NUM})?\b(?!\s*(?:%|percent|°|degrees?\b|ms\b|milli|cm\b|centi|frames?\b|seconds?\b|s\b|\.\d))`,
  'gi'
);
const MS_FIGURE = /\b\d{1,4}(?:\.\d+)?(?:\s*[-–—]\s*\d{1,4})?\s*(?:ms|milliseconds?)\b/gi;
const CM_FIGURE = /\b\d{1,3}(?:\.\d+)?(?:\s*[-–—]\s*\d{1,3})?\s*(?:cm|centimet(?:re|er)s?)\b/gi;

/** A hedge immediately before the figure, or an "approximate" tag immediately after it. */
const HEDGED_BEFORE = new RegExp(String.raw`(?:\b${HEDGE_WORD}\s+(?:the\s+)?|~\s*)$`, 'i');
const HEDGED_AFTER = /^\s*(?:\(|—|–|-|,)?\s*(?:approx\w*|roughly|estimated|or\s+so|-?ish)\b/i;

/** A DELTA is not a RATE: "raise it by 5-10 SPM", "10 to 15 steps per minute more than you run
 * now" are the certified 5-10%-above-self-selected guidance (`pace_framework.md`). Only an
 * ADJACENT delta marker counts, so "Your cadence is 164 SPM, which is below the ideal range" is not
 * excused: the "below" there is a clause away, not attached to the figure. */
const DELTA_BEFORE =
  /\b(?:by|raise|raising|lift|lifting|increase|increasing|add|adding|up|bump|nudge|extra|another)\s+(?:(?:it|them|your\s+\w+(?:\s+rate)?)\s+)?(?:by\s+)?(?:(?:about|around|roughly|approximately|only|just)\s+|~\s*)?$/i;
const DELTA_AFTER =
  /^\s*(?:more|higher|faster|quicker|lower|slower|fewer|extra|above|below|than|beyond|up|down)\b/i;
/** No running cadence is under 40 steps a minute, so a figure that small is a change magnitude
 * ("an extra 5-10 SPM") whatever words surround it. */
const MAX_DELTA_MAGNITUDE = 40;

/** One regex from a list of alternatives, so each marker's vocabulary reads as a list. */
function anyOf(alternatives: string[], flags: string): RegExp {
  return new RegExp(alternatives.map((a) => `(?:${a})`).join('|'), flags);
}

/** A millisecond figure that measures the FRAME SPACING or the WINDOW — the model citing its own
 * evidence, usually to refuse to measure — rather than anything the runner's body did. Read from
 * the text right after the figure (a parenthetical aside may sit between) or right before it. */
const INTERVAL_AFTER = new RegExp(
  String.raw`^\s*(?:\([^)]{0,40}\)\s*)?-?\s*(?:apart|intervals?|spacing|spaced|gaps?|window|burst|span|frames?|samples?|between\s+(?:frames|captures|samples)|of\s+(?:footage|video|clip|film|capture|recording|motion|running))\b`,
  'i'
);
/** The part of `INTERVAL_AFTER` that names a spacing or the window outright, and so still holds
 * in a clause about ground contact ("cannot be timed from frames ~100 ms apart"). A bare frame
 * reference ("250 ms between frames 4 and 6", "240 ms - frames 3 to 5") does not. */
const SPACING_AFTER =
  /^\s*(?:\([^)]{0,40}\)\s*)?-?\s*(?:apart|intervals?|spacing|spaced|gaps?|of\s+(?:footage|video|clip|film|capture|recording))\b/i;
/** A real spacing form: "frames spaced ~200 ms", "frames taken every 100 ms". */
const FRAMES_BEFORE = anyOf(
  [
    String.raw`\b(?:frames?|timestamps?|captures?|samples?)\s+(?:(?:are|were|is)\s+)?(?:spaced|taken|captured|sampled|come)\s+(?:(?:at|every|roughly|about|around|only)\s+){0,2}~?\s*$`,
    String.raw`\bevery\s+(?:(?:about|around|roughly)\s+)?~?\s*$`,
  ],
  'i'
);
/** "frames ~200 ms", "a spacing of about 200 ms", "a window of 700 ms". Weaker than
 * `FRAMES_BEFORE`/`INTERVAL_AFTER`: it never excuses a figure whose own clause names ground contact
 * ("ground contact in these frames is about 240 ms", "ground contact window of 250 ms"), and an
 * evidence noun ("in this clip is about 250 ms") is not an interval at all. */
const INTERVAL_NOUN_BEFORE = anyOf(
  [
    String.raw`\b(?:frames?|timestamps?|captures?|samples?)\s+(?:(?:are|were|is|sit|sits|roughly|about|around|at|only)\s+){0,3}~?\s*$`,
    String.raw`\b(?:spacing|interval|gap|window|span)\s+(?:(?:of|is|was)\s+)?(?:(?:about|around|roughly|approximately|only|just)\s+)?~?\s*$`,
  ],
  'i'
);
const GCT_TERMS = anyOf(
  [
    String.raw`ground[-\s]?contact`,
    String.raw`contact\s+time`,
    String.raw`on\s+the\s+ground`,
    String.raw`ground\s+time`,
    String.raw`stance(?:\s+time|\s+phase)?`,
    String.raw`\bGCT\b`,
    String.raw`touchdown\s+(?:time|duration)`,
  ],
  'i'
);

/** THIS runner. `g` because `firstSubjectMarker` walks every hit to skip comparison objects. */
const RUNNER_MARKER = anyOf(
  [
    // second person — how every pillar's feedback addresses the runner
    String.raw`\b(?:you|you're|you've|you'd|your|yours|yourself)\b`,
    // the runner in the third person
    String.raw`\b(?:the|this)\s+runner(?:'s)?\b`,
    String.raw`\b(?:their|his|her)\s+${CADENCE_NOUN}\b`,
    // the analysed evidence itself: a figure read off "this burst" is a figure about this runner
    String.raw`\b(?:this|the|these|those)\s+(?:burst|clip|video|footage|frames?|sequence|analysis|capture|recording|sample)\b`,
    String.raw`\bhere\b`,
    // the model reporting its own estimate
    String.raw`\bI\s+(?:\w+\s+)?(?:estimate|count|measure|calculate|make\s+it|put\s+it|read\s+it)\b`,
  ],
  'gi'
);
/** Runners at large: a quantified or generic plural, or the research that describes them. */
const GENERAL_MARKER = anyOf(
  [
    String.raw`\b(?:most|many|some|other|average|typical|recreational|competitive|elite|beginner|experienced|all|trained|novice|healthy|distance)\s+(?:\w+\s+){0,2}?(?:runners?|athletes?|people)\b`,
    String.raw`\b(?:runners|athletes|people)\b`,
    String.raw`\b(?:research|studies|the\s+literature)\b`,
  ],
  'gi'
);
/** A marker right after a comparison word names what the subject is compared WITH, not the
 * subject: "quicker than most runners", "you, like most runners, …", "runners like you". */
const COMPARISON_BEFORE = /\b(?:like|than|unlike|versus|vs\.?|compared\s+(?:with|to)|relative\s+to)\s+$/i;
/** Prescription: a target or a change the runner is told to work toward. Governs only the figures
 * AFTER it in its clause, so "You are at 164 spm and should aim for 170 spm" still fails on 164. */
const PRESCRIPTION_MARKER = anyOf(
  [
    String.raw`\b(?:aim|aiming|shoot|shooting)\s+for\b`,
    // "a target of", "target cadence of", "your target is" — the noun, never "on target at"
    String.raw`\btargets?\s+(?:${CADENCE_NOUN}\s+|rate\s+)?(?:of|is|would\s+be|should\s+be)\b`,
    // the imperative verb, at the head of its clause: "Target about 170 spm"
    String.raw`^\s*(?:then\s+|and\s+|so\s+)?target\b`,
    String.raw`\bgoal\b`,
    // "work toward", "build up to", "bring your cadence up to"
    String.raw`\b(?:work|working|build|building|move|moving|progress|progressing|climb|climbing|nudge|nudging|bring|bringing|raise|raising|lift|lifting|increase|increasing|push|pushing|bump|bumping|ease|easing)\b(?:\s+\S+){0,3}?\s+(?:up\s+)?(?:to|toward|towards|into)\b`,
    String.raw`\btry(?:ing)?\s+(?:\w+\s+){0,2}?at\b`,
    String.raw`\bmetronome\b`,
    String.raw`\bshould\b`,
  ],
  'i'
);

/** Sentence ends, but not a decimal point ("1.5 cm") or an abbreviation ("approx.", "vs.", "e.g.",
 * "i.e."), whose period would otherwise cut a hedge or a comparison off from its figure. */
const SENTENCE_END =
  /(?<!\b(?:approx|vs|e\.g|i\.e))(?<!\be(?=\.g\.))(?<!\bi(?=\.e\.))[.!?](?!\d)|\n/i;
/** Clause boundaries, applied to a sentence whose figures are already masked. A coordinating
 * conjunction only starts a clause when a new subject follows it ("…170-180 spm and you look…"). */
const CLAUSE_BREAK_ALTERNATIVES = anyOf(
  [
    String.raw`[;,:()—–]`,
    String.raw`\s-\s`,
    String.raw`\s(?=(?:but|whereas|although|though|yet|while)\s)`,
    String.raw`\s(?=(?:and|so|then)\s+(?:you|your|this|these|the\s+runner|I|most|many)\b)`,
  ],
  'i'
);
/** The same breaks, captured, so `split` keeps each separator between the clauses it divides. */
const CLAUSE_BREAK = new RegExp(`(${CLAUSE_BREAK_ALTERNATIVES.source})`, 'i');
/** A semicolon joins independent clauses, so it ends a prescription ("Cadence should come up;
 * right now it is about 158 spm"). A colon introduces the prescription's own content ("Target:
 * roughly 170 spm") and does not. */
const HARD_BREAK = /^;$/;
/** A relative or appositive clause describes its antecedent; it never becomes the main clause's
 * subject ("Your cadence, which is typical for recreational runners, looks like roughly 160 spm"). */
const RELATIVE_CLAUSE = /^\s*(?:which|who|whom|whose|that)\b/i;

/** Placeholders the masked sentence carries in place of each figure. Control characters never
 * appear in model prose and never match a clause break or a marker. */
const MASK = /\u0001(\d+)\u0002/g;

interface RawFigure {
  start: number;
  end: number;
  text: string;
  kind: NumericFigure['kind'];
}

function findFigures(sentence: string): RawFigure[] {
  const found: RawFigure[] = [];
  const collect = (pattern: RegExp, kind: NumericFigure['kind']) => {
    for (const m of sentence.matchAll(pattern)) {
      const start = m.index ?? 0;
      found.push({ start, end: start + m[0].length, text: m[0], kind });
    }
  };
  collect(SPM_FIGURE, 'spm');
  collect(UNITLESS_CADENCE_FIGURE, 'spm');
  collect(MS_FIGURE, 'ms');
  collect(CM_FIGURE, 'cm');
  // Earliest first, longest first at a tie; drop anything overlapping a figure already kept.
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: RawFigure[] = [];
  for (const f of found) {
    if (kept.length === 0 || f.start >= kept[kept.length - 1].end) kept.push(f);
  }
  return kept;
}

function firstSubjectMarker(clause: string, pattern: RegExp): number {
  for (const m of clause.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (!COMPARISON_BEFORE.test(clause.slice(0, at))) return at;
  }
  return Infinity;
}

/** The EARLIEST runner or general marker wins, so a modifier ("most runners at your level") never
 * outranks the noun phrase it modifies. `null` when the clause names neither. */
function clauseSubject(clause: string): 'runner' | 'general' | null {
  const runner = firstSubjectMarker(clause, RUNNER_MARKER);
  const general = firstSubjectMarker(clause, GENERAL_MARKER);
  if (runner === Infinity && general === Infinity) return null;
  return runner < general ? 'runner' : 'general';
}

type Judgement = Pick<NumericFigure, 'verdict' | 'reason'>;

function judgeSpm(figure: RawFigure, sentence: string, subject: ClaimSubject): Judgement {
  const before = sentence.slice(0, figure.start);
  const after = sentence.slice(figure.end);
  const values = (figure.text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (
    DELTA_BEFORE.test(before) ||
    DELTA_AFTER.test(after) ||
    values.every((v) => v < MAX_DELTA_MAGNITUDE)
  ) {
    return { verdict: 'pass', reason: 'a prescribed change, not a rate' };
  }
  switch (subject) {
    case 'runner':
      return { verdict: 'fail', reason: 'attributed to this runner' };
    case 'general':
      return { verdict: 'pass', reason: 'a norm about runners at large' };
    case 'prescription':
      return { verdict: 'pass', reason: 'prescriptive advice' };
    case 'unattributed':
      return HEDGED_BEFORE.test(before) || HEDGED_AFTER.test(after)
        ? { verdict: 'fail', reason: "a hedged estimate with no other subject, i.e. this runner's rate" }
        : { verdict: 'warn', reason: 'unattributed; legitimate only as a quoted norm' };
  }
}

function judgeMs(figure: RawFigure, sentence: string, clause: string): Judgement {
  const before = sentence.slice(0, figure.start);
  const namesContact = GCT_TERMS.test(clause);
  if (
    FRAMES_BEFORE.test(before) ||
    (namesContact ? SPACING_AFTER : INTERVAL_AFTER).test(sentence.slice(figure.end)) ||
    (!namesContact && INTERVAL_NOUN_BEFORE.test(before))
  ) {
    return { verdict: 'pass', reason: 'the frame spacing or window, not a ground-contact time' };
  }
  return namesContact || GCT_TERMS.test(sentence)
    ? { verdict: 'fail', reason: 'a ground-contact time in ms' }
    : { verdict: 'warn', reason: 'a millisecond figure that is neither a frame interval nor named' };
}

/**
 * The classifier. Every numeric figure in `text` (one runner-facing field), with the subject its
 * clause attributes it to and the verdict that subject earns. Pure, and exported so the
 * regression corpus can assert per-figure rather than only per-result.
 */
export function classifyNumericClaims(text: string): NumericFigure[] {
  const out: NumericFigure[] = [];
  for (const sentence of text.split(SENTENCE_END)) {
    const figures = findFigures(sentence);
    if (figures.length === 0) continue;

    let masked = '';
    let cursor = 0;
    figures.forEach((f, i) => {
      masked += sentence.slice(cursor, f.start) + `\u0001${i}\u0002`;
      cursor = f.end;
    });
    masked += sentence.slice(cursor);
    const restore = (s: string) => s.replace(MASK, (_, i) => figures[Number(i)].text).trim();

    let carried: ClaimSubject = 'unattributed';
    const parts = masked.split(CLAUSE_BREAK);
    for (let p = 0; p < parts.length; p += 2) {
      const clause = parts[p];
      if (p > 0 && carried === 'prescription' && HARD_BREAK.test(parts[p - 1])) carried = 'unattributed';
      const own = clauseSubject(clause);
      const subjectHere: ClaimSubject = own ?? carried;
      let segmentStart = 0;
      for (const m of clause.matchAll(MASK)) {
        const at = m.index ?? 0;
        const figure = figures[Number(m[1])];
        const prescribed = PRESCRIPTION_MARKER.test(clause.slice(segmentStart, at));
        segmentStart = at + m[0].length;
        const subject: ClaimSubject = prescribed ? 'prescription' : subjectHere;
        const judged =
          figure.kind === 'spm'
            ? judgeSpm(figure, sentence, subject)
            : figure.kind === 'ms'
              ? judgeMs(figure, sentence, clause)
              : { verdict: 'fail' as const, reason: 'a vertical-oscillation figure in cm' };
        out.push({ text: figure.text, kind: figure.kind, subject, ...judged, clause: restore(clause) });
      }
      // A clause that names nobody but prescribes hands that on ("Aim for a quicker rhythm, around
      // 170 spm"); one that names nobody at all hands on whatever it inherited.
      // A relative clause hands on nothing: the main clause's subject resumes after it.
      if (RELATIVE_CLAUSE.test(clause)) continue;
      carried = own ?? (PRESCRIPTION_MARKER.test(clause) ? 'prescription' : carried);
    }
  }
  return out;
}

export function checkNoFalsePrecision(result: PaceResult): Check {
  const figures = pillarEntries(result)
    .flatMap(([, p]) => [p.feedback ?? '', ...p.flags.map((f) => f.detail ?? '')])
    .flatMap(classifyNumericClaims);
  const describe = (f: NumericFigure) => `"${f.text}" (${f.reason}) in "${f.clause}"`;

  const failures = figures.filter((f) => f.verdict === 'fail');
  if (failures.length > 0) {
    return {
      id: 'no-false-precision',
      status: 'fail',
      detail:
        `FALSE PRECISION (#112) — forbidden at every tier: ${failures.map(describe).join('; ')}. ` +
        'The frame timestamps are REQUESTED, not measured; a figure derived from them is a rhythm ' +
        'the runner does not have.',
    };
  }

  const warnings = figures.filter((f) => f.verdict === 'warn');
  if (warnings.length > 0) {
    return {
      id: 'no-false-precision',
      status: 'warn',
      detail:
        `No forbidden claim, but worth an eye: ${warnings.map(describe).join('; ')}. ` +
        'Legitimate if it is the certified "180 SPM is not a universal target" norm; check it is.',
    };
  }

  const exempt = figures.filter((f) => f.verdict === 'pass');
  return {
    id: 'no-false-precision',
    status: 'pass',
    detail:
      'No cadence figure attributed to this runner, no GCT in ms, no vertical oscillation in cm.' +
      (exempt.length > 0 ? ` Exempt: ${exempt.map(describe).join('; ')}.` : ''),
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
  /** How many frames a Free submission of this medium actually carries: 1 for a photo (every
   * tier), `PACE_FRAME_CAP.free` for a video. */
  frameCap: number;
  /** Pillars a free submission of this medium can never have scored, given that frame count. */
  unreachablePillars: PacePillarId[];
  /** e.g. "2 of 4". */
  bestCase: string;
}

/**
 * ISSUE #89, AS ARITHMETIC. No model, no images, no spend — just the repo's own constants.
 *
 * The ceiling is a property of the MEDIUM, not the tier. A photo is one frame on every tier, and
 * `analyze-form-prompt.ts`'s MEDIUM_RULES.photo says a still "CANNOT assess Cadence or Elasticity
 * ... Both are motion over time" and requires `score: null` for both — so a Free PHOTO is scored on
 * at most 2 of the 4 pillars, honestly and by construction. A Free VIDEO carries
 * `PACE_FRAME_CAP.free` frames: while that was 1 (before 2026-09-19) the same 2-of-4 ceiling
 * applied to every free trial, clip or not — the collision #89 was filed about. The captain's
 * decision raised it to Pro's 5-frame stride burst, so a Free video can now reach all four.
 *
 * This function is the evidence in both directions: the deno test over it asserts that Free video
 * CAN reach Cadence/Elasticity and that Free photo never does, so the day either half changes,
 * the change announces itself. The harness must never "fix" the photo half: it is the expected,
 * correct behaviour of an honest analyzer.
 */
export function freeTierCeiling(media: PaceMediaKind): FreeTierCeiling {
  const frameCap = media === 'photo' ? 1 : PACE_FRAME_CAP.free;
  // One frame is a still, and a still cannot carry motion-over-time.
  const unreachablePillars: PacePillarId[] = frameCap < 2 ? ['cadence', 'elasticity'] : [];
  const reachable = PACE_PILLARS.length - unreachablePillars.length;
  return {
    frameCap,
    unreachablePillars,
    bestCase: `${reachable} of ${PACE_PILLARS.length}`,
  };
}
