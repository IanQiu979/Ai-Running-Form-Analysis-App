import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

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

const FREE_EXHAUSTED = {
  tier: 'free',
  used: 1,
  limit: 1,
  remaining: 0,
  frameCap: 1,
  isLifetime: true,
  periodStart: null,
  periodEnd: null,
  blocked: false,
  blockedReason: null,
  blockedUntil: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetQuotaStatus.mockResolvedValue({ ok: true, data: FREE_EXHAUSTED });
});

describe('PaywallScreen plan promises', () => {
  it('shows a Free user the exact paid limits and only supported upgrade capabilities', async () => {
    await render(<PaywallScreen />);

    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    // Issue #89 (2026-09-19): Free video runs the same stride burst as Pro, so the free row no
    // longer sells "a single photo or frame". Still one analysis, still no flags or drills.
    expect(screen.getByText(/^One analysis, from a photo or a short video\. No injury-risk flags or drills\.$/)).toBeTruthy();
    expect(screen.queryByText(/single photo or frame/i)).toBeNull();
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

// V23-11's two artboards: Gated (Free exhausted — gate card, Free "Current plan", two upgrades)
// and Voluntary (Pro current — no gate card, Pro "Current plan", Free with NO control, one
// upgrade). The screen derives all of it from the fresh quota read, never from a route param.
describe('PaywallScreen artboards', () => {
  it('Gated: gate card, Free is the current plan, Pro and Elite offer upgrades', async () => {
    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    expect(screen.getByRole('header', { name: 'Choose a plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getAllByText('Current plan')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upgrade to Elite' })).toBeTruthy();
    expect(screen.getByText('Elite adds detail and comparison, not a different analysis.')).toBeTruthy();
  });

  it('Voluntary: no gate card, Pro is the current plan, Free carries no control', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      ok: true,
      data: {
        ...FREE_EXHAUSTED,
        tier: 'pro',
        used: 2,
        limit: 10,
        remaining: 8,
        isLifetime: false,
        periodStart: '2026-09-01T00:00:00Z',
        periodEnd: '2026-10-01T00:00:00Z',
      },
    });

    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getAllByText('Current plan')).toHaveLength(1));

    expect(screen.queryByText('Free analysis used')).toBeNull();
    expect(screen.queryByText('No analyses remaining this period')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Upgrade to Elite' })).toBeTruthy();
    // The one selected card is Pro; Free is a plain raised card with nothing under its detail.
    expect(screen.getByTestId('paywall-tier-pro')).toBeTruthy();
    expect(screen.getByTestId('paywall-tier-free')).toBeTruthy();
  });
});

// Captain's 2026-09-20 polish pass, item 5: "current plan on top" — the confirmed tier's card
// renders first, the other two follow in their usual order, and the mark count stays pinned to
// the tier itself rather than to the render position.
describe('PaywallScreen tier ordering (current plan first)', () => {
  function orderedTierIds() {
    return screen.getAllByTestId(/^paywall-tier-/).map((node) => node.props.testID);
  }

  it('Free is current: free, pro, elite — the plain ladder order', async () => {
    mockGetQuotaStatus.mockResolvedValue({ ok: true, data: FREE_EXHAUSTED });
    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    expect(orderedTierIds()).toEqual(['paywall-tier-free', 'paywall-tier-pro', 'paywall-tier-elite']);
  });

  it('Pro is current: pro leads, then free, then elite', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      ok: true,
      data: {
        ...FREE_EXHAUSTED,
        tier: 'pro',
        used: 2,
        limit: 10,
        remaining: 8,
        isLifetime: false,
        periodStart: '2026-09-01T00:00:00Z',
        periodEnd: '2026-10-01T00:00:00Z',
      },
    });
    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getAllByText('Current plan')).toHaveLength(1));

    expect(orderedTierIds()).toEqual(['paywall-tier-pro', 'paywall-tier-free', 'paywall-tier-elite']);
  });

  it('Elite is current: elite leads, then free, then pro', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      ok: true,
      data: {
        ...FREE_EXHAUSTED,
        tier: 'elite',
        used: 2,
        limit: 30,
        remaining: 28,
        isLifetime: false,
        periodStart: '2026-09-01T00:00:00Z',
        periodEnd: '2026-10-01T00:00:00Z',
      },
    });
    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getAllByText('Current plan')).toHaveLength(1));

    expect(orderedTierIds()).toEqual(['paywall-tier-elite', 'paywall-tier-free', 'paywall-tier-pro']);
    // Elite's own upgrade path (Pro) stays suppressed regardless of where its card renders.
    expect(screen.queryByRole('button', { name: 'Upgrade to Pro' })).toBeNull();
  });
});

describe('PaywallScreen artboards', () => {
  it('shows a quiet loading row until the plan read resolves, then removes it', async () => {
    let resolvePlan: (value: unknown) => void = () => {};
    mockGetQuotaStatus.mockReturnValue(
      new Promise((resolve) => {
        resolvePlan = resolve;
      })
    );

    await render(<PaywallScreen />);
    expect(screen.getByTestId('paywall-plan-loading')).toBeTruthy();
    expect(screen.getByText('Checking plan…')).toBeTruthy();

    await act(async () => {
      resolvePlan({ ok: true, data: FREE_EXHAUSTED });
    });
    expect(screen.queryByTestId('paywall-plan-loading')).toBeNull();
  });

  it('offers a Retry when the plan read fails, and re-reads on press', async () => {
    mockGetQuotaStatus.mockResolvedValueOnce({ ok: false, error: { code: 'unknown', message: 'x' } });

    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByText('Plan could not be loaded.')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());
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

    // Nothing is up before the press.
    expect(screen.queryByTestId('paywall-notice-card')).toBeNull();

    // Same `act` wrap app/__tests__/analyzing.test.tsx uses: the press starts an async purchase
    // whose settling setState would otherwise land outside React's act() scope.
    await act(async () => {
      fireEvent.press(screen.getByText('Upgrade to Pro'));
    });

    expect(mockPurchaseTier).toHaveBeenCalledWith('pro');

    // The result is the page's one-button dialog, not a native alert.
    expect(screen.getByRole('header', { name: 'Upgrades are not available yet' })).toBeTruthy();
    const body = screen.getByText(
      'Purchasing a plan is not yet supported. Your plan has not changed, and you were not charged.'
    );
    // The two claims the old copy made that were false: it is not the build, and it will not
    // clear on its own.
    expect(body.props.children).not.toMatch(/build/i);
    expect(body.props.children).not.toMatch(/check back/i);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();

    // A refused purchase never re-reads the plan — there is nothing new to read — and the CTA
    // must come back so the screen isn't stuck "Upgrading…".
    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Upgrade to Pro')).toBeTruthy();

    // OK dismisses it.
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'OK' }));
    });
    expect(screen.queryByRole('header', { name: 'Upgrades are not available yet' })).toBeNull();
  });
});

describe('PaywallScreen purchase success', () => {
  it('reports the new plan in a dialog and re-reads the plan from the server', async () => {
    mockPurchaseTier.mockResolvedValue({
      ok: true,
      data: { tier: 'pro', periodStart: '2026-09-01T00:00:00Z', periodEnd: '2026-10-01T00:00:00Z' },
    });

    await render(<PaywallScreen />);
    await waitFor(() => expect(screen.getByText('Free analysis used')).toBeTruthy());

    await act(async () => {
      fireEvent.press(screen.getByText('Upgrade to Pro'));
    });

    expect(screen.getByRole('header', { name: 'Upgraded to Pro' })).toBeTruthy();
    expect(screen.getByText('Your new plan is active.')).toBeTruthy();
    // Success re-derives the true state from the server rather than trusting the purchase body.
    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2);
  });
});
