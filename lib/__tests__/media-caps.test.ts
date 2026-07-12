import { checkMediaCaps, MAX_CLIP_DURATION_MS, MAX_PRE_COMPRESS_BYTES } from '../media-caps';

describe('checkMediaCaps', () => {
  it('returns null for a clip within both caps', () => {
    expect(checkMediaCaps({ durationMs: 10_000, fileSizeBytes: 10 * 1024 * 1024 })).toBeNull();
  });

  it('returns null when both fields are omitted (e.g. a photo has no duration)', () => {
    expect(checkMediaCaps({})).toBeNull();
  });

  it('returns null exactly at the boundary (over, not at-or-over, trips it)', () => {
    expect(
      checkMediaCaps({ durationMs: MAX_CLIP_DURATION_MS, fileSizeBytes: MAX_PRE_COMPRESS_BYTES })
    ).toBeNull();
  });

  it('flags clipTooLong when duration exceeds the cap', () => {
    expect(checkMediaCaps({ durationMs: MAX_CLIP_DURATION_MS + 1 })).toBe('clipTooLong');
  });

  it('flags fileTooLarge when size exceeds the cap', () => {
    expect(checkMediaCaps({ fileSizeBytes: MAX_PRE_COMPRESS_BYTES + 1 })).toBe('fileTooLarge');
  });

  it('reports clipTooLong before fileTooLarge when both are violated', () => {
    expect(
      checkMediaCaps({
        durationMs: MAX_CLIP_DURATION_MS + 1,
        fileSizeBytes: MAX_PRE_COMPRESS_BYTES + 1,
      })
    ).toBe('clipTooLong');
  });

  it('ignores null/undefined fields rather than treating them as violations', () => {
    expect(checkMediaCaps({ durationMs: null, fileSizeBytes: undefined })).toBeNull();
  });
});
