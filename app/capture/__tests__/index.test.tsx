/**
 * `app/capture/index.tsx`'s consent self-heal (2026-09-20). There is deliberately no consent gate
 * at capture — Upload/Record are never blocked on a consented account — but the post-signup
 * grants in `app/(auth)/sign-in.tsx` are fire-and-forget, and this screen is the one place with no
 * retry mechanism at all until this change. What has to be true: the consent state is read before
 * either action fires, an account with NO row is repaired before proceeding, an already-granted
 * account pays no extra round trip, and an account that WITHDREW consent in Settings is never
 * silently re-granted — it is shown the way back to Settings instead, and the server's refusal
 * stands. The round trip also runs under the screen's `busy` guard so a double tap cannot fire
 * the navigation twice.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import {
  FUTURE_UPLOADS_ATTESTATION_CONSENT,
  grantConsent,
  readConsentState,
  UPLOAD_HEALTH_CONSENT,
} from '@/lib/consent';

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
// the real client is never reached here since both functions are replaced, so a bare stub does.
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/lib/consent', () => {
  const actual = jest.requireActual('@/lib/consent');
  return { ...actual, readConsentState: jest.fn(), grantConsent: jest.fn() };
});

const mockReadConsentState = readConsentState as jest.Mock;
const mockGrantConsent = grantConsent as jest.Mock;

beforeEach(() => {
  mockPush.mockReset();
  mockReadConsentState.mockReset();
  mockGrantConsent.mockReset();
  mockGrantConsent.mockResolvedValue(undefined);
});

describe('SourcePickerScreen: consent self-heal', () => {
  it('repairs a legacy account with no consent row before navigating to Record', async () => {
    mockReadConsentState.mockResolvedValue('none');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT));
    expect(mockGrantConsent).toHaveBeenCalledWith(FUTURE_UPLOADS_ATTESTATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledWith('/capture/record');
  });

  it('makes no extra grant call when consent is already on file', async () => {
    mockReadConsentState.mockResolvedValue('granted');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(mockReadConsentState).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('never re-grants a consent the user withdrew: no grant, no navigation, a panel pointing at Settings', async () => {
    mockReadConsentState.mockResolvedValue('withdrawn');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.title)).toBeTruthy());
    expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.body)).toBeTruthy();
    expect(mockGrantConsent).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalledWith('/capture/record');

    await act(async () => {
      fireEvent.press(view.getByText(Copy.sourcePicker.error.consentWithdrawn.cta));
    });
    expect(mockPush).toHaveBeenCalledWith('/settings');
  });

  it('holds Upload the same way after a withdrawal', async () => {
    mockReadConsentState.mockResolvedValue('withdrawn');
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-upload'));
    });

    await waitFor(() => expect(view.getByText(Copy.sourcePicker.error.consentWithdrawn.title)).toBeTruthy());
    expect(mockGrantConsent).not.toHaveBeenCalled();
    // The soft-ask panel is the next step of the upload flow; it must not have been reached.
    expect(view.queryByText(Copy.sourcePicker.permission.library.title)).toBeNull();
  });

  it('proceeds to Record even when the repair attempt itself fails (best-effort, not a gate)', async () => {
    mockReadConsentState.mockResolvedValue('none');
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
  });

  it('disables both cards while the consent read is in flight, so a double tap navigates once', async () => {
    let resolveRead: (state: 'granted') => void = () => undefined;
    mockReadConsentState.mockReturnValue(
      new Promise<'granted'>((resolve) => {
        resolveRead = resolve;
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
      resolveRead('granted');
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockReadConsentState).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('source-card-record').props.accessibilityState.disabled).toBe(false);
  });
});
