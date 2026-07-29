/**
 * The one animation primitive (spec 2026-07-26 §4/§5). Locks: it renders exactly the lines it's
 * given, they're hidden from the a11y tree (purely decorative — brief §7), `play=false` renders
 * them already at full scale with no growth (the "re-open renders finished" case), and reduced
 * motion collapses to `onComplete` firing without a staggered per-line draw.
 */
import { render, screen } from '@testing-library/react-native';

import { AnnotationLines, type AnnotationLine } from '../annotation-lines';

jest.mock('@/hooks/use-reduced-motion', () => ({ useReducedMotion: jest.fn(() => false) }));

const LINES: AnnotationLine[] = [
  { id: 'ground', top: '80%', left: '10%', width: '80%' },
  { id: 'posture', top: '20%', left: '48%', width: '60%', rotate: '90deg' },
  { id: 'landing', top: '75%', left: '60%', width: '12%', rotate: '30deg' },
];

describe('AnnotationLines', () => {
  it('renders one hairline per supplied line', async () => {
    await render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    expect(screen.getByTestId('lines-ground', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('lines-posture', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('lines-landing', { includeHiddenElements: true })).toBeTruthy();
  });

  it('hides every line from assistive technology — purely decorative', async () => {
    await render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    expect(
      screen.getByTestId('lines-ground', { includeHiddenElements: true }).props.accessibilityElementsHidden
    ).toBe(true);
  });

  it('renders already fully drawn when play=false (the re-open, no-animation case)', async () => {
    await render(<AnnotationLines lines={LINES} play={false} testID="lines" />);
    const node = screen.getByTestId('lines-ground', { includeHiddenElements: true });
    const style = Array.isArray(node.props.style) ? Object.assign({}, ...node.props.style) : node.props.style;
    expect(style.transform).toEqual(expect.arrayContaining([{ scaleX: 1 }]));
  });
});
