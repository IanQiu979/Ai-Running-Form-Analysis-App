/**
 * The frost behind every translucent surface in the app — one layer, so "what glass is made of" is
 * decided once rather than at each call site.
 *
 * Added 2026-08-02 (pass 3) when the captain overrode the redesign's decision to ship `Glass`
 * effectively unused on controls. It renders as an absolutely-positioned sibling INSIDE whatever it
 * frosts — the caller owns the shape (`borderRadius` + `overflow: 'hidden'`) and the ring, this
 * owns the material.
 *
 * TWO LAYERS, and the order is load-bearing for the contrast proof:
 *
 *   1. `<BlurView>` — the real backdrop blur, so this is frosted glass rather than a flat wash.
 *      Native on iOS, `dimezisBlurView` on Android (`blurMethod`, which is what makes it do
 *      anything there at all — and, as of SDK 55, useless without `blurTarget` pointing at a
 *      `<BlurTargetView>` too; see hooks/use-screen-blur-target.ts for where that ref comes
 *      from), and a plain translucent layer on web.
 *   2. The `Glass[scheme][tone]` token, painted over it.
 *
 * WHY THE PROOF STILL HOLDS WITH A BLUR IN THE STACK. `constants/__tests__/theme-contrast.test.ts`
 * composites the TOKEN ALONE over each legal backdrop — it cannot model a native blur. That is
 * sound here, and not by luck: the blur's own material tint is pinned to the active scheme, so it
 * can only ever move a composite in the SAFE direction. In dark mode a `dark` blur darkens the
 * backdrop, which raises the contrast of the light foregrounds (white text, the pale
 * `control.border` ring) the dark tones are proven for. In light mode a `light` blur lightens it,
 * which raises the contrast of the dark foregrounds (`text.primary`, the darker ring) the light
 * tones are proven for. Every proven pair therefore measures at LEAST its proven ratio on device,
 * never less — and if the blur silently fails to render on some platform, the token layer alone is
 * exactly what the test proved. The blur is never load-bearing for legibility.
 *
 * REDUCED MOTION does not apply: this layer does not move. It is material, not motion.
 */
import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, View } from 'react-native';

import { Glass, type GlassColors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useScreenBlurTarget } from '@/hooks/use-screen-blur-target';

/**
 * Blur strength, 0-100. Deliberately mid-range: heavy enough that the wash behind a control reads
 * as diffused rather than as a flat tint, light enough that the gradient's own top-to-bottom
 * journey is still legible through a full-width bar. Not a token — nothing outside this file has
 * any business choosing a blur radius, and `constants/theme.ts` does not publish tokens with one
 * consumer.
 */
const BLUR_INTENSITY = 28;

type GlassFrostProps = {
  /** Which `Glass` tone paints over the blur. `control`/`chrome` carry contract obligations —
   *  read the contract at `Glass` in constants/theme.ts before picking one. */
  tone: keyof GlassColors;
  /** Round the frost itself, for a caller that cannot clip it. Most callers leave this unset and
   *  clip with their own `borderRadius` + `overflow: 'hidden'`; the floating tab bar cannot, because
   *  `overflow: 'hidden'` there would also mask its `Elevation.floating` shadow. */
  radius?: number;
  testID?: string;
};

export function GlassFrost({ tone, radius, testID }: GlassFrostProps) {
  const scheme = useColorScheme() ?? 'light';
  const blurTarget = useScreenBlurTarget();

  return (
    <View
      style={[StyleSheet.absoluteFill, radius !== undefined && { borderRadius: radius, overflow: 'hidden' }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}>
      <BlurView
        intensity={BLUR_INTENSITY}
        // Pinned to the scheme — see this file's header for why that is what keeps the composite
        // on the safe side of every proven ratio.
        tint={scheme}
        // Android draws nothing at all without both of these — blurTarget undefined (no
        // <ScreenGradient> ancestor, e.g. chrome rendered by a navigator) degrades gracefully to
        // no blur there rather than crashing; iOS and web ignore both props.
        blurTarget={blurTarget}
        blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
        style={StyleSheet.absoluteFill}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Glass[scheme][tone] }]} />
    </View>
  );
}
