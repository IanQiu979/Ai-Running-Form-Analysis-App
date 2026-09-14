/**
 * Regression lock for the home-tab cleanup pass: the top-bar `LowPolyField` logo must be gone
 * (issue: captain called `app/(tabs)/index.tsx` messy) and `Copy.home.title` must render exactly
 * once — it used to also duplicate into the ready-quota block's eyebrow, which read as a second,
 * unlabeled title directly under the first. Since the V23-07 re-theme the title is `<TopBar>`'s
 * header and the Settings control is the page's bled icon button; both are locked here too.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

import HomeScreen from '../index';

const mockPush = jest.fn();

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
    // Real effect semantics (run once after mount, per the `cb` identity), not a call on every
    // render — a naive `useFocusEffect: (cb) => cb()` re-fires `fetchQuota` on every state update
    // it triggers, which loops forever and hangs the test.
    useFocusEffect: (cb: () => void | (() => void)) => react.useEffect(cb, [cb]),
  };
});

jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('@/lib/pending-analysis', () => ({
  checkPendingAnalysis: jest.fn(async () => ({ kind: 'none' })),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

jest.mock('@/lib/quota', () => {
  const actual = jest.requireActual('@/lib/quota');
  return {
    ...actual,
    quotaStatusClient: {
      fetch: jest.fn(async () => ({
        ok: true,
        data: {
          tier: 'free',
          used: 1,
          limit: 3,
          remaining: 2,
          frameCap: 6,
          unlimited: false,
          isLifetime: true,
          periodStart: null,
          periodEnd: null,
          blocked: false,
          blockedReason: null,
          blockedUntil: null,
        },
      })),
    },
  };
});

describe('HomeScreen top bar', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders no low-poly mark and the title exactly once, as the header', async () => {
    await render(<HomeScreen />);

    expect(screen.queryByTestId('home-mark')).toBeNull();
    expect(screen.getAllByText(Copy.home.title)).toHaveLength(1);
    expect(screen.getByTestId('home-title').props.accessibilityRole).toBe('header');
  });

  it('routes the Settings control to /settings', async () => {
    await render(<HomeScreen />);

    const settings = screen.getByRole('button', { name: Copy.settings.title });
    await act(async () => {
      fireEvent.press(settings);
    });
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('routes the primary CTA to /capture while quota is available', async () => {
    await render(<HomeScreen />);

    await act(async () => {
      fireEvent.press(screen.getByTestId('home-primary-cta'));
    });
    expect(mockPush).toHaveBeenCalledWith('/capture');
  });
});
