/**
 * Screen-level coverage for `app/result/sample.tsx` — Free tier's zero-model-call labeled preview
 * (captain-approved 2026-07-26). The load-bearing behavior here is the honesty labeling itself:
 * this is the App Store policy / refund-dispute control the whole feature exists for, so a
 * regression that silently drops or waters down the sample banner is exactly the class of bug a
 * screen-level test — not just a component/unit test — is positioned to catch (it proves the
 * banner actually renders on the real navigated-to screen, not just that the component works in
 * isolation).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

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

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
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
});
