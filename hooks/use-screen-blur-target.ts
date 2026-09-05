import { createContext, useContext, type RefObject } from 'react';
import type { View } from 'react-native';

/**
 * Android's `expo-blur` needs an explicit `blurTarget` ref to snapshot for its
 * `dimezisBlurView` method (iOS's compositor-level blur needs nothing extra) — without one it
 * silently falls back to no blur at all. `<ScreenGradient>` is the one thing every screen sits
 * on, so it owns the ref every `<GlassFrost>` on that screen blurs against; this context is how
 * a `GlassFrost` nested anywhere under a screen's `ScreenGradient` reaches it without prop-
 * drilling through every card/button in between.
 *
 * `undefined` (no provider, e.g. chrome rendered by a navigator outside any single screen's
 * `ScreenGradient`) is a legitimate value, not an error: `BlurView`'s own `blurTarget` prop is
 * already optional, and omitting it just means that specific surface degrades to the pre-SDK-57
 * "no blur on Android" fallback rather than crashing.
 */
export const ScreenBlurTargetContext = createContext<RefObject<View | null> | null>(null);

export function useScreenBlurTarget(): RefObject<View | null> | undefined {
  return useContext(ScreenBlurTargetContext) ?? undefined;
}
