/**
 * The redesign's two panel shapes, in one file because they are the same object at two opacities
 * and choosing between them is a contrast decision, not a styling one.
 *
 * `<SurfaceCard>` — OPAQUE. `surface.base` or `surface.raised`, rounded `Radius.card`. Anything
 * carrying secondary text, score text, score fills or coaching prose goes here. This is the
 * workhorse; on the gradient it reads exactly like the reference's content-detail panel sitting
 * under its hero.
 *
 * `<GlassCard>` — TRANSLUCENT. `Glass.fill`/`Glass.raised`, so the page wash shows through.
 * Carries `text.primary` ONLY, and is never an interactive control's fill or boundary. Both limits
 * are `Glass`'s own token contract (constants/theme.ts) rather than this file's invention, and both
 * are proven by composition in `constants/__tests__/theme-contrast.test.ts` — see that contract for
 * why an 8-12% wash cannot meet WCAG 1.4.11's 3:1 control-boundary floor at any alpha that is still
 * meaningfully translucent.
 *
 * Neither draws a shadow by default. `elevated` opts into `Elevation.resting`; the heavier
 * `Elevation.floating` is reserved for things that actually float over scrolling content (the tab
 * bar, a sticky action bar) and is applied at those call sites, not offered as a prop here.
 *
 * This pair REPLACES `components/ui/notched-card.tsx`, which drew a notched, square-cornered plate
 * — the signature shape of the "Gait Plate" language the Calm redesign supersedes. That file and
 * its test are deleted rather than left as dead scaffolding.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Elevation, Glass, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type CardProps = {
  children?: ReactNode;
  /** `base` is the default panel; `raised` is the one most-prominent panel per screen. */
  tone?: 'base' | 'raised';
  /** Add `Elevation.resting`. Off by default — most panels on the wash read fine unshadowed. */
  elevated?: boolean;
  /** Draw the decorative hairline edge. On by default; the edge is what stops a low-contrast panel
   *  from dissolving into the wash behind it. */
  bordered?: boolean;
  /** Override the default `Spacing.xl` interior padding — pass 0 for a card that holds full-bleed
   *  media, which must reach its own rounded corners. */
  padding?: number;
  /** Android-only live-region announcement. Needed because several banners that were a plain
   *  `<View accessibilityLiveRegion="polite">` became cards in the redesign, and silently dropping
   *  the prop would have removed the Android announcement. iOS is covered by those screens' own
   *  `useAnnounce` calls. */
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function SurfaceCard(props: CardProps) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  return (
    <Card
      {...props}
      fill={props.tone === 'raised' ? colors.surface.raised : colors.surface.base}
      edge={colors.hairline}
    />
  );
}

export function GlassCard(props: CardProps) {
  const scheme = useColorScheme() ?? 'light';
  const glass = Glass[scheme];
  return (
    <Card
      {...props}
      fill={props.tone === 'raised' ? glass.raised : glass.fill}
      edge={glass.hairline}
    />
  );
}

/**
 * TWO nodes, not one, and the split is load-bearing on iOS: `overflow: 'hidden'` compiles to
 * `masksToBounds` on the backing layer, which clips the layer's own shadow as well as its children
 * — so a single node cannot both clip full-bleed media to its corner AND cast an elevation shadow.
 * The outer node owns the shadow and the radius; the inner node owns the fill, the border and the
 * clipping. Rendered unconditionally rather than only when `elevated`, so the tree shape (and any
 * `testID` depth a test walks) never changes with a styling prop.
 */
function Card({
  children,
  elevated = false,
  bordered = true,
  padding = Spacing.xl,
  accessibilityLiveRegion,
  style,
  testID,
  fill,
  edge,
}: CardProps & { fill: string; edge: string }) {
  return (
    <View
      testID={testID}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[styles.shadow, elevated && Elevation.resting, style]}>
      <View
        style={[
          styles.clip,
          { backgroundColor: fill, padding },
          bordered && { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: edge },
        ]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    borderRadius: Radius.card,
  },
  clip: {
    borderRadius: Radius.card,
    // Media and gradients inside a card must be clipped to its corner, or a full-bleed child
    // squares off the very shape this component exists to establish.
    overflow: 'hidden',
  },
});
