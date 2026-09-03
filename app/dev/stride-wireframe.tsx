/**
 * DEV-ONLY preview for `<StrideWireframeHero>` (components/stride-wireframe-hero.tsx) — a place
 * to SEE and iterate on the stride wireframe before the onboarding rebuild that will actually
 * host it exists. Not a product screen: it renders `<Redirect href="/" />` outside `__DEV__`, and
 * is deliberately NOT declared in `app/_layout.tsx`'s Stack, which makes it an always-available,
 * unguarded top-level route (the documented behaviour for an undeclared route file — see that
 * layout's comments) so it can be opened without signing in.
 *
 * Open it on the dev server with a deep link, e.g. from the terminal running `npm start`:
 *   npx uri-scheme open "exp+running-form-v23://expo-development-client/?url=..." — or simpler,
 *   press `r` to reload and type the path into the dev menu's URL bar: `/dev/stride-wireframe`.
 *   On a simulator: `xcrun simctl openurl booted "<scheme>://dev/stride-wireframe"`.
 *
 * Styling here is hand-rolled on the hero's own pinned palette, not on `constants/theme.ts`'s
 * Cadence Arcs tokens (which the redesign is replacing) — acceptable only because this is a
 * temporary dev surface. Delete this file once the hero is mounted in real onboarding.
 */
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { STRIDE_WIREFRAME_PALETTE, StrideWireframeHero } from '@/components/stride-wireframe-hero';
import { FontFamily, FontSize, Spacing, Tracking } from '@/constants/theme';

const ASPECTS = [
  { key: 'portrait', label: '3:4', aspectRatio: 3 / 4 },
  { key: 'square', label: '1:1', aspectRatio: 1 },
  { key: 'wide', label: '16:9', aspectRatio: 16 / 9 },
  { key: 'tile', label: 'tile', aspectRatio: 1, width: 120 },
] as const;

const RATES = [0.25, 0.5, 1] as const;

export default function StrideWireframePreview() {
  const [aspect, setAspect] = useState<(typeof ASPECTS)[number]>(ASPECTS[0]);
  const [chrome, setChrome] = useState(true);
  const [trails, setTrails] = useState(true);
  const [readouts, setReadouts] = useState(true);
  const [paused, setPaused] = useState(false);
  const [rate, setRate] = useState<(typeof RATES)[number]>(0.5);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>STRIDE WIREFRAME — DEV PREVIEW</Text>
        <View style={styles.stage}>
          <StrideWireframeHero
            testID="stride-preview"
            style={[
              styles.hero,
              { aspectRatio: aspect.aspectRatio },
              'width' in aspect ? { width: aspect.width } : null,
            ]}
            chrome={chrome}
            trails={trails}
            readouts={readouts}
            paused={paused}
            playbackRate={rate}
          />
        </View>

        <Row label="box">
          {ASPECTS.map((a) => (
            <Chip key={a.key} label={a.label} active={aspect.key === a.key} onPress={() => setAspect(a)} />
          ))}
        </Row>
        <Row label="layers">
          <Chip label="chrome" active={chrome} onPress={() => setChrome((v) => !v)} />
          <Chip label="trails" active={trails} onPress={() => setTrails((v) => !v)} />
          <Chip label="readouts" active={readouts} onPress={() => setReadouts((v) => !v)} />
        </Row>
        <Row label="playback">
          {RATES.map((r) => (
            <Chip key={r} label={`${r}x`} active={rate === r} onPress={() => setRate(r)} />
          ))}
          <Chip label={paused ? 'resume' : 'pause'} active={paused} onPress={() => setPaused((v) => !v)} />
        </Row>
        <Text style={styles.note}>
          Reduced motion is read from the OS setting (Settings → Accessibility → Motion) and renders
          the still frame with no loop.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label.toUpperCase()}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const { line, background } = STRIDE_WIREFRAME_PALETTE;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: background },
  content: { padding: Spacing.md, gap: Spacing.md },
  title: {
    color: line,
    fontFamily: FontFamily.mono.regular,
    fontSize: FontSize.xs,
    letterSpacing: Tracking.eyebrow,
    opacity: 0.7,
  },
  stage: { alignItems: 'center' },
  hero: { width: '100%' },
  row: { gap: Spacing.xs },
  rowLabel: {
    color: line,
    fontFamily: FontFamily.mono.regular,
    fontSize: FontSize.xs,
    letterSpacing: Tracking.eyebrow,
    opacity: 0.5,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: line,
    opacity: 0.6,
  },
  chipActive: { opacity: 1, backgroundColor: line },
  chipText: { color: line, fontFamily: FontFamily.mono.regular, fontSize: FontSize.xs },
  chipTextActive: { color: background },
  note: {
    color: line,
    opacity: 0.5,
    fontFamily: FontFamily.body.regular,
    fontSize: FontSize.xs,
  },
});
