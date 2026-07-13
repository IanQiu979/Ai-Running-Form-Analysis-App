/**
 * Regression locks for `components/offline-banner.tsx` (issue #93) — the deck's rule that this
 * is a persistent NOTICE, never a gate, and that it renders nothing at all while online (issue
 * #93's "never claim a state that isn't true" applies just as much to a banner that's stuck
 * showing after connectivity comes back as it does to false "saved" copy).
 */
import { render, screen } from '@testing-library/react-native';

import { OfflineBanner } from '../offline-banner';
import { Copy } from '@/constants/copy';
import { useIsOffline } from '@/lib/connectivity';

// react-native-safe-area-context wraps a native module; the package's own jest mock (used the
// same way its own README documents) resolves useSafeAreaInsets() to a fixed zeroed inset
// instead of requiring a real <SafeAreaProvider> ancestor under test.
jest.mock('react-native-safe-area-context', () =>
  // A `jest.mock` factory is hoisted above this file's imports (babel-plugin-jest-hoist), so an
  // ordinary top-level `import` here can't safely feed it — `require` inside the factory itself
  // is the pattern the library's own docs and RTL's own test suite use for this exact mock.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

jest.mock('@/lib/connectivity', () => ({
  useIsOffline: jest.fn(),
}));

const mockUseIsOffline = useIsOffline as jest.MockedFunction<typeof useIsOffline>;

describe('OfflineBanner', () => {
  afterEach(() => {
    mockUseIsOffline.mockReset();
  });

  it('renders nothing while online', async () => {
    mockUseIsOffline.mockReturnValue(false);

    await render(<OfflineBanner />);

    expect(screen.queryByTestId('offline-banner-text')).toBeNull();
  });

  it('renders the deck banner string verbatim while offline', async () => {
    mockUseIsOffline.mockReturnValue(true);

    await render(<OfflineBanner />);

    expect(screen.getByTestId('offline-banner-text').props.children).toBe(Copy.offline.banner);
  });

  it('never claims capture/upload is blocked outright — the copy says capture still works', async () => {
    mockUseIsOffline.mockReturnValue(true);

    await render(<OfflineBanner />);

    expect(Copy.offline.banner).toContain('capture still works');
  });

  it('is announced to screen readers as a live region, not a silent visual-only change', async () => {
    mockUseIsOffline.mockReturnValue(true);

    await render(<OfflineBanner />);

    expect(screen.getByTestId('offline-banner-text').props.accessibilityLiveRegion).toBe('polite');
  });
});
