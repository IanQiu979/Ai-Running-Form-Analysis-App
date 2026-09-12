/**
 * `<PillarDetailModal>` (Part 2 of the result-screen cleanup) — mirrors
 * `components/__tests__/pace-readout.test.tsx`'s own honesty locks for the row: a not-assessed
 * pillar's modal must show its plain-language reason and never a fabricated numeral.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { PillarDetailModal } from '../pillar-detail-modal';
import { Copy } from '@/constants/copy';
import { photoResult, proTierVideoResult } from '@/lib/pace-fixtures';

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
    // The heading's own composed text is "P  Posture" (letter + name as nested `Text` children).
    // Not asserted via `getByText('Posture')` — this fixture's Posture pillar also carries a
    // drill named "Posture Reset (in-run cue)", which the same substring match would also find.
    expect(heading.props.children[1]).toBe('Posture');
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

    await fireEvent.press(screen.getByTestId('pillar-detail-close-posture'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
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
