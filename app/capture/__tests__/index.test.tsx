/**
 * `app/capture/index.tsx`'s consent self-heal (2026-09-20). There is deliberately no consent gate
 * at capture — Upload/Record are never blocked on it — but the post-signup grants in
 * `app/(auth)/sign-in.tsx` are fire-and-forget, and this screen is the one place with no retry
 * mechanism at all until this change. What has to be true: `hasConsented` is checked before either
 * action fires, a missing grant is repaired before proceeding, and an already-granted account pays
 * no extra round trip.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { FUTURE_UPLOADS_ATTESTATION_CONSENT, grantConsent, hasConsented, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';

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
  return { ...actual, hasConsented: jest.fn(), grantConsent: jest.fn() };
});

const mockHasConsented = hasConsented as jest.Mock;
const mockGrantConsent = grantConsent as jest.Mock;

beforeEach(() => {
  mockPush.mockReset();
  mockHasConsented.mockReset();
  mockGrantConsent.mockReset();
  mockGrantConsent.mockResolvedValue(undefined);
});

describe('SourcePickerScreen: consent self-heal', () => {
  it('repairs a missing consent grant before navigating to Record', async () => {
    mockHasConsented.mockResolvedValue(false);
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
    mockHasConsented.mockResolvedValue(true);
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
    expect(mockHasConsented).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('proceeds to Record even when the repair attempt itself fails (best-effort, not a gate)', async () => {
    mockHasConsented.mockResolvedValue(false);
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const view = await render(<SourcePickerScreen />);

    await act(async () => {
      fireEvent.press(view.getByTestId('source-card-record'));
    });

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/capture/record'));
  });
});
