/**
 * `useAnnounce` (issue #11) — the iOS-side complement to `accessibilityLiveRegion="polite"`.
 * `accessibilityLiveRegion` is Android-only and a no-op on iOS; this hook is what actually
 * reaches VoiceOver there. Locks: fires on iOS when `message` changes to a new truthy value,
 * never fires for a falsy message (nothing to announce yet), and never fires on Android — that
 * platform already gets its announcement from `accessibilityLiveRegion`, so calling
 * `announceForAccessibility` there too would double-announce every change.
 */
import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { useAnnounce } from '../use-announce';

const mockAnnounce = AccessibilityInfo.announceForAccessibility as jest.Mock;

type Props = { message: string | null | undefined };

describe('useAnnounce', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
    mockAnnounce.mockClear();
  });

  it('announces a truthy message on iOS', async () => {
    Platform.OS = 'ios';

    await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: 'Sign-in failed.' },
    });

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
    expect(mockAnnounce).toHaveBeenCalledWith('Sign-in failed.');
  });

  it('announces again when the message changes to a new value', async () => {
    Platform.OS = 'ios';

    const { rerender } = await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: 'First error.' },
    });
    await rerender({ message: 'Second error.' });

    expect(mockAnnounce).toHaveBeenNthCalledWith(1, 'First error.');
    expect(mockAnnounce).toHaveBeenNthCalledWith(2, 'Second error.');
    expect(mockAnnounce).toHaveBeenCalledTimes(2);
  });

  it('does not re-announce when the message is unchanged', async () => {
    Platform.OS = 'ios';

    const { rerender } = await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: 'Same error.' },
    });
    await rerender({ message: 'Same error.' });

    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });

  it('does not announce a null message', async () => {
    Platform.OS = 'ios';

    await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: null },
    });

    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('does not announce an undefined message', async () => {
    Platform.OS = 'ios';

    await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: undefined },
    });

    expect(mockAnnounce).not.toHaveBeenCalled();
  });

  it('never announces on Android — accessibilityLiveRegion already covers it', async () => {
    Platform.OS = 'android';

    const { rerender } = await renderHook(({ message }: Props) => useAnnounce(message), {
      initialProps: { message: 'Sign-in failed.' },
    });
    await rerender({ message: 'A different error.' });

    expect(mockAnnounce).not.toHaveBeenCalled();
  });
});
