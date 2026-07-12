/**
 * Honesty locks for <PaceReadout /> (issue #56). The assertions that matter most: a not-assessed
 * pillar (`score: null`) never mounts a numeral, a band word, or a filled bar — it renders a
 * hollow track and a plain-language reason instead. If a future edit ever coerces `null` into
 * "0", these are the tests that must go red.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { PaceReadout } from '../pace-readout';
import { Copy } from '@/constants/copy';
import {
  allNotAssessedResult,
  freeTierVideoResult,
  photoResult,
  poorFramingPhotoResult,
  proTierVideoResult,
} from '@/lib/pace-fixtures';

describe('an assessed pillar (proTierVideoResult)', () => {
  it('renders the numeral, the band word, and a proportional fill bar', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(screen.getByTestId('pillar-score-posture').props.children).toBe(78);
    expect(screen.getByTestId('pillar-band-posture').props.children).toBe('Solid');
    const fillStyle = StyleSheet.flatten(screen.getByTestId('pillar-bar-fill-posture').props.style);
    expect(fillStyle.width).toBe('78%');
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
    expect(screen.queryByTestId('pillar-bar-fill-cadence')).toBeNull();
  });

  it('renders the "needs video" reason, not a numeral, for Cadence and Elasticity', async () => {
    await render(<PaceReadout result={photoResult} />);

    expect(screen.getByTestId('pillar-not-assessed-cadence').props.children).toBe(
      Copy.result.pillar.notAssessed.needsVideo
    );
    expect(screen.getByTestId('pillar-not-assessed-elasticity').props.children).toBe(
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
});

it('renders the "angle" reason distinctly from "needsVideo" for a badly-framed pillar', async () => {
  await render(<PaceReadout result={poorFramingPhotoResult} />);

  expect(screen.getByTestId('pillar-not-assessed-posture').props.children).toBe(
    Copy.result.pillar.notAssessed.angle
  );
  expect(screen.getByTestId('pillar-not-assessed-cadence').props.children).toBe(
    Copy.result.pillar.notAssessed.needsVideo
  );
});

it('renders the overall headline as not-assessed, never a fabricated 0, when every pillar is null', async () => {
  await render(<PaceReadout result={allNotAssessedResult} />);

  expect(screen.queryByTestId('overall-score')).toBeNull();
  expect(screen.getByTestId('overall-not-assessed').props.children).toBe(Copy.result.pillar.notAssessed.generic);
});

describe('tier gating via array emptiness only — no client-side tier re-derivation', () => {
  it('renders no Flags/Drills sections at all for a Free-shaped result (every array empty)', async () => {
    await render(<PaceReadout result={freeTierVideoResult} />);

    for (const pillarId of ['posture', 'armSwing', 'cadence', 'elasticity']) {
      expect(screen.queryByTestId(`pillar-flags-${pillarId}`)).toBeNull();
      expect(screen.queryByTestId(`pillar-drills-${pillarId}`)).toBeNull();
    }
    // Free still gets real scores and one line of feedback per pillar.
    expect(screen.getByTestId('pillar-score-cadence').props.children).toBe(44);
    expect(screen.getByTestId('pillar-feedback-cadence').props.children).toBe('Foot lands well ahead of your hips.');
  });

  it('renders Flags/Drills for a Pro-shaped result wherever the pillar carries them', async () => {
    await render(<PaceReadout result={proTierVideoResult} />);

    expect(screen.getByTestId('pillar-flags-cadence')).toBeTruthy();
    expect(screen.getByText('Overstriding')).toBeTruthy();
    expect(screen.getByTestId('pillar-drills-cadence')).toBeTruthy();
    expect(screen.getByText('Metronome Runs')).toBeTruthy();

    // Elasticity has neither a flag nor a drill in this fixture — must not render empty sections.
    expect(screen.queryByTestId('pillar-flags-elasticity')).toBeNull();
    expect(screen.queryByTestId('pillar-drills-elasticity')).toBeNull();
  });
});

it('gives every pillar row an accessible label with score, band, and pillar name', async () => {
  await render(<PaceReadout result={proTierVideoResult} />);

  expect(screen.getByTestId('pillar-row-posture').props.accessibilityLabel).toBe('Posture, 78 out of 100, Solid.');
});
