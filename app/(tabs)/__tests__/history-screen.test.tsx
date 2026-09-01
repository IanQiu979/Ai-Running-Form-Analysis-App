/**
 * `app/(tabs)/history.tsx`'s four states, locked at the tree that actually mounts.
 *
 * A screen-level render is the right level here for the reason CLAUDE.md § Testing gives ("reach
 * for RNTL when the defect lives in the wiring itself"): every invariant below is one this screen
 * can lose SILENTLY, and none of them can be proven from a pure function.
 *
 *   - A not-assessed overall must never draw a swept arc. `<ArcRing>` enforces that for itself,
 *     but only if this screen keeps passing `null` rather than coercing a missing score to 0 —
 *     which is a one-character regression that would render as a confident "0 / 100".
 *   - The per-row Delete control must stay PRESENT ON EVERY ROW. It is the shipped interaction
 *     (`docs/design/copy-deck.md` Screen 8, superseding the brief's swipe/long-press), and a
 *     redesign that quietly turned it into a gesture would look fine in a screenshot and lose a
 *     screen-reader user their only way to delete an analysis.
 *   - The frame deck must stay capped. Uncapped, a six-frame analysis overflows the row.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import type { HistoryListItem } from '@/lib/history';

import HistoryScreen from '../history';

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

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), storage: { from: jest.fn() } },
}));

const mockFetchHistoryList = jest.fn();
// Four signed URLs on purpose: the row caps its deck at three, and that cap is what this fixture
// exists to exercise.
const mockSignFrameStrip = jest.fn(async (_paths: string[]) => ['uri-a', 'uri-b', 'uri-c', 'uri-d']);

jest.mock('@/lib/history', () => {
  const actual = jest.requireActual('@/lib/history');
  return {
    ...actual,
    fetchHistoryList: (...args: unknown[]) => mockFetchHistoryList(...args),
    // Wrapped in an arrow, never referenced directly: `jest.mock`'s factory runs when `../history`
    // is first imported, which is HOISTED above these `const` declarations — a bare
    // `signFrameStrip: mockSignFrameStrip` binds `undefined` and the screen crashes on call.
    signFrameStrip: (paths: string[]) => mockSignFrameStrip(paths),
    deleteHistoryAnalysis: jest.fn(),
  };
});

function item(id: string, score: number | null): HistoryListItem {
  return {
    id,
    createdAt: '2026-08-28T10:00:00.000Z',
    mediaType: 'video',
    mediaPaths: ['a', 'b', 'c', 'd'],
    outcome: {
      isFallback: false,
      result: {
        overall: { score, band: score === null ? null : 'strong' },
        pillars: {
          posture: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          armSwing: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          cadence: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
          elasticity: { score: 70, band: 'good', feedback: 'x', flags: [], drills: [], notAssessedReason: undefined },
        },
      },
    } as HistoryListItem['outcome'],
  };
}

describe('history render smoke', () => {
  it('loading', async () => {
    mockFetchHistoryList.mockImplementation(() => new Promise(() => {}));
    await render(<HistoryScreen />);
    expect(screen.getByTestId('history-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(Copy.history.loading)).toBeTruthy();
  });

  it('error', async () => {
    mockFetchHistoryList.mockRejectedValue(new Error('nope'));
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText(Copy.history.error.loadFailed)).toBeTruthy());
    expect(screen.getByText(Copy.history.error.retry)).toBeTruthy();
  });

  it('empty', async () => {
    mockFetchHistoryList.mockResolvedValue([]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText(Copy.history.empty.title)).toBeTruthy());
    expect(screen.getByTestId('history-empty-ring', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByTestId('history-empty-ring-track', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('history-empty-ring-fill', { includeHiddenElements: true })).toBeNull();
  });

  it('ready: rows, rings, capped frame deck, delete, compare shelf', async () => {
    mockFetchHistoryList.mockResolvedValue([item('a', 88), item('b', null)]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());

    expect(screen.getByText(Copy.history.compare.cta)).toBeTruthy();
    expect(screen.getByText('88')).toBeTruthy();
    expect(screen.getAllByText(Copy.history.item.deleteCta)).toHaveLength(2);
    // scored row: a swept fill exists; not-assessed row: dashed track, no fill.
    expect(screen.getByTestId('history-ring-a-fill', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('history-ring-b-fill', { includeHiddenElements: true })).toBeNull();
    // four signed URLs came back, at most three tiles are drawn.
    await waitFor(() =>
      expect(screen.getByTestId('history-frame-strip-a').props.children.length).toBe(3)
    );
  });
});
