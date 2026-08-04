/**
 * The Free-tier sample preview (captain-approved 2026-07-26): Free makes ZERO Anthropic calls,
 * ever — this is the fabricated, hand-authored `PaceResult` `analyze-form` hands back instead,
 * always paired with `isSample: true` in the response body (`flow.ts`'s free-tier branch).
 *
 * This is fabricated demo content, not a real analysis of anyone's upload — it is NEVER
 * persisted (no `analyses` row is created for a sample response; see `flow.ts`'s tier branch),
 * never cached per-user, and never varies by request. Its whole job is to look like a believable
 * Pro-tier result (all four pillars scored, real flags and drills) so a Free user can see what
 * upgrading buys — the honesty burden is on the client's labeling (`app/result/sample.tsx`'s
 * banner + `Copy.result.sample.*`), not on this data pretending to be modest.
 *
 * Content style matches `knowledge/injury_flags.md` / `knowledge/drills.md`'s own templates
 * (pattern -> association -> safe next step; a named drill + cue), same as a real model response
 * would produce, so the preview is representative rather than a placeholder-looking stand-in.
 */
import { PACE_PILLARS, type PaceResult } from './pace.ts';

export const FREE_SAMPLE_PACE_RESULT: PaceResult = {
  pillars: {
    posture: {
      score: 81,
      band: 'good',
      feedback:
        'A tall, upright trunk through most of the stride, with a slight forward lean from the ankles rather than the waist — the efficient version of "lean in." A little more lift through the crown of the head would keep this from softening late in a run.',
      flags: [],
      drills: [],
    },
    armSwing: {
      score: 64,
      band: 'mid',
      feedback:
        'Arms swing mostly front-to-back, but the right arm crosses the midline on the forward swing, twisting the shoulders slightly with every stride. Left arm mechanics look clean.',
      flags: [
        {
          pattern: 'Cross-body arm swing',
          detail:
            'The right arm crossing the body\'s centerline is commonly linked to compensatory trunk rotation, which can bleed energy that should be moving you forward and add rotational load through the lower back over a long run. Not urgent, but worth grooving out before higher mileage.',
        },
      ],
      drills: [
        {
          name: 'Wall Arm Drive Drill',
          instructions:
            'Stand tall facing a wall, elbows bent near 90°. Drive each arm straight front-to-back without letting the hand cross the body\'s centerline — imagine two parallel tracks, one for each arm. 3 sets of 20 seconds per side, done slowly enough to feel the correction.',
        },
      ],
    },
    cadence: {
      score: 76,
      band: 'good',
      feedback:
        'Averaging in the mid-170s steps per minute — comfortably in the efficient range for this pace, with only minor step-to-step variation.',
      flags: [],
      drills: [],
    },
    elasticity: {
      score: 58,
      band: 'mid',
      feedback:
        'Ground contact runs a touch long on the right foot compared to the left, with less spring back into the next stride. The left side shows a noticeably quicker, more elastic push-off.',
      flags: [
        {
          pattern: 'Asymmetric ground contact time',
          detail:
            'A longer right-side ground contact paired with quicker left-side rebound is a common early sign of a strength or mobility imbalance between the two legs. Left unaddressed over months of mileage, this kind of asymmetry is one of the patterns associated with overuse injury on the slower-rebounding side — worth a closer look, not a cause for alarm.',
        },
      ],
      drills: [
        {
          name: 'Single-Leg Pogo Hops',
          instructions:
            'Stand on the right leg, small quick hops off the ball of the foot, minimizing ground contact time — think "hot pavement." 3 sets of 10 hops per leg, comparing how springy each side feels. Build the weaker side toward matching the stronger one over a few weeks.',
        },
      ],
    },
  },
  overall: { score: 70, band: 'good' },
};

/** Defensive parity check only meant to be read by a test — every pillar is present, matching
 * `PACE_PILLARS`'s canonical P-A-C-E order, so a future edit that drops a key fails loudly. */
export const FREE_SAMPLE_PACE_RESULT_PILLAR_IDS = PACE_PILLARS;
