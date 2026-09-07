/**
 * THE FREE HALF OF ISSUE #42 — everything the grounding harness can prove with NO model call.
 *
 * This file runs in the normal commit gate (`npm test` -> `test:edge` -> `deno test`). It costs
 * nothing and it must stay that way: the paid half lives in `grounding-eval.live.ts`, which Deno's
 * test discovery cannot see (it globs `*.test.ts` / `*_test.ts`, and `.live.ts` matches neither) and
 * which only ever runs from `npm run eval:grounding` or its scheduled workflow. That split is the
 * same structural lesson PR #77 applied to the HIBP canary: a test that hits a paid third-party API
 * must never sit in the gate, where it would make every unrelated commit slow, flaky, and billed.
 *
 * TWO THINGS ARE PROVEN HERE, and the second matters more than it looks:
 *
 *   1. GATE 1 — the certified PACE knowledge is VERBATIM in the assembled prompt. This is M3's
 *      actual gate ("the prompt provably includes the PACE framework text"), it is a pure string
 *      assertion, and it needs no model. It is therefore checked on every commit, forever, for free.
 *
 *   2. THE GRADERS CAN ACTUALLY FAIL. Every grader in `grounding-eval.ts` is fed output that is
 *      known-bad in exactly the way it exists to catch — the Echo V1 fabrication (a pillar the
 *      media cannot support, filled in with a confident number), an invented drill, paid content
 *      leaked to Free, a cadence figure the timestamps cannot support — and is asserted to FAIL.
 *      An eval whose graders have never been seen to fail is not an eval; it is a green light with
 *      no bulb in it. This is the half that makes a passing live run mean something.
 *
 *   And the mirror image of (2), which is where a careless harness would do real damage: the
 *   graders are ALSO fed legitimate output that merely LOOKS suspicious — a drill whose certified
 *   instructions say "Raise by ~2 SPM every 2 weeks", another that says "feet ~30 cm back", and the
 *   five paraphrased flag labels five REAL live runs actually produced — and are asserted to PASS.
 *   A grader that fails the model for faithfully quoting the certified corpus would be the bug, and
 *   it would be a bug that reads as a quality regression.
 */

import {
  buildCases,
  certifiedDrillNames,
  certifiedFlagPatterns,
  checkGroundedDrills,
  checkGroundedFlags,
  checkKnowledgeInPrompt,
  checkNoFabricatedScore,
  checkNoFalsePrecision,
  checkNoUnsupportedPillar,
  checkPillarSafety,
  checkTierVerbosity,
  freeTierCeiling,
  gradeCase,
  isCertified,
  promptTextForCase,
  readAttempt,
  requestForCase,
  type Check,
  type GroundingCase,
} from './grounding-eval.ts';
import type { AnthropicMessageResponse } from '../analyze-form-validation.ts';
import { DRILLS_MD, INJURY_FLAGS_MD, PACE_FRAMEWORK_MD } from '../knowledge.generated.ts';
import { MAX_OUTPUT_TOKENS_BY_TIER } from '../ai-pricing.ts';
import { PACE_FRAME_CAP, PACE_PILLARS, type PacePillarResult, type PaceResult } from '../pace.ts';

// -------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/** The four cases are built once — rendering the fixture PNGs is the slow part, and it is pure. */
const CASES: GroundingCase[] = await buildCases();

function caseById(id: string): GroundingCase {
  const found = CASES.find((k) => k.id === id);
  if (!found) throw new Error(`No fixture case "${id}".`);
  return found;
}

/** Wrap a `PaceResult` as the model would actually return it under structured outputs: the response
 * text IS the JSON object. Read back with production's own `readAttempt`, so these tests exercise
 * the real parser and not a stand-in. */
function response(result: unknown): AnthropicMessageResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

function pillar(over: Partial<PacePillarResult> = {}): PacePillarResult {
  return {
    score: 70,
    band: 'good',
    feedback: 'Trunk is tall and stable through the stride.',
    safety: { signal: 'none', note: '' },
    flags: [],
    drills: [],
    ...over,
  };
}

const NOT_ASSESSED: PacePillarResult = {
  score: null,
  band: null,
  feedback: 'Not assessed — a single photo cannot show motion over time. A short side-on video would unlock this.',
  notAssessedReason: 'needsVideo',
  safety: { signal: 'none', note: '' },
  flags: [],
  drills: [],
};

/** The honest photo result: Posture and Arm swing scored, Cadence and Elasticity truthfully null.
 * This is the shape the product returns for EVERY free submission (see the #89 test at the bottom),
 * so every grader must pass it cleanly. */
function honestPhotoResult(): PaceResult {
  return {
    pillars: {
      posture: pillar({ score: 72, band: 'good', feedback: 'The trunk is upright rather than leaning from the ankles.' }),
      armSwing: pillar({ score: 65, band: 'mid', feedback: 'The near elbow opens past 90 degrees behind the body.' }),
      cadence: { ...NOT_ASSESSED },
      elasticity: { ...NOT_ASSESSED },
    },
    // mean(72, 65) = 68.5 -> 69. Not counting the two null pillars as zeros.
    overall: { score: 69, band: 'mid' },
  };
}

function statuses(checks: Check[], id: string): string[] {
  return checks.filter((c) => c.id === id).map((c) => c.status);
}

function failed(check: Check): boolean {
  return check.status === 'fail';
}

// -------------------------------------------------------------------------------------------
// 1. GATE 1 — the certified knowledge is VERBATIM in the prompt. THE M3 GATE. No model call.
// -------------------------------------------------------------------------------------------

Deno.test('GATE 1: every fixture prompt carries all three certified documents VERBATIM', () => {
  // Not "mentions posture" — the ENTIRE file, byte for byte. A truncating or escaping bug in the
  // knowledge bundle would pass an anchor-phrase check and fail this one. And an empty knowledge
  // string does not crash a model call; it just makes the model invent fluent, confident
  // biomechanics from its own general knowledge, which nobody can detect from the output.
  for (const kase of CASES) {
    const gate = checkKnowledgeInPrompt(kase);
    assert(
      gate.ok,
      `Case "${kase.id}" (${kase.tier}/${kase.media}) is MISSING certified knowledge from its ` +
        `prompt: ${gate.missing.join(', ')}. M3's gate is that the prompt provably includes the ` +
        'PACE framework text — this is that proof, and it just failed.'
    );
    assert(
      gate.promptChars > 20_000,
      `Case "${kase.id}" assembled a suspiciously short prompt (${gate.promptChars} chars). The ` +
        'certified knowledge is ~33KB of markdown; a short prompt is what a partial or empty ' +
        'knowledge bundle looks like.'
    );
  }
});

Deno.test('GATE 1: the knowledge in the prompt is the SHIPPED knowledge, not a paraphrase', () => {
  const prompt = promptTextForCase(caseById('stride-video-pro'));

  assert(prompt.includes(PACE_FRAMEWORK_MD), 'pace_framework.md is not verbatim in the prompt.');
  assert(prompt.includes(INJURY_FLAGS_MD), 'injury_flags.md is not verbatim in the prompt.');
  assert(prompt.includes(DRILLS_MD), 'drills.md is not verbatim in the prompt.');
  assert(prompt.includes('Never fabricate a number'), 'The certified never-fabricate rule is missing.');
  assert(prompt.includes('Overstriding'), 'The certified overstriding flag is missing.');
  assert(prompt.includes('Pogo Hops'), 'The certified drill library is missing.');
});

Deno.test('the eval sends the request PRODUCTION would send — not one it built itself', () => {
  // If the harness assembled its own request, it would be grading a prompt that does not ship, and
  // a green eval would say nothing about the product. Every case goes through
  // `buildAnalyzeFormRequest` — #44's own builder.
  for (const kase of CASES) {
    const request = requestForCase(kase);
    assert(request.thinking.type === 'adaptive', `Case "${kase.id}" lost adaptive thinking.`);
    assert(
      request.output_config.format?.type === 'json_schema',
      `Case "${kase.id}" is not using the structured-output contract.`
    );
    assert(
      request.max_tokens === MAX_OUTPUT_TOKENS_BY_TIER[kase.tier],
      `Case "${kase.id}" would not use the tier's real max_tokens.`
    );
    assert(
      request.messages[0].content.filter((b) => b.type === 'image').length === kase.frames.length,
      `Case "${kase.id}" did not carry every fixture frame as an image block.`
    );
  }
});

// -------------------------------------------------------------------------------------------
// 2. GRADER INTEGRITY — the certified lists are real, or every grounding check passes vacuously
// -------------------------------------------------------------------------------------------

Deno.test('the certified flag/drill lists are parsed from the SHIPPED corpus and are non-empty', () => {
  const flags = certifiedFlagPatterns();
  const drills = certifiedDrillNames();

  assert(flags.length >= 7, `Expected >= 7 certified flags, parsed ${flags.length}: ${flags.join(' | ')}`);
  assert(drills.length >= 12, `Expected >= 12 certified drills, parsed ${drills.length}: ${drills.join(' | ')}`);

  assert(flags.includes('Overstriding'), `"Overstriding" not parsed out of injury_flags.md: ${flags.join(' | ')}`);
  assert(drills.includes('Pogo Hops'), `"Pogo Hops" not parsed out of drills.md: ${drills.join(' | ')}`);
  assert(drills.includes('Metronome Runs'), `"Metronome Runs" not parsed out of drills.md: ${drills.join(' | ')}`);
});

Deno.test('isCertified accepts the real names (in the spellings a model actually emits)', () => {
  const flags = certifiedFlagPatterns();
  const drills = certifiedDrillNames();

  assert(isCertified('Overstriding', flags), '"Overstriding" should be certified.');
  assert(isCertified('Pogo Hops', drills), '"Pogo Hops" should be certified.');
  assert(isCertified('metronome runs', drills), 'Case drift must not read as a fabrication.');
  assert(isCertified('Hip/Glute Stability block', drills), "drills.md's own fault-map spelling must match.");
  assert(isCertified('Crossing-midline arms', flags), 'Half a compound flag heading must be certified.');
  assert(isCertified('Heavy heel strike', flags), 'A prefix of a flag heading must be certified.');
});

Deno.test('REGRESSION: every flag/drill label five LIVE runs actually produced is GROUNDED', () => {
  // These are not invented test inputs. Every string below came back from a real `claude-sonnet-5`
  // call against the fixtures, and each one FAILED an earlier version of `isCertified` — for the
  // model being RIGHT. They are pinned here so the grader can never re-tighten onto them.
  //
  //   run 2:  "Tense, hiked/high-carried arms"           (a re-titled compound heading)
  //   run 3:  "Tense, hiked-shoulder / high-carried arms" (+ a dropped plural)
  //   run 3:  "Elevated vertical oscillation (moderate)"  (a severity adjective swapped in)
  //   run 3:  "Overstriding (mild)"                       (a severity qualifier appended)
  //   run 4:  "Waist bend / rounded posture"              (verb morphology: bend vs bending)
  //
  // The certified headings they correspond to:
  //   "Tense, hiked shoulders / crossing-midline arms"
  //   "Excessive vertical oscillation"
  //   "Overstriding"
  //   "Anterior pelvic tilt / bending at the waist"
  //
  // The label was NEVER the contract — `pace.ts` says `pattern` is "not structurally constrained to
  // that exact list", because the substance of a flag lives in its `detail`. Grading the title's
  // exact wording was testing a promise the product deliberately does not make. (Each paraphrase
  // was checked BY HAND against the certified section it names: e.g. the `detail` of "Waist bend /
  // rounded posture" reproduces the certified "folds at the waist / lower-back strain / lean from
  // the ankles" content exactly. The model raised the RIGHT fault and re-titled it.)
  const flags = certifiedFlagPatterns();

  const observedFlagLabels = [
    'Tense, hiked/high-carried arms',
    'Tense, hiked-shoulder / high-carried arms',
    'Elevated vertical oscillation (moderate)',
    'Overstriding (mild)',
    'Waist bend / rounded posture',
    'Anterior pelvic tilt / bending at the waist',
  ];
  for (const label of observedFlagLabels) {
    assert(
      isCertified(label, flags),
      `A real live run returned the flag ${JSON.stringify(label)}, which names a CERTIFIED fault. ` +
        'The grader must not call it invented — that would be a permanent false alarm on correct output.'
    );
  }

  // DRILLS, by contrast, came back as verbatim proper nouns in all five runs — no leniency was
  // ever needed, and none should creep in. This is the strong half of the grounding proof.
  const drills = certifiedDrillNames();
  for (const name of ['Arm-Swing Box Drill', 'Metronome Runs', 'Strides', 'Ankle Bounces (Ankling)']) {
    assert(isCertified(name, drills), `The live model returned the certified drill ${JSON.stringify(name)}.`);
  }

  assert(isCertified('High Knees', drills), 'One drill of a compound heading must be certified.');
  assert(isCertified('Butt Kicks', drills), 'One drill of a compound heading must be certified.');
});

Deno.test('isCertified REJECTS a fluent, plausible, invented name — the ungrounded failure mode', () => {
  const flags = certifiedFlagPatterns();
  const drills = certifiedDrillNames();

  // THE GUARD RAILS ON THE LOOSENING ABOVE. `isCertified` was rewritten twice to stop it failing
  // correct output; each rewrite is a chance to punch a hole straight through the grounding proof.
  // These are what make that impossible to do silently. Every name here is what an UNGROUNDED model
  // produces: it sounds exactly like a running coach and traces to nothing Ian certified.
  //
  // If a future change makes any of these pass, the harness has stopped proving grounding — and it
  // will still be green, which is the whole danger.
  assert(!isCertified('Cadence Ladder Drill', drills), 'An invented drill must not be certified.');
  assert(!isCertified('Reactive Strength Protocol', drills), 'An invented drill must not be certified.');
  assert(!isCertified('Lazy glutes', flags), 'An invented flag must not be certified.');
  assert(!isCertified('Weak core engagement', flags), 'An invented flag must not be certified.');
  assert(!isCertified('Weak posterior chain', flags), 'An invented flag must not be certified.');
  assert(!isCertified('Insufficient hip extension', flags), 'An invented flag must not be certified.');

  // THE NEAR MISSES — the ones that share a word with the corpus and must STILL be rejected.
  // "Hip / Glute Stability block" contributes the bare tokens "hip" and "glute"; if either could
  // certify on its own, these would all sail through and the proof would be a rubber stamp.
  assert(!isCertified('Hip Thrusts', drills), '"Hip" alone must not certify an invented drill.');
  assert(!isCertified('Glute Activation Circuit', drills), '"Glute" alone must not certify an invented drill.');
  assert(!isCertified('Arm Circles', drills), '"Arm" alone must not certify an invented drill.');
  assert(!isCertified('Run', drills), 'A 3-character name must not match by containment.');
});

// -------------------------------------------------------------------------------------------
// 3. THE GRADERS CAN FAIL — fed the exact output each one exists to catch
// -------------------------------------------------------------------------------------------

Deno.test('THE BANNED ECHO V1 MISTAKE: a pillar the media cannot support, filled with a number', () => {
  const free = caseById('still-free');

  // Echo V1's "tolerant parser" filled a missing pillar with score 75 and "No feedback available".
  // Here the MODEL does it: it scores Cadence off a single still, which cannot show step rate.
  // Fluent, confident, and wrong — and the runner cannot tell.
  const fabricated = honestPhotoResult();
  fabricated.pillars.cadence = pillar({
    score: 75,
    band: 'good',
    feedback: 'Your turnover looks quick and efficient.',
  });
  fabricated.overall = { score: 71, band: 'good' };

  const checks = checkNoUnsupportedPillar(free, fabricated);
  assert(
    checks.some(failed),
    'A Cadence score invented from a SINGLE STILL was not caught. This is the one failure the ' +
      'product exists to not repeat, and the grader just waved it through.'
  );

  assert(
    !checkNoUnsupportedPillar(free, honestPhotoResult()).some(failed),
    'The honest photo result (Cadence/Elasticity null) must PASS.'
  );
});

Deno.test('a score on an input with NOTHING IN IT is caught', () => {
  const blank = caseById('blank-pro');

  const invented: PaceResult = {
    pillars: {
      posture: pillar({ score: 68, band: 'mid', feedback: 'Reasonable trunk position.' }),
      armSwing: pillar({ score: 70, band: 'good', feedback: 'Arms look relaxed.' }),
      cadence: { ...NOT_ASSESSED },
      elasticity: { ...NOT_ASSESSED },
    },
    overall: { score: 69, band: 'mid' },
  };
  assert(
    failed(checkNoFabricatedScore(blank, invented)),
    'Two scores were invented from an empty field and the grader passed it.'
  );

  const honest: PaceResult = {
    pillars: {
      posture: { ...NOT_ASSESSED, notAssessedReason: 'angle' },
      armSwing: { ...NOT_ASSESSED, notAssessedReason: 'angle' },
      cadence: { ...NOT_ASSESSED, notAssessedReason: 'angle' },
      elasticity: { ...NOT_ASSESSED, notAssessedReason: 'angle' },
    },
    overall: { score: null, band: null },
  };
  assert(
    !failed(checkNoFabricatedScore(blank, honest)),
    'The all-null result for an empty field is the CORRECT answer and must pass.'
  );
});

Deno.test('a fabricated `overall` is caught — including one that counted nulls as zeros', () => {
  const free = caseById('still-free');

  const conjured = honestPhotoResult();
  conjured.overall = { score: 90, band: 'strong' };
  assert(failed(checkNoFabricatedScore(free, conjured)), 'An overall of 90 over pillars of 72/65 was not caught.');

  // The subtler one: averaging over all four pillars, counting the two not-assessed ones as ZERO.
  // (72 + 65 + 0 + 0) / 4 = 34. That silently punishes the runner for a camera angle, and the
  // prompt explicitly forbids it.
  const zeroed = honestPhotoResult();
  zeroed.overall = { score: 34, band: 'low' };
  assert(
    failed(checkNoFabricatedScore(free, zeroed)),
    'An overall that counted not-assessed pillars as zeros was not caught.'
  );

  assert(!failed(checkNoFabricatedScore(free, honestPhotoResult())), 'The correct mean (69) must pass.');
});

Deno.test('an INVENTED drill or flag is caught — the grounding proof itself', () => {
  const withInventedDrill = honestPhotoResult();
  withInventedDrill.pillars.posture.drills = [
    { name: 'Cadence Ladder Drill', instructions: 'Build turnover over six weeks.' },
  ];
  assert(
    failed(checkGroundedDrills(withInventedDrill)),
    'A drill that exists nowhere in drills.md was prescribed and the grader passed it. This check ' +
      'IS the grounding proof — a fluent invented drill is exactly what an ungrounded model emits.'
  );

  const withInventedFlag = honestPhotoResult();
  withInventedFlag.pillars.posture.flags = [
    { pattern: 'Lazy glutes', detail: 'Associated with poor drive.' },
  ];
  assert(failed(checkGroundedFlags(withInventedFlag)), 'A flag with no basis in injury_flags.md was not caught.');

  const grounded = honestPhotoResult();
  grounded.pillars.posture.flags = [
    { pattern: 'Overstriding', detail: 'The foot lands well ahead of the centre of mass.' },
  ];
  grounded.pillars.posture.drills = [
    { name: 'Wall Forward-Lean Drill', instructions: 'Stand facing a wall, feet ~30 cm back.' },
  ];
  assert(!failed(checkGroundedFlags(grounded)), 'A certified flag must pass.');
  assert(!failed(checkGroundedDrills(grounded)), 'A certified drill must pass.');
});

Deno.test('GATE 4: paid-tier content leaking to Free is caught', () => {
  const free = caseById('still-free');

  const leaked = honestPhotoResult();
  leaked.pillars.posture.drills = [
    { name: 'Pogo Hops', instructions: 'Quick, rhythmic bounce. The floor is hot.' },
  ];
  assert(
    failed(checkTierVerbosity(free, leaked)),
    'A Free result carrying a drill was not caught. Free gets no drills — that is the paywall.'
  );

  const flagged = honestPhotoResult();
  flagged.pillars.posture.flags = [{ pattern: 'Overstriding', detail: 'Foot lands ahead of the hips.' }];
  assert(failed(checkTierVerbosity(free, flagged)), 'A Free result carrying an injury flag was not caught.');

  const verbose = honestPhotoResult();
  verbose.pillars.posture.feedback =
    'Your trunk is upright. That costs you forward drive. Lean from the ankles, not the waist.';
  assert(failed(checkTierVerbosity(free, verbose)), 'A three-sentence Free pillar was not caught.');

  assert(!failed(checkTierVerbosity(free, honestPhotoResult())), 'A correct Free result must pass.');
});

Deno.test('GATE 4: a paid tier that flags a fault but prescribes no drill is caught', () => {
  const pro = caseById('still-pro');

  const flaggedNoDrill = honestPhotoResult();
  flaggedNoDrill.pillars.posture.flags = [
    { pattern: 'Overstriding', detail: 'The foot lands well ahead of the centre of mass.' },
  ];
  assert(
    failed(checkTierVerbosity(pro, flaggedNoDrill)),
    'Pro raised a flag and prescribed nothing for it; that was not caught.'
  );

  // But a paid tier that raises NO flag owes NO drill. The prompt itself calls an empty flag list
  // "a fine and common answer" — failing a model for correctly telling a good runner that nothing
  // is wrong would be exactly the over-tight content validation CLAUDE.md bans.
  assert(
    !failed(checkTierVerbosity(pro, honestPhotoResult())),
    'A clean Pro result with no flags and no drills is legitimate and must pass.'
  );
});

Deno.test('#112: false precision the approximate timestamps cannot support is caught', () => {
  const spm = honestPhotoResult();
  spm.pillars.cadence = pillar({
    score: 60,
    band: 'mid',
    feedback: 'Your cadence is 164 SPM, which is below the ideal range.',
  });
  assert(
    failed(checkNoFalsePrecision(spm)),
    'The exact forbidden example ("your cadence is 164 SPM") was not caught.'
  );

  const gct = honestPhotoResult();
  gct.pillars.elasticity.feedback = 'Ground contact is around 250 ms, which is long for your pace.';
  assert(failed(checkNoFalsePrecision(gct)), 'A ground-contact time in milliseconds was not caught.');

  const vo = honestPhotoResult();
  vo.pillars.elasticity.feedback = 'You are bouncing about 12 cm vertically on each step.';
  assert(failed(checkNoFalsePrecision(vo)), 'A vertical oscillation in centimetres was not caught.');

  // A labelled RANGE is what the prompt explicitly permits. It must NOT fail.
  const hedged = honestPhotoResult();
  hedged.pillars.cadence = pillar({
    score: 60,
    band: 'mid',
    feedback: 'Roughly 160-170 SPM — approximate, estimated from frames whose timing is not exact.',
  });
  assert(
    !failed(checkNoFalsePrecision(hedged)),
    'A correctly hedged, labelled-approximate RANGE is exactly what the prompt asks for and must pass.'
  );
});

Deno.test('THE GRADER IS NOT THE BUG (2): describing the FRAME SPACING in ms is obedience, not a GCT claim', () => {
  // VERBATIM from the live run of 2026-09-07, `stride-video-elite`. The bare `/\d+ *ms/` this
  // check used to carry failed this sentence — and this sentence is TIMESTAMP_RULES being obeyed
  // almost to the letter: the model named the frame spacing it was handed in the manifest, hedged
  // it with "~", gave a wide range instead of a point value, said the timestamps are not
  // guaranteed evenly spaced, and told the runner to treat it as a rough sense rather than a
  // measurement. A grader that reds an answer that good trains its reader to skip the red.
  const obedient = honestPhotoResult();
  obedient.pillars.cadence = pillar({
    score: 60,
    band: 'mid',
    feedback:
      'I want to be explicit that any steps-per-minute figure I could estimate from the ' +
      "~200ms-apart timestamps would be a wide, approximate range only (something like the " +
      "150-175 SPM neighborhood) and the timestamps themselves aren't guaranteed to be evenly " +
      'spaced — so treat that number as a rough sense of pace, not a measurement.',
  });

  const check = checkNoFalsePrecision(obedient);
  assert(
    !failed(check),
    'The grader FAILED a model that obeyed TIMESTAMP_RULES. A millisecond figure describing the ' +
      `FRAME INTERVAL is not a ground-contact-time claim. Got: ${check.detail}`
  );
});

Deno.test('a REAL ground-contact-time figure in ms is still caught', () => {
  // The contrast case, and the reason the scoping above is a window and not a deletion. GCT is a
  // lab metric; from a phone video the model is inferring lightness, not measuring milliseconds.
  for (const feedback of [
    'Your ground contact time is about 200ms, which is on the long side.',
    'GCT looks like roughly 190 ms here.',
    'Stance time of 210ms suggests you are sitting into the ground.',
    'You are spending around 250 milliseconds of time on the ground each step.',
  ]) {
    const fabricating = honestPhotoResult();
    fabricating.pillars.elasticity = pillar({ score: 50, band: 'low', feedback });

    const check = checkNoFalsePrecision(fabricating);
    assert(
      failed(check),
      `A real GCT claim slipped past the grader: "${feedback}" -> ${check.status} (${check.detail})`
    );
  }
});

Deno.test('THE GRADER IS NOT THE BUG: certified text that LOOKS like false precision must pass', () => {
  // The trap this test exists to hold shut. The certified corpus itself contains:
  //   drills.md:64          "Raise by ~2 SPM every 2 weeks"     (a drill PRESCRIPTION)
  //   drills.md:24          "feet ~30 cm back"                  (a drill SETUP)
  //   pace_framework.md:134 "180 SPM is not a universal target." (a NORM, quoted to be rejected)
  // The prompt tells the model to quote drill instructions from drills.md. A regex for
  // /\d+ *(SPM|cm)/ over the whole response would therefore fail the model for OBEYING — and the
  // grader, not the model, would be the regression. `checkNoFalsePrecision` scopes itself to
  // `feedback` and `flags[].detail` and exempts `drills[].instructions`.
  const obedient = honestPhotoResult();
  obedient.pillars.cadence = pillar({
    score: 55,
    band: 'mid',
    feedback: '180 SPM is not a universal target; what matters is your own rate and how you land.',
    drills: [
      { name: 'Metronome Runs', instructions: 'Raise by ~2 SPM every 2 weeks only while it still feels natural.' },
    ],
  });
  obedient.pillars.posture.drills = [
    { name: 'Wall Forward-Lean Drill', instructions: 'Stand facing a wall, feet ~30 cm back.' },
  ];
  obedient.overall = { score: 64, band: 'mid' };

  const check = checkNoFalsePrecision(obedient);
  assert(
    !failed(check),
    'The grader FAILED a model that faithfully quoted the certified corpus. That is the grader ' +
      `being the bug, and it would read as a quality regression. Got: ${check.detail}`
  );
  assert(!failed(checkGroundedDrills(obedient)), 'Certified drills must stay certified.');
});

// -------------------------------------------------------------------------------------------
// 4. END TO END, OFFLINE — gradeCase over a canned response, through production's own parser
// -------------------------------------------------------------------------------------------

Deno.test('gradeCase passes an honest free-tier photo response end to end', () => {
  const free = caseById('still-free');
  const report = gradeCase(free, readAttempt(response(honestPhotoResult())), 1234, 'claude-sonnet-5');

  assert(report.parsed, "The honest photo result did not parse through production's readAttempt.");
  assert(
    report.passed,
    'The honest free-tier result failed grading: ' +
      report.checks.filter((c) => c.status === 'fail').map((c) => `${c.id}: ${c.detail}`).join(' | ')
  );
  assert(statuses(report.checks, 'structure')[0] === 'pass', 'structure should pass.');
  assert(statuses(report.checks, 'tier-verbosity')[0] === 'pass', 'tier-verbosity should pass.');
});

Deno.test('gradeCase FAILS a prose reply — the response that ignored the contract entirely', () => {
  const free = caseById('still-free');
  const prose: AnthropicMessageResponse = {
    content: [{ type: 'text', text: 'Great running form! Here are some tips to improve your stride...' }],
    stop_reason: 'end_turn',
    usage: {},
  };
  const report = gradeCase(free, readAttempt(prose), 100, 'claude-sonnet-5');

  assert(!report.parsed, 'A prose reply must not parse as a PaceResult.');
  assert(!report.passed, 'A prose reply must fail the harness.');
});

Deno.test('an unsupportable input may fail CLEANLY — but never with an invented score', () => {
  const blank = caseById('blank-pro');

  // Issue #42's assertion 3, in its own words: "a deliberately bad input yields a clean failure OR
  // an honest partial, never a fabricated score." A refusal on an empty field is honest — the flow
  // releases the reservation and the user is not charged.
  const refusal: AnthropicMessageResponse = {
    content: [{ type: 'text', text: 'I cannot analyse running form from this image.' }],
    stop_reason: 'end_turn',
    usage: {},
  };
  const clean = gradeCase(blank, readAttempt(refusal), 100, 'claude-sonnet-5');
  assert(clean.passed, `A clean refusal on an empty field is honest and must pass. Got: ${JSON.stringify(clean.checks)}`);

  // What is NEVER acceptable is a number — including one smuggled in through the SALVAGE path,
  // which is how a "partial" could quietly become a fabrication.
  const salvageable = {
    pillars: {
      posture: pillar({ score: 68, band: 'mid', feedback: 'Looks solid.' }),
      armSwing: pillar({ score: 70, band: 'good', feedback: 'Relaxed.' }),
      cadence: { safety: { signal: 'none', note: '' } },
      elasticity: { safety: { signal: 'none', note: '' } },
    },
    overall: { score: 69, band: 'mid' },
  };
  const fabricatedPartial = gradeCase(blank, readAttempt(response(salvageable)), 100, 'claude-sonnet-5');
  assert(
    !fabricatedPartial.passed,
    'A partial that salvaged INVENTED scores off an empty field was passed. A fabrication is a ' +
      'fabrication whatever the stop_reason says.'
  );
});

// -------------------------------------------------------------------------------------------
// 5. ISSUE #89 — the free tier's structural ceiling, proven with NO model call
// -------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------
// THE SAFETY CONTRACT — the grader that carries the live merge prerequisite. No model call.
// -------------------------------------------------------------------------------------------

Deno.test('checkPillarSafety passes an honest result where every pillar declares "none"', () => {
  const check = checkPillarSafety(honestPhotoResult());

  assert(check.status === 'pass', `Expected a pass; got ${check.status}: ${check.detail}`);
  // "none" everywhere is the ORDINARY answer for a runner with nothing alarming about them. A
  // grader that demanded a warning would be pressuring the model to invent one.
  assert(
    check.detail.includes('posture=none'),
    `The detail should name each pillar's declared signal; got: ${check.detail}`
  );
});

Deno.test('checkPillarSafety catches a pillar whose safety is missing entirely', () => {
  const result = honestPhotoResult();
  // The exact shape `PACE_RESULT_SCHEMA` asks for and a model can still omit: a pillar that
  // asserts a score and prose but declares nothing about the runner's safety.
  delete (result.pillars.posture as { safety?: unknown }).safety;

  const check = checkPillarSafety(result);

  assert(check.status === 'fail', 'A pillar with no safety declaration must fail.');
  assert(check.detail.includes('posture: absent'), `Expected posture named as absent; got: ${check.detail}`);
});

Deno.test('checkPillarSafety catches an UNGROUNDED signal — one outside injury_flags.md', () => {
  const result = honestPhotoResult();
  (result.pillars.armSwing as { safety?: unknown }).safety = {
    signal: 'runnersKnee',
    note: 'Stop running and see a physio.',
  };

  const check = checkPillarSafety(result);

  assert(check.status === 'fail', 'A signal outside the certified list is an ungrounded claim.');
  assert(
    check.detail.includes('not a grounded declaration'),
    `Expected the ungrounded diagnostic; got: ${check.detail}`
  );
});

Deno.test('checkPillarSafety catches a declared signal carrying a blank note', () => {
  const result = honestPhotoResult();
  // The worst of the three: production would deliver a stop-running signal with nothing to tell
  // the runner. `isPaceSafety` alone accepts this, which is exactly why the note check exists.
  (result.pillars.cadence as { safety?: unknown }).safety = {
    signal: 'swellingLimpOrFavouringOneSide',
    note: '   ',
  };

  const check = checkPillarSafety(result);

  assert(check.status === 'fail', 'A declared signal with no note is unusable.');
  assert(check.detail.includes('blank note'), `Expected the blank-note diagnostic; got: ${check.detail}`);
});

Deno.test('EVERY tier is exercised live — the merge condition cannot be met by two of three', () => {
  const tiers = [...new Set(CASES.map((k) => k.tier))].sort();

  assert(
    tiers.join(',') === 'elite,free,pro',
    `The live case set must cover all three tiers; it covers [${tiers.join(', ')}]. The safety ` +
      'contract is a per-tier question because the tier dial changes the prompt the model is ' +
      'complying with, and `analyze-form-validation.ts` refuses to deliver ANY response that ' +
      'omits a usable declaration — so a tier left unproven is a tier that could be a total outage.'
  );
});

Deno.test('#89 EVIDENCE: Free can never be scored on Cadence or Elasticity. By construction.', () => {
  // This test PASSES on purpose. It is not a bug report in test form — it is the evidence #89's
  // product decision has been waiting for, pinned so that it cannot rot, and so that the day
  // someone changes the cap the change announces itself.
  //
  // The arithmetic, entirely from the repo's own constants:
  //   PACE_FRAME_CAP.free === 1
  //     => a Free submission is always exactly ONE frame — a single still, even from a video
  //     => analyze-form-prompt.ts's MEDIUM_RULES.photo: "You CANNOT assess Cadence or Elasticity
  //        from one frame. Both are motion over time" and REQUIRES score: null for both
  //     => a Free user, even one who films a flawless side-on clip, is scored on AT MOST 2 of the
  //        4 pillars in the product's own name. Every time.
  //
  // #45 then renders that as `is_fallback: true` and the banner "Partial read — we could
  // confidently score 2 of 4 pillars", which becomes the headline of the free trial: the one and
  // only conversion moment in the product.
  //
  // CONFIRMED LIVE (5 runs): the `still-free` fixture returns Cadence and Elasticity as
  // `needsVideo` EVERY time, while `stride-video-pro` (5 frames, same runner) scores all four. The
  // cap is the only reason. This is CORRECT behaviour by an honest analyzer, and #42 must not "fix"
  // it — it is a product decision (raise Free's cap to ~3 frames, or keep it and sell the
  // limitation honestly) and it is Ian's to make.
  const ceiling = freeTierCeiling();

  assert(
    PACE_FRAME_CAP.free === 1,
    `PACE_FRAME_CAP.free is now ${PACE_FRAME_CAP.free}, not 1. If the cap moved to >= 2, issue #89 ` +
      'has been DECIDED — Free can now be scored on all four pillars. Update this test, the ' +
      '`still-free` fixture (which is built as a 1-frame photo), and #89 itself.'
  );
  assert(
    ceiling.unreachablePillars.join(',') === 'cadence,elasticity',
    `Expected Cadence and Elasticity to be unreachable at the free cap; got [${ceiling.unreachablePillars}].`
  );
  assert(ceiling.bestCase === '2 of 4', `Free's best case should be "2 of 4"; got "${ceiling.bestCase}".`);

  // And the prompt really does instruct it — this is not merely our inference about the cap.
  const prompt = promptTextForCase(caseById('still-free'));
  assert(
    prompt.includes('You CANNOT assess Cadence or Elasticity from one frame'),
    'The photo prompt no longer forbids inferring Cadence/Elasticity from one frame. If that rule ' +
      'was relaxed, #89 was resolved by loosening the honesty contract — which is the wrong branch.'
  );
  assert(
    PACE_PILLARS.length === 4 && ceiling.frameCap === 1,
    'The #89 arithmetic (4 pillars, 1 free frame) no longer holds.'
  );
});
