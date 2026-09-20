/**
 * `app/capture/index.tsx`'s consent self-heal (2026-09-20). There is deliberately no consent gate
 * at capture — Upload/Record are never blocked on a consented account — but the post-signup
 * grants in `app/(auth)/sign-in.tsx` are fire-and-forget, and this screen is the one place with no
 * retry mechanism at all until this change. The check-and-repair itself (which keys are read, which
 * are granted, that a withdrawal is never reversed) is `lib/consent.ts`'s `ensureConsentsGranted`
 * and is proven in `lib/__tests__/consent.test.ts`; what has to be true HERE is the screen's
 * mapping of its result: `granted` and `failed` proceed (best-effort, the server still fails
 * closed), `withdrawn` shows the way back to Settings instead of navigating, the round trip is
 * bounded by a timeout so a stalled connection never holds the cards, and it runs under the
 * screen's `busy` guard so a double tap cannot fire the navigation twice.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { ensureConsentsGranted } from '@/lib/consent';

import SourcePickerScreen from '../index';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));

// The screen calls `useMediaLibraryPermissions()` unconditionally at the top; Record doesn't
// touch the library at all, so a fixed "undetermined" tuple is enough for these tests.
jest.mock('expo-image-picker', () => ({
  useMediaLibraryPermissions: () => [{ granted: false, canAskAgain: true, status: 'undetermined' }, jest.fn()],
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));
// `jest.requireActual('@/lib/consent')` below loads `lib/supabase`, which throws without env;
// the real client is never reached here since the one network function is replaced.
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/lib/consent', () => {
  const actual = jest.requireActual('@/lib/consent');
  return { ...actual, ensureConsentsGranted: jest.fn() };
});

const mockEnsureConsents = ensureConsentsGranted as jest.Mock;

beforeEach(() => {
  mockPush.mockReset();
  mockEnsureConsents.mockReset();
});

describe('SourcePickerScreen: consent self-heal', () => {
  it('runs the check-and-repair with a timeout budget before navigating to Record', async () => {
    mockEnsureConsents.mockResolvedValue('granted');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(mockEnsureConsents).toHaveBeenCalledTimes(1);
    expect(mockEnsureConsents).toHaveBeenCalledWith({ timeoutMs: 3000 });
  });

  it('never re-grants a consent the user withdrew: no navigation, a panel pointing at Settings', async () => {
    mockEnsureConsents.mockResolvedValue('withdrawn');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.title)).toBeTruthy());
    expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.body)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalledWith('/capture/record');

    await act(async () => {
      fireEvent.press(view.getByText(Copy.sourcePicker.error.consentWithdrawn.cta));
    });
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('holds Upload the same way after a withdrawal', async () => {
    mockEnsureConsents.mockResolvedValue('withdrawn');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-upload'));
    });

    await waitFor(() => expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.title)).toBeTruthy());
    // The soft-ask panel is the next step of the upload flow; it must not have been reached.
    expect(view.queryByText(Copy.sourcePicker.permission.library.title)).toBeNull();
  });

  it('proceeds to Record even when the repair attempt itself fails or times out (best-effort, not a gate)', async () => {
    mockEnsureConsents.mockResolvedValue('failed');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(view.queryByText(Copy.sourcePicker.error.consentWithdrawn.title)).toBeNull();
  });

  it('disables both cards while the consent check is in flight, so a double tap navigates once', async () => {
    let resolveCheck: (state: 'granted') => void = () => undefined;
    mockEnsureConsents.mockReturnValue(
      new Promise<'granted'>((resolve) => {
        resolveCheck = resolve;
      })
    );
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });
    expect(view.getByTestId('source-card-record').props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('source-card-upload').props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await act(async () => {
      resolveCheck('granted');
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockEnsureConsents).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('source-card-record').props.accessibilityState.disabled).toBe(false);
  });
});
