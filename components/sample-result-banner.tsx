/**
 * The sample-preview banner on `/result/sample` (captain-approved 2026-07-26, Free tier's
 * zero-model-call preview) — the App-Store-policy/refund-dispute-risk control the whole feature
 * exists for: this MUST read as "here's an example of what Pro returns," never as "here's what
 * we found in your photo." Directly modeled on `components/partial-result-banner.tsx`'s shape (a
 * neutral, opaque `colors.surface.raised` panel — never the bare page gradient, whose contract
 * carries `text.primary` only, per CLAUDE.md's Gradient/Glass token rules) since both are the same
 * kind of thing: an honesty disclosure about the readout that follows, not a system error.
 *
 * The upgrade CTA lives INSIDE this banner, immediately under the labeling copy — not at the
 * bottom of the screen — so the disclosure and the upgrade path are visually one unit, per the
 * captain's "clear upgrade path shown adjacent to it" instruction.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  LineHeight,
  Radius,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

import { PillButton } from './ui/pill-button';

type Props = {
  onUpgradePress: () => void;
};

export function SampleResultBanner({ onUpgradePress }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View testID="sample-result-banner" style={styles.container}>
      <Text testID="sample-banner-title" style={styles.title}>
        {Copy.result.sample.banner.title}
      </Text>
      <Text testID="sample-banner-body" style={styles.body}>
        {Copy.result.sample.banner.body}
      </Text>
      <PillButton
        label={Copy.result.sample.cta.upgrade}
        onPress={onUpgradePress}
        testID="sample-banner-upgrade"
        style={styles.cta}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      gap: Spacing.xs,
      padding: Spacing.xl,
    },
    title: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      letterSpacing: Tracking.display,
    },
    body: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
      lineHeight: FontSize.sm * LineHeight.body,
    },
    cta: {
      marginTop: Spacing.sm,
    },
  });
}
