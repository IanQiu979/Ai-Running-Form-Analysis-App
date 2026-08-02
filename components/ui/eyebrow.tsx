/**
 * The tiny tracked-out uppercase micro-label — the reference's "NARRATOR" / "AUTHOR" register.
 *
 * It is the redesign's main hierarchy tool below the display sizes: it lets a screen name what a
 * value IS without spending a heading on it, which is how the reference keeps enormous type on one
 * element and still labels everything around it. Anywhere the old design would have set a 15pt
 * sentence-case label above a value, this goes instead.
 *
 * `text.secondary` by default — proven on every opaque surface in both schemes. `tone="primary"`
 * exists for the one case the wash forces: on the page gradient, secondary text is NOT proven (see
 * `Gradient`'s contract in constants/theme.ts) and an eyebrow there must be primary.
 *
 * Not `textTransform: 'uppercase'` on arbitrary content by accident: callers pass sentence-case
 * copy from the copy deck and this uppercases it for display only. Screen readers read the
 * underlying string, so `accessibilityLabel` is never needed to undo it.
 */
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';

import { Colors, FontFamily, FontSize, Tracking } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type EyebrowProps = {
  children: string;
  /** `secondary` (default) needs an opaque surface. Use `primary` on the page gradient. */
  tone?: 'secondary' | 'primary';
  /** Pass `"header"` where this eyebrow is genuinely the screen's heading rather than a label
   *  above a value — several screens in the redesign demote a former 24pt title into this
   *  register, and the a11y role must move with the text, not with the font size. */
  accessibilityRole?: 'text' | 'header';
  style?: StyleProp<TextStyle>;
  testID?: string;
};

export function Eyebrow({
  children,
  tone = 'secondary',
  accessibilityRole,
  style,
  testID,
}: EyebrowProps) {
  const scheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];

  return (
    <Text
      testID={testID}
      accessibilityRole={accessibilityRole}
      style={[
        styles.eyebrow,
        { color: tone === 'primary' ? colors.text.primary : colors.text.secondary },
        style,
      ]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  eyebrow: {
    fontFamily: FontFamily.body.semiBold,
    fontSize: FontSize.xs,
    letterSpacing: Tracking.eyebrow,
    textTransform: 'uppercase',
  },
});
