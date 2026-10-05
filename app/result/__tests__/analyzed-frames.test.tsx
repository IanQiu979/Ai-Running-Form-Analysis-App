import { act, render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';
import { freeTierOutcome, proTierOutcome } from '@/lib/pace-fixtures';
import { setPendingAnalysisResult } from '@/lib/pending-analysis-result';
import type { AnalysisFrameSlot } from '@/lib/result-frames';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const ANALYSIS_ID = 'b144d29b-2348-4043-a96b-581ff4af6dbe';
const USER_ID = '6fefdccb-3a78-4f56-9b88-9624520fdc74';
const OTHER_USER_ID = '7af0edcc-4b89-4056-ac99-a735630fed85';
const MEDIA_PATHS = [
  `${USER_ID}/${ANALYSIS_ID}/frame-001.jpg`,
  `${USER_ID}/${ANALYSIS_ID}/frame-002.jpg`,
  `${USER_ID}/${ANALYSIS_ID}/frame-003.jpg`,
];

let mockRouteParams: Record<string, string> = { id: ANALYSIS_ID };
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('@/lib/use-announce', () => ({ useAnnounce: jest.fn() }));
let mockUserId = USER_ID;
jest.mock('@/lib/session-provider', () => ({
  useSession: () => ({ session: { user: { id: mockUserId } } }),
}));

const mockBuildPendingAnalysisFrameSlots = jest.fn<AnalysisFrameSlot[], [string[], string, string]>();
const mockSignAnalysisFrames = jest.fn<Promise<AnalysisFrameSlot[]>, [string[], string, string]>();
jest.mock('@/lib/result-frames', () => ({
  buildPendingAnalysisFrameSlots: (...args: [string[], string, string]) =>
    mockBuildPendingAnalysisFrameSlots(...args),
  signAnalysisFrames: (...args: [string[], string, string]) => mockSignAnalysisFrames(...args),
}));

type RowFetch = { data: Record<string, unknown> | null; error: { message: string } | null };
const mockMaybeSingle = jest.fn<Promise<RowFetch>, []>();
const mockGetPublicUrl = jest.fn();
const mockCreateSignedUrl = jest.fn();
const mockCreateSignedUrls = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }) }),
    storage: {
      from: () => ({
        getPublicUrl: mockGetPublicUrl,
        createSignedUrl: mockCreateSignedUrl,
        createSignedUrls: mockCreateSignedUrls,
      }),
    },
  },
}));

// The hero's real component draws through react-native-svg; a plain host node exposes the
// signed URI it was handed so the hero tests can assert WHICH frame became the hero.
jest.mock('@/components/duotone-frame', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    DuotoneFrame: ({ uri, testID }: { uri: string; testID?: string }) => (
      <View testID={testID} nativeID={uri} />
    ),
  };
});

const HIDDEN = { includeHiddenElements: true };

// Imported after the route, session, database, and signer boundaries are registered.
// eslint-disable-next-line import/first
import ResultScreen from '../[id]';

function analysisRow(overrides: Record<string, unknown> = {}) {
  return {
    status: 'delivered',
    result: proTierOutcome.result,
    is_fallback: false,
    media_paths: MEDIA_PATHS,
    media_type: 'video',
    deleted_at: null,
    ...overrides,
  };
}

function pendingSlots(paths: string[] = MEDIA_PATHS): AnalysisFrameSlot[] {
  return paths.map((path) => ({ path, uri: null, status: 'loading' as const }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = USER_ID;
  mockRouteParams = { id: ANALYSIS_ID };
  mockMaybeSingle.mockResolvedValue({ data: analysisRow(), error: null });
  mockBuildPendingAnalysisFrameSlots.mockImplementation((paths) => pendingSlots(paths));
  mockSignAnalysisFrames.mockResolvedValue([
    { path: MEDIA_PATHS[0], uri: 'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-001.jpg?token=token-001', status: 'ready' },
    { path: MEDIA_PATHS[1], uri: null, status: 'unavailable' },
    { path: MEDIA_PATHS[2], uri: 'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-003.jpg?token=token-003', status: 'ready' },
  ]);
});

it('shows every stored frame in source order while a partial batch of signed URLs resolves', async () => {
  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('analyzed-frames-strip')).toBeTruthy());
  expect(screen.getAllByTestId(/^analyzed-frame-slot-/)).toHaveLength(3);
  expect(screen.getByTestId('analyzed-frame-image-0').props.source[0].uri).toBe(
    'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-001.jpg?token=token-001'
  );
  expect(screen.getByTestId('analyzed-frame-unavailable-1')).toBeTruthy();
  expect(screen.getByTestId('analyzed-frame-image-2').props.source[0].uri).toBe(
    'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-003.jpg?token=token-003'
  );
  expect(mockBuildPendingAnalysisFrameSlots).toHaveBeenCalledWith(MEDIA_PATHS, USER_ID, ANALYSIS_ID);
  expect(mockSignAnalysisFrames).toHaveBeenCalledWith(MEDIA_PATHS, USER_ID, ANALYSIS_ID);
});

it('keeps ordered fallback slots when the signing request rejects', async () => {
  mockSignAnalysisFrames.mockRejectedValue(new Error('storage unavailable'));

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('analyzed-frames-strip')).toBeTruthy());
  expect(screen.getAllByTestId(/^analyzed-frame-slot-/)).toHaveLength(3);
  expect(screen.getByTestId('analyzed-frame-unavailable-0')).toBeTruthy();
  expect(screen.getByTestId('analyzed-frame-unavailable-1')).toBeTruthy();
  expect(screen.getByTestId('analyzed-frame-unavailable-2')).toBeTruthy();
  expect(screen.getByTestId('pace-readout')).toBeTruthy();
});

it('renders no strip and never touches storage for a Free result with no real stored frames', async () => {
  mockMaybeSingle.mockResolvedValue({
    data: analysisRow({ result: freeTierOutcome.result, media_paths: [] }),
    error: null,
  });
  mockBuildPendingAnalysisFrameSlots.mockReturnValue([]);

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());
  expect(screen.queryByTestId('analyzed-frames-strip')).toBeNull();
  expect(screen.queryByText(Copy.result.frames.title)).toBeNull();
  expect(mockSignAnalysisFrames).not.toHaveBeenCalled();
  expect(mockGetPublicUrl).not.toHaveBeenCalled();
  expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  expect(mockCreateSignedUrls).not.toHaveBeenCalled();
});

it('suppresses the handoff, readout, frames, and signing for a soft-deleted analysis', async () => {
  mockRouteParams = { id: ANALYSIS_ID, justAnalyzed: '1' };
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: proTierOutcome,
    mediaType: 'video',
  });
  mockMaybeSingle.mockResolvedValue({
    data: analysisRow({ deleted_at: '2026-10-05T08:00:00.000Z' }),
    error: null,
  });

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByText(Copy.result.error.notFound)).toBeTruthy());
  expect(screen.queryByTestId('pace-readout')).toBeNull();
  expect(screen.queryByTestId('analyzed-frames-strip')).toBeNull();
  expect(mockBuildPendingAnalysisFrameSlots).not.toHaveBeenCalled();
  expect(mockSignAnalysisFrames).not.toHaveBeenCalled();
  expect(mockGetPublicUrl).not.toHaveBeenCalled();
});

it('never constructs a public URL while showing signed frames', async () => {
  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('analyzed-frame-image-0')).toBeTruthy());
  expect(mockGetPublicUrl).not.toHaveBeenCalled();
  expect(mockCreateSignedUrl).not.toHaveBeenCalled();
  expect(mockCreateSignedUrls).not.toHaveBeenCalled();
});

it('does not replay one owner handoff after the authenticated user changes on the same route', async () => {
  mockRouteParams = { id: ANALYSIS_ID, justAnalyzed: '1' };
  setPendingAnalysisResult({
    analysisId: ANALYSIS_ID,
    outcome: proTierOutcome,
    mediaType: 'video',
  });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });

  const view = await render(<ResultScreen />);
  await waitFor(() => expect(screen.getByTestId('pace-readout')).toBeTruthy());

  mockUserId = OTHER_USER_ID;
  await view.rerender(<ResultScreen />);

  await waitFor(() => expect(screen.getByText(Copy.result.error.notFound)).toBeTruthy());
  expect(screen.queryByTestId('pace-readout')).toBeNull();
  expect(mockSignAnalysisFrames).not.toHaveBeenCalled();
});

it('uses the first stored frame as the hero once it signs', async () => {
  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('result-hero-image')).toBeTruthy());
  expect(screen.getByTestId('result-hero-image').props.nativeID).toBe('https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-001.jpg?token=token-001');
});

it('falls through to the first frame that signed when the first one is unavailable', async () => {
  mockSignAnalysisFrames.mockResolvedValue([
    { path: MEDIA_PATHS[0], uri: null, status: 'unavailable' },
    { path: MEDIA_PATHS[1], uri: null, status: 'unavailable' },
    { path: MEDIA_PATHS[2], uri: 'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-003.jpg?token=token-003', status: 'ready' },
  ]);

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('result-hero-image')).toBeTruthy());
  expect(screen.getByTestId('result-hero-image').props.nativeID).toBe('https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-003.jpg?token=token-003');
});

// `lib/private-frame-image.ts`: only a signed `media` link may become the hero.
it('skips a ready frame whose URL is not a signed media link when picking the hero', async () => {
  mockSignAnalysisFrames.mockResolvedValue([
    {
      path: MEDIA_PATHS[0],
      uri: 'https://project.supabase.co/storage/v1/object/public/media/user/analysis/frame-001.jpg',
      status: 'ready',
    },
    { path: MEDIA_PATHS[1], uri: null, status: 'unavailable' },
    { path: MEDIA_PATHS[2], uri: null, status: 'unavailable' },
  ]);

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('result-hero-placeholder', { includeHiddenElements: true })).toBeTruthy());
  expect(screen.queryByTestId('result-hero-image')).toBeNull();
});

it('holds the hero spinner while signing, then the placeholder when no frame signs', async () => {
  let resolveSigning: (slots: AnalysisFrameSlot[]) => void = () => {};
  mockSignAnalysisFrames.mockReturnValue(
    new Promise<AnalysisFrameSlot[]>((resolve) => {
      resolveSigning = resolve;
    })
  );

  await render(<ResultScreen />);

  await waitFor(() => expect(screen.getByTestId('result-hero-pending', HIDDEN)).toBeTruthy());
  expect(screen.getByTestId('analyzed-frame-loading-0')).toBeTruthy();
  expect(screen.queryByTestId('result-hero-image')).toBeNull();

  await act(async () => {
    resolveSigning(MEDIA_PATHS.map((path) => ({ path, uri: null, status: 'unavailable' as const })));
  });

  await waitFor(() => expect(screen.getByTestId('result-hero-placeholder', HIDDEN)).toBeTruthy());
  expect(screen.queryByTestId('result-hero-pending', HIDDEN)).toBeNull();
  expect(screen.queryByTestId('result-hero-image')).toBeNull();
  expect(screen.getByTestId('analyzed-frame-unavailable-0')).toBeTruthy();
});
