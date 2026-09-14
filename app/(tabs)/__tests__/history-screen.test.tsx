/**
 * `app/(tabs)/history.tsx`'s four states, locked at the tree that actually mounts (V23-09).
 *
 * A screen-level render is the right level here for the reason CLAUDE.md § Testing gives ("reach
 * for RNTL when the defect lives in the wiring itself"): every invariant below is one this screen
 * can lose SILENTLY, and none of them can be proven from a pure function.
 *
 *   - A not-assessed overall must render the page's em dash, never a numeral. A one-character
 *     regression that coerced a missing score to 0 would render as a confident "0".
 *   - The per-row Delete control must stay PRESENT ON EVERY ROW. It is the shipped interaction
 *     (`docs/design/copy-deck.md` Screen 8, superseding the brief's swipe/long-press), and a
 *     redesign that quietly turned it into a gesture would look fine in a screenshot and lose a
 *     screen-reader user their only way to delete an analysis.
 *   - The frame deck is exactly three cells, whatever the strip holds — a fourth signed URL is
 *     not drawn and a missing one is a placeholder cell, so every row keeps the same silhouette.
 *   - Delete goes through the page's `<ConfirmDialog>`, not a native `Alert`; the row leaves the
 *     list only after the server confirms, and a failed delete raises the one-button notice.
 *   - The inline tab bar is this screen's own (the navigator draws none on this tab), so it must
 *     be present in every state and its Home cell must navigate.
 *
 * Every press is wrapped in an awaited `act`: two bare `fireEvent.press` calls in one test leave
 * an act scope open under this Jest setup and the NEXT test renders an empty tree.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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
    router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn() },
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
const mockDeleteHistoryAnalysis = jest.fn(async (_id: string) => ({ ok: true as const }));

jest.mock('@/lib/history', () => {
  const actual = jest.requireActual('@/lib/history');
  return {
    ...actual,
    fetchHistoryList: (...args: unknown[]) => mockFetchHistoryList(...args),
    // Wrapped in an arrow, never referenced directly: `jest.mock`'s factory runs when `../history`
    // is first imported, which is HOISTED above these `const` declarations — a bare
    // `signFrameStrip: mockSignFrameStrip` binds `undefined` and the screen crashes on call.
    signFrameStrip: (paths: string[]) => mockSignFrameStrip(paths),
    deleteHistoryAnalysis: (id: string) => mockDeleteHistoryAnalysis(id),
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
    mockDeleteHistoryAnalysis.mockReset();
    mockDeleteHistoryAnalysis.mockResolvedValue({ ok: true });
    mockHistoryFocus.callback = null;
    mockHistoryFocus.cleanup = null;
    mockCurrentUserId = 'user-a';
  });

  it('loading', async () => {
    mockFetchHistoryList.mockImplementation(() => new Promise(() => {}));
    await render(<HistoryScreen />);
    expect(screen.getByTestId('history-loading', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByText(Copy.history.loading)).toBeTruthy();
    expect(screen.getByTestId('history-tab-bar')).toBeTruthy();
  });

  it('error', async () => {
    mockFetchHistoryList.mockRejectedValue(new Error('nope'));
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText(Copy.history.error.loadFailed)).toBeTruthy());
    expect(screen.getByText(Copy.history.error.retry)).toBeTruthy();
    expect(screen.getByTestId('history-tab-bar')).toBeTruthy();
  });

  it('empty', async () => {
    mockFetchHistoryList.mockResolvedValue([]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByText(Copy.history.empty.title)).toBeTruthy());
    expect(screen.getByText(Copy.history.empty.body)).toBeTruthy();
    expect(screen.getByTestId('history-empty-box', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: Copy.history.empty.cta })).toBeTruthy();
    expect(screen.getByTestId('history-tab-bar')).toBeTruthy();
  });

  it('ready: rows, numerals, three-cell frame deck, delete, compare entry point', async () => {
    mockFetchHistoryList.mockResolvedValue([item('a', 88), item('b', null)]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());

    expect(screen.getByText(Copy.history.compare.cta)).toBeTruthy();
    expect(screen.getByRole('header', { name: Copy.history.title })).toBeTruthy();
    // scored row: the numeral; not-assessed row: the em dash and the reason, never a "0".
    expect(screen.getByTestId('history-score-a')).toHaveTextContent('88');
    expect(screen.getByTestId('history-score-b')).toHaveTextContent('—');
    expect(screen.getByText(Copy.result.pillar.notAssessed.generic)).toBeTruthy();
    expect(screen.getAllByText(Copy.history.item.deleteCta)).toHaveLength(2);
    // four signed URLs came back; exactly three cells are drawn, all of them images.
    await waitFor(() => expect(screen.getByTestId('history-frame-a-2')).toBeTruthy());
    expect(screen.getByTestId('history-frame-strip-a').props.children).toHaveLength(3);
    expect(screen.queryByTestId('history-frame-a-3')).toBeNull();
    expect(screen.queryByTestId('history-frame-placeholder-a-0')).toBeNull();
    // the inline bar is the list's footer, with History selected.
    const bar = screen.getByTestId('history-tab-bar');
    expect(bar).toBeTruthy();
    expect(screen.getByRole('tab', { name: Copy.history.title }).props.accessibilityState).toEqual({
      selected: true,
    });
  });

  it('draws placeholder cells while a strip is still signing or comes back short', async () => {
    mockSignFrameStrip.mockResolvedValueOnce(['uri-a']);
    mockFetchHistoryList.mockResolvedValue([item('a', 88)]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-frame-a-0')).toBeTruthy());
    expect(screen.getByTestId('history-frame-placeholder-a-1')).toBeTruthy();
    expect(screen.getByTestId('history-frame-placeholder-a-2')).toBeTruthy();
    expect(screen.getByTestId('history-frame-strip-a').props.children).toHaveLength(3);
  });

  it('routes the inline bar Home cell to the root route', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { router } = require('expo-router');
    mockFetchHistoryList.mockResolvedValue([]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-tab-bar')).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByRole('tab', { name: Copy.home.title }));
    });
    expect(router.navigate).toHaveBeenCalledWith('/');
  });

  it('delete: confirms through the dialog, removes the row only after the server confirms', async () => {
    mockFetchHistoryList.mockResolvedValue([item('a', 88), item('b', 72)]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());
    expect(screen.queryByText(Copy.history.delete.confirm.title)).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-a'));
    });
    expect(screen.getByText(Copy.history.delete.confirm.title)).toBeTruthy();
    expect(screen.getByText(Copy.history.delete.confirm.body)).toBeTruthy();
    expect(mockDeleteHistoryAnalysis).not.toHaveBeenCalled();

    // Cancel closes it and deletes nothing.
    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-confirm-secondary'));
    });
    expect(screen.queryByText(Copy.history.delete.confirm.title)).toBeNull();
    expect(mockDeleteHistoryAnalysis).not.toHaveBeenCalled();
    expect(screen.getByTestId('history-row-a')).toBeTruthy();

    // Confirm deletes exactly that row.
    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-a'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-confirm-primary'));
    });
    expect(mockDeleteHistoryAnalysis).toHaveBeenCalledTimes(1);
    expect(mockDeleteHistoryAnalysis).toHaveBeenCalledWith('a');
    await waitFor(() => expect(screen.queryByTestId('history-row-a')).toBeNull());
    expect(screen.getByTestId('history-row-b')).toBeTruthy();
    expect(screen.queryByText(Copy.history.delete.confirm.title)).toBeNull();
  });

  it('delete: a server failure keeps the row and raises the one-button notice', async () => {
    mockDeleteHistoryAnalysis.mockResolvedValue({
      ok: false,
      error: { error: 'nope', code: 'unknown' },
    } as never);
    mockFetchHistoryList.mockResolvedValue([item('a', 88)]);
    await render(<HistoryScreen />);
    await waitFor(() => expect(screen.getByTestId('history-row-a')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-a'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-confirm-primary'));
    });
    await waitFor(() => expect(screen.getByText(Copy.history.delete.error.title)).toBeTruthy());
    expect(screen.getByTestId('history-row-a')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('history-delete-failed-primary'));
    });
    expect(screen.queryByText(Copy.history.delete.error.title)).toBeNull();
    expect(screen.getByTestId('history-row-a')).toBeTruthy();
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
