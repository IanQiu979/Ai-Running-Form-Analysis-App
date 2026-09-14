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
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArcLoader } from '@/components/arc-loader';
import { PaceDeltaPanel } from '@/components/compare/pace-delta-panel';
import { KineticText } from '@/components/kinetic-text';
import { PaceReadout } from '@/components/pace-readout';
import { ArcRing } from '@/components/ui/arc-ring';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { Eyebrow } from '@/components/ui/eyebrow';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { SurfaceCard } from '@/components/ui/surface-card';
import { Copy } from '@/constants/copy';
import {
  Accent,
  Meter,
  CheckboxSize,
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Opacity,
  Radius,
  Score,
  ScoreBandLabel,
  Spacing,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { orderByCreatedAt } from '@/lib/compare';
import { fetchHistoryList, formatHistoryDate, formatHistoryItemA11yLabel, type HistoryListItem } from '@/lib/history';
import { getQuotaStatus } from '@/lib/subscription';
import { useAnnounce } from '@/lib/use-announce';

const MAX_SELECTED = 2;

/** The picker row's overall-score ring. Composition, not a token — the same reasoning
 *  `components/pace-readout.tsx` gives for keeping its own two ring sizes local: this size says how
 *  loud a score is in a LIST row, which is a decision about this screen. Smaller than the readout's
 *  64pt pillar ring, because a picker row is a choice, not a result. */
const PICKER_RING_SIZE = 48;
const PICKER_RING_STROKE = 4;

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
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea}>
      {/* Circular back control, matching app/paywall.tsx and app/settings.tsx — see the note on
          either of those for why the previous "text button, not a chevron glyph" reasoning does
          not carry over to a fixed-size glyph in a fixed 44pt target. */}
      <View style={styles.headerRow}>
        <CircleIconButton accessibilityLabel={Copy.compare.back} onPress={goBack}>
          <MaterialIcons name="arrow-back" size={20} color={colors.text.primary} />
        </CircleIconButton>
        <View style={styles.titleBlock}>
          <KineticText accessibilityRole="header" staggerMs={Motion.stagger.line} style={styles.title}>
            {Copy.compare.title}
          </KineticText>
        </View>
      </View>

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          {/* Cadence Arcs (2026-09-01): the motif's own wait state, replacing the stock
              spinner. Indeterminate by construction — `<ArcLoader>` draws nothing that
              could be read as progress, and the live-region caption beside it is what
              actually says what is happening. */}
          <ArcLoader size={88} testID="compare-loading" />
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
          <PillButton variant="ghost" label={Copy.compare.error.retry} onPress={retry} />
        </View>
      )}

      {state.status === 'locked' && (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyTitle}>{Copy.compare.locked.title}</Text>
          <Text style={styles.caption}>{Copy.compare.locked.body}</Text>
          <PillButton label={Copy.compare.locked.cta} onPress={goPaywall} style={styles.centerCta} />
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
          <PillButton
            label={Copy.compare.picker.cta}
            disabled={selectedIds.length !== MAX_SELECTED}
            onPress={startComparing}
            style={styles.stickyCta}
          />
        </View>
      )}

      {state.status === 'ready' && comparing && pair && (
        <CompareView pair={pair} colors={colors} styles={styles} />
      )}
      </SafeAreaView>
    </ScreenGradient>
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

      {/* The same ring the readout uses, at picker scale — so an analysis looks like the same
          object here as it does once it is opened. Decorative on its own (the row's own
          `accessibilityLabel` carries the spoken version), and a not-assessed overall gets
          `<ArcRing>`'s dashed empty track rather than a zero-length fill. */}
      <ArcRing
        testID={`compare-picker-ring-${item.id}`}
        size={PICKER_RING_SIZE}
        strokeWidth={PICKER_RING_STROKE}
        fraction={overall.score !== null ? overall.score / 100 : null}
        color={overall.band !== null ? Score[overall.band][scheme].fill : Meter[scheme].rule}>
        {overall.score !== null ? <Text style={styles.scoreNumeral}>{overall.score}</Text> : null}
      </ArcRing>

      <View style={styles.rowInfo}>
        <Text style={styles.dateText}>{dateLabel}</Text>
        {overall.band !== null ? (
          <Text style={[styles.scoreBand, { color: Score[overall.band][scheme].text }]}>
            {ScoreBandLabel[overall.band]}
          </Text>
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

  return (
    <ScrollView contentContainerStyle={styles.compareContent}>
      <ComparePane item={older} colors={colors} />
      {/* The two panes are separated by the deck's "vs" in the app-wide eyebrow register rather
          than by a rule: a divider between two cards that are already cards is one line too many.
          `tone="primary"` because this sits on the wash, which `Gradient`'s contract proves for
          primary text only. */}
      <Eyebrow tone="primary" style={styles.vsText}>
        {Copy.compare.vs}
      </Eyebrow>
      <ComparePane item={newer} colors={colors} />

      {/* The deltas, with the motif carried into them — see components/compare/pace-delta-panel.tsx.
          It computes the diff itself from the two stored results (pure, client-side, no network),
          so this screen no longer holds a second copy of that arithmetic. */}
      <PaceDeltaPanel
        testID="compare-delta-panel"
        from={older.outcome.result}
        to={newer.outcome.result}
      />
    </ScrollView>
  );
}

/**
 * One of the two side-by-side readouts.
 *
 * `<PaceReadout>` is the shared V23 readout since lane 2 (2026-09-14): four `<SquareCard>` pillar
 * cards on the `constants/v23-theme.ts` sheet, each with the pillar name, its band word and a 2 px
 * score bar, and an info control that opens the flags and drills in `<PillarDetailModal>` — it
 * draws no inline prose and no prose fills any more. This screen has no approved design page and
 * stays on `constants/theme.ts`, so the V23 cards render inside this old-theme `<SurfaceCard>`;
 * the captain approved that mixed rendering as-is until Compare gets a page of its own.
 *
 * ON A CARD, not on the wash, still: the readout's band words and score bars are not text roles
 * `Gradient.page` is proven for (`constants/theme.ts`'s `Gradient` contract), and the date moves
 * inside the card with them, in the eyebrow register, so each pane reads as one object.
 *
 * `tone="base"` (the default) for BOTH panes, deliberately: `surface.raised` is "the one raised
 * element per screen" (constants/theme.ts), and this screen shows two co-equal analyses — raising
 * either one would say one of them matters more.
 */
function ComparePane({ item, colors }: { item: HistoryListItem; colors: ThemeColors }) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SurfaceCard>
      <View style={styles.pane}>
        <Eyebrow>{formatHistoryDate(item.createdAt)}</Eyebrow>
        <PaceReadout result={item.outcome.result} />
      </View>
    </SurfaceCard>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
      backgroundColor: 'transparent',
      // The tablet readable-column cap (issue #63). Compare HAD this cap from the first #63 pass
      // and lost it in the Calm redesign (#164), which rebuilt this screen's body wholesale.
      //
      // Applied to the SafeAreaView itself rather than to an inner scroll container, which is the
      // shape every other capped screen uses. The reason is structural, not stylistic: this screen
      // has no single inner content node to cap. Five siblings hang off the SafeAreaView directly
      // (headerRow, centerBlock, pickerContainer's FlatList, its sticky CTA, and CompareView's own
      // ScrollView), and capping each one separately is five chances for the next edit to add a
      // sixth and miss it. Capping here caps all of them at once, and stays correct for whatever
      // the next state adds. The wash still fills the whole viewport — `<ScreenGradient>` is the
      // parent and owns the fill; this node is transparent.
      //
      // A no-op below the cap, as everywhere else: on a phone `100%` is already under 560pt.
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.lg,
    },
    titleBlock: {
      flex: 1,
      // Optically centres the title against the 44pt circular button beside it.
      paddingTop: Spacing.xs,
    },
    title: {
      fontFamily: FontFamily.display.bold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
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
      lineHeight: FontSize.md * LineHeight.body,
      // On the wash — `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
      textAlign: 'center',
    },
    emptyTitle: {
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xxl,
      letterSpacing: Tracking.display,
      lineHeight: FontSize.xxl * LineHeight.display,
      color: colors.text.primary,
      textAlign: 'center',
    },
    /** The picker's bottom action, pinned under the list — hence the outer margins the centred
     *  variant below does not need. */
    stickyCta: {
      marginHorizontal: Spacing.xl,
      marginBottom: Spacing.xl,
    },
    centerCta: {
      alignSelf: 'stretch',
      marginHorizontal: Spacing.xl,
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
      lineHeight: FontSize.md * LineHeight.body,
      // On the wash — `text.primary` only (`Gradient`'s contract, constants/theme.ts).
      color: colors.text.primary,
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
      borderColor: colors.hairline,
      padding: Spacing.lg,
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
      // `Radius.tile` at a 24pt box would round it almost to a circle, which reads as a radio
      // button rather than a checkbox. Half the tile radius keeps it square-ish but softened,
      // in the redesign's shape language without changing what the control means.
      borderRadius: Radius.tile / 2,
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
    scoreNumeral: {
      fontFamily: FontFamily.mono.bold,
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
    /** Inside the pane card, not on it: `<SurfaceCard>` puts its children in a second, padded node,
     *  so a `gap` on the card's own style would apply to nothing. */
    pane: {
      gap: Spacing.lg,
    },
    vsText: {
      alignSelf: 'center',
    },
  });
}
