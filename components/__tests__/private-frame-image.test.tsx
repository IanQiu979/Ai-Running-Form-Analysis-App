/**
 * `<PrivateFrameImage>` is the single seam every stored frame renders through. These lock that
 * the seam, not its caller, decides the source and the cache policy (`lib/private-frame-image.ts`).
 */
import { render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { PrivateFrameImage } from '../private-frame-image';

const SIGNED =
  'https://project.supabase.co/storage/v1/object/sign/media/user/analysis/frame-01.jpg?token=token-01';

describe('PrivateFrameImage', () => {
  it('draws a signed media URL with no memory or disk cache', async () => {
    await render(<PrivateFrameImage uri={SIGNED} testID="frame" />);
    const image = screen.getByTestId('frame');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: SIGNED }]);
  });

  it('draws nothing for a URL that is not a signed media link', async () => {
    await render(
      <PrivateFrameImage
        uri="https://project.supabase.co/storage/v1/object/public/media/user/analysis/frame-01.jpg"
        testID="frame"
      />
    );
    const image = screen.getByTestId('frame');
    expect(image.props.source ?? []).toEqual([]);
    expect(image.props.cachePolicy).toBe('none');
  });

  it('ignores a cache policy or source a caller smuggles past the types', async () => {
    const smuggled = {
      uri: SIGNED,
      cachePolicy: 'memory-disk',
      source: { uri: 'https://example.com/elsewhere.jpg' },
      testID: 'frame',
    } as unknown as ComponentProps<typeof PrivateFrameImage>;
    await render(<PrivateFrameImage {...smuggled} />);
    const image = screen.getByTestId('frame');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: SIGNED }]);
  });
});
