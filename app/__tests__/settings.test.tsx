/**
 * V23-12 · Settings — structural locks for the re-themed screen (2026-09-14): the three sections'
 * row grammar (label left, value or action right), the Plan card's three rows off one live
 * `QuotaStatus`, and that every confirmation and notice now opens the page's `<ConfirmDialog>`
 * rather than a native `Alert`. Behaviour is asserted through the libs the screen calls
 * (`signOut`, `deleteAccountClient.submit`, `withdrawConsent`), which are mocked the way
 * `paywall.test.tsx` mocks its own.
 *
 * Every press is wrapped in an awaited `act` (CLAUDE.md § Testing): two bare `fireEvent.press`
 * calls in one test leave an act scope open and the NEXT test renders an empty tree.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockRouter = { back: jest.fn(), push: jest.fn() };
jest.mock('expo-router', () => ({
  // Read lazily: the factory runs at the hoisted import, before `mockRouter` is initialised.
  router: {
    back: (...args: unknown[]) => mockRouter.back(...args),
    push: (...args: unknown[]) => mockRouter.push(...args),
  },
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));

// `lib/quota` is real (its `describeQuota` is the caption under test); only the Supabase client
// beneath its edge-function wrapper is stubbed so the module loads without an env.
jest.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() }, from: jest.fn(), storage: { from: jest.fn() } },
}));

const mockSession = { user: { id: 'user-1', email: 'ian@example.com' } };
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: mockSession }),
}));

const mockGetQuotaStatus = jest.fn();
jest.mock('@/lib/subscription', () => ({
  getQuotaStatus: (...args: unknown[]) => mockGetQuotaStatus(...args),
  formatRenewalDate: jest.fn(() => 'Oct 12, 2026'),
}));

const mockHasConsented = jest.fn();
const mockWithdrawConsent = jest.fn();
jest.mock('@/lib/consent', () => ({
  UPLOAD_HEALTH_CONSENT: 'upload.health.v1',
  hasConsented: (...args: unknown[]) => mockHasConsented(...args),
  withdrawConsent: (...args: unknown[]) => mockWithdrawConsent(...args),
}));

const mockSignOut = jest.fn();
jest.mock('@/lib/sign-out', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const mockSubmitDelete = jest.fn();
const mockGetReauthProvider = jest.fn();
const mockReauthWithGoogle = jest.fn();
const mockReauthWithPassword = jest.fn();
jest.mock('@/lib/delete-account', () => ({
  deleteAccountClient: { submit: (...args: unknown[]) => mockSubmitDelete(...args) },
  getReauthProvider: (...args: unknown[]) => mockGetReauthProvider(...args),
  reauthenticateWithGoogle: (...args: unknown[]) => mockReauthWithGoogle(...args),
  reauthenticateWithPassword: (...args: unknown[]) => mockReauthWithPassword(...args),
}));

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import SettingsScreen from '../settings';
// eslint-disable-next-line import/first
import { PRIVACY_POLICY_URL } from '@/constants/links';
// eslint-disable-next-line import/first
import { Ink } from '@/constants/v23-theme';

const PRO_QUOTA = {
  tier: 'pro',
  used: 2,
  limit: 5,
  remaining: 3,
  frameCap: 6,
  isLifetime: false,
  periodStart: '2026-09-12T00:00:00Z',
  periodEnd: '2026-10-12T00:00:00Z',
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

const FREE_QUOTA = {
  ...PRO_QUOTA,
  tier: 'free',
  used: 0,
  limit: 1,
  remaining: 1,
  frameCap: 1,
  isLifetime: true,
  periodStart: null,
  periodEnd: null,
};

async function renderSettled() {
  await render(<SettingsScreen />);
  await waitFor(() => expect(screen.queryByTestId('settings-plan-loading')).toBeNull());
  await waitFor(() => expect(screen.queryByTestId('settings-consent-loading')).toBeNull());
}

const press = async (node: ReturnType<typeof screen.getByText>) => {
  await act(async () => {
    fireEvent.press(node);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetQuotaStatus.mockResolvedValue({ ok: true, data: PRO_QUOTA });
  mockHasConsented.mockResolvedValue(true);
  mockWithdrawConsent.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue({ ok: true });
  mockSubmitDelete.mockResolvedValue({ ok: false, error: { error: 'x', code: 'unknown' } });
  mockGetReauthProvider.mockReturnValue('password');
});

describe('SettingsScreen rows (V23-12)', () => {
  it('draws the top bar and the three labelled sections', async () => {
    await renderSettled();

    expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Account' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Privacy' })).toBeTruthy();
  });

  it('Account: the email as a value, and Sign out as both a row label and its action', async () => {
    await renderSettled();

    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.getByText('ian@example.com')).toBeTruthy();
    // The page shows the word twice: the row's label and the action on its right.
    expect(screen.getAllByText('Sign out')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });

  it('Plan (paid): tier → quota caption, Renews → date, See plans → action', async () => {
    await renderSettled();

    expect(screen.getByText('Pro')).toBeTruthy();
    expect(screen.getByText('3 of 5 analyses remaining this period')).toBeTruthy();
    expect(screen.getByText('Renews')).toBeTruthy();
    expect(screen.getByText('Oct 12, 2026')).toBeTruthy();
    expect(screen.getAllByText('See plans')).toHaveLength(2);

    await press(screen.getByRole('button', { name: 'See plans' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/paywall');
  });

  it('Plan (Free): no Renews row — a lifetime plan has no renewal', async () => {
    mockGetQuotaStatus.mockResolvedValue({ ok: true, data: FREE_QUOTA });
    await renderSettled();

    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('1 free analysis available')).toBeTruthy();
    expect(screen.queryByText('Renews')).toBeNull();
    expect(screen.getByRole('button', { name: 'See plans' })).toBeTruthy();
  });

  it('Plan: a loading row while the read is in flight, then a Retry row when it fails', async () => {
    let resolvePlan: (value: unknown) => void = () => {};
    mockGetQuotaStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePlan = resolve;
      })
    );

    await render(<SettingsScreen />);
    expect(screen.getByTestId('settings-plan-loading')).toBeTruthy();
    expect(screen.getByText('Checking plan…')).toBeTruthy();

    await act(async () => {
      resolvePlan({ ok: false, error: { code: 'unknown', message: 'x' } });
    });
    expect(screen.getByText('Plan could not be loaded.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Retry loading plan' }));
    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('3 of 5 analyses remaining this period')).toBeTruthy());
  });

  it('Privacy: the one summary line, the Consent row with its action, and the policy link row', async () => {
    await renderSettled();

    expect(screen.getByText(
        'Frames are processed by Anthropic to produce your feedback, the original video never leaves your device, and frames are stored privately until you delete them.',
      )).toBeTruthy();
    expect(screen.getByText('Consent')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw consent' })).toBeTruthy();
    // Not on the page, but a live disclosure: one more row, and the whole row is the link.
    expect(screen.getByRole('link', { name: 'Full privacy policy' })).toBeTruthy();
    expect(screen.queryByText(/not yet published/)).toBeNull();
  });

  it('Privacy: the policy row opens the published policy URL (issue #202)', async () => {
    // React Native's jest mock of `Linking.openURL` returns undefined; the real one is a Promise.
    jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await renderSettled();

    await press(screen.getByRole('link', { name: 'Full privacy policy' }));
    expect(Linking.openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it('Privacy: a withdrawn consent reads as a value, with no action', async () => {
    mockHasConsented.mockResolvedValue(false);
    await renderSettled();

    expect(screen.queryByRole('button', { name: 'Withdraw consent' })).toBeNull();
    expect(screen.getByText(/^You have not consented to health-related analysis/)).toBeTruthy();
  });

  it('Privacy: a failed consent read offers its own Retry', async () => {
    mockHasConsented.mockRejectedValueOnce(new Error('offline'));
    await renderSettled();

    expect(screen.getByText('Consent status could not be loaded.')).toBeTruthy();
    await press(screen.getByRole('button', { name: 'Retry loading consent status' }));
    expect(mockHasConsented).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Withdraw consent' })).toBeTruthy());
  });

  it('ends with the ruled danger Delete account control', async () => {
    await renderSettled();
    const button = screen.getByRole('button', { name: 'Delete account' });
    const style = StyleSheet.flatten(button.props.style);
    expect(style.borderColor).toBe(Ink.danger);
    expect(style.marginTop).toBe('auto');
  });
});

describe('SettingsScreen dialogs (every Alert is now a <ConfirmDialog>)', () => {
  it('Sign out: opens the confirm, Cancel closes it, the primary signs out', async () => {
    await renderSettled();
    expect(screen.queryByRole('header', { name: 'Sign out?' })).toBeNull();

    await press(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('header', { name: 'Sign out?' })).toBeTruthy();
    expect(screen.getByText('You can sign in again at any time.')).toBeTruthy();
    // The primary is the accent fill — signing out is not destructive.
    expect(StyleSheet.flatten(screen.getByTestId('settings-dialog-primary').props.style).backgroundColor).toBe(
      Ink.accent
    );

    await press(screen.getByTestId('settings-dialog-secondary'));
    expect(screen.queryByRole('header', { name: 'Sign out?' })).toBeNull();
    expect(mockSignOut).not.toHaveBeenCalled();

    await press(screen.getByRole('button', { name: 'Sign out' }));
    await press(screen.getByTestId('settings-dialog-primary'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('header', { name: 'Sign out?' })).toBeNull();
  });

  it('Sign out (stillSignedIn): a two-button notice whose primary retries', async () => {
    mockSignOut.mockResolvedValue({ ok: false, reason: 'stillSignedIn' });
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Sign out' }));
    await press(screen.getByTestId('settings-dialog-primary'));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('header', { name: 'Still signed in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Try again' }));
    expect(mockSignOut).toHaveBeenCalledTimes(2);
  });

  it('Delete account: a danger confirm; the primary submits; a failure becomes a one-button notice', async () => {
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByRole('header', { name: 'Delete your account?' })).toBeTruthy();
    expect(
      screen.getByText(
        'This permanently deletes your account, every analysis and every stored frame. This cannot be undone.'
      )
    ).toBeTruthy();
    const primary = screen.getByRole('button', { name: 'Delete account and data' });
    expect(StyleSheet.flatten(primary.props.style).backgroundColor).toBe(Ink.danger);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();

    await press(primary);
    expect(mockSubmitDelete).toHaveBeenCalledTimes(1);

    // `code: 'unknown'` → the generic, retryable notice, with OK as its only button.
    expect(screen.getByRole('header', { name: 'Account could not be deleted' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    await press(screen.getByRole('button', { name: 'OK' }));
    expect(screen.queryByRole('header', { name: 'Account could not be deleted' })).toBeNull();
    // The control is back to idle.
    expect(screen.queryByTestId('settings-delete-busy')).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete account' }).props.accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
  });

  it('Delete account (Google reauth): the prompt is a dialog, and Cancel resets the busy state', async () => {
    mockSubmitDelete.mockResolvedValue({ ok: false, error: { error: 'x', code: 'reauth_required' } });
    mockGetReauthProvider.mockReturnValue('google');
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Delete account' }));
    await press(screen.getByRole('button', { name: 'Delete account and data' }));

    expect(screen.getByRole('header', { name: 'Confirm your identity' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeTruthy();
    // `isDeleting` stays true through the detour — the delete control is busy underneath.
    expect(screen.getByTestId('settings-delete-busy')).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockReauthWithGoogle).not.toHaveBeenCalled();
    expect(screen.queryByTestId('settings-delete-busy')).toBeNull();
  });

  it('Delete account (password reauth): opens the password modal, whose Cancel resets the busy state', async () => {
    mockSubmitDelete.mockResolvedValue({ ok: false, error: { error: 'x', code: 'reauth_required' } });
    mockGetReauthProvider.mockReturnValue('password');
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Delete account' }));
    await press(screen.getByRole('button', { name: 'Delete account and data' }));

    expect(screen.getByRole('header', { name: 'Confirm your identity' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm and delete' })).toBeTruthy();

    await press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByTestId('settings-delete-busy')).toBeNull();
  });

  it('Withdraw consent: a danger confirm; the primary withdraws and the row flips to the withdrawn value', async () => {
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Withdraw consent' }));
    expect(screen.getByRole('header', { name: 'Withdraw consent?' })).toBeTruthy();
    const primary = screen.getByTestId('settings-dialog-primary');
    expect(StyleSheet.flatten(primary.props.style).backgroundColor).toBe(Ink.danger);

    await press(primary);
    expect(mockWithdrawConsent).toHaveBeenCalledWith('upload.health.v1');
    expect(screen.queryByRole('button', { name: 'Withdraw consent' })).toBeNull();
    expect(screen.getByText(/^You have not consented to health-related analysis/)).toBeTruthy();
  });

  it('Withdraw consent (failure): says nothing changed, and keeps the action', async () => {
    mockWithdrawConsent.mockRejectedValue(new Error('offline'));
    await renderSettled();

    await press(screen.getByRole('button', { name: 'Withdraw consent' }));
    await press(screen.getByTestId('settings-dialog-primary'));

    expect(screen.getByRole('header', { name: 'Consent could not be withdrawn' })).toBeTruthy();
    await press(screen.getByRole('button', { name: 'OK' }));
    expect(screen.getByRole('button', { name: 'Withdraw consent' })).toBeTruthy();
  });
});
