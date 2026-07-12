/**
 * Parses `app/capture/extracting.tsx`'s route params (set by `app/capture/index.tsx`'s library
 * pick and `app/capture/record.tsx`'s recording, both via `router.push({ params })`) back into
 * `lib/frames.ts`'s `PaceMediaInput`. Kept as one pure function, tested directly, rather than
 * inlined in the screen — expo-router search params are always
 * `string | string[] | undefined`, and getting the numeric/shape validation wrong here would
 * either crash the extraction screen or silently hand `extractFrames` a bad `durationMs`
 * (`sampleTimestamps` throws on `durationMs <= 0`).
 */
import type { PaceMediaInput } from './frames';

type RouteParams = Partial<Record<'mediaType' | 'uri' | 'durationMs' | 'width' | 'height', string | string[]>>;

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function toPositiveNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Returns `null` for anything malformed — a missing/empty `uri`, an unrecognized `mediaType`,
 * or a numeric field that isn't a positive finite number. The screen treats `null` as the same
 * generic "couldn't process this clip" error it uses for any other extraction failure. */
export function parseCaptureParams(params: RouteParams): PaceMediaInput | null {
  const uri = firstString(params.uri);
  if (!uri) return null;

  const mediaType = firstString(params.mediaType);

  if (mediaType === 'video') {
    const durationMs = toPositiveNumber(firstString(params.durationMs));
    if (durationMs === null) return null;
    return { mediaType: 'video', uri, durationMs };
  }

  if (mediaType === 'photo') {
    const width = toPositiveNumber(firstString(params.width));
    const height = toPositiveNumber(firstString(params.height));
    if (width === null || height === null) return null;
    return { mediaType: 'photo', uri, width, height };
  }

  return null;
}
