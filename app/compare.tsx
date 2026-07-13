/**
 * Screen 9 — Compare (Elite, minimal) (issue #60, Ruling 13 — `docs/status.md`, 2026-07-10:
 * "M6: Elite comparison — two stored results side by side with per-pillar deltas").
 *
 * SCOPE, DELIBERATELY MINIMAL (Ruling 13, design brief §4 screen 9 — a LOCKED decision, resist
 * growing this): a CLIENT-SIDE view of two already-stored `analyses` rows, picked from the
 * caller's own Past Analyses, side by side, with per-pillar score deltas.
 *   - Reads rows the user already has via the normal `analyses` RLS read — this screen calls
 *     `lib/history.ts`'s existing `fetchHistoryList()`, the exact same read
 *     `app/(tabs)/history.tsx` uses for its own list, rather than a second, parallel query.
 *   - Diffs them IN THE CLIENT — `lib/compare.ts`'s `computePaceDeltas`, pure arithmetic, no
 *     network call of its own.
 *   - NO new AI call, NO quota burn, NO extra storage, NO new edge function, NO new API route.
 *   - NOT a trends/progress feature — exactly two analyses, one comparison, nothing graphed over
 *     time. The product is explicitly "one thing, no training plans, no logging, no chat"
 *     (CLAUDE.md).
 *
 * TIER GATING (CLAUDE.md: "the client may display tier/quota state but is never the authority for
 * it"): this screen independently re-reads the caller's CURRENT tier via `getQuotaStatus()`
 * (`lib/subscription.ts`, the same client `app/paywall.tsx` already uses) on every mount, and
 * renders the `locked` state for anything other than Elite — regardless of how the screen was
 * reached. The History entry point is expected to gate its own "Compare two analyses" CTA to
 * Elite + ≥2 analyses too (see this change's HANDOFF note), but that is a convenience, not the
 * enforcement: a direct navigation to `/compare` must read the same honest, server-sourced
 * answer. Nothing here ever hardcodes which tiers are allowed to compare.
 *
 * THE TRAP THIS SCREEN MUST NEVER FALL INTO (issue #60's own words): a pillar that is `null`
 * ("not assessed") in EITHER of the two selected results renders as "not assessed," NEVER as a
 * delta of zero. `lib/compare.ts`'s `computePillarDelta` enforces this by construction — see that
 * file's header — and `formatPillarDelta`/`pillarDeltaA11yLabel` are the only functions this
 * screen uses to turn a delta into copy, so there is no code path here that stringifies a
 * not-assessed pillar as "+0"/"No change."
 *
 * STATES BUILT (CLAUDE.md: "build the states, not just the happy view"): loading (tier + list
 * fetch in flight), error (either fetch failed), locked (tier isn't Elite), empty (Elite, but
 * fewer than 2 analyses exist), picking (a checklist to select exactly two), and comparing (the
 * two PACE readouts side by side + the per-pillar delta list). The long-content case is already
 * covered for free: the picker is a virtualized `FlatList` (matching `app/(tabs)/history.tsx`'s
 * own choice), not a `ScrollView` mapping every row eagerly.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PaceReadout } from '@/components/pace-readout';
import { Copy } from '@/constants/copy';
import {
  Accent,
  CheckboxSize,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { computePaceDeltas, formatPillarDelta, orderByCreatedAt, pillarDeltaA11yLabel } from '@/lib/compare';
import { fetchHistoryList, formatHistoryDate, formatHistoryItemA11yLabel, type HistoryListItem } from '@/lib/history';
import { pillarLabel, pillarLetter } from '@/lib/pace-readout';
import { getQuotaStatus } from '@/lib/subscription';
import { useAnnounce } from '@/lib/use-announce';
import { PACE_PILLARS } from '@shared/pace';

const MAX_SELECTED = 2;

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'locked' }
  | { status: 'ready'; items: HistoryListItem[] };

/** Mirrors `app/(tabs)/history.tsx`'s own `ActiveFlag` pattern: minted per load attempt, flipped
 * off on unmount/re-load, so a slow or superseded request can never overwrite newer state. */
type ActiveFlag = { active: boolean };

export default function CompareScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [state, setState] = useState<ListState>({ status: 'loading' });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const activeFlagRef = useRef<ActiveFlag>({ active: false });
  // Issue #11: the loading/error captions below carry `accessibilityLiveRegion="polite"`, which
  // is Android-only — this is the iOS complement, same pattern as app/(tabs)/index.tsx.
  useAnnounce(
    state.status === 'loading'
      ? Copy.compare.loading
      : state.status === 'error'
        ? Copy.compare.error.loadFailed
        : null
  );

  const load = useCallback(async (active: ActiveFlag) => {
    setState({ status: 'loading' });
    setSelectedIds([]);
    setComparing(false);

    // Tier and the analyses list are two independent reads with no ordering dependency between
    // them, so they run concurrently rather than one waiting on the other.
    const [quotaResult, historyResult] = await Promise.all([
      getQuotaStatus(),
      fetchHistoryList().then(
        (items) => ({ ok: true as const, items }),
        () => ({ ok: false as const })
      ),
    ]);

    if (!active.active) return;

    if (!quotaResult.ok) {
      setState({ status: 'error' });
      return;
    }
    // The one non-negotiable gate this screen enforces on itself, freshly, every load — see this
    // file's header on why a route param or a prior screen's own gate is never trusted instead.
    if (quotaResult.data.tier !== 'elite') {
      setState({ status: 'locked' });
      return;
    }
    if (!historyResult.ok) {
      setState({ status: 'error' });
      return;
    }
    setState({ status: 'ready', items: historyResult.items });
  }, []);

  useEffect(() => {
    const active: ActiveFlag = { active: true };
    activeFlagRef.current = active;
    load(active);
    return () => {
      active.active = false;
    };
  }, [load]);

  function retry() {
    load(activeFlagRef.current);
  }

  function goPaywall() {
    router.push('/paywall');
  }

  /** While comparing, "Back" returns to the picker with the same two rows still checked (a
   * "change selection" affordance, not a second copy key — see constants/copy.ts's `compare.back`
   * doc comment). Otherwise it leaves the screen entirely. */
  function goBack() {
    if (comparing) {
      setComparing(false);
      return;
    }
    router.back();
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) => {
      if (current.includes(id)) return current.filter((existing) => existing !== id);
      if (current.length >= MAX_SELECTED) return current; // the row is disabled once the cap is hit
      return [...current, id];
    });
  }

  function startComparing() {
    if (selectedIds.length === MAX_SELECTED) setComparing(true);
  }

  const selectedItems =
    state.status === 'ready' ? state.items.filter((item) => selectedIds.includes(item.id)) : [];
  const pair = selectedItems.length === MAX_SELECTED ? orderByCreatedAt(selectedItems[0], selectedItems[1]) : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        {/* Text button, not a chevron glyph — matches app/paywall.tsx's / app/settings.tsx's back
            button exactly (Dynamic Type + no icon-font mapping to rely on). */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={Copy.compare.back}
          onPress={goBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
          <Text style={styles.backText}>{Copy.compare.back}</Text>
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {Copy.compare.title}
        </Text>
      </View>

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.text.secondary} />
          <Text style={styles.caption} accessibilityLiveRegion="polite">
            {Copy.compare.loading}
          </Text>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.centerBlock}>
          <Text style={styles.caption} accessibilityLiveRegion="polite">
            {Copy.compare.error.loadFailed}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.compare.error.retry}
            onPress={retry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{Copy.compare.error.retry}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'locked' && (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyTitle}>{Copy.compare.locked.title}</Text>
          <Text style={styles.caption}>{Copy.compare.locked.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.compare.locked.cta}
            onPress={goPaywall}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{Copy.compare.locked.cta}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && state.items.length < MAX_SELECTED && (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyTitle}>{Copy.compare.empty.title}</Text>
          <Text style={styles.caption}>{Copy.compare.empty.body}</Text>
        </View>
      )}

      {state.status === 'ready' && state.items.length >= MAX_SELECTED && !comparing && (
        <View style={styles.pickerContainer}>
          <Text style={styles.prompt}>{Copy.compare.picker.prompt}</Text>
          <FlatList
            data={state.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <PickerRow
                item={item}
                selected={selectedIds.includes(item.id)}
                disabled={!selectedIds.includes(item.id) && selectedIds.length >= MAX_SELECTED}
                colors={colors}
                scheme={scheme}
                onToggle={() => toggleSelect(item.id)}
              />
            )}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.compare.picker.cta}
            accessibilityState={{ disabled: selectedIds.length !== MAX_SELECTED }}
            disabled={selectedIds.length !== MAX_SELECTED}
            onPress={startComparing}
            style={({ pressed }) => [
              styles.primaryButton,
              selectedIds.length !== MAX_SELECTED && styles.disabled,
              pressed && selectedIds.length === MAX_SELECTED && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonText}>{Copy.compare.picker.cta}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && comparing && pair && (
        <CompareView pair={pair} colors={colors} styles={styles} />
      )}
    </SafeAreaView>
  );
}

function PickerRow({
  item,
  selected,
  disabled,
  colors,
  scheme,
  onToggle,
}: {
  item: HistoryListItem;
  selected: boolean;
  disabled: boolean;
  colors: ThemeColors;
  scheme: ColorScheme;
  onToggle: () => void;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dateLabel = formatHistoryDate(item.createdAt);
  const { overall } = item.outcome.result;

  return (
    <Pressable
      testID={`compare-picker-row-${item.id}`}
      accessibilityRole="checkbox"
      accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.pickerRow,
        selected && styles.pickerRowSelected,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <View style={[styles.checkbox, selected && styles.checkboxChecked]}>
        {selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
      </View>

      <View style={styles.rowInfo}>
        <Text style={styles.dateText}>{dateLabel}</Text>
        {overall.score !== null && overall.band !== null ? (
          <View style={[styles.scoreChip, { borderColor: colors.hairline }]}>
            <Text style={styles.scoreNumeral}>{overall.score}</Text>
            <Text style={[styles.scoreBand, { color: Score[overall.band][scheme].text }]}>
              {ScoreBandLabel[overall.band]}
            </Text>
          </View>
        ) : (
          <Text style={styles.notAssessedText}>{Copy.result.pillar.notAssessed.generic}</Text>
        )}
      </View>
    </Pressable>
  );
}

function CompareView({
  pair,
  colors,
  styles,
}: {
  pair: [HistoryListItem, HistoryListItem];
  colors: ThemeColors;
  styles: Styles;
}) {
  const [older, newer] = pair;
  const deltas = useMemo(
    () => computePaceDeltas(older.outcome.result, newer.outcome.result),
    [older, newer]
  );

  return (
    <ScrollView contentContainerStyle={styles.compareContent}>
      <ComparePane item={older} colors={colors} />
      <Text style={styles.vsText}>{Copy.compare.vs}</Text>
      <ComparePane item={newer} colors={colors} />

      <View style={styles.deltaList}>
        {PACE_PILLARS.map((id) => {
          const label = pillarLabel(id);
          const delta = deltas[id];
          return (
            <View
              key={id}
              testID={`compare-delta-row-${id}`}
              style={styles.deltaRow}
              accessible
              accessibilityLabel={pillarDeltaA11yLabel(label, delta)}>
              <Text style={styles.deltaPillarLetter}>{pillarLetter(id)}</Text>
              <Text style={styles.deltaText}>{formatPillarDelta(label, delta)}</Text>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

function ComparePane({ item, colors }: { item: HistoryListItem; colors: ThemeColors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.pane}>
      <Text style={styles.paneDate}>{formatHistoryDate(item.createdAt)}</Text>
      <PaceReadout result={item.outcome.result} />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.lg,
    },
    backButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
    },
    title: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
      color: colors.text.primary,
    },
    centerBlock: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    caption: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.secondary,
      textAlign: 'center',
    },
    emptyTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.lg,
      color: colors.text.primary,
      textAlign: 'center',
    },
    retryButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
    },
    retryText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
      textDecorationLine: 'underline',
    },
    primaryButton: {
      minHeight: ControlHeight.standard,
      borderRadius: Radius.card,
      backgroundColor: Accent.value,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    primaryButtonText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: Accent.onAccent,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    disabled: {
      opacity: Opacity.disabled,
    },
    pickerContainer: {
      flex: 1,
    },
    prompt: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      color: colors.text.secondary,
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.lg,
    },
    listContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xl,
      gap: Spacing.md,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      borderWidth: 1,
      borderColor: colors.surface.base,
      padding: Spacing.md,
    },
    pickerRowSelected: {
      borderColor: Accent.value,
    },
    // Same checkbox treatment as components/consent-gate.tsx's own checkbox — see that file's
    // comment on why `control.border` (not `hairline`) is the unchecked-state boundary color.
    checkbox: {
      alignItems: 'center',
      justifyContent: 'center',
      width: CheckboxSize.box,
      height: CheckboxSize.box,
      borderRadius: Radius.card,
      borderWidth: CheckboxSize.border,
      borderColor: colors.control.border,
    },
    checkboxChecked: {
      backgroundColor: Accent.value,
      borderColor: Accent.value,
    },
    checkboxMark: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.bold,
      fontSize: FontSize.xs,
    },
    rowInfo: {
      flex: 1,
      gap: Spacing.xs,
    },
    dateText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
    scoreChip: {
      flexDirection: 'row',
      alignItems: 'baseline',
      alignSelf: 'flex-start',
      gap: Spacing.xs,
      backgroundColor: colors.surface.raised,
      borderWidth: 1,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.sm,
      paddingVertical: Spacing.xs,
    },
    scoreNumeral: {
      fontFamily: FontFamily.mono.medium,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
    scoreBand: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
    },
    notAssessedText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
    },
    compareContent: {
      flexGrow: 1,
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xxxl,
      gap: Spacing.xl,
    },
    pane: {
      gap: Spacing.md,
    },
    paneDate: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    vsText: {
      alignSelf: 'center',
      fontFamily: FontFamily.display.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    deltaList: {
      gap: Spacing.sm,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.lg,
    },
    deltaRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: Spacing.sm,
    },
    deltaPillarLetter: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
      width: Spacing.xl,
    },
    deltaText: {
      fontFamily: FontFamily.mono.regular,
      fontSize: FontSize.sm,
      color: colors.text.primary,
    },
  });
}
