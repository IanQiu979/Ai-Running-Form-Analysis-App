import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AnalyzedFramesStrip } from '../analyzed-frames-strip';
import type { AnalysisFrameSlot } from '@/lib/result-frames';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const SLOTS: AnalysisFrameSlot[] = [
  { path: 'user/analysis/frame-001.jpg', uri: 'https://signed.example/frame-001', status: 'ready' },
  { path: 'user/analysis/frame-002.jpg', uri: null, status: 'loading' },
  { path: 'user/analysis/frame-003.jpg', uri: null, status: 'unavailable' },
  { path: 'user/analysis/frame-004.jpg', uri: 'https://signed.example/frame-004', status: 'ready' },
];

describe('AnalyzedFramesStrip', () => {
  it('preserves frame count and order across ready, loading, and unavailable slots', async () => {
    await render(<AnalyzedFramesStrip slots={SLOTS} />);

    expect(screen.getByText('Frames analyzed')).toBeTruthy();
    expect(screen.getAllByTestId(/^analyzed-frame-slot-/)).toHaveLength(4);
    expect(screen.getByTestId('analyzed-frame-image-0').props.source[0]).toEqual({
      uri: 'https://signed.example/frame-001',
    });
    expect(screen.getByTestId('analyzed-frame-loading-1')).toBeTruthy();
    expect(screen.getByTestId('analyzed-frame-unavailable-2')).toBeTruthy();
    expect(screen.getByTestId('analyzed-frame-image-3').props.source[0]).toEqual({
      uri: 'https://signed.example/frame-004',
    });
    expect(screen.getByLabelText('Frame 1 of 4')).toBeTruthy();
    expect(screen.getByLabelText('Frame 4 of 4')).toBeTruthy();
  });

  it('renders nothing when there are no stored frame slots', async () => {
    await render(<AnalyzedFramesStrip slots={[]} />);

    expect(screen.queryByTestId('analyzed-frames-strip')).toBeNull();
    expect(screen.queryByText('Frames analyzed')).toBeNull();
  });

  it('opens the tapped ready frame in the paged viewer and closes from both controls', async () => {
    await render(<AnalyzedFramesStrip slots={SLOTS} reduceMotion={false} />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Frame 4 of 4'));
    });

    const modal = screen.getByTestId('analyzed-frame-viewer');
    expect(modal.props.animationType).toBe('fade');
    expect(screen.getByTestId('analyzed-frame-viewer-surface').props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByTestId('analyzed-frame-viewer-list').props.initialScrollIndex).toBe(3);
    expect(screen.getByTestId('analyzed-frame-viewer-image-3').props.contentFit).toBe('contain');
    expect(screen.getByTestId('analyzed-frame-viewer-image-3').props.cachePolicy).toBe('none');

    await act(async () => {
      fireEvent.press(screen.getByTestId('analyzed-frame-viewer-close'));
    });
    expect(screen.queryByTestId('analyzed-frame-viewer')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Frame 1 of 4'));
    });
    await act(async () => {
      screen.getByTestId('analyzed-frame-viewer').props.onRequestClose();
    });
    expect(screen.queryByTestId('analyzed-frame-viewer')).toBeNull();
  });

  it('disables the modal transition when reduced motion is requested', async () => {
    await render(<AnalyzedFramesStrip slots={SLOTS} reduceMotion />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Frame 1 of 4'));
    });

    expect(screen.getByTestId('analyzed-frame-viewer').props.animationType).toBe('none');
  });

  it('replaces an image that fails to load with the fallback without removing its slot', async () => {
    await render(<AnalyzedFramesStrip slots={SLOTS} />);

    expect(screen.getByTestId('analyzed-frame-image-0').props.cachePolicy).toBe('none');
    await act(async () => {
      fireEvent(screen.getByTestId('analyzed-frame-image-0'), 'onError', {
        nativeEvent: { error: 'signed URL expired' },
      });
    });

    expect(screen.queryByTestId('analyzed-frame-image-0')).toBeNull();
    expect(screen.getByTestId('analyzed-frame-unavailable-0')).toBeTruthy();
    expect(screen.getAllByTestId(/^analyzed-frame-slot-/)).toHaveLength(4);
  });
});
