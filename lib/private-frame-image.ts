/**
 * THE ONE CACHE POLICY for rendering a user's stored running frames (CLAUDE.md, "Uploaded media
 * is sensitive"). Every surface that draws a frame from the private `media` bucket goes through
 * `<PrivateFrameImage>` (`components/private-frame-image.tsx`), which reads its whole policy from
 * this file. As of 2026-10-05 those surfaces are: History's three-cell frame deck, the result
 * screen's hero (via `<DuotoneFrame>`), and the result screen's "Frames analyzed" strip and its
 * full-screen viewer. Since 2026-10-06 the Preparing and Analysing screens draw the frames that
 * have not left the device yet, through `<DeviceFrameImage>` (`deviceFrameSource` below) under the
 * same cache policy. Compare and Home's recent-analysis card render no frames, and the entry
 * flow's hero (`components/stride-hero.tsx`) is a computed line drawing, not user media.
 *
 * THE POLICY:
 *
 *   1. SIGNED URLS ONLY. A source is rendered only if it is a Supabase Storage *signed* URL into
 *      the `media` bucket on THIS app's Supabase origin
 *      (`EXPO_PUBLIC_SUPABASE_URL/storage/v1/object/sign/media/…?token=…`) — the only kind
 *      `createSignedUrls` returns. Path segments are plain names (letters, digits, `.`, `_`, `-`,
 *      never starting with a dot), so no `..` or percent-encoded segment can walk the request
 *      out of `/sign/media/`. A public-object URL, an authenticated-object URL, another host, a
 *      local file, a data URI, or anything else is refused and draws nothing, so a future caller
 *      cannot quietly widen the contract by passing a different kind of link.
 *   2. NO CACHE, IN MEMORY OR ON DISK. `cachePolicy: 'none'`. Each signed URL carries a fresh
 *      token, so a URL-keyed cache could never be re-hit anyway; all it would do is pile up body
 *      images on disk under keys that outlive the token, the analysis (after a delete) and the
 *      account (after sign-out or deletion). With no cache there is no key to outlive anything,
 *      and nothing to bound. A revisit re-signs (`lib/history.ts`, `lib/result-frames.ts`) and
 *      re-downloads a few small JPEGs — the right trade for images of people's bodies.
 *      (expo-image's `'none'` also refuses the HTTP-layer cache on iOS: SDWebImage drops the
 *      response from `NSURLCache` unless told otherwise.)
 *   3. PURGED ON EXIT. `purgePrivateFrameImageCaches()` empties expo-image's memory and disk
 *      caches. `lib/session-provider.tsx` runs it once at launch — which removes frames that
 *      builds before this policy cached to disk through History's default-cached thumbnails —
 *      and again whenever a session ends or changes user (sign-out, account deletion). Under
 *      rule 2 those caches should already be empty; the purge is the backstop. It is safe to
 *      clear expo-image wholesale because nothing else in the app renders through expo-image.
 *      It resolves `false` when either clear reports it did nothing (expo-image on Android
 *      no-ops while no Activity is attached), and the session provider retries once on the next
 *      foreground.
 *
 *      KNOWN RESIDUAL: it cannot reach the caches of the hero's OLD renderer (below). Hero
 *      frames that pre-2026-10-05 builds loaded may still sit in `NSURLCache` (iOS) or Fresco's
 *      disk cache (Android) until those caches evict them; clearing them needs native code.
 *      Only development builds ever shipped that renderer. See `docs/status.md` Known Issue #54.
 *
 * WHY THE HERO MOVED OFF react-native-svg: an SVG `<Image href>` loads through React Native's
 * own image pipeline — `NSURLCache` on iOS, Fresco's on-disk cache on Android — with no way to
 * opt out, so the result hero was writing every frame it showed to disk. It now draws through
 * expo-image like the other surfaces; see `components/duotone-frame.tsx` for how it keeps its
 * greyscale grade without SVG.
 */
import { Image, type ImageProps } from 'expo-image';

/** The storage bucket every stored frame lives in (`lib/history.ts`'s `MEDIA_BUCKET`). Repeated
 *  here as a literal so this module stays import-free of the Supabase client. */
const PRIVATE_FRAME_BUCKET = 'media';

/** What follows `<origin>/storage/v1/object/sign/media/` in a signed URL storage-js's
 *  `createSignedUrls` builds: plain path segments (none starting with a dot, nothing
 *  percent-encoded), then a query carrying a non-empty `token`. */
const SIGNED_FRAME_PATH_AND_QUERY =
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\?(?:[^#]*&)?token=[^&#]+/;

/** `EXPO_PUBLIC_SUPABASE_URL` as an origin — the only one a frame may load from. Normalised the
 *  way supabase-js's own `new URL(...)` normalises it (trimmed, lower-case, no trailing slash, no
 *  default port), so a non-canonical spelling of the same origin cannot silently refuse every
 *  frame. Read per call (static dot access, per the `expo/no-dynamic-env-var` rule) so tests can
 *  set it. */
function signedFramePrefix(): string | null {
  const origin = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/^(https:\/\/[^/]+):443$/, '$1')
    .replace(/^(http:\/\/[^/]+):80$/, '$1');
  return origin ? `${origin}/storage/v1/object/sign/${PRIVATE_FRAME_BUCKET}/` : null;
}

/** expo-image's cache policy for every private frame. See rule 2 in this file's header. */
export const PRIVATE_FRAME_CACHE_POLICY = 'none' satisfies NonNullable<ImageProps['cachePolicy']>;

/** True only for a signed URL into the private `media` bucket. See rule 1 in this file's header. */
export function isSignedPrivateFrameUrl(uri: unknown): uri is string {
  const prefix = signedFramePrefix();
  return (
    typeof uri === 'string' &&
    prefix !== null &&
    uri.startsWith(prefix) &&
    SIGNED_FRAME_PATH_AND_QUERY.test(uri.slice(prefix.length))
  );
}

/** The expo-image `source` for a private frame, or `null` (draws nothing) when `uri` is not a
 *  signed `media` URL. */
export function privateFrameSource(uri: string | null | undefined): { uri: string } | null {
  return isSignedPrivateFrameUrl(uri) ? { uri } : null;
}

/** A raw base64 JPEG as `lib/frames.ts` produces it: the base64 alphabet only, no `data:`
 *  prefix, no whitespace. */
const DEVICE_FRAME_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * The expo-image `source` for a frame that has NOT left the device yet — the Preparing and
 * Analysing screens' thumbnails, drawn from the in-memory `PaceFrame.base64` that
 * `lib/frames.ts` extracted (2026-10-06). Rule 1's signed-URL check cannot apply to a frame that
 * has no URL: this is the one other kind of source a private frame may have, and it is built
 * here, from bytes, so no caller can pass a `file://`, a remote URL or a ready-made `data:` URI of
 * its own. It is rendered under the SAME `PRIVATE_FRAME_CACHE_POLICY` (rule 2), so the bytes are
 * decoded for display and never written to expo-image's memory or disk cache. `null` (draws
 * nothing) for anything that is not plain base64.
 */
export function deviceFrameSource(base64: string | null | undefined): { uri: string } | null {
  return typeof base64 === 'string' && base64.length > 0 && DEVICE_FRAME_BASE64.test(base64)
    ? { uri: `data:image/jpeg;base64,${base64}` }
    : null;
}

/**
 * Empties expo-image's memory and disk caches. Never rejects: it runs on sign-out and at launch,
 * and neither may be held up or broken by a cache that failed to clear. Resolves `true` only when
 * both clears report success, so the caller can retry one that silently did nothing.
 */
export async function purgePrivateFrameImageCaches(): Promise<boolean> {
  // Each call is wrapped so a synchronous throw (no native module) settles like a rejection.
  const results = await Promise.allSettled([
    (async () => Image.clearMemoryCache())(),
    (async () => Image.clearDiskCache())(),
  ]);
  return results.every((result) => result.status === 'fulfilled' && result.value === true);
}
