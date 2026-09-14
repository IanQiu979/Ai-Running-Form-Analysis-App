/**
 * The lane-2 pages' card: `bgRaised` fill, 1 px `line` border, square corners, 16 or 24 pt of
 * padding — the box every one of V23-07..12 draws its content in (the recent analysis, a quota
 * caption, a pillar row, a history row, a source card, a tier card, a settings section, a confirm
 * dialog). Opaque on purpose: it is the surface `ink2` copy is proven on
 * (`constants/__tests__/v23-theme-contrast.test.ts`).
 *
 * `tone="selected"` is V23-11's current-plan card, a half step lighter. `dashed` is V23-07's empty
 * state — a border and NO fill, so the box reads as an outline of where a result will go rather
 * than as a card with nothing in it.
 *
 * A plain `View`, not a `Pressable`: a card that is tappable (Home's recent analysis, a source
 * card) wraps this in its own `Pressable` so the a11y role and label live on the control.
 */
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Ink, Layout } from '@/constants/v23-theme';

type SquareCardProps = ViewProps & {
  children?: ReactNode;
  /** 16 (`Layout.cardPadding`, the default) or 24 (`Layout.cardPaddingLg`) on every side. Pass 0
   *  when a child draws its own rows edge to edge (V23-12's settings sections pad horizontally
   *  only). */
  padding?: number;
  tone?: 'raised' | 'selected';
  dashed?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function SquareCard({
  children,
  padding = Layout.cardPadding,
  tone = 'raised',
  dashed = false,
  style,
  ...viewProps
}: SquareCardProps) {
  return (
    <View
      {...viewProps}
      style={[
        styles.base,
        dashed ? styles.dashed : tone === 'selected' ? styles.selected : styles.raised,
        { padding },
        style,
      ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
  },
  raised: {
    backgroundColor: Ink.bgRaised,
  },
  selected: {
    backgroundColor: Ink.bgSelected,
  },
  dashed: {
    borderStyle: 'dashed',
  },
});
