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
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Copy } from '@/constants/copy';
import {
  Colors,
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
import {
  deleteHistoryAnalysis,
  fetchHistoryList,
  formatHistoryDate,
  formatHistoryItemA11yLabel,
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

  function retry() {
    load(activeFlagRef.current);
  }

  function goAnalyze() {
    router.push('/capture');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{Copy.history.title}</Text>
      </View>

      {state.status === 'loading' && (
        <View style={styles.centerBlock}>
          <ActivityIndicator color={colors.text.secondary} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.history.error.retry}
            onPress={retry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <Text style={styles.retryText}>{Copy.history.error.retry}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <View style={styles.centerBlock}>
          <Text style={styles.emptyTitle}>{Copy.history.empty.title}</Text>
          <Text style={styles.caption}>{Copy.history.empty.body}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={Copy.history.empty.cta}
            onPress={goAnalyze}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonText}>{Copy.history.empty.cta}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={Copy.history.item.deleteCta}
        accessibilityState={{ disabled: isDeleting }}
        disabled={isDeleting}
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteButton, pressed && !isDeleting && styles.pressed, isDeleting && styles.disabled]}>
        <Text style={styles.deleteText}>{Copy.history.item.deleteCta}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerRow: {
      paddingHorizontal: Spacing.xl,
      paddingTop: Spacing.xl,
      paddingBottom: Spacing.lg,
    },
    header: {
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
      minHeight: HitTarget.min,
      borderRadius: Radius.card,
      backgroundColor: colors.surface.raised,
      borderColor: colors.control.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.xl,
    },
    primaryButtonText: {
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
      color: colors.text.primary,
    },
    pressed: {
      opacity: Opacity.pressed,
    },
    disabled: {
      opacity: Opacity.disabled,
    },
    listContent: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xl,
      gap: Spacing.md,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
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
      borderRadius: Radius.card,
      backgroundColor: colors.surface.raised,
    },
    thumbnailPlaceholder: {
      width: FRAME_THUMBNAIL_SIZE,
      height: FRAME_THUMBNAIL_SIZE,
      borderRadius: Radius.card,
      backgroundColor: colors.surface.raised,
      borderColor: colors.hairline,
      borderWidth: 1,
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
