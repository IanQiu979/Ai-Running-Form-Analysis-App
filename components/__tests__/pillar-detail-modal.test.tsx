/**
 * `<PillarDetailModal>` (V23-08's third artboard) — mirrors
 * `components/__tests__/pace-readout.test.tsx`'s own honesty locks for the row: a not-assessed
 * pillar's modal must show its plain-language reason and never a fabricated numeral. Since the
 * page moved flags and drills OUT of the rows, this modal is also the only place they render,
 * so their presence is locked here.
 *
 * Every press is wrapped in an awaited `act` — see CLAUDE.md § Testing on the open-act-scope
 * quirk that otherwise empties the next test's tree.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { PillarDetailModal } from '../pillar-detail-modal';
import { Copy } from '@/constants/copy';
import { photoResult, proTierVideoResult, safetySignalPhotoResult, SAFETY_NOTE_FIXTURE } from '@/lib/pace-fixtures';

// The modal pads its column by the live safe-area insets; the package's own jest mock supplies
// them without a native module.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

describe('an assessed pillar (proTierVideoResult.posture)', () => {
  it('renders the letter+name heading, score, band, and feedback when visible', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="posture"
        pillar={proTierVideoResult.pillars.posture}
      />
    );

    const heading = screen.getByTestId('pillar-detail-heading-posture');
    expect(heading.props.accessibilityRole).toBe('header');
    expect(heading.props.accessible).toBe(true);
    // Letter and name are the heading's own two children — scoped with `within` because this
    // fixture's Posture pillar also carries a drill named "Posture Reset (in-run cue)".
    expect(within(heading).getByText('P')).toBeTruthy();
    expect(within(heading).getByText('Posture')).toBeTruthy();
    expect(screen.getByTestId('pillar-detail-score-posture').props.children).toBe(78);
    expect(screen.getByTestId('pillar-detail-band-posture').props.children).toBe('Solid');
    expect(screen.queryByTestId('pillar-detail-not-assessed-posture')).toBeNull();
    expect(
      screen.getByText(
        'Slight forward lean from the ankles, good — head stays level through the stride.'
      )
    ).toBeTruthy();
  });

  it('renders the "Risk flags"/"Drills" labeled flags and drills for a pillar that has them (cadence)', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={proTierVideoResult.pillars.cadence}
      />
    );

    expect(screen.getByText(Copy.result.pillar.flagsLabel)).toBeTruthy();
    expect(screen.getByText('Overstriding')).toBeTruthy();
    expect(screen.getByText(Copy.result.pillar.drillsLabel)).toBeTruthy();
    expect(screen.getByText('Metronome Runs')).toBeTruthy();
  });

  it('renders no "Risk flags"/"Drills" label at all for a pillar with empty arrays (elasticity)', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="elasticity"
        pillar={proTierVideoResult.pillars.elasticity}
      />
    );

    // Tier gating by array emptiness only — never an empty heading, and never a rule leading
    // to nothing.
    expect(screen.queryByTestId('pillar-detail-flags-elasticity')).toBeNull();
    expect(screen.queryByTestId('pillar-detail-drills-elasticity')).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.flagsLabel)).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.drillsLabel)).toBeNull();
  });

  it('renders nothing when not visible', async () => {
    await render(
      <PillarDetailModal
        visible={false}
        onDismiss={jest.fn()}
        pillarId="posture"
        pillar={proTierVideoResult.pillars.posture}
      />
    );

    expect(screen.queryByTestId('pillar-detail-modal-posture')).toBeNull();
    expect(screen.queryByTestId('pillar-detail-score-posture')).toBeNull();
  });
});

describe('the close control', () => {
  it('calls onDismiss when pressed', async () => {
    const onDismiss = jest.fn();
    await render(
      <PillarDetailModal
        visible
        onDismiss={onDismiss}
        pillarId="posture"
        pillar={proTierVideoResult.pillars.posture}
      />
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('pillar-detail-close-posture'));
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('is named for a screen reader, since the glyph is a bare text "×"', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="posture"
        pillar={proTierVideoResult.pillars.posture}
      />
    );

    expect(screen.getByTestId('pillar-detail-close-posture').props.accessibilityLabel).toBe(
      Copy.result.pillar.detail.close
    );
  });

  it('is also wired to onRequestClose (the Android back button)', async () => {
    const onDismiss = jest.fn();
    await render(
      <PillarDetailModal
        visible
        onDismiss={onDismiss}
        pillarId="posture"
        pillar={proTierVideoResult.pillars.posture}
      />
    );

    screen.getByTestId('pillar-detail-modal-posture').props.onRequestClose();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('a not-assessed pillar never reads as a zero (photoResult.cadence is null)', () => {
  it('shows the not-assessed reason and renders no score/band nodes', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={photoResult.pillars.cadence}
      />
    );

    expect(screen.getByTestId('pillar-detail-not-assessed-cadence').props.children).toBe(
      Copy.result.pillar.notAssessed.needsVideo
    );
    expect(screen.queryByTestId('pillar-detail-score-cadence')).toBeNull();
    expect(screen.queryByTestId('pillar-detail-band-cadence')).toBeNull();
  });

  // The second render surface for the same fact (the info button opens this modal). A runner whose
  // video was clipped to one frame must not read "needs video, not a photo" here either.
  it('speaks the media-aware reason for a video clipped to one frame', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={{
          ...photoResult.pillars.cadence,
          notAssessedReason: 'singleFrameFromVideo',
          feedback: 'Get that ankle looked at before running on it.',
        }}
      />
    );

    const reason = screen.getByTestId('pillar-detail-not-assessed-cadence').props.children;
    expect(reason).toBe(Copy.result.pillar.notAssessed.singleFrameFromVideo);
    expect(reason).not.toContain('not a photo');
    // The prose beside it is the stop-running note the server carried across — a different fact,
    // not a competing account of what was submitted.
    expect(screen.getByTestId('pillar-detail-feedback-cadence').props.children).toBe(
      'Get that ankle looked at before running on it.'
    );
  });

  it('never renders the literal string "0" anywhere', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={photoResult.pillars.cadence}
      />
    );

    expect(screen.queryByText('0')).toBeNull();
  });

  it('renders the not-assessed reason reachable to a screen reader — not hidden the way the row hides it', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={photoResult.pillars.cadence}
      />
    );

    // No `includeHiddenElements` needed here — unlike `pace-readout.tsx`'s own not-assessed text
    // (hidden because the row's header already speaks it aloud), this modal has no duplicate
    // announcement standing in for it, so it must be found WITHOUT opting into hidden elements.
    expect(screen.getByTestId('pillar-detail-not-assessed-cadence')).toBeTruthy();
  });
});

describe('a certified stop-running note (safetySignalPhotoResult.posture)', () => {
  it('renders the note as its own labelled, alert-role node above the coaching', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="posture"
        pillar={safetySignalPhotoResult.pillars.posture}
      />
    );

    const block = screen.getByTestId('pillar-detail-safety-posture');
    expect(block.props.accessible).toBe(true);
    expect(block.props.accessibilityRole).toBe('alert');
    expect(block.props.accessibilityLabel).toBe(`${Copy.result.pillar.safetyLabel}. ${SAFETY_NOTE_FIXTURE}`);
    expect(within(block).getByText(Copy.result.pillar.safetyLabel)).toBeTruthy();
    expect(screen.getByTestId('pillar-detail-safety-note-posture').props.children).toBe(SAFETY_NOTE_FIXTURE);

    // The coaching is untouched and separate, and the note comes first in the card.
    const feedback = screen.getByTestId('pillar-detail-feedback-posture').props.children;
    expect(feedback).toBe(safetySignalPhotoResult.pillars.posture.feedback);
    expect(feedback).not.toContain(SAFETY_NOTE_FIXTURE);
    const card = JSON.stringify(screen.getByTestId('pillar-detail-card-posture').toJSON());
    expect(card.indexOf(SAFETY_NOTE_FIXTURE)).toBeLessThan(card.indexOf(feedback));
  });

  it('renders no notice for a `none` declaration (armSwing)', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="armSwing"
        pillar={safetySignalPhotoResult.pillars.armSwing}
      />
    );
    expect(screen.queryByTestId('pillar-detail-safety-armSwing')).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.safetyLabel)).toBeNull();
  });

  it('renders no notice for a pillar with no declaration at all (cadence)', async () => {
    await render(
      <PillarDetailModal
        visible
        onDismiss={jest.fn()}
        pillarId="cadence"
        pillar={safetySignalPhotoResult.pillars.cadence}
      />
    );
    expect(screen.queryByTestId('pillar-detail-safety-cadence')).toBeNull();
    expect(screen.queryByText(Copy.result.pillar.safetyLabel)).toBeNull();
  });
});
