import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));

const mockGetQuotaStatus = jest.fn();
const mockPurchaseTier = jest.fn();
jest.mock('@/lib/subscription', () => ({
  getQuotaStatus: (...args: unknown[]) => mockGetQuotaStatus(...args),
  purchaseTier: (...args: unknown[]) => mockPurchaseTier(...args),
  formatRenewalDate: jest.fn(() => 'Oct 1, 2026'),
}));

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import PaywallScreen from '../paywall';

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetQuotaStatus.mockResolvedValue({
    ok: true,
    data: {
      tier: 'free',
      used: 1,
      limit: 1,
      remaining: 0,
      frameCap: 1,
      unlimited: false,
      isLifetime: true,
      periodStart: null,
      periodEnd: null,
      blocked: false,
      blockedReason: null,
      blockedUntil: null,
    },
  });
});

describe('PaywallScreen plan promises', () => {
  it('shows a Free user the exact paid limits and only supported upgrade capabilities', async () => {
    await render(<PaywallScreen />);

    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    expect(screen.getByText(/^One analysis, from a single photo or frame/i)).toBeTruthy();
    expect(
      screen.getByText(
        '10 analyses per period. Multi-frame evidence where footage supports it. Certified injury-risk flags and drills where supported.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        '30 analyses per period. Everything in Pro, plus deeper per-pillar feedback and side-by-side comparison of past analyses.'
      )
    ).toBeTruthy();

    expect(screen.queryByText(/full 4-pillar read/i)).toBeNull();
    expect(screen.queryByText(/unlocks cadence and elasticity/i)).toBeNull();
  });
});

// v23 user-audit 2026-09-12: tapping a paid plan surfaced "This build can't complete an upgrade
// right now. Check back soon." — copy that blamed the build and promised the state would clear on
// its own. Neither is true. There is NO in-app purchase in this app (no StoreKit/RevenueCat
// module exists); the CTA calls the dummy `purchase-tier` self-grant endpoint, which the captain
// deliberately disabled on the live project on 2026-08-06 (`docs/status.md` Known Issue #21),
// so it answers `404 not_found` from EVERY build — Expo Go, dev build, or TestFlight alike.
// This locks the honest copy for that state: it names the real outcome (nothing was bought, the
// plan is unchanged) and does not blame the build or promise a retry will succeed.
describe('PaywallScreen purchase unavailable (purchase-tier gate off)', () => {
  it('tells the user paid plans cannot be bought yet, without blaming the build', async () => {
    mockPurchaseTier.mockResolvedValue({
      ok: false,
      error: {
        code: 'not_found',
        message: 'purchase-tier is not available (deployment gate off, caller not allowlisted, or not deployed).',
      },
    });

    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    // Same `act` wrap app/__tests__/analyzing.test.tsx uses: the press starts an async purchase
    // whose settling setState would otherwise land outside React's act() scope.
    await act(async () => {
      fireEvent.press(screen.getByText('Upgrade to Pro'));
    });

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(mockPurchaseTier).toHaveBeenCalledWith('pro');

    const [title, body] = alertSpy.mock.calls[0] as [string, string];
    expect(title).toBe('Upgrades are not available yet');
    expect(body).toBe(
      'Purchasing a plan is not yet supported. Your plan has not changed, and you were not charged.'
    );
    // The two claims the old copy made that were false: it is not the build, and it will not
    // clear on its own.
    expect(body).not.toMatch(/build/i);
    expect(body).not.toMatch(/check back/i);

    // A refused purchase never re-reads the plan — there is nothing new to read — and the CTA
    // must come back so the screen isn't stuck "Upgrading…".
    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Upgrade to Pro')).toBeTruthy();
  });
});
