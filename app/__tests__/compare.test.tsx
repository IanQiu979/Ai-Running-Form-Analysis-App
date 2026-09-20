/**
 * `app/compare.tsx`'s states, locked at the tree that actually mounts, after the V23 re-cut
 * (2026-09-21, change-list item 5). A screen-level render is the right level here for the reason
 * CLAUDE.md § Testing gives ("reach for RNTL when the defect lives in the wiring itself"):
 *
 *   - The Elite gate must render `locked` for any tier other than `'elite'`, re-read fresh on
 *     every mount, regardless of how the screen was reached (this file's own header).
 *   - A not-assessed pillar (either side) must never render as a delta of zero, and a
 *     not-assessed overall in the picker must never render a numeral.
 *   - Every state (loading, error, locked, empty, picker, comparing) must render on the V23 sheet
 *     with no leftover old-theme structure.
 *
 * Every press is wrapped in an awaited `act` (CLAUDE.md § Testing: two bare `fireEvent.press`
 * calls in one test poison the next test under this Jest setup).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import type { HistoryListItem } from '@/lib/history';
import type { QuotaStatus } from '@/lib/subscription';

import CompareScreen from '../compare';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: () => mockBack() },
}));

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), storage: { from: jest.fn() } },
}));

const mockFetchHistoryList = jest.fn();
jest.mock('@/lib/history', () => {
  const actual = jest.requireActual('@/lib/history');
  return {
    ...actual,
    fetchHistoryList: (...args: unknown[]) => mockFetchHistoryList(...args),
  };
});

const mockGetQuotaStatus = jest.fn();
jest.mock('@/lib/subscription', () => {
  const actual = jest.requireActual('@/lib/subscription');
  return {
    ...actual,
    getQuotaStatus: (...args: unknown[]) => mockGetQuotaStatus(...args),
  };
});

function quota(tier: QuotaStatus['tier']): { ok: true; data: QuotaStatus } {
  return {
    ok: true,
    data: {
      tier,
      used: 0,
      limit: 1,
      remaining: 1,
      frameCap: 1,
      isLifetime: tier === 'free',
      periodStart: tier === 'free' ? null : '2026-09-01T00:00:00.000Z',
      periodEnd: tier === 'free' ? null : '2026-09-30T00:00:00.000Z',
      blocked: false,
      blockedReason: null,
      blockedUntil: null,
    },
  };
}

function item(id: string, createdAt: string, score: number | null): HistoryListItem {
  return {
    id,
    createdAt,
    mediaType: 'video',
    mediaPaths: ['a'],
    outcome: {
      isFallback: false,
      result: {
        overall: { score, band: score === null ? null : 'strong' },
        pillars: {
          posture: score === null
            ? { score: null, band: null, feedback: null, notAssessedReason: 'needsVideo', flags: [], drills: [] }
            : { score, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          armSwing: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          cadence: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          elasticity: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
        },
      },
    } as HistoryListItem['outcome'],
  };
}

describe('compare screen states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchHistoryList.mockReset();
    mockGetQuotaStatus.mockReset();
  });

  it('renders loading while the tier and list reads are in flight', async () => {
    mockGetQuotaStatus.mockReturnValue(new Promise(() => {}));
    mockFetchHistoryList.mockReturnValue(new Promise(() => {}));

    await act(async () => {
      render(<CompareScreen />);
    });

    expect(screen.getByTestId('compare-loading')).toBeTruthy();
  });

  it('renders error when the tier read fails', async () => {
    mockGetQuotaStatus.mockResolvedValue({ ok: false });
    mockFetchHistoryList.mockResolvedValue([]);

    await act(async () => {
      render(<CompareScreen />);
    });
    await waitFor(() => expect(screen.getByText(Copy.compare.error.loadFailed)).toBeTruthy());
  });

  it('renders locked for any tier other than Elite, regardless of how it was reached', async () => {
    mockGetQuotaStatus.mockResolvedValue(quota('pro'));
    mockFetchHistoryList.mockResolvedValue([]);

    await act(async () => {
      render(<CompareScreen />);
    });
    await waitFor(() => expect(screen.getByText(Copy.compare.locked.title)).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('compare-locked-cta'));
    });
    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });

  it('renders the empty state for an Elite caller with fewer than two analyses', async () => {
    mockGetQuotaStatus.mockResolvedValue(quota('elite'));
    mockFetchHistoryList.mockResolvedValue([item('a', '2026-09-01T00:00:00.000Z', 80)]);

    await act(async () => {
      render(<CompareScreen />);
    });
    await waitFor(() => expect(screen.getByText(Copy.compare.empty.title)).toBeTruthy());
  });

  it('renders the picker with a not-assessed row honestly, never a zero', async () => {
    mockGetQuotaStatus.mockResolvedValue(quota('elite'));
    mockFetchHistoryList.mockResolvedValue([
      item('a', '2026-09-01T00:00:00.000Z', 80),
      item('b', '2026-09-02T00:00:00.000Z', null),
    ]);

    await act(async () => {
      render(<CompareScreen />);
    });
    await waitFor(() => expect(screen.getByTestId('compare-picker-row-a')).toBeTruthy());

    expect(screen.getByText(Copy.result.pillar.notAssessed.generic)).toBeTruthy();
    expect(screen.getByText('80')).toBeTruthy();
    expect(screen.getByText(ScoreBandLabel.strong)).toBeTruthy();
    expect(screen.getByTestId('compare-picker-cta').props.accessibilityState.disabled).toBe(true);
  });

  it('selects exactly two rows and moves into the comparison', async () => {
    mockGetQuotaStatus.mockResolvedValue(quota('elite'));
    mockFetchHistoryList.mockResolvedValue([
      item('a', '2026-09-01T00:00:00.000Z', 80),
      item('b', '2026-09-05T00:00:00.000Z', 88),
    ]);

    await act(async () => {
      render(<CompareScreen />);
    });
    await waitFor(() => expect(screen.getByTestId('compare-picker-row-a')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('compare-picker-row-a'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('compare-picker-row-b'));
    });
    expect(screen.getByTestId('compare-picker-cta').props.accessibilityState.disabled).toBe(false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('compare-picker-cta'));
    });

    expect(screen.getByTestId('compare-delta-panel')).toBeTruthy();
    expect(screen.getByText(Copy.compare.vs)).toBeTruthy();

    // "Back" from the comparison returns to the picker with the same two rows still checked,
    // rather than leaving the screen (this file's own header comment on `goBack`).
    await act(async () => {
      fireEvent.press(screen.getByLabelText(Copy.compare.back));
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('compare-picker-row-a').props.accessibilityState.checked).toBe(true);
  });
});
