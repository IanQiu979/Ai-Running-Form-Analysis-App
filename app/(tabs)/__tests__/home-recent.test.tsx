/**
 * Home's lead card (`components/home/recent-analysis.tsx`) in all four of its states, driven
 * through the real screen so the FETCH-TO-STATE wiring is covered too, not just the
 * presentational branch.
 *
 * The two invariants worth a screen render, both of which fail silently:
 *
 *   - `unavailable` must not collapse into `empty`. `fetchHistoryList` fails closed (it throws),
 *     and the tempting one-line catch is `setRecent({ status: 'empty' })` — which tells a user
 *     with a full history, during an outage, that they have never analyzed anything. This asserts
 *     the dashed box still draws and the "No analyses yet" line does NOT.
 *   - A not-assessed overall must draw no numeral. Same rule `components/pace-readout.tsx` is
 *     built around: `null` is a first-class state, never a zero — and a null PILLAR score is the
 *     page's "—" (V23-07, third artboard), never "0".
 *
 * See `app/(tabs)/__tests__/index.test.tsx` for the separate top-bar lock on this screen.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { formatHistoryDate, type HistoryListItem } from '@/lib/history';
import { pillarLetter } from '@/lib/pace-readout';
import { PACE_PILLARS } from '@shared/pace';

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

function item(score: number | null, cadenceScore: number | null = 70): HistoryListItem {
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
          cadence: {
            score: cadenceScore,
            band: cadenceScore === null ? null : 'good',
            feedback: 'x',
            flags: [],
            drills: [],
          },
          elasticity: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [] },
        },
      },
    } as HistoryListItem['outcome'],
  };
}

describe('home lead card render smoke', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('loading: the indicator holds the slot', async () => {
    mockFetchHistoryList.mockImplementation(() => new Promise(() => {}));
    await render(<HomeScreen />);
    expect(screen.getByTestId('home-recent-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('home-primary-cta')).toBeTruthy();
  });

  it('empty: the dashed box with its title and sentence, no card', async () => {
    mockFetchHistoryList.mockResolvedValue([]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-hero-line')).toBeTruthy());
    expect(screen.getByText(Copy.home.empty.caption)).toBeTruthy();
    expect(screen.getByText(Copy.home.empty.body)).toBeTruthy();
    expect(screen.queryByTestId('home-recent')).toBeNull();
    expect(screen.queryByTestId('home-recent-unavailable')).toBeNull();
  });

  it('unavailable: the dashed box draws but nothing claims an empty history', async () => {
    mockFetchHistoryList.mockRejectedValue(new Error('offline'));
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('home-hero-line')).toBeNull();
    expect(screen.queryByText(Copy.home.empty.caption)).toBeNull();
    expect(screen.getByTestId('home-primary-cta')).toBeTruthy();
  });

  it('ready: numeral, band word, date, the P/A/C/E row, and one accessible open target', async () => {
    mockFetchHistoryList.mockResolvedValue([item(88)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    expect(screen.getByTestId('home-recent-score')).toHaveTextContent('88');
    expect(screen.getByText(ScoreBandLabel.strong)).toBeTruthy();
    expect(screen.getByText(Copy.result.overall.label)).toBeTruthy();
    expect(screen.getByText(formatHistoryDate('2026-08-28T10:00:00.000Z'))).toBeTruthy();
    for (const id of PACE_PILLARS) {
      expect(screen.getByText(pillarLetter(id))).toBeTruthy();
      expect(screen.getByTestId(`home-recent-pillar-${id}`)).toHaveTextContent('70');
    }
    expect(screen.getByLabelText(/Analysis from .*overall 88 out of 100/)).toBeTruthy();
  });

  it('ready: tapping the card opens that result', async () => {
    mockFetchHistoryList.mockResolvedValue([item(88)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByTestId('home-recent'));
    });
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/result/[id]', params: { id: 'a1' } });
  });

  it('ready, not assessed: no numeral, an honest sentence', async () => {
    mockFetchHistoryList.mockResolvedValue([item(null)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    expect(screen.queryByTestId('home-recent-score')).toBeNull();
    expect(screen.getByText(Copy.result.pillar.notAssessed.generic)).toBeTruthy();
  });

  it('ready, one pillar null: that cell shows the dash, never a zero', async () => {
    mockFetchHistoryList.mockResolvedValue([item(58, null)]);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId('home-recent')).toBeTruthy());
    expect(screen.getByTestId('home-recent-pillar-cadence')).toHaveTextContent('—');
    expect(screen.getByTestId('home-recent-pillar-posture')).toHaveTextContent('70');
    expect(screen.queryByText('0')).toBeNull();
  });
});
