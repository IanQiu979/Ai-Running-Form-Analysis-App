/**
 * `lib/private-frame-image.ts` — the one cache policy every stored-frame surface renders under
 * (History's deck, the result hero, the "Frames analyzed" strip and its viewer). Locks the three
 * rules in that file's header: signed `media` URLs only, no image cache, and a purge that can
 * never break the sign-out or launch that calls it.
 */
import { Image } from 'expo-image';

import {
  PRIVATE_FRAME_CACHE_POLICY,
  isSignedPrivateFrameUrl,
  privateFrameSource,
  purgePrivateFrameImageCaches,
} from '../private-frame-image';

jest.mock('expo-image', () => ({
  Image: {
    clearMemoryCache: jest.fn(async () => true),
    clearDiskCache: jest.fn(async () => true),
  },
}));

const mockClearMemoryCache = Image.clearMemoryCache as jest.Mock;
const mockClearDiskCache = Image.clearDiskCache as jest.Mock;

// `jest.setup.js` sets EXPO_PUBLIC_SUPABASE_URL to this origin when no `.env` is present.
const ORIGIN = 'https://project.supabase.co';
const ORIGINAL_ENV_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGIN;
});
afterAll(() => {
  process.env.EXPO_PUBLIC_SUPABASE_URL = ORIGINAL_ENV_URL;
});

const SIGNED =
  `${ORIGIN}/storage/v1/object/sign/media/` +
  '0b6a1f5e-0000-4000-8000-000000000001/7c1d2e3f-0000-4000-8000-000000000002/frame-01.jpg' +
  '?token=eyJhbGciOiJIUzI1NiJ9.payload.signature';

describe('PRIVATE_FRAME_CACHE_POLICY', () => {
  it('keeps frames out of both the memory and the disk cache', () => {
    expect(PRIVATE_FRAME_CACHE_POLICY).toBe('none');
  });
});

describe('isSignedPrivateFrameUrl', () => {
  it('accepts the signed URL createSignedUrls returns for the media bucket', () => {
    expect(isSignedPrivateFrameUrl(SIGNED)).toBe(true);
  });

  it('accepts a local Supabase stack origin and a token that is not the first query parameter', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321/';
    expect(
      isSignedPrivateFrameUrl('http://127.0.0.1:54321/storage/v1/object/sign/media/u/a/frame-01.jpg?download=&token=t')
    ).toBe(true);
  });

  it.each([' HTTPS://Project.Supabase.co/ ', 'https://project.supabase.co:443', 'https://project.supabase.co//'])(
    'matches the origin supabase-js signs against when the env spells it as %p',
    (envUrl) => {
      process.env.EXPO_PUBLIC_SUPABASE_URL = envUrl;
      expect(isSignedPrivateFrameUrl(SIGNED)).toBe(true);
    }
  );

  it('refuses everything when the app has no Supabase origin configured', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    expect(isSignedPrivateFrameUrl(SIGNED)).toBe(false);
  });

  it.each([
    ['a public-object URL', SIGNED.replace('/object/sign/', '/object/public/').replace(/\?.*$/, '')],
    ['a public-object URL that still carries a token', SIGNED.replace('/object/sign/', '/object/public/')],
    ['an authenticated-object URL', SIGNED.replace('/object/sign/', '/object/authenticated/')],
    ['a signed URL into another bucket', SIGNED.replace('/sign/media/', '/sign/avatars/')],
    ['a signed path with no token', SIGNED.replace(/\?.*$/, '')],
    ['a signed path with an empty token', SIGNED.replace(/token=.*$/, 'token=')],
    ['a token only in the fragment', SIGNED.replace('?token=', '#token=')],
    ['a bare bucket path', '0b6a1f5e/7c1d2e3f/frame-01.jpg'],
    ['a local file', 'file:///var/mobile/frame-01.jpg'],
    ['a data URI', 'data:image/jpeg;base64,AAAA'],
    ['an unrelated https URL', 'https://example.com/frame-01.jpg?token=t'],
    ['a signed-shaped URL on another host', SIGNED.replace(ORIGIN, 'https://attacker.example')],
    ['a signed-shaped URL over http on the right host', SIGNED.replace('https://', 'http://')],
    ['a host that only starts with the origin', SIGNED.replace(ORIGIN, `${ORIGIN}.attacker.example`)],
    ['a dot-dot segment out of /sign/media/', `${ORIGIN}/storage/v1/object/sign/media/../../public/b/x.jpg?token=t`],
    ['a single-dot segment', `${ORIGIN}/storage/v1/object/sign/media/./u/a/frame-01.jpg?token=t`],
    ['a percent-encoded dot segment', `${ORIGIN}/storage/v1/object/sign/media/%2e%2e/public/x.jpg?token=t`],
    ['a percent-encoded slash', `${ORIGIN}/storage/v1/object/sign/media/u%2f..%2fx.jpg?token=t`],
    ['a backslash in the path', `${ORIGIN}/storage/v1/object/sign/media/u\\..\\x.jpg?token=t`],
    ['an empty path segment', `${ORIGIN}/storage/v1/object/sign/media//u/x.jpg?token=t`],
    ['the empty string', ''],
  ])('refuses %s', (_label, uri) => {
    expect(isSignedPrivateFrameUrl(uri)).toBe(false);
  });

  it.each([null, undefined, 42, {}])('refuses a non-string (%p)', (value) => {
    expect(isSignedPrivateFrameUrl(value)).toBe(false);
  });
});

describe('privateFrameSource', () => {
  it('passes a signed URL through as the expo-image source', () => {
    expect(privateFrameSource(SIGNED)).toEqual({ uri: SIGNED });
  });

  it('returns null — draws nothing — for anything that is not a signed media URL', () => {
    expect(privateFrameSource('https://example.com/frame.jpg')).toBeNull();
    expect(privateFrameSource(null)).toBeNull();
    expect(privateFrameSource(undefined)).toBeNull();
  });
});

describe('purgePrivateFrameImageCaches', () => {
  beforeEach(() => {
    mockClearMemoryCache.mockReset().mockResolvedValue(true);
    mockClearDiskCache.mockReset().mockResolvedValue(true);
  });

  it('clears both the memory and the disk cache and reports success', async () => {
    await expect(purgePrivateFrameImageCaches()).resolves.toBe(true);
    expect(mockClearMemoryCache).toHaveBeenCalledTimes(1);
    expect(mockClearDiskCache).toHaveBeenCalledTimes(1);
  });

  // expo-image on Android resolves `false` without clearing while no Activity is attached.
  it('reports failure when a clear says it did nothing', async () => {
    mockClearDiskCache.mockResolvedValue(false);
    await expect(purgePrivateFrameImageCaches()).resolves.toBe(false);
  });

  it('still clears the disk cache, and resolves false, when the memory clear rejects', async () => {
    mockClearMemoryCache.mockRejectedValue(new Error('native failure'));
    await expect(purgePrivateFrameImageCaches()).resolves.toBe(false);
    expect(mockClearDiskCache).toHaveBeenCalledTimes(1);
  });

  it('resolves even when a clear throws synchronously (no native module)', async () => {
    mockClearDiskCache.mockImplementation(() => {
      throw new Error('Cannot find native module');
    });
    await expect(purgePrivateFrameImageCaches()).resolves.toBe(false);
    expect(mockClearMemoryCache).toHaveBeenCalledTimes(1);
  });
});
