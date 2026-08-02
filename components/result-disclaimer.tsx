/**
 * The "not medical advice" disclaimer (issue #68) — rendered on EVERY result, every tier, no
 * exceptions (copy-deck.md § Disclaimer).
 *
 * The string is `Copy.result.disclaimer.footer`, from the copy deck — NOT the differently-worded
 * version in `knowledge/injury_flags.md`, which is prompt content for the model. Issue #68 points
 * at the knowledge file; it is wrong.
 *
 * This is a component, not a route. M4 owns where it sits on the result screen.
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
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ResultDisclaimer() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text testID="result-disclaimer-text" style={styles.text}>
        {Copy.result.disclaimer.footer}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.base,
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      padding: Spacing.xl,
    },
    text: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * LineHeight.body,
    },
  });
}
