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
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import type { HistoryListItem } from '@/lib/history';

import HistoryScreen from '../history';

type FocusEffectCallback = () => void | (() => void);

const mockHistoryFocus = {
  callback: null as FocusEffectCallback | null,
  cleanup: null as (() => void) | null,
};
let mockCurrentUserId = 'user-a';

function mockBlurHistoryScreen() {
  const cleanup = mockHistoryFocus.cleanup;
  mockHistoryFocus.cleanup = null;
  cleanup?.();
}

function mockFocusHistoryScreen() {
  const cleanup = mockHistoryFocus.callback?.();
  mockHistoryFocus.cleanup = typeof cleanup === 'function' ? cleanup : null;
}

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    useFocusEffect: (cb: FocusEffectCallback) => {
      react.useEffect(() => {
        const focus = () => cb();
        mockHistoryFocus.callback = focus;
        const cleanup = focus();
        mockHistoryFocus.cleanup = typeof cleanup === 'function' ? cleanup : null;

        return () => {
          if (mockHistoryFocus.callback === focus) {
            mockHistoryFocus.callback = null;
          }
          mockBlurHistoryScreen();
        };
      }, [cb]);
    },
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

jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    session: { user: { id: mockCurrentUserId } },
    isLoading: false,
    isPasswordRecovery: false,
  }),
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
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchHistoryList.mockReset();
    mockHistoryFocus.callback = null;
    mockHistoryFocus.cleanup = null;
    mockCurrentUserId = 'user-a';
  });

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

  it('keeps the last list visible while a focus refresh loads and then replaces it', async () => {
    let resolveRefresh!: (items: HistoryListItem[]) => void;
    const refresh = new Promise<HistoryListItem[]>((resolve) => {
      resolveRefresh = resolve;
    });
    mockFetchHistoryList
      .mockResolvedValueOnce([item('a', 88)])
      .mockImplementationOnce(() => refresh);

    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());

    await act(async () => {
      mockBlurHistoryScreen();
      mockFocusHistoryScreen();
    });

    expect(screen.getByTestId('history-row-a')).toBeTruthy();
    expect(screen.queryByTestId('history-loading', { includeHiddenElements: true })).toBeNull();
    expect(screen.queryByText(Copy.history.loading)).toBeNull();

    await act(async () => {
      resolveRefresh([item('b', 72)]);
    });
    await waitFor(() => expect(screen.getByTestId('history-row-b')).toBeTruthy());
    expect(screen.queryByTestId('history-row-a')).toBeNull();
  });

  it('clears the prior user list on an identity switch and ignores their late refresh', async () => {
    let resolveUserARefresh!: (items: HistoryListItem[]) => void;
    const userARefresh = new Promise<HistoryListItem[]>((resolve) => {
      resolveUserARefresh = resolve;
    });
    let resolveUserBLoad!: (items: HistoryListItem[]) => void;
    const userBLoad = new Promise<HistoryListItem[]>((resolve) => {
      resolveUserBLoad = resolve;
    });
    mockFetchHistoryList
      .mockResolvedValueOnce([item('a', 88)])
      .mockImplementationOnce(() => userARefresh)
      .mockImplementationOnce(() => userBLoad);

    const { rerender } = await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());

    await act(async () => {
      mockBlurHistoryScreen();
      mockFocusHistoryScreen();
    });

    mockCurrentUserId = 'user-b';
    await rerender(<HistoryScreen />);

    expect(screen.queryByTestId('history-row-a')).toBeNull();
    expect(screen.getByTestId('history-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(Copy.history.loading)).toBeTruthy();

    await act(async () => {
      resolveUserBLoad([item('b', 72)]);
    });
    await waitFor(() => expect(screen.getByTestId('history-row-b')).toBeTruthy());
    expect(screen.queryByTestId('history-row-a')).toBeNull();

    await act(async () => {
      resolveUserARefresh([item('a', 91)]);
    });
    expect(screen.getByTestId('history-row-b')).toBeTruthy();
    expect(screen.queryByTestId('history-row-a')).toBeNull();
  });
});
