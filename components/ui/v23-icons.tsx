/**
 * The lane-2 pages' glyphs (V23-07..12), traced from the pages' own inline SVGs — every one is a
 * one-stroke line drawing (`stroke-width` 1.3–1.4, no fill) on the same viewBox the page drew it
 * on, so it renders at the page's pixel size with nothing re-interpreted. Colour is a prop because
 * the pages draw the same glyph in `ink` (active tab, top bar) and `ink2` (inactive tab, the
 * pillar info button).
 *
 * Decorative by default — a glyph inside a labelled control has nothing to say on its own — so
 * each hides itself from the accessibility tree; the `Pressable` around it carries the label.
 */
import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

import { Ink } from '@/constants/v23-theme';

type IconProps = {
  color?: string;
  size?: number;
  testID?: string;
};

const HIDDEN = {
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants' as const,
};

/** The Settings control on Home's and History's top bar: two rails, two sliders. 20 pt. */
export function SettingsIcon({ color = Ink.ink, size = 20, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Line x1="2" y1="6" x2="18" y2="6" />
      <Line x1="2" y1="14" x2="18" y2="14" />
      <Circle cx="7" cy="6" r="2.2" fill={Ink.bg} />
      <Circle cx="13" cy="14" r="2.2" fill={Ink.bg} />
    </Svg>
  );
}

/** A pushed screen's Back control. 20 pt. */
export function BackIcon({ color = Ink.ink, size = 20, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Line x1="18" y1="10" x2="3" y2="10" />
      <Polyline points="9,4 3,10 9,16" />
    </Svg>
  );
}

/** The arrow after Home's primary CTA label. 14 pt, drawn in `onAccent`. */
export function ArrowRightIcon({ color = Ink.onAccent, size = 14, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Line x1="1" y1="7" x2="13" y2="7" />
      <Polyline points="8,2 13,7 8,12" />
    </Svg>
  );
}

/** The Home tab. 22 pt. */
export function HomeIcon({ color = Ink.ink, size = 22, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Path d="M3 10.5 11 3l8 7.5V19H3z" />
    </Svg>
  );
}

/** The History tab: a clock. 22 pt. */
export function HistoryIcon({ color = Ink.ink2, size = 22, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 22 22" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Circle cx="11" cy="11" r="8" />
      <Polyline points="11,6 11,11 15,13" />
    </Svg>
  );
}

/** The per-pillar detail control on the result rows. 18 pt, `ink2`. */
export function InfoIcon({ color = Ink.ink2, size = 18, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke={color} strokeWidth={1.3} testID={testID} {...HIDDEN}>
      <Circle cx="9" cy="9" r="7.5" />
      <Line x1="9" y1="8" x2="9" y2="13" />
      <Circle cx="9" cy="5.5" r="0.6" fill={color} />
    </Svg>
  );
}

/** The result disclaimer's disclosure chevron (2026-10-05). Not traced from a page — the pages
 *  draw the disclaimer open — so it is drawn in the sheet's own idiom: one 1.4 stroke, no fill.
 *  Points down; the disclaimer turns it to point up while open. 12 pt, `ink2`. */
export function ChevronDownIcon({ color = Ink.ink2, size = 12, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Polyline points="2,4 6,8 10,4" />
    </Svg>
  );
}

/** The source picker's Upload badge: a landscape with a sun. 24 pt. */
export function UploadIcon({ color = Ink.ink, size = 24, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Rect x="3" y="4" width="18" height="16" />
      <Polyline points="3,16 9,10 14,15 17,12 21,16" />
      <Circle cx="16" cy="8" r="1.5" />
    </Svg>
  );
}

/** The source picker's Record badge: a camera body and lens flap. 24 pt. */
export function RecordIcon({ color = Ink.ink, size = 24, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Rect x="3" y="7" width="13" height="10" />
      <Polyline points="16,10 21,7 21,17 16,14" />
    </Svg>
  );
}

/** The full-screen frame viewer's Close control: two crossed strokes. 20 pt. */
export function CloseIcon({ color = Ink.ink, size = 20, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke={color} strokeWidth={1.4} testID={testID} {...HIDDEN}>
      <Line x1="4" y1="4" x2="16" y2="16" />
      <Line x1="16" y1="4" x2="4" y2="16" />
    </Svg>
  );
}

/** The tick inside a checked consent box: a 10 x 8 polyline in `onAccent` on the `ink` fill. */
export function CheckIcon({ color = Ink.onAccent, size = 10, testID }: IconProps) {
  const height = (size * 8) / 10;
  return (
    <Svg width={size} height={height} viewBox="0 0 12 9" fill="none" stroke={color} strokeWidth={1.5} testID={testID} {...HIDDEN}>
      <Polyline points="1,4.5 4.5,8 11,1" />
    </Svg>
  );
}

// --- The Preparing / Analysing pages (2026-10-06). Traced from those pages' inline SVGs: a 24 pt
// viewBox, square caps, stroke 1.75 at the 24 pt state-icon size and 2 at the 16 pt row size. ---

type StateIconProps = IconProps & { strokeWidth?: number };

/** Those pages' Back control: a single chevron. 22 pt. */
export function ChevronLeftIcon({ color = Ink.ink, size = 22, testID }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

/** A done checklist row, and the "Not counted against your quota" line. 16 pt. */
export function TickIcon({ color = Ink.ink, size = 16, strokeWidth = 2, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

/** Out of analyses: a gauge at its stop. */
export function GaugeIcon({ color = Ink.ink, size = 24, strokeWidth = 1.75, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Path d="M4 17a8 8 0 1 1 16 0" />
      <Path d="M12 17l4-5" />
      <Path d="M4 20h16" />
    </Svg>
  );
}

/** A pause or a timeout. */
export function ClockIcon({ color = Ink.ink, size = 24, strokeWidth = 1.75, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

/** No connection: a struck-through signal. */
export function WifiOffIcon({ color = Ink.ink, size = 24, strokeWidth = 1.75, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Path d="M3 3l18 18" />
      <Path d="M8.5 16a5 5 0 0 1 7 0" />
      <Path d="M5 12.5a10 10 0 0 1 4-2.4" />
      <Path d="M15.5 10.4A10 10 0 0 1 19 12.5" />
      <Path d="M12 19.5h.01" />
    </Svg>
  );
}

/** A failure: a warning triangle. */
export function AlertIcon({ color = Ink.danger, size = 24, strokeWidth = 1.75, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" strokeLinejoin="miter" testID={testID} {...HIDDEN}>
      <Path d="M12 3.5l9 16.5H3z" />
      <Path d="M12 10v4.5" />
      <Path d="M12 17.2h.01" />
    </Svg>
  );
}

/** A session that ended: a padlock. */
export function LockIcon({ color = Ink.ink2, size = 16, strokeWidth = 2, testID }: StateIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="square" testID={testID} {...HIDDEN}>
      <Rect x="5" y="11" width="14" height="9" />
      <Path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}
