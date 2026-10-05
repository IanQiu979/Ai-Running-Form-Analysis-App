/**
 * Realistic `@shared/pace` result fixtures (issue #56) — used by `lib/__tests__` and
 * `components/__tests__` to prove the result screen renders every honest state the contract
 * allows, not just the fully-scored happy path.
 *
 * Written when `analyze-form` (#44) did not yet exist and `analyses` had zero live rows to test
 * against; `analyze-form` is deployed and live now (issue #128), but these fixtures remain the
 * fast, deterministic way to exercise every honest state without a live model call — see
 * `components/pace-readout.tsx`'s header for the rule they exist to prove: a pillar the model
 * did not return is `score: null, band: null`, and must never render as "0" or a greyed-out
 * fake score.
 *
 * Test/dev fixtures only — nothing under `app/` or non-test `components/`/`lib/` code imports
 * this file. Kept as a plain `lib/` module (not inside a `__tests__`/`__fixtures__` directory)
 * so it can be imported by both `lib/__tests__/*.test.ts` and `components/__tests__/*.test.tsx`
 * without Jest's default `testMatch` (which matches every file under any `__tests__` directory
 * regardless of name — see `jest.config.js`'s comment) mistaking it for a test file itself.
 */
import type {
  PaceAnalysisOutcome,
  PaceDrill,
  PaceInjuryFlag,
  PaceNotAssessedReason,
  PacePillarResult,
  PaceResult,
} from '@shared/pace';

function scored(
  score: number,
  band: PacePillarResult['band'],
  feedback: string,
  flags: PaceInjuryFlag[] = [],
  drills: PaceDrill[] = [],
  analysis?: string
): PacePillarResult {
  return { score, band, feedback, analysis, flags, drills };
}

function notAssessed(reason?: PaceNotAssessedReason): PacePillarResult {
  return { score: null, band: null, feedback: null, notAssessedReason: reason, flags: [], drills: [] };
}

export const POSTURE_ANALYSIS_FIXTURE =
  'The clip shows a slight forward lean beginning at the ankles while your head stays level rather than reaching forward. That alignment helps direct momentum ahead without folding at the waist or adding avoidable load through the lower back. Keep the tall line through your hips and shoulders, and reset it when fatigue makes your torso tip. In this clip, the stable head position is the part to preserve. Review future side-on clips for the same ankle-led line rather than trying to increase the lean.';

export const ARM_SWING_ANALYSIS_FIXTURE =
  'Your hands begin in a compact position, then rise toward the chest later in the clip as fatigue builds. That upward drift can add shoulder tension and uses motion that should support balance and rhythm. Let the shoulders soften, keep the elbows comfortably bent, and think about driving the hands back rather than lifting them. The front-to-back path is otherwise controlled, so the priority is reducing the late-clip lift rather than rebuilding the whole action. Check whether the hands stay low and relaxed on a future clip taken at a similar effort.';

export const CADENCE_ANALYSIS_FIXTURE =
  'The clearest visible pattern is the foot reaching well ahead of the hips with the knee close to straight at landing. That creates a braking action on each step instead of letting the body pass smoothly over the foot. Shorten the reach in front, place the foot nearer beneath you, and use a slightly quicker, relaxed turnover without chasing a specific number. Keep the change comfortable enough that the feet still land quietly and the upper body remains relaxed. A later side-on clip can show whether the landing has moved nearer the hips without inventing a cadence value from this footage.';

export const ELASTICITY_ANALYSIS_FIXTURE =
  'Your contacts look quiet and springy, with little visible rise and fall between steps. That suggests you are redirecting force forward instead of spending extra energy bouncing upward. Preserve that response by landing softly beneath you and letting the ankle and calf recoil naturally rather than forcing a stiff push-off. The pattern stays consistent across the visible strides, so there is no clear need to add more bounce. Recheck it when tired, when stiffness can replace the relaxed spring shown here.';

const FREE_POSTURE_ANALYSIS_FIXTURE =
  'The clip shows a slight forward lean from the ankles while your head stays level. That alignment helps direct momentum ahead without folding at the waist. Keep the tall line through your hips and shoulders as fatigue builds.';

const FREE_ARM_SWING_ANALYSIS_FIXTURE =
  'Your hands begin in a compact position, then rise toward the chest later in the clip. That drift can add shoulder tension and motion that does not support forward rhythm. Let the shoulders soften and think about driving the hands back rather than lifting them.';

const FREE_CADENCE_ANALYSIS_FIXTURE =
  'The foot reaches ahead of the hips with the knee close to straight at landing. That creates a braking action instead of letting the body pass smoothly over the foot. Shorten the reach in front and use a slightly quicker, relaxed turnover without chasing a specific number.';

const FREE_ELASTICITY_ANALYSIS_FIXTURE =
  'Your contacts look quiet and springy, with little visible rise and fall between steps. That helps direct energy forward instead of spending it on extra bounce. Keep landing softly beneath you and allow the ankle and calf to recoil naturally.';

/** A pillar from an analysis stored before the optional fuller-analysis field existed. */
export const legacyStoredPosturePillar: PacePillarResult = {
  score: 78,
  band: 'good',
  feedback: 'Slight forward lean from the ankles, good — head stays level through the stride.',
  flags: [],
  drills: [],
};

/** A full Pro-tier video result — every pillar assessed, feedback + injury flags + drills all
 * present (`docs/design/frontend-design-brief.md` §3: "Pro — fuller per-pillar feedback,
 * injury-risk flags, 1–2 drills per issue."). Same pillar scores as `freeTierVideoResult` below
 * on purpose, so diffing the two isolates exactly the tier-gated fields. */
export const proTierVideoResult: PaceResult = {
  pillars: {
    posture: scored(
      78,
      'good',
      'Slight forward lean from the ankles, good — head stays level through the stride.',
      [],
      [
        {
          name: 'Posture Reset (in-run cue)',
          instructions: 'Every 5–10 min: drop the shoulders, level the head, re-set the ankle lean.',
        },
      ],
      POSTURE_ANALYSIS_FIXTURE
    ),
    armSwing: scored(
      64,
      'mid',
      'Hands are creeping up toward the chest under fatigue in the back half of the clip.',
      [],
      [
        {
          name: 'Arm-Swing Box Drill',
          instructions: 'Elbows ~90°, drive front-to-back from the shoulder, nothing crosses the midline. 3×30s.',
        },
      ],
      ARM_SWING_ANALYSIS_FIXTURE
    ),
    cadence: scored(
      44,
      'low',
      'Foot is landing well ahead of the hips with a near-straight knee — the clearest fix available here.',
      [
        {
          pattern: 'Overstriding',
          detail:
            'Foot lands ahead of the centre of mass with an extended knee, amplifying braking force. Associated with shin splints and patellofemoral pain — shorten and quicken the stride.',
        },
      ],
      [{ name: 'Metronome Runs', instructions: 'Set a metronome +2–3 SPM above baseline, 10 min on / 5 min off, 2–3x.' }],
      CADENCE_ANALYSIS_FIXTURE
    ),
    elasticity: scored(71, 'good', 'Quiet, springy contact — low vertical bounce.', [], [], ELASTICITY_ANALYSIS_FIXTURE),
  },
  overall: { score: 64, band: 'mid' },
};

/** Same scores as `proTierVideoResult`, but shaped exactly the way Free tier's structural
 * contract requires: flags and drills are always `[]` — never omitted — and feedback is a single
 * short line (frontend-design-brief.md §3: "Free ... one line of feedback each. No drills. No
 * flags."). `components/pace-readout.tsx` renders this honestly by checking array length; it
 * never re-derives "this is a Free result" itself (CLAUDE.md: no business rules in the client). */
export const freeTierVideoResult: PaceResult = {
  pillars: {
    posture: scored(78, 'good', 'Good ankle-driven lean, head level.', [], [], FREE_POSTURE_ANALYSIS_FIXTURE),
    armSwing: scored(64, 'mid', 'Hands drift high late in the clip.', [], [], FREE_ARM_SWING_ANALYSIS_FIXTURE),
    cadence: scored(44, 'low', 'Foot lands well ahead of your hips.', [], [], FREE_CADENCE_ANALYSIS_FIXTURE),
    elasticity: scored(71, 'good', 'Quiet, springy contact.', [], [], FREE_ELASTICITY_ANALYSIS_FIXTURE),
  },
  overall: { score: 64, band: 'mid' },
};

/** THE core honesty fixture the task calls out by name: a PHOTO submission. Posture and Arm
 * swing are assessable from one still frame; Cadence and Elasticity are motion-over-time pillars
 * a single photo structurally cannot show (`knowledge/pace_framework.md`: "Cannot show cadence,
 * arm-swing range, vertical oscillation, or ground-contact time... Score those pillars as needs
 * video rather than guessing"). Half of this result is legitimately, honestly not-assessed —
 * that's the common case for a photo, not an error. */
export const photoResult: PaceResult = {
  pillars: {
    posture: scored(82, 'good', 'Ankle-driven lean looks close to ideal in this frame.'),
    armSwing: scored(70, 'good', 'Elbow angle and hand position look compact.'),
    cadence: notAssessed('needsVideo'),
    elasticity: notAssessed('needsVideo'),
  },
  overall: { score: 76, band: 'good' },
};

/** A badly-framed clip: the camera isn't side-on, so Posture can't be judged either, alongside
 * the photo-only pillars — proves the OTHER not-assessed reason (`'angle'`) renders its own,
 * distinct copy instead of reusing `'needsVideo'`'s string. */
export const poorFramingPhotoResult: PaceResult = {
  pillars: {
    posture: notAssessed('angle'),
    armSwing: scored(58, 'mid', 'Visible tension in the shoulders; hard to read the arc from this angle.'),
    cadence: notAssessed('needsVideo'),
    elasticity: notAssessed('needsVideo'),
  },
  overall: { score: 58, band: 'mid' },
};

/** An honest retry-then-fallback partial result (`PACE_MIN_ASSESSED_PILLARS_FOR_PARTIAL` = 2):
 * Posture and Cadence parsed cleanly on the retry; Arm swing and Elasticity never validated
 * structurally, so — unlike the photo fixtures above — they carry no `notAssessedReason` at all
 * (a parse gap, not a medium limitation the model itself reported; see `pace.ts`'s own note that
 * `score: null` renders identically either way). Pair with `isFallback: true` — see
 * `fallbackOutcome` below. */
export const fallbackResult: PaceResult = {
  pillars: {
    posture: scored(69, 'mid', 'Slight bend at the waist rather than a lean from the ankles.'),
    armSwing: notAssessed(),
    cadence: scored(52, 'mid', 'Stride length looks a little long for this pace.'),
    elasticity: notAssessed(),
  },
  overall: { score: 61, band: 'mid' },
};

/** The extreme edge the contract allows but is rare in practice: every pillar not assessed (a
 * photo submitted with framing poor enough that even Posture and Arm swing fail too). `overall`
 * is null — "never a fabricated average built from zero real data" (`PaceOverall`'s own doc
 * comment) — so the headline itself must render hollow, not a fabricated 0. */
export const allNotAssessedResult: PaceResult = {
  pillars: {
    posture: notAssessed('angle'),
    armSwing: notAssessed('angle'),
    cadence: notAssessed('needsVideo'),
    elasticity: notAssessed('needsVideo'),
  },
  overall: { score: null, band: null },
};

export const proTierOutcome: PaceAnalysisOutcome = { result: proTierVideoResult, isFallback: false };
export const freeTierOutcome: PaceAnalysisOutcome = { result: freeTierVideoResult, isFallback: false };
export const photoOutcome: PaceAnalysisOutcome = { result: photoResult, isFallback: false };
export const poorFramingPhotoOutcome: PaceAnalysisOutcome = { result: poorFramingPhotoResult, isFallback: false };
export const fallbackOutcome: PaceAnalysisOutcome = { result: fallbackResult, isFallback: true };
export const allNotAssessedOutcome: PaceAnalysisOutcome = { result: allNotAssessedResult, isFallback: false };

/** THE SAFETY FIXTURE. Posture carries a certified stop-running declaration alongside ordinary
 * coaching prose, which is the one combination the readout must keep visually apart: the note is
 * not advice about form, and a runner who reads only one of the two must read that one. It lives
 * on the structured `safety` field — never concatenated into `feedback` — so both surfaces that
 * show it (`components/pace-readout.tsx` and `components/pillar-detail-modal.tsx`) read the same
 * value through `lib/pace-readout.ts`'s `safetyNote()`. Arm swing deliberately declares
 * `signal: 'none'` and cadence carries no `safety` field at all, so the same fixture also proves
 * both no-signal cases render nothing. Elasticity is NOT assessed (a photo cannot show a bounce
 * cycle) yet carries its own declaration: the honesty rule says a `score: null` pillar renders no
 * numeral, band or fill, and the note must still stand alone there — it is the one thing a single
 * frame can warrant saying. */
export const SAFETY_NOTE_FIXTURE =
  'The left leg cannot take even weight and you are guarding it — see someone before your next run.';

export const NOT_ASSESSED_SAFETY_NOTE_FIXTURE =
  'Pain at the back of the heel that sharpens as you push off is a reason to stop. Have it assessed before your next run.';

export const safetySignalPhotoResult: PaceResult = {
  pillars: {
    posture: {
      ...scored(82, 'good', 'Ankle-driven lean looks close to ideal in this frame.', [], [], POSTURE_ANALYSIS_FIXTURE),
      safety: { signal: 'swellingLimpOrFavouringOneSide', note: SAFETY_NOTE_FIXTURE },
    },
    armSwing: {
      ...scored(70, 'good', 'Elbow angle and hand position look compact.', [], [], ARM_SWING_ANALYSIS_FIXTURE),
      safety: { signal: 'none', note: '' },
    },
    cadence: notAssessed('needsVideo'),
    elasticity: {
      ...notAssessed('needsVideo'),
      safety: { signal: 'sharpOrWorseningPain', note: NOT_ASSESSED_SAFETY_NOTE_FIXTURE },
    },
  },
  overall: { score: 76, band: 'good' },
};
