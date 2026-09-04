/**
 * (tabs)/history — Screen 8, Past Analyses (issue #55). The second `Tabs.Screen`
 * `app/(tabs)/_layout.tsx`'s own header comment said would land "then, not before" — this is
 * "then".
 *
 * Lists the caller's own `analyses` rows (a plain RLS-guarded read — `lib/history.ts`'s
 * `fetchHistoryList`, not an edge function: `docs/architecture.md` "Direct Supabase-client reads
 * ... list own `analyses`"), each with a frame strip resolved through short-TTL signed URLs
 * (`lib/history.ts`'s `signFrameStrip` — see that file's header for THE MEDIA RULE this screen
 * depends on: the `media` bucket is private, there are no public URLs, and a signed URL is never
 * logged). Tap a row to reopen its stored result at `/result/[id]`; tap Delete to purge it (row +
 * frames together, via `DELETE /functions/v1/analysis/:id` — `lib/history.ts`'s
 * `deleteHistoryAnalysis`) after a native confirm, same `Alert`-based confirmation pattern
 * `app/settings.tsx` already established for its own destructive actions.
 *
 * Renders every state CLAUDE.md's "build the states, not just the happy view" requires: loading,
 * error (the fetch itself failed), empty (no analyses yet), and ready — where "ready" already
 * covers the long-content case for free, because the list is a virtualized `FlatList`, not a
 * `ScrollView` mapping every row eagerly.
 *
 * NO BUSINESS LOGIC HERE (CLAUDE.md: "No business rules in the client"): this screen does not
 * decide which rows are deletable, does not compute a tier/quota gate on the list, and does not
 * decide whether Storage successfully purged anything — it only renders what `lib/history.ts`'s
 * reads report and sends the caller's own intent (open, delete) to the server.
 *
 * CADENCE ARCS (2026-09-01) — this file is now the screen's I/O and state machine, and very little
 * else. The row moved out to `components/history/history-row.tsx` (which owns the recomposed
 * ring-led row and documents what changed about it); what stays here is the header, the four
 * states, and the list. The two visual changes that belong to THIS file:
 *   - the header is two tiers (chrome line, then the display title on its own full-width line),
 *     so the 64pt title no longer shares a row with a 44pt circular control;
 *   - the empty state leads with the motif's own "nothing to report" picture — a dashed,
 *     unfilled `<ArcRing>` — rather than with two lines of type on a bare wash.
 * The DELETE INTERACTION is deliberately untouched: a persistent, visibly labelled per-row control
 * behind a native confirm, per `docs/design/copy-deck.md` Screen 8 (which supersedes the design
 * brief's "swipe/long-press"). Only its placement inside the row changed.
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArcLoader } from '@/components/arc-loader';
import { HistoryRow } from '@/components/history/history-row';
import { KineticText } from '@/components/kinetic-text';
import { ArcRing } from '@/components/ui/arc-ring';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { Copy } from '@/constants/copy';
import {
  Meter,
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  LineHeight,
  Motion,
  Spacing,
  TabBar,
  Tracking,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  deleteHistoryAnalysis,
  fetchHistoryList,
  signFrameStrip,
  type HistoryListItem,
} from '@/lib/history';
import { useAnnounce } from '@/lib/use-announce';

/** The empty state's ring. Composition, not a token — the same call `components/pace-readout.tsx`
 *  makes for its own ring sizes. Drawn with `fraction={null}`, i.e. the dashed, unfilled track the
 *  whole app already uses for "nothing to report", so an empty History reads as the same idea a
 *  not-assessed pillar does rather than as a bespoke empty-state illustration. */
const EMPTY_RING_SIZE = 160;
const EMPTY_RING_STROKE = 10;

type ScreenState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: HistoryListItem[] };

/** Mirrors `app/(tabs)/index.tsx`'s own `ActiveFlag` pattern: minted per fetch attempt, flipped
 * off on unmount/blur/re-fetch, so a slow or superseded request can never overwrite newer state
 * or fire against an unmounted screen. */
type ActiveFlag = { active: boolean };

export default function HistoryScreen() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Issue #63: mirrors app/(tabs)/index.tsx — the floating tab bar moves up to clear Android's
  // system navigation bar, so the list's bottom padding has to move with it or the last row
  // scrolls under the bar and stops there. A no-op on iOS; see `TabBar.bottomOffset`.
  const insets = useSafeAreaInsets();
  const tabBarClearance = TabBar.clearanceFor(insets.bottom);
  const listContentStyle = useMemo(
    () => [styles.listContent, { paddingBottom: tabBarClearance }],
    [styles.listContent, tabBarClearance],
  );

  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  // Keyed by analysis id -> resolved frame-strip URLs. Separate from `state` so a thumbnail
  // resolving in has nothing to do with the list's own load/error/ready status — a row renders
  // with an empty strip (a placeholder) until, or unless, its own signing settles.
  const [thumbnails, setThumbnails] = useState<Record<string, string[]>>({});
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const activeFlagRef = useRef<ActiveFlag>({ active: false });
  // Issue #11: the loading/error captions below carry `accessibilityLiveRegion="polite"`, which
  // is Android-only — this is the iOS complement, same pattern as app/(tabs)/index.tsx.
  useAnnounce(
    state.status === 'loading'
      ? Copy.history.loading
      : state.status === 'error'
        ? Copy.history.error.loadFailed
        : null
  );

  const load = useCallback(async (active: ActiveFlag) => {
    setState({ status: 'loading' });
    setThumbnails({});

    let items: HistoryListItem[];
    try {
      items = await fetchHistoryList();
    } catch {
      if (active.active) setState({ status: 'error' });
      return;
    }

    if (!active.active) return;
    setState({ status: 'ready', items });

    // Best-effort, per row, resolved AFTER the list itself renders — a slow or failed signing
    // pass for one row must never delay or fail the whole list (lib/history.ts's header: "handle
    // a row whose media is gone without crashing"). Fresh signed URLs every load, never cached
    // across a re-focus, matching "short-TTL (~1h, regenerated on open)"
    // (docs/architecture.md).
    for (const item of items) {
      signFrameStrip(item.mediaPaths).then((urls) => {
        if (!active.active) return;
        setThumbnails((current) => ({ ...current, [item.id]: urls }));
      });
    }
  }, []);

  // Same reasoning as app/(tabs)/index.tsx's own useFocusEffect: loads on first mount, and
  // refetches on every later focus, so a just-finished analysis (or a delete from a prior visit)
  // shows up without needing an app restart. The ActiveFlag minted here also backs the Retry
  // button below, which calls load() directly, outside this effect.
  useFocusEffect(
    useCallback(() => {
      const active: ActiveFlag = { active: true };
      activeFlagRef.current = active;
      load(active);
      return () => {
        active.active = false;
      };
    }, [load])
  );

  function confirmDelete(item: HistoryListItem) {
    Alert.alert(
      Copy.history.delete.confirm.title,
      Copy.history.delete.confirm.body,
      [
        { text: Copy.history.delete.confirm.cta.secondary, style: 'cancel' },
        {
          text: Copy.history.delete.confirm.cta.primary,
          style: 'destructive',
          onPress: () => {
            void handleDelete(item);
          },
        },
      ]
    );
  }

  async function handleDelete(item: HistoryListItem) {
    if (deletingIds.has(item.id)) return;
    setDeletingIds((current) => new Set(current).add(item.id));

    let result: Awaited<ReturnType<typeof deleteHistoryAnalysis>>;
    try {
      result = await deleteHistoryAnalysis(item.id);
    } catch {
      // deleteHistoryAnalysis never rejects (see lib/history.ts) — this is a last-resort
      // backstop only, same discipline lib/delete-account.ts documents for its own equivalent.
      result = { ok: false, error: { error: Copy.history.delete.error.body, code: 'unknown' } };
    }

    if (!activeFlagRef.current.active) return;

    setDeletingIds((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });

    if (!result.ok) {
      Alert.alert(Copy.history.delete.error.title, Copy.history.delete.error.body, [
        { text: Copy.history.delete.error.dismiss },
      ]);
      return;
    }

    // The server confirmed the purge (row + frames together) — only now does the row leave the
    // list; never removed optimistically ahead of that confirmation.
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', items: current.items.filter((existing) => existing.id !== item.id) }
        : current
    );
    setThumbnails((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
  }

  function openResult(item: HistoryListItem) {
    // Object form (pathname + params), matching app/analyzing.tsx's own navigation into this
    // same dynamic route, rather than a hand-built template-literal path.
    router.push({ pathname: '/result/[id]', params: { id: item.id } });
  }

  function openCompare() {
    router.push('/compare');
  }

  function retry() {
    load(activeFlagRef.current);
  }

  function goAnalyze() {
    router.push('/capture');
  }

  return (
    // edges excludes 'bottom' — same reasoning as app/(tabs)/index.tsx (issue #63): the tab bar
    // already pads itself by the bottom safe-area inset, so this screen must not pad it a
    // second time.
    <ScreenGradient>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        {/* A two-tier header, not the old title-and-button row. The 64pt display title used to
            share a row with a 44pt circular control, which left it a narrow column to wrap into
            and made the screen's largest element read as one of two things competing for the top
            edge. Chrome now sits on its own line ABOVE the title, and the title gets the full
            readable column to itself — the reference's content-detail treatment, and the same
            shape the arc ornament in this corner (drawn by `<ScreenGradient>`) was composed for.
            Still no eyebrow above the title: the copy deck has exactly one string for this
            screen's name, and setting the same words twice to manufacture hierarchy is filler. */}
        <View style={styles.header}>
          <View style={styles.chromeRow}>
            {/* M5 (v23-ux-audit-r1): Home's top bar has a Settings entry point
                (`app/(tabs)/index.tsx`'s `home-settings`); History had none, so reaching Settings
                from here required going back to Home first. Same control, same destination. */}
            <CircleIconButton
              accessibilityLabel={Copy.settings.title}
              onPress={() => {
                router.push('/settings');
              }}
              testID="history-settings">
              <MaterialIcons name="tune" size={20} color={colors.text.primary} />
            </CircleIconButton>
          </View>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.headerTitle}
            testID="history-title">
            {Copy.history.title}
          </KineticText>
        </View>

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          {/* Cadence Arcs (2026-09-01): the motif's own wait state, replacing the stock
              spinner. Indeterminate by construction — `<ArcLoader>` draws nothing that
              could be read as progress, and the live-region caption beside it is what
              actually says what is happening. */}
          <ArcLoader size={88} testID="history-loading" />
          <Text style={styles.caption} accessibilityLiveRegion="polite">
            {Copy.history.loading}
          </Text>
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.centerBlock}>
          <Text style={styles.caption} accessibilityLiveRegion="polite">
            {Copy.history.error.loadFailed}
          </Text>
          <PillButton variant="ghost" label={Copy.history.error.retry} onPress={retry} />
        </View>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <View style={styles.centerBlock}>
          {/* The motif carrying the empty state, instead of two lines of type alone. A dashed,
              unfilled ring is what this app already draws for "there is nothing to report here"
              (a not-assessed pillar, a not-assessed overall) — so an empty History is the same
              idea at hero scale rather than a one-off illustration. Decorative: `<ArcRing>` hides
              itself from the a11y tree and the copy below carries the whole meaning. */}
          <ArcRing
            testID="history-empty-ring"
            size={EMPTY_RING_SIZE}
            strokeWidth={EMPTY_RING_STROKE}
            fraction={null}
            color={Meter[scheme].rule}
          />
          <Text style={styles.emptyTitle}>{Copy.history.empty.title}</Text>
          <Text style={styles.caption}>{Copy.history.empty.body}</Text>
          {/* `secondary`, not `primary`: `Accent` is reserved for the one primary CTA per screen
              (constants/theme.ts), and this empty-state action used to be a `surface.raised` +
              `control.border` button expressing exactly that restraint. The pill's `secondary`
              variant IS that treatment, so the restraint is preserved, not spent. */}
          <PillButton
            variant="secondary"
            label={Copy.history.empty.cta}
            onPress={goAnalyze}
            style={styles.emptyCta}
          />
        </View>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={listContentStyle}
          ListHeaderComponent={
            state.items.length >= 2 ? (
              // A tools shelf above the content, separated by a hairline rather than by spacing
              // alone — without the rule this pill read as a first row of the list that happened
              // to be button-shaped. No label above it: the pill already says what it does, and
              // setting those words twice to manufacture a hierarchy would be filler (the same
              // call this screen's header makes about its own missing eyebrow).
              <View style={styles.listHeader}>
                <PillButton
                  variant="secondary"
                  label={Copy.history.compare.cta}
                  accessibilityHint={Copy.history.compare.a11yHint}
                  onPress={openCompare}
                />
                <View style={styles.listHeaderRule} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <HistoryRow
              item={item}
              thumbnailUris={thumbnails[item.id] ?? []}
              isDeleting={deletingIds.has(item.id)}
              onPress={() => openResult(item)}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}
      </SafeAreaView>
    </ScreenGradient>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      // Transparent — `<ScreenGradient>` behind it owns the fill.
      backgroundColor: 'transparent',
    },
    // width/maxWidth/alignSelf here and on centerBlock/listContent below: the same tablet
    // readable-column cap as app/(tabs)/index.tsx (issue #63) — a no-op on any phone, see
    // ContentWidth's own comment in constants/theme.ts.
    header: {
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.xl,
    },
    // The chrome line above the title. Right-aligned, so the control sits where a top-bar control
    // is expected and has nothing beside it to compete with.
    chromeRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    headerTitle: {
      fontFamily: FontFamily.display.bold,
      // xl -> display (24 -> 64). The screen's ONE oversized element, per spec 2026-07-26 §3.1's
      // still-standing "at most one display-or-larger element per screen".
      fontSize: FontSize.display,
      letterSpacing: Tracking.hero,
      lineHeight: FontSize.display * LineHeight.hero,
      color: colors.text.primary,
    },
    centerBlock: {
      flex: 1,
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    caption: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.md,
      lineHeight: FontSize.md * LineHeight.body,
      // `text.primary`: these captions sit directly on the page wash, proven for the primary tone
      // only (`Gradient`'s contract, constants/theme.ts).
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
      // The ring above already carries this block's air; without an extra step here the title sits
      // closer to the ring than to the body line under it, and the three read as two groups.
      marginTop: Spacing.md,
    },
    emptyCta: {
      marginTop: Spacing.sm,
    },
    list: {
      flex: 1,
    },
    listContent: {
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      paddingHorizontal: Spacing.xl,
      // The tab bar floats and reserves no layout space — see `TabBar` in constants/theme.ts.
      // Without this the last row scrolls under the bar and stops there. The phone default here
      // is the floor; the render site overlays `TabBar.clearanceFor(insets.bottom)` (issue #63).
      paddingBottom: TabBar.clearance,
      gap: Spacing.md,
    },
    // The tools shelf above the list, ruled off from the rows below it. Every per-row style that
    // used to live here moved to `components/history/history-row.tsx` with the row itself.
    listHeader: {
      alignSelf: 'stretch',
      gap: Spacing.lg,
      marginBottom: Spacing.sm,
    },
    listHeaderRule: {
      backgroundColor: colors.hairline,
      height: StyleSheet.hairlineWidth,
    },
  });
}
