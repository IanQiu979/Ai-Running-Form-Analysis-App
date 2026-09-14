/**
 * The lane-2 pages' top chrome row — the 44 pt line under the top safe area that every one of
 * V23-07..12 opens with. Two compositions, both drawn on the pages:
 *
 *   centred   `[control | spacer] [LABEL, centred] [control | spacer]`   Home, Capture, Record
 *   leading   `[Back] ─16─ [title, flex]`                                 Settings, Paywall
 *
 * A control is a `<SquareIconButton>` with the matching `bleed`; a missing side gets a 44 pt
 * spacer so the centred label stays centred. The title is `Type.label` in `ink` (the pages'
 * "HOME", "ADD FOOTAGE", "SETTINGS") or, for the paywall, `Type.displaySm` set 4 pt down so its
 * cap height sits level with the back glyph. It carries `accessibilityRole="header"` — it is the
 * screen's name.
 *
 * Owns no safe-area padding: the screen's scroll container pays the top inset
 * (`Math.max(insets.top, Layout.canvas.safeTop)`, as the entry flow does), and this row sits
 * directly under it.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Ink, Layout, Space, Type } from '@/constants/v23-theme';

type TopBarProps = {
  title?: string;
  titleRole?: 'label' | 'displaySm';
  leading?: ReactNode;
  trailing?: ReactNode;
  align?: 'center' | 'leading';
  style?: StyleProp<ViewStyle>;
  testID?: string;
  titleTestID?: string;
};

export function TopBar({
  title,
  titleRole = 'label',
  leading,
  trailing,
  align = 'center',
  style,
  testID,
  titleTestID,
}: TopBarProps) {
  const titleStyle = titleRole === 'displaySm' ? [Type.displaySm, styles.displayTitle] : [Type.label, styles.labelTitle];

  if (align === 'leading') {
    return (
      <View testID={testID} style={[styles.row, titleRole === 'displaySm' && styles.rowTop, style]}>
        {leading}
        {title !== undefined ? (
          <Text testID={titleTestID} accessibilityRole="header" style={[titleStyle, styles.leadingTitle]}>
            {title}
          </Text>
        ) : null}
        {trailing}
      </View>
    );
  }

  return (
    <View testID={testID} style={[styles.row, styles.rowBetween, style]}>
      {leading ?? <View style={styles.spacer} />}
      {title !== undefined ? (
        <Text testID={titleTestID} accessibilityRole="header" style={[titleStyle, styles.centredTitle]} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.flex} />
      )}
      {trailing ?? <View style={styles.spacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: Layout.topBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.lg,
  },
  rowTop: {
    alignItems: 'flex-start',
  },
  rowBetween: {
    justifyContent: 'space-between',
  },
  spacer: {
    width: Layout.hitTarget,
    height: Layout.hitTarget,
  },
  flex: {
    flex: 1,
  },
  labelTitle: {
    color: Ink.ink,
  },
  displayTitle: {
    color: Ink.ink,
    paddingTop: Space.xs,
  },
  centredTitle: {
    flex: 1,
    textAlign: 'center',
  },
  leadingTitle: {
    flex: 1,
  },
});
