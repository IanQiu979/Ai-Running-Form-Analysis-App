/**
 * Screen-level coverage for `app/result/sample.tsx` — Free tier's zero-model-call labeled preview
 * (captain-approved 2026-07-26). The load-bearing behavior here is the honesty labeling itself:
 * this is the App Store policy / refund-dispute control the whole feature exists for, so a
 * regression that silently drops or waters down the sample banner is exactly the class of bug a
 * screen-level test — not just a component/unit test — is positioned to catch (it proves the
 * banner actually renders on the real navigated-to screen, not just that the component works in
 * isolation).
 */
import { render, screen, fireEvent } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return {
    useRouter: () => ({ replace: mockReplace, push: mockPush }),
    // H4 (v23-ux-audit-r1): the real bail-out is now a declarative <Redirect>, not a
    // mount-effect router.replace — stub it as a plain, queryable marker rather than a no-op so
    // the test below can assert on it without reaching into expo-router's real navigator.
    Redirect: ({ href }: { href: string }) => createElement(Text, { testID: 'redirect-to-home' }, href),
  };
});

const mockTakePendingSampleResult = jest.fn();
jest.mock('@/lib/pending-sample-result', () => ({
  takePendingSampleResult: () => mockTakePendingSampleResult(),
}));

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import SampleResultScreen from '../sample';

beforeEach(() => {
  jest.clearAllMocks();
});

const samplePayload = {
  result: jest.requireActual('@/lib/pace-fixtures').proTierVideoResult,
  heroDataUri: 'data:image/jpeg;base64,AAAA',
};

describe('SampleResultScreen', () => {
  it('bails to Home when nothing is staged in the mailbox (a direct/cold navigation)', async () => {
    mockTakePendingSampleResult.mockReturnValue(null);

    await render(<SampleResultScreen />);

    // H4 (v23-ux-audit-r1): a declarative <Redirect href="/" />, not a mount-effect
    // router.replace — the effect version throws on a cold start/deep link, before the root
    // navigator has mounted.
    expect(screen.getByTestId('redirect-to-home')).toHaveTextContent('/');
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('renders the sample banner, never as if it were a real personalized result', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    expect(screen.getByTestId('sample-result-banner')).toBeTruthy();
    expect(screen.getByText(Copy.result.sample.banner.title)).toBeTruthy();
    expect(screen.getByText(Copy.result.sample.banner.body)).toBeTruthy();
  });

  it('renders the PACE readout for the staged sample result', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    expect(screen.getByTestId('sample-readout-card')).toBeTruthy();
  });

  it('renders the user\'s own photo as the hero image', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    expect(screen.getByTestId('sample-hero-image')).toBeTruthy();
  });

  it('the upgrade CTA, adjacent to the banner, navigates to the paywall', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    fireEvent.press(screen.getByTestId('sample-banner-upgrade'));

    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });

  it('"Back to Home" returns to Home', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    fireEvent.press(screen.getByTestId('sample-done'));

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('the terminal CTA is the upgrade, not "Back to Home" (M10, v23-ux-audit-r1)', async () => {
    mockTakePendingSampleResult.mockReturnValue(samplePayload);

    await render(<SampleResultScreen />);

    expect(screen.getByText(Copy.result.sample.cta.terminalUpgrade)).toBeTruthy();
    fireEvent.press(screen.getByTestId('sample-upgrade'));

    expect(mockPush).toHaveBeenCalledWith('/paywall');
  });
});
