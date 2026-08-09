/**
 * Regression lock for the home-tab cleanup pass: the top-bar `LowPolyField` logo must be gone
 * (issue: captain called `app/(tabs)/index.tsx` messy) and `Copy.home.title` must render exactly
 * once — it used to also duplicate into the ready-quota block's `Eyebrow`, which read as a second,
 * unlabeled title directly under the first.
 */
import { render, screen } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

import HomeScreen from '../index';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    // Real effect semantics (run once after mount, per the `cb` identity), not a call on every
    // render — a naive `useFocusEffect: (cb) => cb()` re-fires `fetchQuota` on every state update
    // it triggers, which loops forever and hangs the test.
    useFocusEffect: (cb: () => void | (() => void)) => react.useEffect(cb, [cb]),
  };
});

// See app/capture/__tests__/record.test.tsx's comment: `@expo/vector-icons` pulls in
// `expo-font` -> `expo-asset`, which this project does not have installed under Jest.
jest.mock('@expo/vector-icons/MaterialIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native');
  return { __esModule: true, default: () => react.createElement(rn.View) };
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
  it('renders no low-poly mark and the title exactly once', async () => {
    await render(<HomeScreen />);

    expect(screen.queryByTestId('home-mark')).toBeNull();
    expect(screen.getAllByText(Copy.home.title)).toHaveLength(1);
    expect(screen.getByTestId('home-title')).toBeTruthy();
  });
});
