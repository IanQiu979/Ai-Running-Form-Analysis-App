/**
 * The parts the Preparing (`app/capture/extracting.tsx`) and Analysing (`app/analyzing.tsx`)
 * screens share (2026-10-06, Claude Design "Preparing & Analysing — V23"): the 56 pt header, a
 * frame tile, the checklist, the stop-state icon box and headline, the "not counted" line, and the
 * two motions — the in-progress pulse and the viewer's scan line.
 *
 * FRAMES ARE THE RUNNER'S OWN. A tile draws the real extracted frame (`<DuotoneFrame
 * deviceBase64>`, the app's duotone grade, no cache) — never the page's stick-figure placeholder —
 * and carries "Frame 2 of 5" for a screen reader.
 *
 * REDUCED MOTION. Every motion here takes `reduceMotion` and, when it is set, renders its first
 * frame and stops: the pulse holds at full opacity, the scan line is not mounted at all. The page
 * draws the same reduced-motion artboards.
 */
import { memo, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { DuotoneFrame } from '@/components/duotone-frame';
import {
  AlertIcon,
  ChevronLeftIcon,
  ClockIcon,
  GaugeIcon,
  LockIcon,
  TickIcon,
  WifiOffIcon,
} from '@/components/ui/v23-icons';
import { Chrome, Ink, Layout, Motion, Space, Type } from '@/constants/v23-theme';

// -------------------------------------------------------------------------------------------
// Motion
// -------------------------------------------------------------------------------------------

/** Breathes its children between full and `Motion.loading.pulseFloor` opacity while `active`. */
export function Pulse({
  active,
  reduceMotion,
  children,
  style,
  testID,
}: {
  active: boolean;
  reduceMotion: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const opacity = useSharedValue(1);
  const running = active && !reduceMotion;

  useEffect(() => {
    if (!running) {
      cancelAnimation(opacity);
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(
      withTiming(Motion.loading.pulseFloor, {
        duration: Motion.loading.pulse / 2,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true
    );
    return () => cancelAnimation(opacity);
  }, [running, opacity]);

  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View testID={testID} style={[style, animated]}>
      {children}
    </Animated.View>
  );
}

/**
 * The one motion over the frame viewer while it reads: a 1 pt line travelling down and back up.
 * It stands for "reading", and only that — no skeleton, no joint markers: nothing on the device
 * tracks a pose, and the screen must not imply it does. Not mounted under reduced motion.
 */
export function ScanLine({ testID }: { testID?: string }) {
  const [travel, setTravel] = useState<number | null>(null);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (travel === null) return;
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: Motion.loading.scan, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    return () => cancelAnimation(progress);
  }, [travel, progress]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: SCAN_INSET + progress.value * Math.max(0, (travel ?? 0) - 2 * SCAN_INSET) }],
  }));

  function handleLayout(event: LayoutChangeEvent) {
    setTravel(event.nativeEvent.layout.height);
  }

  return (
    <View
      testID={testID}
      style={StyleSheet.absoluteFill}
      onLayout={handleLayout}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.scanLine, lineStyle]} />
    </View>
  );
}

/** The page's 10 pt margin at each end of the scan's travel. */
const SCAN_INSET = Layout.loading.stackGap;

// -------------------------------------------------------------------------------------------
// Header
// -------------------------------------------------------------------------------------------

/** The pages' 56 pt header: a leading slot (Back, or an eyebrow) and a trailing mono readout. */
export function LoadingHeader({ leading, trailing }: { leading?: ReactNode; trailing?: ReactNode }) {
  return (
    <View style={styles.header}>
      {leading ?? <View />}
      {trailing}
    </View>
  );
}

/** The header's Back control: a 44 pt target around the page's chevron. */
export function HeaderBack({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={Space.xs}
      style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}>
      <ChevronLeftIcon />
    </Pressable>
  );
}

// -------------------------------------------------------------------------------------------
// Frames
// -------------------------------------------------------------------------------------------

export type FrameTileProps = {
  /** The frame's bytes when it exists on this device yet; `null` draws an empty slot. */
  base64: string | null;
  /** "Frame 2 of 5" — every tile is announced, empty or not. */
  accessibilityLabel: string;
  /** Bottom-left mono caption: a timestamp ("0.40s") or an index ("02"). */
  caption?: string;
  /** `now` rings the tile in `ink` and marks its corner; `done` fills it; `todo` is an outline. */
  status: 'done' | 'now' | 'todo';
  /** The page draws Preparing's tiles at 3:4 and Analysing's at 1:1. */
  aspectRatio: number;
  /** Pulses the `now` tile (Preparing). */
  pulse?: boolean;
  reduceMotion: boolean;
  testID?: string;
};

export const FrameTile = memo(function FrameTile({
  base64,
  accessibilityLabel,
  caption,
  status,
  aspectRatio,
  pulse = false,
  reduceMotion,
  testID,
}: FrameTileProps) {
  const body = (
    <View
      style={[
        styles.tile,
        { aspectRatio },
        status === 'now' && styles.tileNow,
        status === 'done' && styles.tileDone,
      ]}>
      {base64 ? (
        <DuotoneFrame
          deviceBase64={base64}
          accessibilityLabel={accessibilityLabel}
          style={StyleSheet.absoluteFill}
          testID={testID ? `${testID}-frame` : undefined}
        />
      ) : null}
      {caption ? (
        // Hidden from the a11y tree: the tile's label already names the frame.
        <View style={styles.tileCaptionBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.tileCaption}>{caption}</Text>
        </View>
      ) : null}
      {status === 'now' ? <View style={styles.tileMark} /> : null}
    </View>
  );

  return (
    <View
      testID={testID}
      style={styles.tileCell}
      // A tile with a frame is announced by its image; an empty one still needs its label.
      accessible={!base64}
      accessibilityLabel={base64 ? undefined : accessibilityLabel}>
      {status === 'now' && pulse ? (
        <Pulse active reduceMotion={reduceMotion}>
          {body}
        </Pulse>
      ) : (
        body
      )}
    </View>
  );
});

/** A row of tiles sharing the width equally, with the page's 6 pt gap. */
export function FrameStrip({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} style={[styles.strip, style]}>
      {children}
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// Checklist
// -------------------------------------------------------------------------------------------

export type ChecklistItem = {
  key: string;
  label: string;
  value: string;
  status: 'done' | 'now' | 'todo';
  /** The state in words for a screen reader ("done", "in progress", "not started"). */
  stateLabel: string;
};

/** Preparing's three steps on one raised card, hairline-ruled between rows. */
export function Checklist({ items, reduceMotion, testID }: { items: ChecklistItem[]; reduceMotion: boolean; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      {items.map((item, i) => (
        <View
          key={item.key}
          testID={testID ? `${testID}-${item.key}` : undefined}
          accessible
          accessibilityLabel={`${item.label}, ${item.value}, ${item.stateLabel}`}
          accessibilityState={{ busy: item.status === 'now' }}
          style={[styles.row, i > 0 && styles.rowRule]}>
          <View style={styles.rowGlyph}>
            {item.status === 'done' ? <TickIcon /> : null}
            {item.status === 'now' ? (
              <Pulse active reduceMotion={reduceMotion}>
                <View style={styles.rowMarkNow} />
              </Pulse>
            ) : null}
            {item.status === 'todo' ? <View style={styles.rowMarkTodo} /> : null}
          </View>
          <Text style={[styles.rowLabel, item.status === 'todo' && styles.rowLabelTodo]}>{item.label}</Text>
          <Text style={styles.rowValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** A key / value card (the out-of-analyses panel). */
export function KeyValueCard({ rows, testID }: { rows: { key: string; label: string; value: string }[]; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      {rows.map((row, i) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}, ${row.value}`}
          style={[styles.row, styles.rowBetween, i > 0 && styles.rowRule]}>
          <Text style={styles.kvLabel}>{row.label}</Text>
          <Text style={styles.kvValue}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

// -------------------------------------------------------------------------------------------
// Stop states
// -------------------------------------------------------------------------------------------

export type StopIconName = 'quota' | 'clock' | 'wifi' | 'alert' | 'lock';

function StopGlyph({ name, color, size, strokeWidth }: { name: StopIconName; color: string; size: number; strokeWidth: number }) {
  switch (name) {
    case 'quota':
      return <GaugeIcon color={color} size={size} strokeWidth={strokeWidth} />;
    case 'clock':
      return <ClockIcon color={color} size={size} strokeWidth={strokeWidth} />;
    case 'wifi':
      return <WifiOffIcon color={color} size={size} strokeWidth={strokeWidth} />;
    case 'alert':
      return <AlertIcon color={color} size={size} strokeWidth={strokeWidth} />;
    case 'lock':
      return <LockIcon color={color} size={size} strokeWidth={strokeWidth} />;
  }
}

/** Preparing's 48 pt hairline box around a stop state's icon. */
export function StopIconBox({ name, danger = false }: { name: StopIconName; danger?: boolean }) {
  return (
    <View style={styles.iconBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <StopGlyph name={name} color={danger ? Ink.danger : Ink.ink} size={24} strokeWidth={1.75} />
    </View>
  );
}

/**
 * A stop state's eyebrow, headline and body. The eyebrow takes `danger` only for a real failure;
 * a pause, an expired session, or a lost connection reads in `ink2`. `inlineIcon` is Analysing's
 * 16 pt glyph set before the eyebrow (Preparing draws `<StopIconBox>` above it instead).
 */
export function StopHeadline({
  eyebrow,
  title,
  body,
  danger = false,
  inlineIcon,
  testID,
}: {
  eyebrow: string;
  title: string;
  body: string;
  danger?: boolean;
  inlineIcon?: StopIconName;
  testID?: string;
}) {
  const tone = danger ? Ink.danger : Ink.ink2;
  return (
    <View style={styles.stopHeadline} testID={testID}>
      <View style={styles.eyebrowRow}>
        {inlineIcon ? (
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <StopGlyph name={inlineIcon} color={tone} size={16} strokeWidth={2} />
          </View>
        ) : null}
        <Text style={[Type.eyebrow, { color: tone }]}>{eyebrow}</Text>
      </View>
      <Text style={styles.stopTitle} accessibilityRole="header" accessibilityLabel={title}>
        {title}
      </Text>
      <Text style={styles.stopBody}>{body}</Text>
    </View>
  );
}

/** "Not counted against your quota" — boxed above Analysing's buttons, a centred note under Preparing's. */
export function NotCounted({ label, boxed, testID }: { label: string; boxed: boolean; testID?: string }) {
  return (
    <View testID={testID} style={boxed ? styles.notCountedBox : styles.notCountedNote} accessible accessibilityLabel={label}>
      <TickIcon color={boxed ? Ink.ink : Ink.ink2} size={boxed ? 16 : 14} />
      <Text style={boxed ? styles.notCountedBoxText : styles.notCountedNoteText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.6,
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: Layout.hairline,
    backgroundColor: Chrome.scan,
  },
  header: {
    height: Layout.loading.headerHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBack: {
    width: Layout.hitTarget,
    height: Layout.hitTarget,
    marginLeft: -Space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    flexDirection: 'row',
    gap: Layout.loading.tileGap,
  },
  tileCell: {
    flex: 1,
    minWidth: 0,
  },
  tile: {
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tileNow: {
    borderColor: Ink.ink,
    backgroundColor: Ink.bgRaised,
  },
  tileDone: {
    backgroundColor: Ink.bgPlaceholder,
  },
  // A chip of the page black under the caption, so it reads over a bright frame.
  tileCaptionBox: {
    position: 'absolute',
    left: Layout.loading.captionInset,
    bottom: Layout.loading.captionInset,
    paddingHorizontal: Layout.loading.captionInset,
    backgroundColor: Chrome.scrim,
  },
  tileCaption: {
    ...Type.monoMicro,
    color: Ink.ink,
  },
  tileMark: {
    position: 'absolute',
    left: Space.xs,
    top: Space.xs,
    width: Layout.loading.activeMark,
    height: Layout.loading.activeMark,
    backgroundColor: Ink.ink,
  },
  card: {
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
  },
  row: {
    minHeight: Layout.loading.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingHorizontal: Layout.loading.rowPadding,
  },
  rowBetween: {
    justifyContent: 'space-between',
  },
  rowRule: {
    borderTopWidth: Layout.hairline,
    borderTopColor: Ink.line,
  },
  rowGlyph: {
    width: Layout.loading.rowGlyph,
    height: Layout.loading.rowGlyph,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMarkNow: {
    width: Layout.loading.rowMark,
    height: Layout.loading.rowMark,
    backgroundColor: Ink.ink,
  },
  rowMarkTodo: {
    width: Layout.loading.rowMark,
    height: Layout.loading.rowMark,
    borderWidth: Layout.hairline,
    borderColor: Ink.ink3,
  },
  rowLabel: {
    ...Type.bodySm,
    flex: 1,
    color: Ink.ink,
  },
  rowLabelTodo: {
    color: Ink.ink2,
  },
  rowValue: {
    ...Type.monoValue,
    color: Ink.ink2,
    textTransform: 'uppercase',
  },
  kvLabel: {
    ...Type.bodySm,
    color: Ink.ink2,
  },
  kvValue: {
    ...Type.mono,
    color: Ink.ink,
    textTransform: 'uppercase',
  },
  iconBox: {
    width: Layout.loading.iconBox,
    height: Layout.loading.iconBox,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopHeadline: {
    gap: Layout.loading.stackGap,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
  },
  stopTitle: {
    ...Type.displayLg,
    color: Ink.ink,
  },
  stopBody: {
    ...Type.lead,
    color: Ink.ink2,
  },
  notCountedBox: {
    minHeight: Layout.loading.row,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Layout.loading.stackGap,
    paddingHorizontal: Layout.loading.rowPadding,
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
  },
  notCountedBoxText: {
    ...Type.bodySm,
    color: Ink.ink,
  },
  notCountedNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Layout.loading.noteGap,
  },
  notCountedNoteText: {
    ...Type.small,
    color: Ink.ink2,
  },
});
