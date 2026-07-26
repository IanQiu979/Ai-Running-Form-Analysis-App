/**
 * Regression lock for issue #147 — the infinite render loop ("Maximum update depth exceeded")
 * that crashed every photo/video submission.
 *
 * WHY THIS TEST EXISTS. `expo-router`'s `useLocalSearchParams()` returns a brand-new object
 * reference on every render (no memoization, by contract — see its own source). The bug was a
 * `useMemo` keyed on that whole `params` object: it recomputed every render, fed a fresh `media`
 * into the extraction effect, which called `setState` unconditionally, which re-rendered, which
 * got a fresh `params` object again — unbounded. Before this file, `app/capture/extracting.tsx`
 * had zero screen-level render coverage: `lib/__tests__/parse-capture-params.test.ts` only
 * unit-tests the pure parser, which can never see a reference-identity bug, because it never
 * renders anything twice. The bug class here is "reference identity across renders," which only
 * a real render — with a params mock that honestly reproduces expo-router's fresh-object-per-call
 * contract — can expose. A mock that returns the SAME object every call would pass even with the
 * old, broken `[params]` dependency, so it's the load-bearing part of this test, mirroring how
 * `lib/__tests__/scrollview-style-contract.test.ts` reproduces the exact real-world shape that
 * broke, rather than a convenient stand-in for it.
 *
 * `extractFrames` never resolves in this test (deliberately) — the render count must stay bounded
 * indefinitely while the screen sits in its "extracting" state, not just for a moment before a
 * promise settles and hides the loop.
 */
import { render } from '@testing-library/react-native';

import ExtractingScreen from '../extracting';

// react-native-safe-area-context wraps a native module; the package's own jest mock (used the
// same way its own README documents, and the same way components/__tests__/offline-banner.test.tsx
// already does) resolves useSafeAreaInsets()/SafeAreaView without requiring a real
// <SafeAreaProvider> ancestor under test.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

// Issue #128 made `lib/analyze-form.ts` a REAL edge-function client, so this screen's existing
// import of it now transitively pulls in `lib/functions-client.ts` -> `lib/supabase.ts`, which
// builds a client from `EXPO_PUBLIC_*` at import time and throws when they are unset (as they are
// under Jest). This screen never touches Supabase itself — it only mints an idempotency key and
// stages the request — so the module boundary is mocked rather than the env faked, matching
// `lib/__tests__/delete-account.test.ts` and `lib/__tests__/consent.test.ts`. Faking the env in
// `jest.setup.js` instead would hand every suite in the repo a real, half-configured client.
jest.mock('../../../lib/supabase', () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

let renderCount = 0;

// THE load-bearing mock: a fresh object literal every call, exactly like the real
// `useLocalSearchParams()` (node_modules/expo-router/build/hooks.js). Returning the same cached
// object here would make the old, buggy `useMemo(..., [params])` dependency look correct.
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => {
    renderCount += 1;
    return {
      mediaType: 'photo',
      uri: 'file:///fake/photo.jpg',
      width: '1080',
      height: '1920',
    };
  },
  useRouter: () => ({
    replace: jest.fn(),
    push: jest.fn(),
  }),
}));

// Never resolves: the screen must stay in its "extracting" state — and, critically, stay
// RENDER-BOUNDED while it does — for as long as extraction is in flight.
jest.mock('@/lib/frames', () => {
  const actual = jest.requireActual('@/lib/frames');
  return {
    ...actual,
    extractFrames: jest.fn(() => new Promise(() => {})),
  };
});

describe('ExtractingScreen (issue #147 render-loop regression)', () => {
  beforeEach(() => {
    renderCount = 0;
  });

  it('does not loop when useLocalSearchParams returns a fresh object every render', async () => {
    await render(<ExtractingScreen />);

    // A healthy mount calls useLocalSearchParams a small, bounded number of times (React may
    // render more than once — e.g. StrictMode-style double-invoke, or the initial "extracting"
    // state settling — but never runs away). The old bug called this dozens/hundreds of times
    // before "Maximum update depth exceeded" aborted the render tree; a generous fixed ceiling
    // here fails loudly on any regression of that bug class without being flaky about exactly how
    // many renders React itself performs for an unchanged input.
    expect(renderCount).toBeLessThan(10);
  });
});
