/**
 * Locks for the signed-out entry flow (`welcome.tsx`): hero, the story's intro and Get started in
 * one snapping scroll (2026-09-20; reshaped 2026-10-05, when the four pillar sections left it for
 * the optional `pillars` route and the "Get started" link became the form itself). The scroll
 * must be locked and the "Scroll down" cue absent until the hero reports that its own timeline
 * has reached the hold (`StrideHero`'s `onHold`); the scroll's offset must drive each section's
 * reveal, monotonically, through `lib/entry-story.ts`; the scroll must snap to the three section
 * tops and run free past the last so the form can grow and ride above the keyboard; the main
 * scroll must carry no pillar section; Get started's link must open the pillar introductions;
 * and under reduced motion the whole flow must be usable at once. Reanimated does not advance
 * under Jest (CLAUDE.md § Testing), so a rise is asserted at its first frame, never finished.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Keyboard, Platform, StyleSheet, TextInput } from 'react-native';

import { Copy } from '@/constants/copy';
import { Motion } from '@/constants/v23-theme';
import { PACE_PILLARS } from '@shared/pace';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

// The hero has its own structural test (components/__tests__/stride-hero.test.tsx). Here it is a
// stub that exposes the one thing the screen depends on — the `onHold` callback its clock fires —
// as a pressable, so the test can reach the hold without a UI-thread clock.
jest.mock('@/components/stride-hero', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, View } = require('react-native');
  return {
    StrideHero: ({ testID, onHold }: { testID?: string; onHold?: () => void }) => (
      <View testID={testID}>
        <Pressable testID="mock-hero-hold" onPress={() => onHold?.()} />
      </View>
    ),
  };
});

// The intro and the rise are the real ones (their own locks are in
// components/__tests__/pillar-story.test.tsx), wrapped so the props the screen hands them can be
// read back; nothing rendered exposes them. The screen's only direct `Reveal` is Get started's —
// the intro's own rises bind inside the module and are not seen here.
type IntroProps = { sectionHeight: number; revealed: boolean; reduceMotion: boolean };
const mockIntroProps: IntroProps[] = [];
const mockGetStartedRevealed: boolean[] = [];
jest.mock('@/components/pillar-story', () => {
  const actual = jest.requireActual('@/components/pillar-story');
  return {
    ...actual,
    StoryIntro: (props: IntroProps) => {
      mockIntroProps.push(props);
      return <actual.StoryIntro {...props} />;
    },
    Reveal: (props: { revealed: boolean }) => {
      mockGetStartedRevealed.push(props.revealed);
      return <actual.Reveal {...props} />;
    },
  };
});

// Get started is the real form (`components/auth-form.tsx`, locked screen-side by the sign-in
// and sign-up suites); only its network edges and the Turnstile WebView are stubbed.
jest.mock('@/lib/auth', () => ({ signInWithGoogle: jest.fn() }));
jest.mock('@/lib/hibp', () => ({ checkPasswordBreached: jest.fn() }));
jest.mock('@/lib/signup-with-captcha', () => ({ signUpWithCaptcha: jest.fn(), applySignupSession: jest.fn() }));
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: jest.fn() } } }));
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    deepLinkAuthError: null,
    clearDeepLinkAuthError: jest.fn(),
    corruptedSessionError: mockCorruptedSessionError,
    clearCorruptedSessionError: jest.fn(),
  }),
}));
jest.mock('@/components/turnstile-widget', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { forwardRef } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    TurnstileWidget: forwardRef(function MockTurnstileWidget() {
      return <View testID="mock-turnstile-widget" />;
    }),
  };
});

/** What the mocked session context serves as `corruptedSessionError` — none unless a test sets it. */
let mockCorruptedSessionError: string | null = null;

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY = 'test-site-key';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const HeroScreen = require('../welcome').default;

const hidden = { includeHiddenElements: true } as const;
const cue = () => screen.queryByTestId('entry-hero-cue', hidden);
const scroll = () => screen.getByTestId('entry-scroll', hidden);
const lastIntroProps = () => mockIntroProps[mockIntroProps.length - 1];
const getStartedRevealed = () => mockGetStartedRevealed[mockGetStartedRevealed.length - 1];
/** The rise wrapping the form: the form's own column is its only child. */
const formRise = () => StyleSheet.flatten(screen.getByTestId('entry-get-started-form', hidden).parent!.props.style);
const H = 800;

async function reachHold() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('mock-hero-hold', hidden));
  });
}

function layoutScroll(height: number) {
  fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height, width: 393, x: 0, y: 0 } } });
}

async function scrollTo(y: number) {
  await act(async () => {
    fireEvent.scroll(scroll(), { nativeEvent: { contentOffset: { y, x: 0 } } });
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockIntroProps.length = 0;
  mockGetStartedRevealed.length = 0;
  mockUseReducedMotion.mockReturnValue(false);
  mockCorruptedSessionError = null;
});

describe('entry flow — animated', () => {
  it('locks the scroll and withholds the cue until the hero reports the hold', async () => {
    await render(<HeroScreen />);

    expect(screen.getByTestId('entry-hero', hidden)).toBeTruthy();
    expect(cue()).toBeNull();
    expect(scroll().props.scrollEnabled).toBe(false);

    await reachHold();

    expect(cue()).toBeTruthy();
    expect(screen.getByText(Copy.entry.hero.cue, hidden)).toBeTruthy();
    expect(scroll().props.scrollEnabled).toBe(true);
  });

  it('never labels the cue "Continue", and no such label is anywhere in the flow', async () => {
    await render(<HeroScreen />);
    await reachHold();

    expect(Copy.entry.hero.cue).toBe('Scroll down');
    expect(screen.queryByText('Continue', hidden)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue', ...hidden })).toBeNull();
  });

  it('is hero, intro, Get started — and carries no pillar section and no "Get started" link', async () => {
    await render(<HeroScreen />);

    const sections = screen
      .getAllByTestId(/^(entry-hero-section|story-section-|entry-get-started$)/, hidden)
      .map((node) => node.props.testID);
    expect(sections).toEqual(['entry-hero-section', 'story-section-intro', 'entry-get-started']);
    for (const id of PACE_PILLARS) {
      expect(screen.queryByTestId(`story-section-${id}`, hidden)).toBeNull();
      expect(screen.queryByTestId(`pillar-box-${id}`, hidden)).toBeNull();
    }
    expect(screen.queryByText(Copy.entry.details.hint, hidden)).toBeNull();
    // The old link to a separate sign-up screen is gone: the form is the section.
    expect(screen.queryByTestId('entry-sign-up', hidden)).toBeNull();
    expect(screen.getByRole('header', { name: Copy.auth.title, ...hidden })).toBeTruthy();
    expect(screen.getByPlaceholderText(Copy.auth.email.placeholder, hidden)).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.auth.signUp.submit, ...hidden })).toBeTruthy();
  });

  it('reveals the intro, then Get started, as each is scrolled to, and never hides one again', async () => {
    await render(<HeroScreen />);
    await reachHold();
    await act(async () => layoutScroll(H));

    // The hero is the only section reached at the top; Get started holds its first frame.
    expect(lastIntroProps().sectionHeight).toBe(H);
    expect(lastIntroProps().revealed).toBe(false);
    expect(getStartedRevealed()).toBe(false);
    expect(formRise().opacity).toBe(0);
    expect(formRise().transform).toEqual([{ translateY: Motion.pageShift }]);

    // Half a section in: the intro begins to arrive; Get started does not.
    await scrollTo(H * 0.5);
    expect(lastIntroProps().revealed).toBe(true);
    expect(getStartedRevealed()).toBe(false);

    // Snapped to the intro, nothing more is reached; a section and a half in, Get started is.
    await scrollTo(H);
    expect(getStartedRevealed()).toBe(false);
    await scrollTo(H * 1.5);
    expect(getStartedRevealed()).toBe(true);

    // Scrolling back up hides nothing.
    await scrollTo(0);
    expect(lastIntroProps().revealed).toBe(true);
    expect(getStartedRevealed()).toBe(true);
  });

  it('snaps to the three section tops and runs free past the last, above the keyboard', async () => {
    await render(<HeroScreen />);
    await act(async () => layoutScroll(H));

    const props = scroll().props;
    expect(props.pagingEnabled).toBeFalsy();
    expect(props.snapToOffsets).toEqual([0, H, 2 * H]);
    expect(props.snapToEnd).toBe(false);
    expect(props.disableIntervalMomentum).toBe(true);
    expect(props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(props.keyboardShouldPersistTaps).toBe('handled');
  });

  // React Native's iOS snapping clamps every drag to the content height less the viewport and
  // ignores the keyboard's inset, so with snap points set the end of the form could never be
  // dragged out from under the keyboard (seen on a 667 pt simulator). While a keyboard is up the
  // scroll has no snap points; they come back when it goes.
  it('drops the snap points while a keyboard is up, and restores them when it goes', async () => {
    const listeners = new Map<string, () => void>();
    const addListener = jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, listener: () => void) => {
      listeners.set(event, listener);
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    try {
      await render(<HeroScreen />);
      await act(async () => layoutScroll(H));
      expect(scroll().props.snapToOffsets).toEqual([0, H, 2 * H]);

      await act(async () => listeners.get('keyboardWillShow')!());
      expect(scroll().props.snapToOffsets).toBeUndefined();
      // The inset that makes the form reachable is still asked for.
      expect(scroll().props.automaticallyAdjustKeyboardInsets).toBe(true);

      await act(async () => listeners.get('keyboardDidHide')!());
      expect(scroll().props.snapToOffsets).toEqual([0, H, 2 * H]);

      // Android sends only the `Did` events.
      await act(async () => listeners.get('keyboardDidShow')!());
      expect(scroll().props.snapToOffsets).toBeUndefined();
    } finally {
      addListener.mockRestore();
    }
  });

  it('gives the hero and the intro the viewport height, and Get started at least that', async () => {
    await render(<HeroScreen />);
    await act(async () => layoutScroll(H));

    expect(screen.getByTestId('entry-hero-section', hidden).props.style).toEqual({ height: H });
    expect(StyleSheet.flatten(screen.getByTestId('story-section-intro', hidden).props.style).height).toBe(H);
    const getStarted = StyleSheet.flatten(screen.getByTestId('entry-get-started', hidden).props.style);
    expect(getStarted.minHeight).toBe(H);
    expect(getStarted.height).toBeUndefined();
  });

  it('keeps the sections when a keyboard shrinks the view with a field focused', async () => {
    const focused = jest.spyOn(TextInput.State, 'currentlyFocusedInput');
    try {
      await render(<HeroScreen />);
      await act(async () => layoutScroll(H));

      type Focused = ReturnType<typeof TextInput.State.currentlyFocusedInput>;
      focused.mockReturnValue({} as Focused);
      await act(async () => layoutScroll(H - 300));
      expect(scroll().props.snapToOffsets).toEqual([0, H, 2 * H]);

      // With nothing focused a new height is a real one.
      focused.mockReturnValue(null as unknown as Focused);
      await act(async () => layoutScroll(H - 300));
      expect(scroll().props.snapToOffsets).toEqual([0, H - 300, 2 * (H - 300)]);
    } finally {
      focused.mockRestore();
    }
  });

  it('opens the pillar introductions from the link on Get started', async () => {
    await render(<HeroScreen />);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.pillars.open, ...hidden }));
    });
    expect(mockPush).toHaveBeenCalledWith('/pillars');
  });

  it('draws the sign-up rows only once a field of the embedded form takes focus', async () => {
    await render(<HeroScreen />);

    expect(screen.queryByTestId('signup-consent', hidden)).toBeNull();
    expect(screen.queryByTestId('signup-future-uploads-consent', hidden)).toBeNull();
    expect(screen.queryByTestId('signup-age-18-plus', hidden)).toBeNull();

    await act(async () => {
      fireEvent(screen.getByPlaceholderText(Copy.auth.password.placeholder, hidden), 'focus');
    });

    expect(screen.getByTestId('signup-consent', hidden)).toBeTruthy();
    expect(screen.getByTestId('signup-future-uploads-consent', hidden)).toBeTruthy();
    expect(screen.getByTestId('signup-age-18-plus', hidden)).toBeTruthy();
  });
});

describe('entry flow — reduced motion', () => {
  it('shows the cue at once, frees the scroll, and renders the intro and the form in place', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<HeroScreen />);

    expect(cue()).toBeTruthy();
    expect(scroll().props.scrollEnabled).toBe(true);
    expect(lastIntroProps().reduceMotion).toBe(true);
    expect(screen.getByText(Copy.entry.details.title)).toBeTruthy();
    expect(formRise().opacity).toBe(1);
    expect(formRise().transform).toEqual([{ translateY: 0 }]);
    expect(screen.getByRole('button', { name: Copy.auth.signUp.submit })).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.entry.pillars.open }));
    });
    expect(mockPush).toHaveBeenCalledWith('/pillars');
  });
});

describe('entry flow — a session error waits for Get started to be in view', () => {
  const originalOS = Platform.OS;
  const ERROR = 'Your session could not be restored.';
  let announce: jest.SpyInstance;

  beforeEach(() => {
    Platform.OS = 'ios';
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockCorruptedSessionError = ERROR;
  });

  afterEach(() => {
    Platform.OS = originalOS;
    announce.mockRestore();
  });

  it('is not announced from the hero, and is announced once Get started is reached', async () => {
    await render(<HeroScreen />);
    await reachHold();
    await act(async () => layoutScroll(H));

    expect(screen.getByText(ERROR, hidden).props.accessibilityLiveRegion).toBe('none');
    await scrollTo(H);
    expect(announce).not.toHaveBeenCalled();

    await scrollTo(H * 1.5);
    expect(announce).toHaveBeenCalledWith(ERROR);
    expect(screen.getByText(ERROR, hidden).props.accessibilityLiveRegion).toBe('polite');
  });

  it('is announced at once under reduced motion, where the form is already in place', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<HeroScreen />);

    expect(announce).toHaveBeenCalledWith(ERROR);
  });
});
