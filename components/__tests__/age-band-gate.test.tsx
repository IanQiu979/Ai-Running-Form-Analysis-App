/**
 * `components/age-band-gate.tsx` — the one-time age screen for an OAuth-created account. What the
 * wiring has to get right: who is gated (a Google account with no band; never an email account),
 * that the read fails CLOSED with a Retry, that Continue is keyed on a complete choice, that the
 * choice the user made is what `recordAgeBand` receives, and that the gate lifts on success and
 * on the server's write-once answer alike.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { Copy } from '@/constants/copy';
import { readAgeBand, recordAgeBand } from '@/lib/age-band';
import { FUTURE_UPLOADS_ATTESTATION_CONSENT, grantConsent, hasConsented, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';
import { signOut } from '@/lib/sign-out';

import { AgeBandGate } from '../age-band-gate';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);
// `jest.requireActual('@/lib/age-band')` below loads `lib/supabase`, which throws without env;
// the real client is never reached here (both network functions are replaced), so a bare stub does.
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() } } }));
jest.mock('@/lib/age-band', () => {
  const actual = jest.requireActual('@/lib/age-band');
  return {
    ...actual,
    readAgeBand: jest.fn(),
    recordAgeBand: jest.fn(),
  };
});
jest.mock('@/lib/sign-out', () => ({ signOut: jest.fn() }));
jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));
jest.mock('@/lib/consent', () => {
  const actual = jest.requireActual('@/lib/consent');
  return { ...actual, grantConsent: jest.fn(), hasConsented: jest.fn() };
});

let mockProvider: string = 'google';
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({
    session: { user: { id: 'u1', app_metadata: { provider: mockProvider } } },
  }),
}));

const mockRead = readAgeBand as jest.Mock;
const mockRecord = recordAgeBand as jest.Mock;
const mockSignOut = signOut as jest.Mock;
const mockGrantConsent = grantConsent as jest.Mock;
const mockHasConsented = hasConsented as jest.Mock;

/** The gate always wraps the signed-in surface; a labelled stand-in makes the a11y hiding visible. */
const Gate = () => (
  <AgeBandGate>
    <Text testID="tabs-stand-in">Home</Text>
  </AgeBandGate>
);

beforeEach(async () => {
  mockProvider = 'google';
  mockRead.mockReset();
  mockRecord.mockReset();
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue({ ok: true });
  mockGrantConsent.mockReset();
  mockGrantConsent.mockResolvedValue(undefined);
  mockHasConsented.mockReset();
  mockHasConsented.mockResolvedValue(false);
  // The per-device "answered" note lives in AsyncStorage (jest.setup.js's in-memory mock) and must
  // not leak between tests.
  await AsyncStorage.clear();
});

describe('AgeBandGate: who is gated', () => {
  it('renders nothing for an email account and never reads the profile', async () => {
    mockProvider = 'email';
    const view = await render(<Gate />);
    expect(view.queryByTestId('age-band-gate')).toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('renders nothing for a Google account whose band is already on file, and remembers that on this device', async () => {
    mockRead.mockResolvedValue('18_plus');
    const view = await render(<Gate />);
    await waitFor(() => expect(mockRead).toHaveBeenCalled());
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    await waitFor(async () => expect(await AsyncStorage.getItem('age-band.recorded.u1')).toBe('1'));
  });

  it('skips the network entirely once this device has seen the band recorded (no offline wall)', async () => {
    await AsyncStorage.setItem('age-band.recorded.u1', '1');
    mockRead.mockRejectedValue(new Error('offline'));
    const view = await render(<Gate />);
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    expect(mockRead).not.toHaveBeenCalled();
    expect(view.getByTestId('age-band-gate-content').props.importantForAccessibility).toBe('auto');
    expect(view.getByTestId('tabs-stand-in')).toBeTruthy();
  });

  it('is keyed per account: another user\'s note does not skip the check', async () => {
    await AsyncStorage.setItem('age-band.recorded.someone-else', '1');
    mockRead.mockResolvedValue(null);
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.title)).toBeTruthy());
  });

  it('covers the screen while checking, then asks a Google account with no band', async () => {
    let resolveRead: (band: string | null) => void = () => {};
    mockRead.mockReturnValue(new Promise((resolve) => { resolveRead = resolve; }));
    const view = await render(<Gate />);

    // Blank overlay, not nothing: Home must not be usable for a beat before the question lands —
    // and it is modal for assistive tech, with Sign out still reachable.
    expect(view.getByTestId('age-band-gate')).toBeTruthy();
    expect(view.getByTestId('age-band-gate').props.accessibilityViewIsModal).toBe(true);
    // RNTL's default queries exclude what `no-hide-descendants` hides — which is the point.
    expect(view.queryByTestId('tabs-stand-in')).toBeNull();
    expect(
      view.getByTestId('age-band-gate-content', { includeHiddenElements: true }).props.importantForAccessibility
    ).toBe('no-hide-descendants');
    expect(view.getByTestId('age-gate-sign-out')).toBeTruthy();
    expect(view.queryByText(Copy.auth.ageGate.title)).toBeNull();

    await act(async () => { resolveRead(null); });
    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.title)).toBeTruthy());
    expect(view.getByTestId('age-gate-18-plus')).toBeTruthy();
    expect(view.getByTestId('age-gate-13-17')).toBeTruthy();
    // Continue also writes the two consent rows (ticked on sign-in before the OAuth round trip),
    // so the screen says what confirming records — as a plain line, not another control.
    expect(view.getByText(Copy.auth.ageGate.consentReminder)).toBeTruthy();
    expect(view.getByTestId('age-gate-consent-reminder').props.accessibilityRole).toBeUndefined();
    expect(view.getByTestId('age-gate-consent-reminder').props.onPress).toBeUndefined();
  });

  it('fails closed on a read error, with Retry and Sign out', async () => {
    mockRead.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    const view = await render(<Gate />);

    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.error.load)).toBeTruthy());
    expect(view.queryByTestId('age-gate-18-plus')).toBeNull();
    expect(view.queryByTestId('age-gate-consent-reminder')).toBeNull();
    expect(view.getByTestId('age-gate-sign-out')).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-retry')); });
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});

describe('AgeBandGate: recording the choice', () => {
  beforeEach(() => {
    mockRead.mockResolvedValue(null);
  });

  it('keeps Continue disabled until the choice is complete, then records exactly that choice and lifts', async () => {
    mockRecord.mockResolvedValue({ ok: true, data: { ageBand: '13_17', guardianConsentRecorded: true } });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-13-17')).toBeTruthy());

    expect(view.getByTestId('age-gate-submit')).toBeDisabled();
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-13-17')); });
    await waitFor(() => expect(view.getByTestId('age-gate-guardian-consent')).toBeTruthy());
    expect(view.getByTestId('age-gate-submit')).toBeDisabled();
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-guardian-consent')); });
    await waitFor(() => expect(view.getByTestId('age-gate-submit')).toBeEnabled());

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith({ ageBand: '13_17', guardianConsent: true }));
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
  });

  it('records 18 or older with no attestation', async () => {
    mockRecord.mockResolvedValue({ ok: true, data: { ageBand: '18_plus', guardianConsentRecorded: false } });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await waitFor(() => expect(view.getByTestId('age-gate-submit')).toBeEnabled());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(mockRecord).toHaveBeenCalledWith({ ageBand: '18_plus', guardianConsent: false }));
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
  });

  it('grants both once-ever consents before the gate closes on a successful submit', async () => {
    mockRecord.mockResolvedValue({ ok: true, data: { ageBand: '18_plus', guardianConsentRecorded: false } });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT));
    expect(mockGrantConsent).toHaveBeenCalledWith(FUTURE_UPLOADS_ATTESTATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
  });

  it('does not close the gate when a consent grant fails after a successful age-band write', async () => {
    mockRecord.mockResolvedValue({ ok: true, data: { ageBand: '18_plus', guardianConsentRecorded: false } });
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.error.save)).toBeTruthy());
    expect(view.getByTestId('age-band-gate')).toBeTruthy();
    expect(view.queryByTestId('tabs-stand-in')).toBeNull();
  });

  it('on the server\'s write-once answer, grants consent (already missing) and lifts once granted', async () => {
    mockRecord.mockResolvedValue({ ok: false, code: 'age_band_already_recorded' });
    mockHasConsented.mockResolvedValue(false);
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });
    await waitFor(() => expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT));
    expect(mockGrantConsent).toHaveBeenCalledWith(FUTURE_UPLOADS_ATTESTATION_CONSENT);
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    expect(await AsyncStorage.getItem('age-band.recorded.u1')).toBe('1');
  });

  it('on the server\'s write-once answer, skips granting again when consent is already on file', async () => {
    mockRecord.mockResolvedValue({ ok: false, code: 'age_band_already_recorded' });
    mockHasConsented.mockResolvedValue(true);
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    expect(mockGrantConsent).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem('age-band.recorded.u1')).toBe('1');
  });

  it('does NOT close the gate on the write-once answer when consent is missing and the grant fails — this is issue #240, the silent lockout', async () => {
    mockRecord.mockResolvedValue({ ok: false, code: 'age_band_already_recorded' });
    mockHasConsented.mockResolvedValue(false);
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.error.save)).toBeTruthy());
    expect(view.getByTestId('age-band-gate')).toBeTruthy();
    expect(view.queryByTestId('tabs-stand-in')).toBeNull();
    expect(await AsyncStorage.getItem('age-band.recorded.u1')).not.toBe('1');
  });

  it('a successful write leaves the per-device note', async () => {
    mockRecord.mockResolvedValue({ ok: true, data: { ageBand: '18_plus', guardianConsentRecorded: false } });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    expect(await AsyncStorage.getItem('age-band.recorded.u1')).toBe('1');
  });

  it('stays up with a readable message when the write fails, and can be retried', async () => {
    mockRecord
      .mockResolvedValueOnce({ ok: false, code: 'network' })
      .mockResolvedValueOnce({ ok: true, data: { ageBand: '18_plus', guardianConsentRecorded: false } });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-18-plus')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-18-plus')); });
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });

    await waitFor(() => expect(view.getByText(Copy.auth.ageGate.error.save)).toBeTruthy());
    expect(view.getByTestId('age-band-gate')).toBeTruthy();

    await act(async () => { fireEvent.press(view.getByTestId('age-gate-submit')); });
    await waitFor(() => expect(view.queryByTestId('age-band-gate')).toBeNull());
    expect(mockRecord).toHaveBeenCalledTimes(2);
  });

  it('offers a way out: Sign out calls signOut', async () => {
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-sign-out')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-sign-out')); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('says so when Sign out did not go through (stillSignedIn), instead of a dead link', async () => {
    mockSignOut.mockResolvedValue({ ok: false, reason: 'stillSignedIn' });
    const view = await render(<Gate />);
    await waitFor(() => expect(view.getByTestId('age-gate-sign-out')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('age-gate-sign-out')); });
    await waitFor(() => expect(view.getByText(Copy.settings.signOutError.stillSignedIn.body)).toBeTruthy());
    expect(view.getByTestId('age-band-gate')).toBeTruthy();
    expect(view.getByTestId('age-gate-sign-out')).toBeEnabled();
  });
});
