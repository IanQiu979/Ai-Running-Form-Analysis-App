/**
 * `components/history/history-row.tsx`'s own contract (V23-09): what one row says and hands back.
 * The screen test covers the deck's three-cell rule and the delete flow end to end; this locks the
 * row-local invariants a screen render cannot reach cheaply — the busy swap, the disabled
 * state, and the two a11y sentences the row must carry.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { formatHistoryDate, formatHistoryItemDeleteA11yLabel, type HistoryListItem } from '@/lib/history';

import { HistoryRow } from '../history-row';

jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), storage: { from: jest.fn() } },
}));

function item(id: string, score: number | null): HistoryListItem {
  return {
    id,
    createdAt: '2026-08-28T10:00:00.000Z',
    mediaType: 'video',
    mediaPaths: ['a', 'b', 'c'],
    outcome: {
      isFallback: false,
      result: {
        overall: { score, band: score === null ? null : 'good' },
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

describe('<HistoryRow>', () => {
  it('leads with the numeral, the band word and the date, and emits open + delete', async () => {
    const onPress = jest.fn();
    const onDelete = jest.fn();
    const row = item('a', 74);
    await render(
      <HistoryRow item={row} thumbnailUris={[]} isDeleting={false} onPress={onPress} onDelete={onDelete} />
    );

    expect(screen.getByTestId('history-score-a')).toHaveTextContent('74');
    expect(screen.getByText(ScoreBandLabel.good)).toBeTruthy();
    expect(screen.getByText(formatHistoryDate(row.createdAt))).toBeTruthy();
    // No signed URLs yet: three placeholder cells, still three cells.
    expect(screen.getByTestId('history-frame-strip-a').props.children).toHaveLength(3);
    expect(screen.getByTestId('history-frame-placeholder-a-2')).toBeTruthy();

    const del = screen.getByTestId('history-delete-a');
    expect(del.props.accessibilityLabel).toBe(
      formatHistoryItemDeleteA11yLabel(row, formatHistoryDate(row.createdAt))
    );
    await act(async () => {
      fireEvent.press(del);
    });
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('draws the em dash and the not-assessed reason for a null overall', async () => {
    await render(
      <HistoryRow item={item('b', null)} thumbnailUris={[]} isDeleting={false} onPress={() => {}} onDelete={() => {}} />
    );
    expect(screen.getByTestId('history-score-b')).toHaveTextContent('—');
    expect(screen.getByText(Copy.result.pillar.notAssessed.generic)).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('swaps the Delete word for a spinner and disables the control while deleting', async () => {
    const onDelete = jest.fn();
    await render(
      <HistoryRow item={item('c', 60)} thumbnailUris={[]} isDeleting onPress={() => {}} onDelete={onDelete} />
    );
    expect(screen.queryByText(Copy.history.item.deleteCta)).toBeNull();
    expect(screen.getByTestId('history-delete-busy-c')).toBeTruthy();
    const del = screen.getByTestId('history-delete-c');
    expect(del.props.accessibilityState).toEqual({ disabled: true, busy: true });
    await act(async () => {
      fireEvent.press(del);
    });
    expect(onDelete).not.toHaveBeenCalled();
  });
});
