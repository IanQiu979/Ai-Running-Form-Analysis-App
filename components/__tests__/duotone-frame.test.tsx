/**
 * Locks the rules that make DuotoneFrame safe on real bodies: the frame draws under the app's one
 * private-frame cache policy (signed URL, no image cache — `lib/private-frame-image.ts`), never
 * through react-native-svg's disk-cached image pipeline; the grade is a greyscale blend plus a
 * low-opacity wash of the page's black, never a hue shift of the subject; and the frame always
 * carries a text alternative. The annotation marks and the vignette are the result screen's own
 * layers now, not this component's, so there is nothing about them to lock here.
 */
import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';

import { DuotoneFrame } from '../duotone-frame';
import { Ink } from '@/constants/v23-theme';

const SIGNED =
  'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-01.jpg?token=token-01';

describe('DuotoneFrame', () => {
  it('renders the supplied image', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByTestId('frame')).toBeTruthy();
  });

  it('carries the text alternative the hero requires', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByLabelText('your running frame')).toBeTruthy();
  });

  it('draws the frame through the private-frame cache policy', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    const image = screen.getByTestId('frame-image', { includeHiddenElements: true });
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: SIGNED }]);
  });

  it('draws nothing for a frame URL that is not a signed media link', async () => {
    await render(<DuotoneFrame uri="file:///frame-01.jpg" accessibilityLabel="your running frame" testID="frame" />);
    const image = screen.getByTestId('frame-image', { includeHiddenElements: true });
    expect(image.props.source ?? []).toEqual([]);
  });

  // Preparing / Analysing (2026-10-06): a frame that has not left the device yet draws from its
  // in-memory bytes. `<PrivateFrameImage>` refuses any `data:` URI, so a data-URI source on the
  // image node is only reachable through `<DeviceFrameImage>`.
  describe('a frame still on the device (deviceBase64)', () => {
    const B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD+abc=';

    it('draws the bytes through the device-frame source under the same no-cache policy', async () => {
      await render(<DuotoneFrame deviceBase64={B64} accessibilityLabel="Frame 2 of 5" testID="frame" />);
      const image = screen.getByTestId('frame-image', { includeHiddenElements: true });
      expect(image.props.source).toEqual([{ uri: `data:image/jpeg;base64,${B64}` }]);
      expect(image.props.cachePolicy).toBe('none');
    });

    it('carries the text alternative', async () => {
      await render(<DuotoneFrame deviceBase64={B64} accessibilityLabel="Frame 2 of 5" testID="frame" />);
      expect(screen.getByLabelText('Frame 2 of 5')).toBeTruthy();
    });

    it('draws nothing for device bytes that are not plain base64', async () => {
      await render(
        <DuotoneFrame deviceBase64={SIGNED} accessibilityLabel="Frame 2 of 5" testID="frame" />
      );
      const image = screen.getByTestId('frame-image', { includeHiddenElements: true });
      expect(image.props.source ?? []).toEqual([]);
    });

    it.each(['cover', 'contain'] as const)('passes contentFit="%s" through to the image', async (fit) => {
      await render(
        <DuotoneFrame deviceBase64={B64} contentFit={fit} accessibilityLabel="Frame 2 of 5" testID="frame" />
      );
      const image = screen.getByTestId('frame-image', { includeHiddenElements: true });
      expect(image.props.contentFit).toBe(fit);
    });
  });

  it('passes contentFit through for a stored frame too, defaulting to cover', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    expect(screen.getByTestId('frame-image', { includeHiddenElements: true }).props.contentFit).toBe('cover');
  });

  it('desaturates with a neutral saturation-blend layer', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    const layer = screen.getByTestId('frame-desaturate', { includeHiddenElements: true });
    const style = StyleSheet.flatten(layer.props.style);
    expect(style.mixBlendMode).toBe('saturation');
    // A saturation blend only greys the photo when the blend colour itself has no saturation.
    const [r, g, b] = [1, 3, 5].map((i) => style.backgroundColor.slice(i, i + 2));
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(layer.props.accessibilityElementsHidden).toBe(true);
  });

  describe('on Android', () => {
    const originalOS = Platform.OS;
    const originalVersion = Platform.Version;
    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
      Object.defineProperty(Platform, 'Version', { value: originalVersion, configurable: true });
    });

    function setAndroidApi(version: number) {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      Object.defineProperty(Platform, 'Version', { value: version, configurable: true });
    }

    // Below API 29 `mixBlendMode` is ignored, so the layer would paint an opaque `Ink.bg` sheet
    // over the runner instead of greying them.
    it('does not mount the blend layer below API 29', async () => {
      setAndroidApi(28);
      await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
      expect(screen.queryByTestId('frame-desaturate', { includeHiddenElements: true })).toBeNull();
      expect(screen.getByTestId('frame-image', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('frame-grade', { includeHiddenElements: true })).toBeTruthy();
    });

    it('mounts the blend layer from API 29', async () => {
      setAndroidApi(29);
      await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
      expect(screen.getByTestId('frame-desaturate', { includeHiddenElements: true })).toBeTruthy();
    });
  });

  it('grades toward the page’s black with a light wash rather than recolouring the subject', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="your running frame" testID="frame" />);
    const overlay = screen.getByTestId('frame-grade', { includeHiddenElements: true });
    const style = StyleSheet.flatten(overlay.props.style);
    expect(style.backgroundColor).toBe(Ink.bg);
    // A grade heavy enough to tint the interface, light enough to leave skin readable.
    expect(style.opacity).toBeLessThanOrEqual(0.2);
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
  });

  it('draws no annotation marks of its own — those are the hero box’s layers', async () => {
    await render(<DuotoneFrame uri={SIGNED} accessibilityLabel="frame" testID="frame" />);
    expect(screen.queryByTestId('frame-annotations-ground', { includeHiddenElements: true })).toBeNull();
  });
});
