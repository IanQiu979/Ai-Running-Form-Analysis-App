/**
 * Honesty locks for <PaceReadout /> (issue #56). The assertions that matter most: a not-assessed
 * pillar (`score: null`) never mounts a numeral, a band word, or a bar fill — it renders a dashed
 * track and a plain-language reason instead. If a future edit ever coerces `null` into "0", these
 * are the tests that must go red.
 *
 * UPDATED 2026-09-14 (V23-08): the rings became 2 px bars, so the assertions that named a ring's
 * SWEPT ARC now name a fill's WIDTH. Not one of them was relaxed in the move — the same facts are
 * proven about a different shape. Flags and drills moved out of the rows and into the pillar
 * detail modal, so the "tier gating by array emptiness" locks now read through the modal.
 *
 * Every press is wrapped in an awaited `act` — see CLAUDE.md § Testing on the open-act-scope
 * quirk that otherwise empties the next test's tree.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PaceReadout } from '../pace-readout';
import { Copy } from '@/constants/copy';
import { Font, Ink, Type } from '@/constants/v23-theme';
import {
  allNotAssessedResult,
  freeTierVideoResult,
  photoResult,
  poorFramingPhotoResult,
  proTierVideoResult,
  safetySignalPhotoResult,
  NOT_ASSESSED_SAFETY_NOTE_FIXTURE,
  SAFETY_NOTE_FIXTURE,
} from '@/lib/pace-fixtures';
import { pillarDetailA11yLabel, pillarLabel } from '@/lib/pace-readout';
import type { PaceResult } from '@shared/pace';

// Every row mounts its (closed) detail modal, which pads by the live safe-area insets.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const HIDDEN = { includeHiddenElements: true } as const;

/** The bar fill is decorative (hidden from the a11y tree), so it is queried with hidden nodes. */
const fillStyle = (pillar: string) =>
  StyleSheet.flatten(screen.getByTestId(`pillar-bar-${pillar}`, HIDDEN).props.style);
const trackStyle = (pillar: string) =>
  StyleSheet.flatten(screen.getByTestId(`pillar-bar-track-${pillar}`).props.style);

describe('an assessed pillar (proTierVideoResult)', () => {
  it('renders the numeral, the band word, and a fill as wide as the score', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(screen.getByTestId('pillar-score-posture').props.children).toBe(78);
    expect(screen.getByTestId('pillar-band-posture').props.children).toBe('Solid');
    // The page's `width:78%` — the score is the fill's layout width, never re-derived.
    expect(fillStyle('posture').width).toBe('78%');
    expect(fillStyle('posture').backgroundColor).toBe(Ink.ink);
    expect(trackStyle('posture').backgroundColor).toBe(Ink.line);
  });

  it('renders the overall headline numeral + band', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(screen.getByTestId('overall-score').props.children).toBe(64);
    expect(screen.getByTestId('overall-band').props.children).toBe('Developing');
    expect(screen.queryByTestId('overall-not-assessed')).toBeNull();
  });
});

describe('a not-assessed pillar never reads as a zero (photoResult: Cadence + Elasticity are null)', () => {
  it('renders no score/band/fill nodes at all for Cadence', async () => {
    await render(<PaceReadout result={photoResult} />);

    expect(screen.queryByTestId('pillar-score-cadence')).toBeNull();
    expect(screen.queryByTestId('pillar-band-cadence')).toBeNull();
    // No fill — not a fill at 0 %.
    expect(screen.queryByTestId('pillar-bar-cadence', HIDDEN)).toBeNull();
  });

  it('draws the bar track dashed for Cadence and solid for the pillar beside it', async () => {
    await render(<PaceReadout result={photoResult} />);

    // M1 (v23-ux-audit-r1): "could not be scored" must be structurally distinct from "scored
    // zero" at a glance — the page's `height:0;border-top:2px dashed`.
    expect(trackStyle('cadence').borderStyle).toBe('dashed');
    expect(trackStyle('cadence').borderColor).toBe(Ink.line);
    expect(trackStyle('posture').borderStyle).toBeUndefined();
  });

  it('renders the "needs video" reason, not a numeral, for Cadence and Elasticity', async () => {
    await render(<PaceReadout result={photoResult} />);

    // Issue #62 review follow-up: the not-assessed reason still renders visually but is hidden
    // from the a11y tree (the pillar header label already speaks it), so RNTL excludes it from
    // testID queries unless we opt back into hidden elements.
    expect(screen.getByTestId('pillar-not-assessed-cadence', HIDDEN).props.children).toBe(
      Copy.result.pillar.notAssessed.needsVideo
    );
    expect(screen.getByTestId('pillar-not-assessed-elasticity', HIDDEN).props.children).toBe(
      Copy.result.pillar.notAssessed.needsVideo
    );
  });

  it('still renders real scores for Posture and Arm swing from the same photo', async () => {
    await render(<PaceReadout result={photoResult} />);

    expect(screen.getByTestId('pillar-score-posture').props.children).toBe(82);
    expect(screen.getByTestId('pillar-score-armSwing').props.children).toBe(70);
  });

  it('never renders the literal string "0" anywhere for a not-assessed pillar', async () => {
    await render(<PaceReadout result={photoResult} />);

    // The not-assessed pillars must contribute no "0" text node — proves null was never
    // stringified into a fabricated score rather than just checking the testID is absent.
    expect(screen.queryByText('0')).toBeNull();
  });

  it('sets the page’s em dash in the disabled tone where the numeral would be', async () => {
    await render(<PaceReadout result={photoResult} />);

    // Two not-assessed pillars, two dashes; `ink3` is the one tone the sheet reserves for
    // exactly this (a placeholder, never copy the user has to read).
    const dashes = screen.getAllByText('—');
    expect(dashes).toHaveLength(2);
    expect(StyleSheet.flatten(dashes[0].props.style).color).toBe(Ink.ink3);
  });
});

// The runner DID send a video; their plan's frame cap clipped it to one frame. Neither "needs
// video, not a photo" nor "bad angle" is a true sentence about that upload, so the server writes
// its own reason and this row must speak it.
it('speaks the single-frame-from-video reason, never "not a photo", for a clipped video', async () => {
  const clipped: PaceResult = {
    ...photoResult,
    pillars: {
      ...photoResult.pillars,
      cadence: { ...photoResult.pillars.cadence, notAssessedReason: 'singleFrameFromVideo' },
    },
  };

  await render(<PaceReadout result={clipped} />);

  const line = screen.getByTestId('pillar-not-assessed-cadence', HIDDEN).props.children;
  expect(line).toBe(Copy.result.pillar.notAssessed.singleFrameFromVideo);
  expect(line).not.toContain('not a photo');
  // The a11y announcement is the same fact, not a different one — a screen-reader user on this
  // path must not be told they sent a photo either.
  expect(screen.getByLabelText(`Cadence. ${Copy.result.pillar.notAssessed.singleFrameFromVideo}`)).toBeTruthy();
});

// A Pro/Elite multi-frame analysis may honestly report a pillar as not-assessed AND write real
// explanatory prose for it (`_shared/pace.ts` permits exactly that). The marker must not vanish
// just because feedback is present — a dashed track alone does not say "not assessed".
it('keeps the not-assessed marker on a Pro pillar that carries its own feedback', async () => {
  const proWithNote: PaceResult = {
    ...proTierVideoResult,
    pillars: {
      ...proTierVideoResult.pillars,
      armSwing: {
        score: null,
        band: null,
        feedback: 'Keep the elbows near 90 degrees.',
        notAssessedReason: 'angle',
        flags: [],
        drills: [],
      },
    },
  };

  await render(<PaceReadout result={proWithNote} />);

  expect(screen.getByTestId('pillar-not-assessed-armSwing', HIDDEN).props.children).toBe(
    Copy.result.pillar.notAssessed.angle
  );
  expect(screen.getByTestId('pillar-feedback-armSwing').props.children).toBe('Keep the elbows near 90 degrees.');
  expect(screen.queryByTestId('pillar-score-armSwing')).toBeNull();
});

it('renders the "angle" reason distinctly from "needsVideo" for a badly-framed pillar', async () => {
  await render(<PaceReadout result={poorFramingPhotoResult} />);

  expect(screen.getByTestId('pillar-not-assessed-posture', HIDDEN).props.children).toBe(
    Copy.result.pillar.notAssessed.angle
  );
  expect(screen.getByTestId('pillar-not-assessed-cadence', HIDDEN).props.children).toBe(
    Copy.result.pillar.notAssessed.needsVideo
  );
});

it('renders the overall headline as not-assessed, never a fabricated 0, when every pillar is null', async () => {
  await render(<PaceReadout result={allNotAssessedResult} />);

  expect(screen.queryByTestId('overall-score')).toBeNull();
  expect(screen.queryByTestId('overall-band')).toBeNull();
  expect(screen.getByTestId('overall-not-assessed').props.children).toBe(Copy.result.pillar.notAssessed.generic);
  expect(screen.queryByText('0')).toBeNull();
});

describe('tier gating via array emptiness only — no client-side tier re-derivation', () => {
  it('renders no flags or drills in any row — the page keeps them in the detail modal', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    // Cadence carries a flag and a drill in this fixture; neither is on the row.
    expect(screen.queryByText('Overstriding')).toBeNull();
    expect(screen.queryByText('Metronome Runs')).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.flagsLabel)).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.drillsLabel)).toBeNull();
  });

  it('renders real scores and one line of feedback per pillar for a Free-shaped result', async () => {
    await render(<PaceReadout result={freeTierVideoResult} />);

    expect(screen.getByTestId('pillar-score-cadence').props.children).toBe(44);
    // A plain `Text`, so the whole sentence is its children — and what a screen reader receives.
    expect(screen.getByTestId('pillar-feedback-cadence').props.children).toBe('Foot lands well ahead of your hips.');
  });

  it('renders Flags/Drills in the modal for a Pro-shaped pillar that carries them, and not otherwise', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-button-cadence'));
    });
    expect(screen.getByTestId('pillar-detail-flags-cadence')).toBeTruthy();
    expect(screen.getByText('Overstriding')).toBeTruthy();
    expect(screen.getByTestId('pillar-detail-drills-cadence')).toBeTruthy();
    expect(screen.getByText('Metronome Runs')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-close-cadence'));
    });

    // Elasticity has neither a flag nor a drill in this fixture — must not render empty sections.
    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-button-elasticity'));
    });
    expect(screen.queryByTestId('pillar-detail-flags-elasticity')).toBeNull();
    expect(screen.queryByTestId('pillar-detail-drills-elasticity')).toBeNull();
  });
});

it('gives every pillar row an accessible label with score, band, and pillar name', async () => {
  await render(<PaceReadout result={proTierVideoResult} />);

  // Issue #62 fix #1: `accessible`/`accessibilityLabel` live on the inner header block
  // (`pillar-header-${id}`), not the outer row (`pillar-row-${id}`) — the outer row must NOT
  // collapse the rest of the row (the feedback prose) into this one opaque node.
  expect(screen.getByTestId('pillar-header-posture').props.accessibilityLabel).toBe(
    'Posture, 78 out of 100, Solid.'
  );
  expect(screen.getByTestId('pillar-row-posture').props.accessible).toBeUndefined();
});

// Issue #62 audit finding #1 (Blocker): before the fix, the outer `pillar-row-*` View carried
// `accessible` + `accessibilityLabel`, which collapses the ENTIRE row — including
// `pillar.feedback` — into one opaque VoiceOver/TalkBack node, making the paid-tier coaching
// content structurally unreachable. This proves the prose survives as its own text node, and that
// the info control keeps its own name rather than being swallowed by the header group.
it('does not swallow the feedback prose or the info control into the row-level accessible node', async () => {
  await render(<PaceReadout result={proTierVideoResult} />);

  expect(
    screen.getByText(
      'Foot is landing well ahead of the hips with a near-straight knee — the clearest fix available here.'
    )
  ).toBeTruthy();
  expect(screen.getByLabelText(pillarDetailA11yLabel(pillarLabel('cadence')))).toBeTruthy();
});

// ---------------------------------------------------------------------------------------------
// Part 2 — the per-pillar detail modal (tap the info icon). The modal itself is proven in
// `components/__tests__/pillar-detail-modal.test.tsx`; these tests cover the WIRING — the row's
// own info button opens the RIGHT pillar's modal with the right content.
// ---------------------------------------------------------------------------------------------
describe("the per-pillar info button opens that pillar's detail modal", () => {
  it('carries an accessible name naming the pillar, and no modal content is mounted until tapped', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    const button = screen.getByTestId('pillar-detail-button-posture');
    expect(button.props.accessibilityLabel).toBe(pillarDetailA11yLabel(pillarLabel('posture')));
    expect(button.props.accessibilityHint).toBe(Copy.result.pillar.detail.a11yHint);
    expect(screen.queryByTestId('pillar-detail-modal-posture')).toBeNull();
  });

  it("opens that pillar's modal, with its own score/feedback, when the info button is pressed", async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-button-cadence'));
    });

    expect(screen.getByTestId('pillar-detail-modal-cadence')).toBeTruthy();
    expect(screen.getByTestId('pillar-detail-score-cadence').props.children).toBe(44);
    expect(screen.getByTestId('pillar-detail-feedback-cadence').props.children).toBe(
      'Foot is landing well ahead of the hips with a near-straight knee — the clearest fix available here.'
    );
    // A different pillar's modal never mounts as a side effect of opening this one.
    expect(screen.queryByTestId('pillar-detail-modal-posture')).toBeNull();
  });

  it('shows the not-assessed reason, never a fabricated numeral, for a null pillar (photoResult.cadence)', async () => {
    await render(<PaceReadout result={photoResult} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-button-cadence'));
    });

    expect(screen.getByTestId('pillar-detail-not-assessed-cadence').props.children).toBe(
      Copy.result.pillar.notAssessed.needsVideo
    );
    expect(screen.queryByTestId('pillar-detail-score-cadence')).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// V23-08 typography: the page sets prose in Inter Tight body and every number in Barlow
// Condensed. The pair below is what stops a future edit sliding one into the other's family.
// ---------------------------------------------------------------------------------------------
describe('readout typography', () => {
  it('sets per-pillar feedback as body prose in the secondary tone', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    const style = StyleSheet.flatten(screen.getByTestId('pillar-feedback-cadence').props.style);
    expect(style.fontFamily).toBe(Font.tight.regular);
    expect(style.fontSize).toBe(Type.body.fontSize);
    expect(style.color).toBe(Ink.ink2);
  });

  it('sets the pillar numeral as a condensed metric and the overall as the score role', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    const pillar = StyleSheet.flatten(screen.getByTestId('pillar-score-cadence').props.style);
    expect(pillar.fontFamily).toBe(Font.condensed.bold);
    expect(pillar.fontSize).toBe(Type.metric.fontSize);

    const overall = StyleSheet.flatten(screen.getByTestId('overall-score').props.style);
    expect(overall.fontFamily).toBe(Font.condensed.extraBold);
    expect(overall.fontSize).toBe(Type.score.fontSize);
  });
});

// ---------------------------------------------------------------------------------------------
// THE STOP-RUNNING NOTE on the actual result screen (issue #212).
//
// The regression these lock: the server used to compose `"note\n\ncoaching"` into `feedback`,
// and the row drew that one string as one paragraph in one tone, so the warning was
// indistinguishable from the coaching it led. A server-side assertion about the string could not
// see any of this, which is exactly how the defect reached review. So these render the real
// component and assert what a reader — sighted or VoiceOver — can actually tell apart: the note
// is its OWN node, it is NOT inside the coaching, it is styled apart from it, and when there is no
// signal nothing mounts at all.
// ---------------------------------------------------------------------------------------------
describe('a certified stop-running note (safetySignalPhotoResult)', () => {
  it('renders the note as its own element, above and outside the coaching', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    expect(screen.getByTestId('pillar-safety-note-posture').props.children).toBe(SAFETY_NOTE_FIXTURE);
    expect(within(screen.getByTestId('pillar-safety-posture')).getByText(Copy.result.pillar.safetyLabel)).toBeTruthy();

    // The coaching is still there and carries NONE of the warning's words — the two are separate
    // fields rendered as separate nodes, not one string split back apart.
    const feedback = screen.getByTestId('pillar-feedback-posture').props.children;
    expect(feedback).toBe(safetySignalPhotoResult.pillars.posture.feedback);
    expect(feedback).not.toContain(SAFETY_NOTE_FIXTURE);

    // ORDER: the notice precedes the coaching inside the row.
    const row = screen.getByTestId('pillar-row-posture');
    const kids = JSON.stringify(row.toJSON());
    expect(kids.indexOf(SAFETY_NOTE_FIXTURE)).toBeGreaterThan(-1);
    expect(kids.indexOf(SAFETY_NOTE_FIXTURE)).toBeLessThan(kids.indexOf(feedback));
  });

  it('is ONE VoiceOver node of its own — a sibling of the header group, never inside it', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    const block = screen.getByTestId('pillar-safety-posture');
    expect(block.props.accessible).toBe(true);
    expect(block.props.accessibilityRole).toBe('alert');
    expect(block.props.accessibilityLabel).toBe(`${Copy.result.pillar.safetyLabel}. ${SAFETY_NOTE_FIXTURE}`);
    // Not hidden the way the row's not-assessed line is: nothing else announces it.
    expect(block.props.accessibilityElementsHidden).toBeUndefined();
    // And issue #62's lesson: the collapsed header group must not have swallowed it.
    const header = screen.getByTestId('pillar-header-posture');
    expect(JSON.stringify(header.toJSON())).not.toContain(SAFETY_NOTE_FIXTURE);
    expect(header.props.accessibilityLabel).not.toContain(SAFETY_NOTE_FIXTURE);
  });

  it('sets the notice apart from the coaching — a danger label and a primary-ink sentence', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    const label = StyleSheet.flatten(
      within(screen.getByTestId('pillar-safety-posture')).getByText(Copy.result.pillar.safetyLabel).props.style
    );
    const note = StyleSheet.flatten(screen.getByTestId('pillar-safety-note-posture').props.style);
    const coaching = StyleSheet.flatten(screen.getByTestId('pillar-feedback-posture').props.style);

    expect(label.color).toBe(Ink.danger);
    expect(label.fontFamily).toBe(Type.label.fontFamily);
    expect(note.color).toBe(Ink.ink);
    expect(note.fontSize).toBe(Type.body.fontSize);
    // THE ASSERTION THAT WOULD HAVE FAILED BEFORE: composed into `feedback`, the warning was drawn
    // in the coaching's own tone, so these two were necessarily equal.
    expect(note.color).not.toBe(coaching.color);
  });

  it('renders nothing at all for a `none` declaration or for no declaration', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    // armSwing declares `signal: 'none'`; cadence carries no `safety` field at all. Posture and
    // elasticity are the fixture's two declarations, so exactly two labels mount.
    expect(screen.queryByTestId('pillar-safety-armSwing')).toBeNull();
    expect(screen.queryByTestId('pillar-safety-cadence')).toBeNull();
    expect(screen.getAllByText(Copy.result.pillar.safetyLabel)).toHaveLength(2);
  });

  it('stands alone on a NOT-ASSESSED pillar: the note mounts, no numeral, band or fill does', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    expect(screen.getByTestId('pillar-safety-note-elasticity').props.children).toBe(
      NOT_ASSESSED_SAFETY_NOTE_FIXTURE
    );
    const block = screen.getByTestId('pillar-safety-elasticity');
    expect(block.props.accessibilityRole).toBe('alert');
    expect(block.props.accessibilityLabel).toBe(
      `${Copy.result.pillar.safetyLabel}. ${NOT_ASSESSED_SAFETY_NOTE_FIXTURE}`
    );

    // The honesty rule holds beside it: `score: null` renders no numeral, no band word, no fill.
    expect(screen.getByTestId('pillar-not-assessed-elasticity', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('pillar-score-elasticity', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('pillar-band-elasticity', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('pillar-bar-elasticity', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('pillar-feedback-elasticity')).toBeNull();
  });

  it('renders no notice anywhere on a result with no signal at all', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(screen.queryByText(Copy.result.pillar.safetyLabel)).toBeNull();
    expect(screen.queryByTestId(/^pillar-safety-/)).toBeNull();
  });

  it('shows the SAME note in the detail modal, read from the same structured field', async () => {
    await render(<PaceReadout result={safetySignalPhotoResult} />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-button-posture'));
    });

    expect(screen.getByTestId('pillar-detail-safety-note-posture').props.children).toBe(SAFETY_NOTE_FIXTURE);
  });
});
