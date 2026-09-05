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
  it('describes only supported upgrades from the genuine Free analysis', async () => {
    await render(<PaywallScreen />);

    await waitFor(() => expect(screen.getByText("You've used your free analysis")).toBeTruthy());

    expect(screen.getByText(/1 real analysis/i)).toBeTruthy();
    expect(screen.getByText(/additional analyses/i)).toBeTruthy();
    expect(screen.getByText(/multi-frame evidence when (?:your )?footage supports it/i)).toBeTruthy();
    expect(screen.getByText(/certified.*flags.*drills.*when supported/i)).toBeTruthy();
    expect(screen.getByText(/deeper feedback.*side-by-side comparison.*past analyses/i)).toBeTruthy();

    expect(screen.queryByText(/full 4-pillar read/i)).toBeNull();
    expect(screen.queryByText(/unlocks cadence and elasticity/i)).toBeNull();
  });
});
