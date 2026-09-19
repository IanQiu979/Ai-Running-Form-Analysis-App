/**
 * Issue #89 (decided 2026-09-19), at the level that can see the headline: the result screen.
 *
 * Before the decision every free trial was a single still, so `countAssessedPillars` came back 2
 * and `<PartialResultBanner>` — "Partial read" — was the first thing a Free runner read after
 * their one lifetime analysis. Now a Free VIDEO extracts Pro's 5-frame stride burst and the server
 * delivers all four pillars scored (flags/drills stripped), so the banner must not appear. A Free
 * PHOTO is still one frame, still 2 of 4, and must keep the honest banner and the honest
 * "Requires video" line on the two motion pillars.
 *
 * The screen gates the banner on the assessed-pillar COUNT, not on tier or on `isFallback`
 * (`components/partial-result-banner.tsx`), so these tests drive it with the two fixtures the
 * server would deliver and assert what is drawn. Same harness as `handoff.test.tsx`: the just-
 * analyzed handoff, with a row lookup that finds nothing, so nothing here depends on Supabase.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { formatPartialBannerBody } from '@/lib/pace-readout';
import { freeTierVideoResult, photoResult } from '@/lib/pace-fixtures';
import { setPendingAnalysisResult } from '@/lib/pending-analysis-result';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const ANALYSIS_ID = 'd4c1b7a2-5f63-4e0a-9b21-7c8e2f1a3b45';

let mockRouteParams: Record<string, string> = { id: ANALYSIS_ID, justAnalyzed: '1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));

type RowFetch = { data: null; error: { message: string } | null };
const mockMaybeSingle = jest.fn<Promise<RowFetch>, []>(async () => ({ data: null, error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }) }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
  },
}));

// Imported after the mocks above are registered.
// eslint-disable-next-line import/first
import ResultScreen from '../[id]';

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams = { id: ANALYSIS_ID, justAnalyzed: '1' };
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
});

// The per-pillar not-assessed line is hidden from the a11y tree (its sentence is folded into the
// row's accessibility label instead), so RNTL only finds it with this option — CLAUDE.md § Testing.
const HIDDEN = { includeHiddenElements: true } as const;

it('a Free VIDEO result with all four pillars scored does not headline "Partial read"', async () => {
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: { result: freeTierVideoResult, isFallback: false },
    mediaType: 'video',
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  expect(screen.queryByTestId('partial-result-banner')).toBeNull();
  expect(screen.queryByText(Copy.result.partial.banner.title)).toBeNull();
  // No pillar reads as not assessed: neither the photo line nor the one-frame-video line.
  for (const id of ['posture', 'armSwing', 'cadence', 'elasticity']) {
    expect(screen.queryByTestId(`pillar-not-assessed-${id}`, HIDDEN)).toBeNull();
  }
  expect(screen.queryByText(Copy.result.pillar.notAssessed.needsVideo, HIDDEN)).toBeNull();
  expect(screen.queryByText(Copy.result.pillar.notAssessed.singleFrameFromVideo, HIDDEN)).toBeNull();
  // The headline is a real number, averaged from the assessed pillars.
  expect(screen.queryByTestId('overall-not-assessed')).toBeNull();
});

it('a Free PHOTO result keeps the honest "Partial read" banner and the "Requires video" copy', async () => {
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: { result: photoResult, isFallback: false },
    mediaType: 'photo',
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  expect(screen.getByTestId('partial-result-banner')).toBeTruthy();
  expect(screen.getByText(Copy.result.partial.banner.title)).toBeTruthy();
  // "2 of 4 pillars scored from this photo ..." — the count and the medium are both honest.
  expect(screen.getByText(formatPartialBannerBody(2, 'photo'))).toBeTruthy();
  // Cadence and Elasticity each carry the photo reason — "Requires video", which is true of a
  // photo — and Posture and Arm swing carry no not-assessed line at all.
  expect(screen.getByTestId('pillar-not-assessed-cadence', HIDDEN).props.children).toBe(
    Copy.result.pillar.notAssessed.needsVideo
  );
  expect(screen.getByTestId('pillar-not-assessed-elasticity', HIDDEN).props.children).toBe(
    Copy.result.pillar.notAssessed.needsVideo
  );
  expect(screen.queryByTestId('pillar-not-assessed-posture', HIDDEN)).toBeNull();
  expect(screen.queryByTestId('pillar-not-assessed-armSwing', HIDDEN)).toBeNull();
});
