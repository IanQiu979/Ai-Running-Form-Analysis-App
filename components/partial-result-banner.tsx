/**
 * The "Partial read" banner (issue #56; V23-08's second artboard) — renders whenever fewer than
 * four pillars carried a real score (`app/result/[id].tsx` gates it on `countAssessedPillars`,
 * not on the server's `isFallback` flag — a legitimate photo submission scores 2 of 4).
 *
 * A partial read is an honesty disclosure the user is entitled to, so this must never be hidden
 * and never presented as if it were a full result. It is a plain `<SquareCard>` — the page draws
 * it in the same box as everything else, with no error colour: a partial read is not a system
 * failure and not a low score, and `Ink.danger` is for errors only.
 */
import { StyleSheet, Text } from 'react-native';

import { SquareCard } from '@/components/ui/square-card';
import { Copy } from '@/constants/copy';
import { Font, Ink, Space, Type } from '@/constants/v23-theme';
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
  return (
    <SquareCard testID="partial-result-banner" style={styles.card}>
      {/* A section heading, and marked as one: this banner is the first thing above the
          readout on its screen, so the rotor needs it as the entry point INTO that
          disclosure rather than only as prose a user reaches by swiping. */}
      <Text testID="partial-banner-title" accessibilityRole="header" style={styles.title}>
        {Copy.result.partial.banner.title}
      </Text>
      <Text testID="partial-banner-body" style={[Type.note, styles.body]}>
        {formatPartialBannerBody(assessedCount, mediaType)}
      </Text>
    </SquareCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Space.xs,
  },
  // The page's `600 16px/24px Inter Tight` — body size at the semibold weight, a step the type
  // scale does not name on its own (`Type.h2` is 20, `Type.bodySmSemi` is 14), so it is composed
  // here from the same family tokens.
  title: {
    color: Ink.ink,
    fontFamily: Font.tight.semiBold,
    fontSize: Type.body.fontSize,
    lineHeight: Type.body.lineHeight,
  },
  body: {
    color: Ink.ink2,
  },
});
