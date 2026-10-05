/**
 * A compact, ordered view of the private frames used for one analysis.
 *
 * The caller owns signed-URL resolution. This component never sees a bucket path as an image
 * source and never constructs, logs, or persists a URL. Every slot keeps its position while it
 * is signing or unavailable, so the spoken "Frame N of M" labels always describe the server's
 * original analysis order.
 *
 * Stored running frames are sensitive. Both of this component's `expo-image` surfaces opt out
 * of disk and memory caching, so signed URL expiry, sign-out, and deletion leave no durable copy
 * from here. (The result hero and History's thumbnails render the same frames through their own
 * components; this note covers only the strip and its viewer.)
 */
import { useMemo, useState } from 'react';
import { Image } from 'expo-image';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SquareIconButton } from '@/components/ui/square-icon-button';
import { CloseIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import type { AnalysisFrameSlot } from '@/lib/result-frames';

type Props = {
  slots: AnalysisFrameSlot[];
  /** Overrides the live OS setting in focused component tests. */
  reduceMotion?: boolean;
};

function frameLabel(index: number, count: number): string {
  return Copy.result.frames.frameA11yLabel
    .replace('{n}', String(index + 1))
    .replace('{total}', String(count));
}

function imageIdentity(index: number, slot: AnalysisFrameSlot): string | null {
  return slot.status === 'ready' ? `${index}:${slot.uri}` : null;
}

export function AnalyzedFramesStrip({ slots, reduceMotion: reduceMotionOverride }: Props) {
  const systemReduceMotion = useReducedMotion();
  const reduceMotion = reduceMotionOverride ?? systemReduceMotion;
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [failedImages, setFailedImages] = useState<ReadonlySet<string>>(() => new Set());

  if (slots.length === 0) return null;

  function markUnavailable(index: number, slot: AnalysisFrameSlot) {
    const identity = imageIdentity(index, slot);
    if (!identity) return;
    setFailedImages((current) => {
      if (current.has(identity)) return current;
      const next = new Set(current);
      next.add(identity);
      return next;
    });
  }

  function isReady(index: number, slot: AnalysisFrameSlot): slot is Extract<AnalysisFrameSlot, { status: 'ready' }> {
    const identity = imageIdentity(index, slot);
    return slot.status === 'ready' && identity !== null && !failedImages.has(identity);
  }

  return (
    <View testID="analyzed-frames-strip" style={styles.strip}>
      <Text style={[Type.label, styles.secondary]}>{Copy.result.frames.title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.frameRow}>
        {slots.map((slot, index) => {
          const label = frameLabel(index, slots.length);
          const ready = isReady(index, slot);
          return (
            <Pressable
              key={`${slot.path}-${index}`}
              testID={`analyzed-frame-slot-${index}`}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: !ready, busy: slot.status === 'loading' }}
              disabled={!ready}
              onPress={() => setViewerIndex(index)}
              style={({ pressed }) => [styles.thumbnail, pressed && styles.pressed]}>
              {ready ? (
                <Image
                  testID={`analyzed-frame-image-${index}`}
                  source={{ uri: slot.uri }}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="none"
                  accessible={false}
                  onError={() => markUnavailable(index, slot)}
                />
              ) : slot.status === 'loading' ? (
                <View
                  testID={`analyzed-frame-loading-${index}`}
                  style={[StyleSheet.absoluteFill, styles.placeholder]}>
                  <ActivityIndicator color={Ink.ink2} />
                </View>
              ) : (
                <View
                  testID={`analyzed-frame-unavailable-${index}`}
                  style={[StyleSheet.absoluteFill, styles.placeholder]}
                />
              )}
            </Pressable>
          );
        })}
      </ScrollView>

      {viewerIndex !== null ? (
        <AnalyzedFrameViewer
          slots={slots}
          initialIndex={viewerIndex}
          reduceMotion={reduceMotion}
          failedImages={failedImages}
          isReady={isReady}
          onImageError={markUnavailable}
          onDismiss={() => setViewerIndex(null)}
        />
      ) : null}
    </View>
  );
}

function AnalyzedFrameViewer({
  slots,
  initialIndex,
  reduceMotion,
  failedImages,
  isReady,
  onImageError,
  onDismiss,
}: {
  slots: AnalysisFrameSlot[];
  initialIndex: number;
  reduceMotion: boolean;
  failedImages: ReadonlySet<string>;
  isReady: (
    index: number,
    slot: AnalysisFrameSlot
  ) => slot is Extract<AnalysisFrameSlot, { status: 'ready' }>;
  onImageError: (index: number, slot: AnalysisFrameSlot) => void;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  // The list's measured height, not the window's: on edge-to-edge Android the Modal can be taller
  // than the window, which would leave a `contain` frame sitting high. Window height is only the
  // first-frame fallback before the list reports its own layout.
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  // Pages re-render when a frame fails to load or the list reports its height.
  const listExtraData = useMemo(() => ({ failedImages, pageHeight }), [failedImages, pageHeight]);

  return (
    <Modal
      visible
      animationType={reduceMotion ? 'none' : 'fade'}
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={onDismiss}
      testID="analyzed-frame-viewer">
      <View
        testID="analyzed-frame-viewer-surface"
        style={styles.viewer}
        accessibilityViewIsModal>
        <FlatList
          testID="analyzed-frame-viewer-list"
          style={styles.viewerList}
          onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}
          data={slots}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          windowSize={3}
          extraData={listExtraData}
          keyExtractor={(slot, index) => `${slot.path}-${index}`}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          renderItem={({ item, index }) => {
            const label = frameLabel(index, slots.length);
            return (
              <View style={[styles.viewerPage, { width, height: pageHeight ?? windowHeight }]}>
                {isReady(index, item) ? (
                  <Image
                    testID={`analyzed-frame-viewer-image-${index}`}
                    source={{ uri: item.uri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="contain"
                    cachePolicy="none"
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={label}
                    onError={() => onImageError(index, item)}
                  />
                ) : item.status === 'loading' ? (
                  <View
                    testID={`analyzed-frame-viewer-loading-${index}`}
                    style={[StyleSheet.absoluteFill, styles.viewerFallback]}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={label}>
                    <ActivityIndicator color={Ink.ink2} />
                  </View>
                ) : (
                  <View
                    testID={`analyzed-frame-viewer-unavailable-${index}`}
                    style={[StyleSheet.absoluteFill, styles.viewerFallback]}
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={label}
                  />
                )}
              </View>
            );
          }}
        />

        <SquareIconButton
          testID="analyzed-frame-viewer-close"
          accessibilityLabel={Copy.result.frames.close}
          onPress={onDismiss}
          style={[
            styles.close,
            {
              top: Math.max(insets.top, Layout.canvas.safeTop),
              right: Layout.gutter,
            },
          ]}>
          <CloseIcon />
        </SquareIconButton>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: Space.md,
  },
  frameRow: {
    gap: Space.sm,
  },
  thumbnail: {
    width: Layout.frameDeck.size,
    height: Layout.frameDeck.size,
    backgroundColor: Ink.bgPlaceholder,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    borderWidth: Layout.hairline,
    overflow: 'hidden',
  },
  placeholder: {
    alignItems: 'center',
    backgroundColor: Ink.bgPlaceholder,
    justifyContent: 'center',
  },
  viewer: {
    flex: 1,
    backgroundColor: Ink.bg,
  },
  viewerList: {
    flex: 1,
  },
  viewerPage: {
    alignItems: 'center',
    backgroundColor: Ink.bg,
    justifyContent: 'center',
  },
  viewerFallback: {
    alignItems: 'center',
    backgroundColor: Ink.bg,
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
  },
  secondary: {
    color: Ink.ink2,
  },
  pressed: {
    opacity: 0.6,
  },
});
