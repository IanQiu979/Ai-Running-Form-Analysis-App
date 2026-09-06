import { render, screen, waitFor } from '@testing-library/react-native';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));

const mockGetQuotaStatus = jest.fn();
jest.mock('@/lib/subscription', () => ({
  getQuotaStatus: (...args: unknown[]) => mockGetQuotaStatus(...args),
  purchaseTier: jest.fn(),
  formatRenewalDate: jest.fn(() => 'Oct 1, 2026'),
}));

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import PaywallScreen from '../paywall';

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

    await waitFor(() => expect(screen.getByText("You've used your free analysis")).toBeTruthy());

    expect(screen.getByText(/1 real analysis/i)).toBeTruthy();
    expect(
      screen.getByText(
        '10 analyses per period, plus multi-frame evidence when your footage supports it — certified injury-risk flags and drills when supported.'
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        '30 analyses per period. Everything in Pro, plus deeper feedback per pillar and a side-by-side comparison with your past analyses.'
      )
    ).toBeTruthy();

    expect(screen.queryByText(/full 4-pillar read/i)).toBeNull();
    expect(screen.queryByText(/unlocks cadence and elasticity/i)).toBeNull();
  });
});
