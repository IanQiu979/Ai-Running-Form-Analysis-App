/**
 * The page backdrop. It is behind every screen in the app, so its failure modes are app-wide:
 *
 *   - it must paint the ACTIVE SCHEME's stops (a scheme mix-up here would put light-mode stops
 *     behind dark-mode text, which is the one way the proven `Gradient` contrast can be
 *     invalidated without any token changing);
 *   - it must stay out of the a11y tree (it is atmosphere, and it wraps every screen's real
 *     content — a focusable backdrop would be in front of the whole app);
 *   - it must still render its children when `drift` is off and under reduced motion, because a
 *     backdrop that depends on its animation is a blank screen.
 */
import { render, screen } from '@testing-library/react-native';
import { processColor, Text } from 'react-native';

import { ScreenGradient } from '../screen-gradient';
import { Gradient } from '@/constants/theme';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const mockUseColorScheme = jest.fn(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockUseColorScheme(),
}));

describe('ScreenGradient', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
    mockUseColorScheme.mockReturnValue('light');
  });

  // `expo-linear-gradient` normalises its `colors` prop through React Native's own colour
  // processing before it reaches the native view, so the stops arrive as packed ints rather than
  // as the hex strings the token holds. Comparing against `processColor(...)` of the token is
  // therefore comparing the same thing, not weakening the assertion — and it still fails if the
  // wrong scheme's stops are passed, which is the regression this locks.
  function washColors(): unknown {
    return screen.getByTestId('bg-wash', { includeHiddenElements: true }).props.colors;
  }

  it('paints the light scheme’s stops when light', async () => {
    await render(<ScreenGradient testID="bg" />);

    expect(washColors()).toEqual(Gradient.page.light.map((stop) => processColor(stop)));
  });

  it('paints the dark scheme’s stops when dark — never the other scheme’s', async () => {
    mockUseColorScheme.mockReturnValue('dark');
    await render(<ScreenGradient testID="bg" />);

    expect(washColors()).toEqual(Gradient.page.dark.map((stop) => processColor(stop)));
    expect(washColors()).not.toEqual(Gradient.page.light.map((stop) => processColor(stop)));
  });

  it('renders its children — the backdrop wraps every screen, so this is the app', async () => {
    await render(
      <ScreenGradient testID="bg">
        <Text>Analyze my form</Text>
      </ScreenGradient>
    );

    expect(screen.getByText('Analyze my form')).toBeTruthy();
  });

  it('still renders children under reduced motion, and with drift explicitly off', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(
      <ScreenGradient testID="bg" drift={false}>
        <Text>Analyze my form</Text>
      </ScreenGradient>
    );

    expect(screen.getByText('Analyze my form')).toBeTruthy();
    expect(screen.getByTestId('bg-wash', { includeHiddenElements: true })).toBeTruthy();
  });

  // Cadence Arcs (2026-09-01). The ornament lives here rather than on twelve screens so that "on
  // every screen" is structural; these lock the two halves of that decision — it is on by
  // default, and it is genuinely suppressible for the one screen whose top corner is occupied.
  describe('the corner ornament', () => {
    it('draws the arc ripple by default, without being asked for', async () => {
      await render(<ScreenGradient testID="bg" />);

      expect(screen.getByTestId('bg-ornament', { includeHiddenElements: true })).toBeTruthy();
    });

    it('can be suppressed entirely — the result screen’s hero owns its top corner', async () => {
      await render(<ScreenGradient testID="bg" ornament="none" />);

      expect(screen.queryByTestId('bg-ornament', { includeHiddenElements: true })).toBeNull();
    });

    it('keeps the ornament behind the screen’s own content', async () => {
      await render(
        <ScreenGradient testID="bg">
          <Text>Analyze my form</Text>
        </ScreenGradient>
      );

      // Paint order is child order in React Native: the ornament must be mounted BEFORE the
      // children, or the ripple draws on top of the screen's controls.
      const root = screen.getByTestId('bg', { includeHiddenElements: true });
      const ornamentIndex = root.children.findIndex(
        (child) => typeof child !== 'string' && child.props?.testID === 'bg-ornament'
      );
      expect(ornamentIndex).toBeGreaterThanOrEqual(0);
      expect(ornamentIndex).toBeLessThan(root.children.length - 1);
    });
  });
});
