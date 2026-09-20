/**
 * The just-analyzed handoff, at the only level that can see the defect it fixes (review r7-4).
 *
 * THE REGRESSION: `analyze-form` returns 200 with a complete, honest all-null readout for a
 * submission that assessed nothing, but RELEASES its reservation rather than settling it — nobody
 * is charged for a result carrying no information (cd8bf97 / PR #194). This screen used to discard
 * that body and re-query `public.analyses` by id, which by then is a released row with a null
 * `result`, so `readAnalysisRow` said `notFound` and the runner was shown "We couldn't find this
 * analysis." A real answer, computed and delivered, rendered as a dead end. These tests drive the
 * real screen with a row lookup that finds nothing — exactly that case — and assert the readout
 * renders anyway.
 *
 * Neither the fix nor these tests persist the zero-pillar row: that would charge the very
 * submission the no-charge policy exists to refund.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { allNotAssessedResult, photoResult } from '@/lib/pace-fixtures';
import { setPendingAnalysisResult } from '@/lib/pending-analysis-result';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const ANALYSIS_ID = 'b144d29b-2348-4043-a96b-581ff4af6dbe';

let mockRouteParams: Record<string, string> = { id: ANALYSIS_ID, justAnalyzed: '1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));

// The row lookup finds nothing — which is precisely what a released zero-pillar reservation looks
// like from here.
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

it('renders the zero-pillar readout the server just sent, with no readable row behind it', async () => {
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: { result: allNotAssessedResult, isFallback: false },
    mediaType: 'video',
  });

  await render(<ResultScreen />);

  // The honest all-null readout — four not-assessed pillars and a hollow headline — not a dead end.
  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  expect(screen.getByTestId('overall-not-assessed')).toBeTruthy();
  expect(screen.queryByText(Copy.result.error.notFound)).toBeNull();
});

it('still says it could not find the analysis when nothing was handed off', async () => {
  // A re-open from Past Analyses of a row that is genuinely gone. The handoff must not paper over
  // this — it only ever covers the navigation it was staged for.
  mockRouteParams = { id: ANALYSIS_ID };

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByText(Copy.result.error.notFound)).toBeTruthy());
});

it('does not replay a handoff staged for a different analysis', async () => {
  setPendingAnalysisResult({
    analysisId: 'c255e3ac-3459-5154-ba7c-692ff5bf7ecf',
    outcome: { result: photoResult, isFallback: false },
    mediaType: 'photo',
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByText(Copy.result.error.notFound)).toBeTruthy());
});

it('keeps the handed-off result on screen when the row lookup itself errors', async () => {
  // A failed fetch can cost the hero frame; it must never cost the result.
  mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: { result: photoResult, isFallback: false },
    mediaType: 'photo',
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  expect(screen.queryByText(Copy.result.error.loadFailed)).toBeNull();
});

it('draws the placeholder gradient and the vignette in the hero box when there is no frame', async () => {
  // The vignette draws over the placeholder too — the hero is the same box whether or not an
  // image ever arrives, so the readout under it never moves. The drawn annotation marks were
  // removed 2026-09-20 (captain's phone test).
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: { result: photoResult, isFallback: false },
    mediaType: 'photo',
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  const HIDDEN = { includeHiddenElements: true } as const;
  await waitFor(() => expect(screen.getByTestId('result-hero-placeholder', HIDDEN)).toBeTruthy());
  expect(screen.getByTestId('result-hero-vignette', HIDDEN)).toBeTruthy();
  expect(screen.queryByTestId('result-hero-image')).toBeNull();
  expect(screen.queryByTestId('result-hero-pending', HIDDEN)).toBeNull();
  // The readout card, the disclaimer and the Done control follow in the page's order.
  expect(screen.getByTestId('result-readout-card')).toBeTruthy();
  expect(screen.getByTestId('result-disclaimer-text')).toBeTruthy();
  expect(screen.getByTestId('result-done').props.accessibilityLabel).toBe(Copy.result.cta.done);
});
