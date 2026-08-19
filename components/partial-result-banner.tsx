/**
 * The "Partial read" banner (issue #56) — renders whenever an analysis outcome carries
 * `isFallback: true` (`docs/design/copy-deck.md`'s `result.partial.banner.*`).
 *
 * `isFallback: true` means the model produced an honest partial after a retry — the user is
 * entitled to know their result is partial, so this must never be hidden and never presented as
 * if it were a full result (issue #56). There was no existing `FallbackNotice`/equivalent
 * component in `components/` at the time this was built (checked before writing it) — this is
 * the drop-in `app/result/[id].tsx` renders above the PACE readout when `outcome.isFallback` is
 * true, and skips entirely otherwise.
 *
 * A neutral surface, not `Semantic.error` — a partial read is an honesty disclosure, not a
 * system failure or a low score, and `constants/theme.ts`'s own header comment is explicit that
 * `error` exists specifically so a system error is never visually confused with a score-scale
 * hue on this screen (issue #24).
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
import { formatPartialBannerBody } from '@/lib/pace-readout';

type Props = {
  /** How many of the four pillars carried a real score (`lib/pace-readout.ts`'s
   * `countAssessedPillars`) — interpolated into `result.partial.banner.body`'s `{n}`. */
  assessedCount: number;
  /** Which medium was submitted — interpolated into `result.partial.banner.body`'s `{medium}`
   * (M3, v23-ux-audit-r1: the banner used to always say "clip", even for a photo). */
  mediaType: 'photo' | 'video';
};

export function PartialResultBanner({ assessedCount, mediaType }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View testID="partial-result-banner" style={styles.container}>
      {/* A section heading, and marked as one: this banner is the first thing above the
          readout on its screen, so the rotor needs it as the entry point INTO that
          disclosure rather than only as prose a user reaches by swiping. Matches how
          `app/capture/extracting.tsx` and `app/settings.tsx` mark their own section
          titles. */}
      <Text testID="partial-banner-title" accessibilityRole="header" style={styles.title}>
        {Copy.result.partial.banner.title}
      </Text>
      <Text testID="partial-banner-body" style={styles.body}>
        {formatPartialBannerBody(assessedCount, mediaType)}
      </Text>
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
  });
}
