/**
 * The only way the app draws a user's stored running frame. A thin `expo-image` wrapper whose
 * source and cache policy are fixed by `lib/private-frame-image.ts` — signed `media` URLs only,
 * no memory or disk cache — so no caller can opt a body image into a cache, or render a link
 * that is not signed, by passing a prop. Callers own layout, fit, accessibility and error
 * handling; they cannot set `source` or `cachePolicy`.
 */
import { Image, type ImageProps } from 'expo-image';

import { PRIVATE_FRAME_CACHE_POLICY, privateFrameSource } from '@/lib/private-frame-image';

type PrivateFrameImageProps = Omit<ImageProps, 'source' | 'cachePolicy' | 'placeholder'> & {
  /** A signed URL from `createSignedUrls`. Anything else draws nothing. */
  uri: string;
};

export function PrivateFrameImage({ uri, ...rest }: PrivateFrameImageProps) {
  return <Image {...rest} source={privateFrameSource(uri)} cachePolicy={PRIVATE_FRAME_CACHE_POLICY} />;
}
