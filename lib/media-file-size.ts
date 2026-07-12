/**
 * Best-effort local file size, in bytes, for a picked/recorded media file. `expo-image-picker`'s
 * `ImagePickerAsset.fileSize` is already optional (not every platform/content provider reports
 * it), and `expo-camera`'s `recordAsync` doesn't report a size at all — this is the fallback
 * both `app/capture/index.tsx` (library pick) and `app/capture/extracting.tsx` (pre-flight
 * re-check) use to feed `lib/media-caps.ts`'s `checkMediaCaps`.
 */
import { File } from 'expo-file-system';

/** Never throws. Returns `null` — "unknown", the same thing an omitted `fileSizeBytes` means to
 * `checkMediaCaps` — for a URI that can't be statted (expired cache path, malformed URI, a
 * platform that doesn't support the new `File` API for this location). */
export function readFileSizeBytes(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return typeof size === 'number' ? size : null;
  } catch {
    return null;
  }
}
