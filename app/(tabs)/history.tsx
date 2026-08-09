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
 */
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KineticText } from '@/components/kinetic-text';
import { CircleIconButton } from '@/components/ui/circle-icon-button';
import { PillButton } from '@/components/ui/pill-button';
import { ScreenGradient } from '@/components/ui/screen-gradient';
import { Copy } from '@/constants/copy';
import {
  Colors,
  ContentWidth,
  FontFamily,
  FontSize,
  HitTarget,
  LineHeight,
  Motion,
  Opacity,
  Radius,
  Score,
  ScoreBandLabel,
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
  formatHistoryDate,
  formatHistoryItemA11yLabel,
  formatHistoryItemDeleteA11yLabel,
  signFrameStrip,
  type HistoryListItem,
} from '@/lib/history';
import { useAnnounce } from '@/lib/use-announce';

// A local layout constant, not a `constants/theme.ts` role — same call `app/result/[id].tsx`
// makes for its own `HERO_ASPECT_RATIO`: thumbnail sizing isn't one of that file's roles (colors/
// spacing/type/radii), and this issue's file lane is explicitly this screen, not new
// design-system tokens.
const FRAME_THUMBNAIL_SIZE = 56;

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
        {/* The reference's content-detail header: a huge, tightly-leaded title that assembles
            itself word by word. Was a 24pt heading in a bare row. This is a top-level destination
            and now looks like one. No eyebrow above it — the copy deck has exactly one string for
            this screen's name, and setting the same words twice to manufacture a hierarchy would
            be filler, not structure. */}
        <View style={styles.headerRow}>
          <KineticText
            accessibilityRole="header"
            staggerMs={Motion.stagger.line}
            style={styles.header}
            containerStyle={styles.headerTitleRow}
            testID="history-title">
            {Copy.history.title}
          </KineticText>
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

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.text.primary} />
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
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            state.items.length >= 2 ? (
              <PillButton
                variant="secondary"
                label={Copy.history.compare.cta}
                accessibilityHint={Copy.history.compare.a11yHint}
                onPress={openCompare}
                style={styles.compareCta}
              />
            ) : null
          }
          renderItem={({ item }) => (
            <HistoryRow
              item={item}
              thumbnailUris={thumbnails[item.id] ?? []}
              isDeleting={deletingIds.has(item.id)}
              colors={colors}
              scheme={scheme}
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

function HistoryRow({
  item,
  thumbnailUris,
  isDeleting,
  colors,
  scheme,
  onPress,
  onDelete,
}: {
  item: HistoryListItem;
  thumbnailUris: string[];
  isDeleting: boolean;
  colors: ThemeColors;
  scheme: ColorScheme;
  onPress: () => void;
  onDelete: () => void;
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dateLabel = formatHistoryDate(item.createdAt);
  const { overall } = item.outcome.result;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemA11yLabel(item, dateLabel)}
        onPress={onPress}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        {thumbnailUris.length > 0 ? (
          <View style={styles.frameStrip} testID={`history-frame-strip-${item.id}`}>
            {thumbnailUris.map((uri, index) => (
              <Image key={`${item.id}-${index}`} source={{ uri }} style={styles.thumbnail} contentFit="cover" />
            ))}
          </View>
        ) : (
          // Covers BOTH the "still resolving" moment and the real "no thumbnail" outcome (empty
          // media_paths, or every signed-URL attempt failed) with the same neutral placeholder —
          // never a broken image, never a crash (lib/history.ts's header note on this exact case).
          <View style={styles.thumbnailPlaceholder} testID={`history-frame-placeholder-${item.id}`} />
        )}

        <View style={styles.rowInfo}>
          {/* The score is now the row's headline and the date its supporting metadata — the
              reference's list rows lead with the thing you came for, not with when it happened.
              Previously the date was the only prominent text and the score sat in a small chip
              beneath it. */}
          {overall.score !== null && overall.band !== null ? (
            <View style={styles.scoreLine}>
              <Text style={styles.scoreNumeral}>{overall.score}</Text>
              <Text style={[styles.scoreBand, { color: Score[overall.band][scheme].text }]}>
                {ScoreBandLabel[overall.band]}
              </Text>
            </View>
          ) : (
            <Text style={styles.notAssessedText}>{Copy.result.pillar.notAssessed.generic}</Text>
          )}
          <Text style={styles.dateText}>{dateLabel}</Text>
        </View>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={formatHistoryItemDeleteA11yLabel(item, dateLabel)}
        accessibilityState={{ disabled: isDeleting }}
        disabled={isDeleting}
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteButton, pressed && !isDeleting && styles.pressed, isDeleting && styles.disabled]}>
        {/* Kept as a visible word rather than becoming the reference's icon-only row action.
            Delete is destructive and irreversible here (it purges the stored frames too); an
            unlabelled glyph would be the one place in this redesign where matching the reference
            costs the user real clarity. Flagged as a judgement call. */}
        <Text style={styles.deleteText}>{Copy.history.item.deleteCta}</Text>
      </Pressable>
    </View>
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
    headerRow: {
      width: '100%',
      maxWidth: ContentWidth.readable,
      alignSelf: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: Spacing.md,
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.lg,
    },
    // `<KineticText>`'s own `containerStyle` (the wrapping row `style` gets applied per-word to
    // — flex has no meaningful effect on an individual word's TextStyle).
    headerTitleRow: {
      flex: 1,
    },
    header: {
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
    },
    emptyCta: {
      marginTop: Spacing.sm,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    disabled: {
      opacity: Opacity.disabled,
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
      // Without this the last row scrolls under the bar and stops there.
      paddingBottom: TabBar.clearance,
      gap: Spacing.md,
    },
    compareCta: {
      alignSelf: 'stretch',
      marginBottom: Spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.surface.base,
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: StyleSheet.hairlineWidth * 2,
      padding: Spacing.md,
    },
    rowMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    frameStrip: {
      flexDirection: 'row',
      gap: Spacing.xs,
    },
    thumbnail: {
      width: FRAME_THUMBNAIL_SIZE,
      height: FRAME_THUMBNAIL_SIZE,
      // `Radius.tile`, not `Radius.card`: a thumbnail nested inside a 24pt-cornered row needs the
      // tighter inner corner, or the two radii fight. Before the redesign `Radius.card` was 0, so
      // this line drew a square — it is now genuinely a rounded tile.
      borderRadius: Radius.tile,
      backgroundColor: colors.surface.raised,
    },
    thumbnailPlaceholder: {
      width: FRAME_THUMBNAIL_SIZE,
      height: FRAME_THUMBNAIL_SIZE,
      borderRadius: Radius.tile,
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderWidth: 1,
    },
    rowInfo: {
      flex: 1,
      gap: Spacing.xs,
    },
    dateText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      // Demoted to secondary metadata under the score — see the row's own comment.
      color: colors.text.secondary,
    },
    scoreLine: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: Spacing.sm,
    },
    scoreNumeral: {
      fontFamily: FontFamily.display.semiBold,
      // The row's headline now: sm -> xl, and in the display family rather than mono.
      fontSize: FontSize.xl,
      letterSpacing: Tracking.display,
      color: colors.text.primary,
    },
    scoreBand: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.xs,
      letterSpacing: Tracking.eyebrow,
      textTransform: 'uppercase',
    },
    notAssessedText: {
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      color: colors.text.secondary,
    },
    deleteButton: {
      minHeight: HitTarget.min,
      minWidth: HitTarget.min,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.sm,
    },
    deleteText: {
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
      color: colors.text.secondary,
      textDecorationLine: 'underline',
    },
  });
}
