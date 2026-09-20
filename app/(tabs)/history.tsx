/**
 * (tabs)/history — Screen 8, History (issue #55), cut to V23-09 (2026-09-14).
 *
 * Lists the caller's own `analyses` rows (a plain RLS-guarded read — `lib/history.ts`'s
 * `fetchHistoryList`, not an edge function: `docs/architecture.md` "Direct Supabase-client reads
 * ... list own `analyses`"), each with a frame deck resolved through short-TTL signed URLs
 * (`lib/history.ts`'s `signFrameStrip` — see that file's header for THE MEDIA RULE this screen
 * depends on: the `media` bucket is private, there are no public URLs, and a signed URL is never
 * logged). Tap a row to reopen its stored result at `/result/[id]`; tap Delete to purge it (row +
 * frames together, via `DELETE /functions/v1/analysis/:id` — `lib/history.ts`'s
 * `deleteHistoryAnalysis`) after a confirm. The confirm is the page's own `<ConfirmDialog
 * tone="danger">` — "danger used on the destructive action only" — and a failed delete reports
 * through the same dialog as a one-button notice; no native `Alert` is raised from this screen.
 *
 * Renders every state CLAUDE.md's "build the states, not just the happy view" requires: loading,
 * error (the fetch itself failed), empty (no analyses yet), and ready — where "ready" already
 * covers the long-content case for free, because the list is a virtualized `FlatList`, not a
 * `ScrollView` mapping every row eagerly.
 *
 * THE TAB BAR IS PART OF THE SCROLL. The page says "tab bar sits at the end of the scroll, not
 * floating": the navigator (`app/(tabs)/_layout.tsx`) renders no bar on this tab, and this screen
 * lays the inline `<V23TabBar>` out itself — as the list's footer in the ready state, and pinned
 * under the centred column in the loading / error / empty states. So the list needs no bottom
 * clearance for a floating bar; the footer's own margin pays the bottom inset.
 *
 * NO BUSINESS LOGIC HERE (CLAUDE.md: "No business rules in the client"): this screen does not
 * decide which rows are deletable, does not compute a tier/quota gate on the list, and does not
 * decide whether Storage successfully purged anything — it only renders what `lib/history.ts`'s
 * reads report and sends the caller's own intent (open, delete) to the server.
 *
 * The row lives in `components/history/history-row.tsx`; what stays here is the header, the four
 * states, the list, and the two dialogs.
 */
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryRow } from '@/components/history/history-row';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { SquareButton } from '@/components/ui/square-button';
import { SquareIconButton } from '@/components/ui/square-icon-button';
import { TopBar } from '@/components/ui/top-bar';
import { SettingsIcon } from '@/components/ui/v23-icons';
import { V23TabBar } from '@/components/v23-tab-bar';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import {
  deleteHistoryAnalysis,
  fetchHistoryList,
  signFrameStrip,
  type HistoryListItem,
} from '@/lib/history';
import { useSession } from '@/lib/session-provider';
import { useAnnounce } from '@/lib/use-announce';

type ScreenState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: HistoryListItem[] };

/** The one dialog this screen can show at a time, modelled as local state so each kind renders
 *  its own `<ConfirmDialog>` and nothing native is raised. */
type Dialog =
  | { kind: 'deleteConfirm'; item: HistoryListItem }
  | { kind: 'deleteFailed' };

/** Mirrors `app/(tabs)/index.tsx`'s own `ActiveFlag` pattern: minted per fetch attempt, flipped
 * off on unmount/blur/re-fetch, so a slow or superseded request can never overwrite newer state
 * or fire against an unmounted screen. */
type ActiveFlag = { active: boolean };

export default function HistoryScreen() {
  const { session } = useSession();
  const userId = session?.user.id;

  return <HistoryScreenContent key={userId ?? 'signed-out'} userId={userId} />;
}

function HistoryScreenContent({ userId }: { userId: string | undefined }) {
  // The page's 59 / 34 are the design's minimum breathing room; a device with a larger inset
  // gets its own (the entry flow's pattern, `components/pillar-story.tsx`).
  const insets = useSafeAreaInsets();
  const safeTop = Math.max(insets.top, Layout.canvas.safeTop);
  const safeBottom = Math.max(insets.bottom, Layout.canvas.safeBottom);
  const headerStyle = useMemo(() => [styles.header, { paddingTop: safeTop }], [safeTop]);
  // Both bars pay the bottom inset themselves (the page's 34): the list's bar as the scroll's
  // last item, the pinned bar as the column's last child.
  const listBarStyle = useMemo(() => [styles.listBar, { marginBottom: safeBottom }], [safeBottom]);
  const pinnedBarStyle = useMemo(() => [styles.pinnedBar, { marginBottom: safeBottom }], [safeBottom]);

  const [state, setState] = useState<ScreenState>({ status: 'loading' });
  // Keyed by analysis id -> resolved frame-strip URLs. Separate from `state` so a thumbnail
  // resolving in has nothing to do with the list's own load/error/ready status — a row renders
  // with placeholder cells until, or unless, its own signing settles.
  const [thumbnails, setThumbnails] = useState<Record<string, string[]>>({});
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
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
    // A focus refresh keeps the last successful list on screen. Loading is only a full-screen
    // state before this mounted screen has any ready result (including a ready empty result), or
    // while retrying an error that has no stale list to show.
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }));

    let items: HistoryListItem[];
    try {
      items = await fetchHistoryList();
    } catch {
      if (active.active) {
        setState((current) => (current.status === 'ready' ? current : { status: 'error' }));
      }
      return;
    }

    if (!active.active) return;
    setState({ status: 'ready', items });

    // Best-effort, per row, resolved AFTER the list itself renders — a slow or failed signing
    // pass for one row must never delay or fail the whole list (lib/history.ts's header: "handle
    // a row whose media is gone without crashing"). Every successful list refresh signs fresh
    // short-TTL URLs; the previous URLs remain only in this mounted screen's memory as a bridge
    // until each refreshed strip resolves (docs/architecture.md).
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
      if (!userId) return;

      const active: ActiveFlag = { active: true };
      activeFlagRef.current = active;
      load(active);
      return () => {
        active.active = false;
      };
    }, [load, userId])
  );

  function confirmDelete(item: HistoryListItem) {
    setDialog({ kind: 'deleteConfirm', item });
  }

  function dismissDialog() {
    setDialog(null);
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
      setDialog({ kind: 'deleteFailed' });
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

  function openSettings() {
    router.push('/settings');
  }

  function retry() {
    load(activeFlagRef.current);
  }

  function goAnalyze() {
    router.push('/capture');
  }

  function goHome() {
    router.navigate('/');
  }

  const tabBar = (style: typeof listBarStyle | typeof pinnedBarStyle) => (
    <V23TabBar
      mode="inline"
      active="history"
      onPressHome={goHome}
      onPressHistory={() => {}}
      style={style}
      testID="history-tab-bar"
    />
  );

  return (
    <View style={styles.screen}>
      {/* Page: `padding:59px 24px 0; gap:16px` — the chrome row (only the Settings control, at
          the right; M5 of v23-ux-audit-r1 gave History the same entry point Home has) and then
          the display title on its own full-width line. */}
      <View style={headerStyle}>
        <TopBar
          trailing={
            <SquareIconButton
              accessibilityLabel={Copy.settings.title}
              bleed="right"
              onPress={openSettings}
              testID="history-settings">
              <SettingsIcon />
            </SquareIconButton>
          }
        />
        <Text accessibilityRole="header" style={styles.title} testID="history-title">
          {Copy.history.title}
        </Text>
      </View>

      {state.status === 'loading' && (
        <>
          <View style={styles.centerBlock}>
            {/* Not drawn on the page: the quietest faithful wait state — the same indicator
                `SquareButton busy` uses, and a live-region caption that says what is happening. */}
            <ActivityIndicator color={Ink.ink2} testID="history-loading" />
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {Copy.history.loading}
            </Text>
          </View>
          {tabBar(pinnedBarStyle)}
        </>
      )}

      {state.status === 'error' && (
        <>
          <View style={styles.centerBlock}>
            <Text style={styles.caption} accessibilityLiveRegion="polite">
              {Copy.history.error.loadFailed}
            </Text>
            <SquareButton variant="link" label={Copy.history.error.retry} onPress={retry} />
          </View>
          {tabBar(pinnedBarStyle)}
        </>
      )}

      {state.status === 'ready' && state.items.length === 0 && (
        <>
          <View style={styles.centerBlock}>
            {/* Captain's 2026-09-20 polish pass: no boxed card — the title is the screen's single
                centred focus, with its one secondary line beneath. */}
            <Text style={styles.emptyTitle}>{Copy.history.empty.title}</Text>
            <Text style={styles.emptyBody}>{Copy.history.empty.body}</Text>
            {/* `secondary` (the 1 px `line` border), as the page draws it — `accent` is the one
                primary CTA per screen and this is not it. */}
            <View style={styles.emptyCta}>
              <SquareButton variant="secondary" label={Copy.history.empty.cta} onPress={goAnalyze} />
            </View>
          </View>
          {tabBar(pinnedBarStyle)}
        </>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            state.items.length >= 2 ? (
              // The Compare entry point. The page does not draw it, but it is live functionality
              // with its own screen (issue #60), so it stays: a secondary button above the rows,
              // set apart by the list's own gap and nothing else — no hairline, no label.
              <SquareButton
                variant="secondary"
                label={Copy.history.compare.cta}
                accessibilityHint={Copy.history.compare.a11yHint}
                onPress={openCompare}
                testID="history-compare"
              />
            ) : null
          }
          ListFooterComponent={tabBar(listBarStyle)}
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

      {/* Page, third artboard: "Delete confirm · danger used on the destructive action only". */}
      <ConfirmDialog
        tone="danger"
        visible={dialog?.kind === 'deleteConfirm'}
        title={Copy.history.delete.confirm.title}
        body={Copy.history.delete.confirm.body}
        primary={{
          label: Copy.history.delete.confirm.cta.primary,
          onPress: () => {
            if (dialog?.kind !== 'deleteConfirm') return;
            const { item } = dialog;
            setDialog(null);
            void handleDelete(item);
          },
        }}
        secondary={{ label: Copy.history.delete.confirm.cta.secondary, onPress: dismissDialog }}
        testID="history-delete-confirm"
      />
      {/* Not drawn on the page: a failed delete's own outcome, as the same dialog with one button. */}
      <ConfirmDialog
        visible={dialog?.kind === 'deleteFailed'}
        title={Copy.history.delete.error.title}
        body={Copy.history.delete.error.body}
        primary={{ label: Copy.history.delete.error.dismiss, onPress: dismissDialog }}
        testID="history-delete-failed"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  // Page: `padding:59px 24px 0; gap:16px` — the top inset is applied at the render site.
  header: {
    paddingHorizontal: Layout.gutter,
    gap: Space.lg,
  },
  title: {
    ...Type.display,
    color: Ink.ink,
  },
  // Page (empty artboard): `flex:1; align-items:center; justify-content:center; gap:16px;
  // padding:24px; text-align:center`.
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
  emptyBody: {
    ...Type.body,
    color: Ink.ink2,
    textAlign: 'center',
  },
  emptyCta: {
    alignSelf: 'stretch',
    marginTop: Space.sm,
  },
  list: {
    flex: 1,
  },
  // Page: `padding:24px 24px 0; gap:16px`. No bottom clearance — the bar is the last item.
  listContent: {
    paddingTop: Space.xl,
    paddingHorizontal: Layout.gutter,
    gap: Space.lg,
  },
  // Page: the list's bar is `margin:24px -8px 34px`. The FlatList's own 16 pt `gap` already
  // separates the last row from the footer, so the footer pays only the remaining 8 of the
  // page's 24 (`Space.xl - Space.lg`). The -8 bleeds the bar past the 24 gutter so it sits 16
  // from the edge (`Layout.tabBar.inset`), where Home's floating bar sits too. The bottom 34 is
  // the live inset, applied at the render site.
  listBar: {
    marginTop: Space.xl - Space.lg,
    marginHorizontal: -(Layout.gutter - Layout.tabBar.inset),
  },
  // Page (empty artboard): `margin:24px 16px 34px` under the centred column.
  pinnedBar: {
    marginTop: Space.xl,
    marginHorizontal: Layout.tabBar.inset,
  },
});
