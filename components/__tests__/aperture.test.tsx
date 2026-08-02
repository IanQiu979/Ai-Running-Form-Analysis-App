/**
 * The aperture. The locks are the ones that keep it from becoming either a blocker or a decoration
 * that lies:
 *
 *   1. IT NEVER WITHHOLDS CONTENT. What it frames is a child, rendered unconditionally, at every
 *      state. An aperture that mounted its content only once open would turn a lens effect into a
 *      loading gate on the single screen that IS the product's payload.
 *   2. REDUCED MOTION KEEPS THE APERTURE AND DROPS THE OPENING. The still fallback is not "nothing"
 *      — the vignette (the thing that makes the frame read as seen through a lens) is permanent,
 *      and only the iris and the rack focus are suppressed. This is the same contract
 *      `components/low-poly-field.tsx` and `components/annotation-lines.tsx` state, and it is the
 *      one a "just hide the whole effect" change would quietly break.
 *   3. `onOpened` ALWAYS FIRES. The result hero sequences its annotation wireframe off this
 *      callback, so a path where it never fires is a hero that never finishes drawing. It must fire
 *      when there is nothing to wait for — reduced motion, or a re-open — not only after a real
 *      animation.
 *   4. IT IS DECORATION. Every overlay stays out of the a11y tree and takes no touches, or it would
 *      sit in front of the hero image's own alt text and the screen's scroll.
 */
import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Aperture } from '../aperture';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const OVERLAYS = ['vignette', 'blades', 'focus'] as const;

describe('Aperture', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('renders what it frames, opening or not', async () => {
    await render(
      <Aperture open testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    expect(screen.getByText('the hero')).toBeTruthy();
  });

  it('draws the iris and the rack focus while opening', async () => {
    await render(
      <Aperture open testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    expect(screen.getByTestId('ap-blades', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('ap-focus', { includeHiddenElements: true })).toBeTruthy();
  });

  it('keeps the vignette but drops the iris and rack focus under reduced motion — a STILL aperture', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(
      <Aperture open testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    // The composition survives...
    expect(screen.getByText('the hero')).toBeTruthy();
    expect(screen.getByTestId('ap-vignette', { includeHiddenElements: true })).toBeTruthy();
    // ...and only the movement goes.
    expect(screen.queryByTestId('ap-blades', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('ap-focus', { includeHiddenElements: true })).toBeNull();
  });

  it('renders already open when open=false — the re-open case costs no overlay at all', async () => {
    await render(
      <Aperture testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    expect(screen.getByTestId('ap-vignette', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('ap-blades', { includeHiddenElements: true })).toBeNull();
  });

  it('fires onOpened immediately under reduced motion, so a caller sequencing off it is not stranded', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onOpened = jest.fn();
    await render(
      <Aperture open onOpened={onOpened} testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('fires onOpened immediately when there is no opening to play', async () => {
    const onOpened = jest.fn();
    await render(
      <Aperture onOpened={onOpened} testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it.each(OVERLAYS)('keeps the %s overlay out of the a11y tree and out of the touch path', async (layer) => {
    await render(
      <Aperture open testID="ap">
        <Text>the hero</Text>
      </Aperture>
    );

    const node = screen.getByTestId(`ap-${layer}`, { includeHiddenElements: true });
    expect(node.props.accessibilityElementsHidden).toBe(true);
    expect(node.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(node.props.pointerEvents).toBe('none');
  });
});
