/**
 * The only way the app draws a frame that has not left the device yet — the Preparing and
 * Analysing screens' thumbnails, from the in-memory base64 JPEG `lib/frames.ts` extracted. The
 * sibling of `<PrivateFrameImage>` (which draws only signed `media` URLs): its source is built
 * from bytes by `lib/private-frame-image.ts`'s `deviceFrameSource`, and its cache policy is the
 * same `PRIVATE_FRAME_CACHE_POLICY` — no memory or disk cache — so an image of a person's body is
 * decoded for display and never written anywhere. Callers own layout, fit and accessibility; they
 * cannot set `source` or `cachePolicy`.
 */
import { Image, type ImageProps } from 'expo-image';
import { useMemo } from 'react';

import { PRIVATE_FRAME_CACHE_POLICY, deviceFrameSource } from '@/lib/private-frame-image';

type DeviceFrameImageProps = Omit<ImageProps, 'source' | 'cachePolicy' | 'placeholder'> & {
  /** Raw base64 JPEG bytes (`PaceFrame.base64`), no `data:` prefix. Anything else draws nothing. */
  base64: string;
};

export function DeviceFrameImage({ base64, ...rest }: DeviceFrameImageProps) {
  // Memoised on the bytes: the screens re-render every clock tick, and rebuilding a several-hundred-
  // KB data: URI (and a fresh source object) each time is wasted work for an unchanged frame.
  const source = useMemo(() => deviceFrameSource(base64), [base64]);
  // `placeholder` is forced off AFTER the spread, not just omitted from the type: expo-image on iOS
  // writes a placeholder to its disk cache whatever `cachePolicy` says, so a body image must never
  // reach that prop, even through a cast.
  return (
    <Image
      {...rest}
      source={source}
      cachePolicy={PRIVATE_FRAME_CACHE_POLICY}
      placeholder={undefined}
    />
  );
}
