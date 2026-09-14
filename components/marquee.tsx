/**
 * The ticker — Home's one piece of standing typographic furniture (V23-07's `v23tick` strip).
 *
 * It runs the four PACE pillar names across the screen, continuously, at a constant rate. That is
 * not decoration for its own sake: the four pillars ARE the product's vocabulary, and a user who
 * has not yet submitted anything has no other way to learn what the app is going to measure. The
 * marquee teaches them while the screen is otherwise idle.
 *
 * HOW THE LOOP IS SEAMLESS: the item list is rendered TWICE, back to back, inside a row that is
 * translated left by exactly the width of one copy and then reset — the page's
 * `@keyframes v23tick { to { transform: translateX(-50%) } }` over two copies. At the instant of
 * reset the second copy is sitting precisely where the first was, so the seam is invisible and
 * there is no gap to time. Width is measured with `onLayout` rather than assumed, so the loop is
 * correct at any Dynamic Type size — an assumed width is how a marquee ends up stuttering on a
 * large-text device.
 *
 * THE LOOP IS A FIXED DURATION: `animation: v23tick 18s linear infinite` — one copy width per
 * `Motion.marqueeLoop`, whatever that width measures. The page sets a period, not a speed, so a
 * longer list would travel faster rather than take longer; with four fixed pillar names the
 * distinction never shows, and the page's number is the one that is kept.
 *
 * THE CURVE IS `linear` AND MUST BE: any eased curve makes a continuous loop visibly pulse at
 * every seam, because the animation restarts at its own slowest point. `Motion.curve.linear`
 * exists in the token file for exactly this.
 *
 * REDUCED MOTION: no travel at all. One static copy renders, left-aligned, and the second copy is
 * not mounted. A perpetually scrolling strip is a textbook vestibular trigger and there is no
 * "gentler" version of it worth shipping — it stops.
 *
 * ACCESSIBILITY: the strip is one accessible node labelled with the item list read once, and the
 * duplicated copy is hidden. Without that, a screen reader would announce every pillar twice.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Motion, Space } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

type MarqueeProps = {
  /** Rendered in order, then repeated. */
  items: readonly string[];
  /** Drawn between items — the page's middot. */
  separator?: string;
  textStyle?: StyleProp<TextStyle>;
  separatorStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function Marquee({
  items,
  separator = '·',
  textStyle,
  separatorStyle,
  style,
  testID,
}: MarqueeProps) {
  const reduceMotion = useReducedMotion();
  // Measured, not assumed — see this file's header. Null until the first copy has laid out.
  const [copyWidth, setCopyWidth] = useState<number | null>(null);
  const translate = useSharedValue(0);

  const animate = !reduceMotion && copyWidth !== null && copyWidth > 0;

  useEffect(() => {
    if (!animate || copyWidth === null) {
      translate.value = 0;
      return;
    }
    translate.value = 0;
    translate.value = withRepeat(
      withTiming(-copyWidth, {
        duration: Motion.marqueeLoop,
        easing: Easing.bezier(...Motion.curve.linear),
      }),
      -1,
      false
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- translate is a stable shared value
  }, [animate, copyWidth]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translate.value }],
  }));

  const label = items.join(` ${separator} `);

  return (
    <View
      testID={testID}
      style={[styles.clip, style]}
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}>
      <Animated.View style={[styles.row, !reduceMotion && animatedStyle]}>
        <Copy
          items={items}
          separator={separator}
          textStyle={textStyle}
          separatorStyle={separatorStyle}
          onWidth={setCopyWidth}
        />
        {/* The trailing duplicate that makes the seam invisible. Never mounted under reduced
            motion — nothing scrolls, so nothing needs to follow. */}
        {!reduceMotion && (
          <Copy items={items} separator={separator} textStyle={textStyle} separatorStyle={separatorStyle} />
        )}
      </Animated.View>
    </View>
  );
}

function Copy({
  items,
  separator,
  textStyle,
  separatorStyle,
  onWidth,
}: {
  items: readonly string[];
  separator: string;
  textStyle: StyleProp<TextStyle>;
  separatorStyle: StyleProp<TextStyle>;
  onWidth?: (width: number) => void;
}) {
  return (
    <View
      style={styles.row}
      onLayout={onWidth ? (e) => onWidth(e.nativeEvent.layout.width) : undefined}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {items.map((item, index) => (
        <View key={`${item}-${index}`} style={styles.item}>
          <Text style={textStyle} numberOfLines={1}>
            {item}
          </Text>
          <Text style={separatorStyle ?? textStyle} numberOfLines={1}>
            {separator}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    width: '100%',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  // The page's copy is "Posture · Arm swing · Cadence · Elasticity · " with `padding-right:16px`
  // on the whole span: a word space either side of each dot, and the span's own 16 pt after its
  // last dot. Drawn per item as 8 pt around the dot and 16 pt after it, so every join — the
  // seam between the two copies included — measures the same.
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Space.sm,
    paddingRight: Space.lg,
  },
});
