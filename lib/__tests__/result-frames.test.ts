import { supabase } from '../supabase';
import { buildPendingAnalysisFrameSlots, signAnalysisFrames } from '../result-frames';

jest.mock('../supabase', () => ({
  supabase: {
    storage: { from: jest.fn() },
  },
}));

const mockStorageFrom = supabase.storage.from as jest.MockedFunction<typeof supabase.storage.from>;

const USER_ID = '11111111-1111-1111-1111-111111111111';
const ANALYSIS_ID = '22222222-2222-2222-2222-222222222222';
const path = (frameNumber: number) =>
  `${USER_ID}/${ANALYSIS_ID}/frame-${String(frameNumber).padStart(2, '0')}.jpg`;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildPendingAnalysisFrameSlots', () => {
  it('preserves stored order, rejects non-canonical paths, and caps the strip at eight slots', () => {
    const mediaPaths = [
      path(3),
      `${USER_ID}/another-analysis/frame-01.jpg`,
      path(1),
      path(2),
      path(4),
      path(5),
      path(6),
      path(7),
      path(8),
    ];

    expect(buildPendingAnalysisFrameSlots(mediaPaths, USER_ID, ANALYSIS_ID)).toEqual([
      { path: path(3), uri: null, status: 'loading' },
      { path: `${USER_ID}/another-analysis/frame-01.jpg`, uri: null, status: 'unavailable' },
      { path: path(1), uri: null, status: 'loading' },
      { path: path(2), uri: null, status: 'loading' },
      { path: path(4), uri: null, status: 'loading' },
      { path: path(5), uri: null, status: 'loading' },
      { path: path(6), uri: null, status: 'loading' },
      { path: path(7), uri: null, status: 'loading' },
    ]);
  });

  it('matches an upper-case route id against the lower-case stored paths', () => {
    const upperAnalysisId = 'ABCDEF01-2345-4678-9ABC-DEF012345678';
    const stored = `${USER_ID}/${upperAnalysisId.toLowerCase()}/frame-01.jpg`;
    expect(buildPendingAnalysisFrameSlots([stored], USER_ID, upperAnalysisId)).toEqual([
      { path: stored, uri: null, status: 'loading' },
    ]);
  });

  it('returns no slots when the row has no stored frames', () => {
    expect(buildPendingAnalysisFrameSlots([], USER_ID, ANALYSIS_ID)).toEqual([]);
  });
});

describe('signAnalysisFrames', () => {
  it('does not contact Storage for an empty row', async () => {
    await expect(signAnalysisFrames([], USER_ID, ANALYSIS_ID)).resolves.toEqual([]);
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('does not contact Storage when every stored path is outside the canonical owner namespace', async () => {
    const invalidPaths = [
      `${USER_ID}/another-analysis/frame-01.jpg`,
      `${USER_ID}/${ANALYSIS_ID}/frame-1.jpg`,
      `${USER_ID}/${ANALYSIS_ID}/frame-09.jpg`,
      `https://example.com/${USER_ID}/${ANALYSIS_ID}/frame-01.jpg`,
    ];

    await expect(signAnalysisFrames(invalidPaths, USER_ID, ANALYSIS_ID)).resolves.toEqual(
      invalidPaths.map((invalidPath) => ({ path: invalidPath, uri: null, status: 'unavailable' }))
    );
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('signs valid paths once and maps shuffled, partial per-frame results back to stored order', async () => {
    const getPublicUrl = jest.fn();
    const upload = jest.fn();
    const createSignedUrls = jest.fn().mockResolvedValue({
      data: [
        { path: path(3), signedUrl: 'https://signed.example/frame-03', error: null },
        { path: path(1), signedUrl: 'https://signed.example/frame-01', error: null },
        {
          path: path(2),
          signedUrl: 'https://signed.example/malformed-error-entry',
          error: 'object missing',
        },
      ],
      error: null,
    });
    mockStorageFrom.mockReturnValue({ createSignedUrls, getPublicUrl, upload } as never);
    const invalidPath = `${USER_ID}/another-analysis/frame-01.jpg`;

    const slots = await signAnalysisFrames(
      [path(1), invalidPath, path(2), path(4), path(3)],
      USER_ID,
      ANALYSIS_ID
    );

    expect(mockStorageFrom).toHaveBeenCalledTimes(1);
    expect(mockStorageFrom).toHaveBeenCalledWith('media');
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(createSignedUrls).toHaveBeenCalledWith([path(1), path(2), path(4), path(3)], 60 * 60);
    expect(slots).toEqual([
      { path: path(1), uri: 'https://signed.example/frame-01', status: 'ready' },
      { path: invalidPath, uri: null, status: 'unavailable' },
      { path: path(2), uri: null, status: 'unavailable' },
      { path: path(4), uri: null, status: 'unavailable' },
      { path: path(3), uri: 'https://signed.example/frame-03', status: 'ready' },
    ]);
    expect(getPublicUrl).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('returns unavailable slots when Storage reports a batch-level error', async () => {
    const createSignedUrls = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'bucket unreachable' },
    });
    mockStorageFrom.mockReturnValue({ createSignedUrls } as never);

    await expect(signAnalysisFrames([path(1), path(2)], USER_ID, ANALYSIS_ID)).resolves.toEqual([
      { path: path(1), uri: null, status: 'unavailable' },
      { path: path(2), uri: null, status: 'unavailable' },
    ]);
  });

  it('returns unavailable slots rather than rejecting when the signing call throws', async () => {
    const createSignedUrls = jest.fn().mockRejectedValue(new Error('network down'));
    mockStorageFrom.mockReturnValue({ createSignedUrls } as never);

    await expect(signAnalysisFrames([path(1)], USER_ID, ANALYSIS_ID)).resolves.toEqual([
      { path: path(1), uri: null, status: 'unavailable' },
    ]);
  });
});
