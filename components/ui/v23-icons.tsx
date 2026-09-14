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

/** The tick inside a checked consent box: a 10 x 8 polyline in `onAccent` on the `ink` fill. */
export function CheckIcon({ color = Ink.onAccent, size = 10, testID }: IconProps) {
  const height = (size * 8) / 10;
  return (
    <Svg width={size} height={height} viewBox="0 0 12 9" fill="none" stroke={color} strokeWidth={1.5} testID={testID} {...HIDDEN}>
      <Polyline points="1,4.5 4.5,8 11,1" />
    </Svg>
  );
}
