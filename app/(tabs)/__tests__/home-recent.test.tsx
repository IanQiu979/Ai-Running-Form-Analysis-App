/**
 * Home's hero (`components/home/recent-analysis.tsx`) in all four of its states, driven through
 * the real screen so the FETCH-TO-STATE wiring is covered too, not just the presentational branch.
 *
 * The two invariants worth a screen render, both of which fail silently:
 *
 *   - `unavailable` must not collapse into `empty`. `fetchHistoryList` fails closed (it throws),
 *     and the tempting one-line catch is `setRecent({ status: 'empty' })` — which tells a user
 *     with a full history, during an outage, that they have never analyzed anything. This asserts
 *     the ring still draws and the "Nothing analyzed yet" line does NOT.
 *   - A not-assessed overall must draw no fill arc and no numeral. Same rule
 *     `components/pace-readout.tsx` is built around: `null` is a first-class state, never a zero.
 *
 * See `app/(tabs)/__tests__/index.test.tsx` for the separate top-bar lock on this screen.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import type { HistoryListItem } from '@/lib/history';

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
    useFocusEffect: (cb: () => void | (() => void)) => react.useEffect(cb, [cb]),
  };
});

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
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), storage: { from: jest.fn() } },
}));

const mockFetchHistoryList = jest.fn();
jest.mock('@/lib/history', () => {
  const actual = jest.requireActual('@/lib/history');
  return { ...actual, fetchHistoryList: (...a: unknown[]) => mockFetchHistoryList(...a) };
});

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

function item(score: number | null): HistoryListItem {
  return {
    id: 'a1',
    createdAt: '2026-08-28T10:00:00.000Z',
    mediaType: 'video',
    mediaPaths: [],
    outcome: {
      isFallback: false,
      result: {
        overall: { score, band: score === null ? null : 'strong' },
        pillars: {
          posture: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [] },
          armSwing: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [] },
          cadence: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [] },
          elasticity: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [] },
        },
      },
    } as HistoryListItem['outcome'],
  };
}

describe('home hero render smoke', () => {
  it('loading: the arc loader holds the hero slot', async () => {
    mockFetchHistoryList.mockImplementation(() => new Promise(() => {}));
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-recent-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('home-primary-cta')).toBeTruthy();
  });

  it('empty: dashed ring + the kinetic line, no fill arc', async () => {
    mockFetchHistoryList.mockResolvedValue([]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-hero-line')).toBeTruthy());
    expect(screen.getByLabelText(Copy.home.empty.caption)).toBeTruthy();
    expect(screen.getByTestId('home-recent-empty-ring-track', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('home-recent-empty-ring-fill', { includeHiddenElements: true })).toBeNull();
  });

  it('unavailable: the ring draws but nothing claims an empty history', async () => {
    mockFetchHistoryList.mockRejectedValue(new Error('offline'));
    await render(<HomeScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('home-recent-empty-ring', { includeHiddenElements: true })).toBeTruthy()
    );
    expect(screen.queryByTestId('home-hero-line')).toBeNull();
    expect(screen.getByTestId('home-primary-cta')).toBeTruthy();
  });

  it('ready: score ring, band, date, and one accessible open target', async () => {
    mockFetchHistoryList.mockResolvedValue([item(88)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    expect(screen.getByTestId('home-recent-ring-fill', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('home-recent-score')).toBeTruthy();
    expect(screen.getByLabelText(/Analysis from .*overall 88 out of 100/)).toBeTruthy();
  });

  it('ready, not assessed: dashed ring, no numeral, an honest sentence', async () => {
    mockFetchHistoryList.mockResolvedValue([item(null)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    expect(screen.queryByTestId('home-recent-ring-fill', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByTestId('home-recent-score')).toBeNull();
    expect(screen.getByText(Copy.result.pillar.notAssessed.generic)).toBeTruthy();
  });
});
