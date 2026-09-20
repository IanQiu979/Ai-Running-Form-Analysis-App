/**
 * Screen 9 — Compare (Elite, minimal) (issue #60, Ruling 13 — `docs/status.md`, 2026-07-10:
 * "M6: Elite comparison — two stored results side by side with per-pillar deltas"). Re-cut to
 * V23 (2026-09-21, change-list item 5) — the captain flagged it as the last user-facing screen
 * still on `constants/theme.ts`. VISUAL ONLY: this pass changes no data flow, gating, or copy.
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
 * Elite + ≥2 analyses too, but that is a convenience, not the enforcement: a direct navigation to
 * `/compare` must read the same honest, server-sourced answer. Nothing here ever hardcodes which
 * tiers are allowed to compare.
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
 *
 * NOT A TAB SCREEN. Compare is a pushed root route reached from History's "Compare two analyses"
 * button, so — unlike `app/(tabs)/history.tsx` — it draws no `<V23TabBar>`; there is nothing for
 * this screen to lay the inline bar into.
 */
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PaceDeltaPanel } from '@/components/compare/pace-delta-panel';
import { PaceReadout } from '@/components/pace-readout';
import { SquareButton } from '@/components/ui/square-button';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { BackIcon, CheckIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { ScoreBandLabel } from '@/constants/theme';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { orderByCreatedAt } from '@/lib/compare';
import { fetchHistoryList, formatHistoryDate, formatHistoryItemA11yLabel, type HistoryListItem } from '@/lib/history';
import { getQuotaStatus } from '@/lib/subscription';
import { useAnnounce } from '@/lib/use-announce';

const MAX_SELECTED = 2;

const PRESSED_OPACITY = 0.6;
const DISABLED_OPACITY = 0.4;

type ListState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'locked' }
  | { status: 'ready'; items: HistoryListItem[] };

/** Mirrors `app/(tabs)/history.tsx`'s own `ActiveFlag` pattern: minted per load attempt, flipped
 * off on unmount/re-load, so a slow or superseded request can never overwrite newer state. */
type ActiveFlag = { active: boolean };

export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(insets.top, Layout.canvas.safeTop);
  const safeBottom = Math.max(insets.bottom, Layout.canvas.safeBottom);
  const headerStyle = useMemo(() => [styles.header, { paddingTop: safeTop }], [safeTop]);
  const stickyCtaStyle = useMemo(() => [styles.stickyCta, { marginBottom: safeBottom }], [safeBottom]);
  const centerCtaStyle = useMemo(() => [styles.centerCta, { marginBottom: safeBottom }], [safeBottom]);

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
    <View style={styles.screen}>
      <View style={headerStyle}>
        <TopBar
          align="leading"
          title={Copy.compare.title}
          leading={
            <SquareIconButton accessibilityLabel={Copy.compare.back} bleed="left" onPress={goBack}>
              <BackIcon />
            </SquareIconButton>
          }
        />
      </View>

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={Ink.ink2} testID="compare-loading" />
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
          <SquareButton variant="link" label={Copy.compare.error.retry} onPress={retry} />
        </View>
      )}

      {state.status === 'locked' && (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyTitle}>{Copy.compare.locked.title}</Text>
          <Text style={styles.caption}>{Copy.compare.locked.body}</Text>
          <View style={centerCtaStyle}>
            <SquareButton label={Copy.compare.locked.cta} onPress={goPaywall} testID="compare-locked-cta" />
          </View>
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
                onToggle={() => toggleSelect(item.id)}
              />
            )}
          />
          <View style={stickyCtaStyle}>
            <SquareButton
              label={Copy.compare.picker.cta}
              disabled={selectedIds.length !== MAX_SELECTED}
              onPress={startComparing}
              testID="compare-picker-cta"
            />
          </View>
        </View>
      )}

      {state.status === 'ready' && comparing && pair && <CompareView pair={pair} bottomInset={safeBottom} />}
    </View>
  );
}

function PickerRow({
  item,
  selected,
  disabled,
  onToggle,
}: {
  item: HistoryListItem;
  selected: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
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
      {/* Same `Layout.consentCheckbox` square idiom `components/age-band-choice.tsx` draws. */}
      <View style={[styles.checkbox, selected && styles.checkboxChecked]}>{selected ? <CheckIcon /> : null}</View>

      <View style={styles.rowInfo}>
        <Text style={styles.dateText}>{dateLabel}</Text>
        {overall.score !== null && overall.band !== null ? (
          <View style={styles.scoreRow}>
            <Text style={styles.scoreText}>{overall.score}</Text>
            <Text style={styles.bandWord}>{ScoreBandLabel[overall.band]}</Text>
          </View>
        ) : (
          <Text style={styles.notAssessedText}>{Copy.result.pillar.notAssessed.generic}</Text>
        )}
      </View>
    </Pressable>
  );
}

function CompareView({ pair, bottomInset }: { pair: [HistoryListItem, HistoryListItem]; bottomInset: number }) {
  const [older, newer] = pair;
  const contentStyle = useMemo(() => [styles.compareContent, { paddingBottom: bottomInset + Layout.gutter }], [
    bottomInset,
  ]);

  return (
    <ScrollView contentContainerStyle={contentStyle}>
      <ComparePane item={older} />
      {/* The two panes are separated by "vs" in the app-wide label register rather than by a
          rule: a divider between two cards that are already cards is one line too many. */}
      <Text style={styles.vsText}>{Copy.compare.vs}</Text>
      <ComparePane item={newer} />

      {/* The deltas — see components/compare/pace-delta-panel.tsx. It computes the diff itself
          from the two stored results (pure, client-side, no network), so this screen holds no
          second copy of that arithmetic. */}
      <PaceDeltaPanel testID="compare-delta-panel" from={older.outcome.result} to={newer.outcome.result} />
    </ScrollView>
  );
}

/**
 * One of the two stacked readouts. `<PaceReadout>` is fully V23-native
 * (`components/pace-readout.tsx`) and draws its own `<SquareCard>` per pillar, so this pane wraps
 * it in nothing but a date label — matching how `app/result/[id].tsx` renders the same component
 * directly, with no outer card of its own.
 */
function ComparePane({ item }: { item: HistoryListItem }) {
  return (
    <View style={styles.pane}>
      <Text style={styles.paneDate}>{formatHistoryDate(item.createdAt)}</Text>
      <PaceReadout result={item.outcome.result} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  header: {
    paddingHorizontal: Layout.gutter,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.lg,
    padding: Layout.gutter,
  },
  caption: {
    ...Type.body,
    color: Ink.ink,
    textAlign: 'center',
  },
  emptyTitle: {
    ...Type.h1,
    color: Ink.ink,
    textAlign: 'center',
  },
  centerCta: {
    alignSelf: 'stretch',
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  disabled: {
    opacity: DISABLED_OPACITY,
  },
  pickerContainer: {
    flex: 1,
  },
  prompt: {
    ...Type.body,
    color: Ink.ink,
    paddingHorizontal: Layout.gutter,
    paddingBottom: Space.lg,
  },
  listContent: {
    paddingHorizontal: Layout.gutter,
    paddingBottom: Space.xl,
    gap: Space.md,
  },
  stickyCta: {
    marginHorizontal: Layout.gutter,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    padding: Layout.cardPadding,
  },
  pickerRowSelected: {
    borderColor: Ink.ink,
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: Layout.consentCheckbox,
    height: Layout.consentCheckbox,
    borderWidth: Layout.hairline,
    borderRadius: Layout.radius,
    borderColor: Ink.line,
    backgroundColor: Ink.bgRaised,
  },
  checkboxChecked: {
    borderColor: Ink.ink,
    backgroundColor: Ink.ink,
  },
  rowInfo: {
    flex: 1,
    gap: Space.xs,
  },
  dateText: {
    ...Type.bodySmMedium,
    color: Ink.ink,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Space.sm,
  },
  scoreText: {
    ...Type.mono,
    color: Ink.ink,
  },
  bandWord: {
    ...Type.label,
    color: Ink.ink,
  },
  notAssessedText: {
    ...Type.small,
    color: Ink.ink2,
  },
  compareContent: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    paddingTop: Space.xl,
    gap: Space.xl,
  },
  pane: {
    gap: Space.md,
  },
  paneDate: {
    ...Type.label,
    color: Ink.ink2,
  },
  vsText: {
    ...Type.label,
    color: Ink.ink2,
    alignSelf: 'center',
  },
});
