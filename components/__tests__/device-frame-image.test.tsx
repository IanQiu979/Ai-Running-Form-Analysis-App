/**
 * `<DeviceFrameImage>` is the single seam every frame that has NOT left the device yet renders
 * through (the Preparing and Analysing thumbnails). These lock that the seam, not its caller,
 * decides the source (built from bytes by `deviceFrameSource`) and the cache policy (none), and
 * that no placeholder is set — the sibling of `private-frame-image.test.tsx`.
 */
import { render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { DeviceFrameImage } from '../device-frame-image';
import { deviceFrameSource } from '@/lib/private-frame-image';

const B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD+abc=';

describe('DeviceFrameImage', () => {
  it('draws the bytes as a data URI built by deviceFrameSource, with no memory or disk cache', async () => {
    await render(<DeviceFrameImage base64={B64} testID="frame" />);
    const image = screen.getByTestId('frame');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([deviceFrameSource(B64)]);
    expect(image.props.source).toEqual([{ uri: `data:image/jpeg;base64,${B64}` }]);
  });

  it('sets no placeholder', async () => {
    await render(<DeviceFrameImage base64={B64} testID="frame" />);
    const image = screen.getByTestId('frame');
    expect(image.props.placeholder ?? []).toEqual([]);
  });

  it('draws nothing for a string that is not plain base64', async () => {
    await render(<DeviceFrameImage base64="file:///var/mobile/frame-01.jpg" testID="frame" />);
    const image = screen.getByTestId('frame');
    expect(image.props.source ?? []).toEqual([]);
    expect(image.props.cachePolicy).toBe('none');
  });

  it('ignores a cache policy, source or placeholder a caller smuggles past the types', async () => {
    // A placeholder matters most: expo-image on iOS writes placeholders to its disk cache whatever
    // `cachePolicy` says, so a body image must never reach that prop.
    const smuggled = {
      base64: B64,
      cachePolicy: 'memory-disk',
      source: { uri: 'https://example.com/elsewhere.jpg' },
      placeholder: { uri: `data:image/jpeg;base64,${B64}` },
      testID: 'frame',
    } as unknown as ComponentProps<typeof DeviceFrameImage>;
    await render(<DeviceFrameImage {...smuggled} />);
    const image = screen.getByTestId('frame');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: `data:image/jpeg;base64,${B64}` }]);
    expect(image.props.placeholder ?? []).toEqual([]);
  });
});
