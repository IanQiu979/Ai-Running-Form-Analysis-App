/**
 * Lock for <PartialResultBanner /> (issue #56) — `isFallback: true` must be visibly, honestly
 * flagged, never hidden and never presented as a full result.
 */
import { render, screen } from '@testing-library/react-native';

import { PartialResultBanner } from '../partial-result-banner';
import { Copy } from '@/constants/copy';

it('renders the deck "Partial read" title verbatim', async () => {
  await render(<PartialResultBanner assessedCount={2} mediaType="video" />);

  expect(screen.getByText(Copy.result.partial.banner.title)).toBeTruthy();
});

it('interpolates the assessed-pillar count into the body and never fabricates a full score', async () => {
  await render(<PartialResultBanner assessedCount={2} mediaType="video" />);

  expect(screen.getByTestId('partial-banner-body').props.children).toBe(
    '2 of 4 pillars scored from this clip. The rest are marked not assessed; no score is estimated.'
  );
});

it('reflects a different assessed count correctly', async () => {
  await render(<PartialResultBanner assessedCount={3} mediaType="video" />);

  expect(screen.getByTestId('partial-banner-body').props.children).toEqual(
    expect.stringContaining('3 of 4 pillars')
  );
});

it('says "photo" instead of "clip" for a photo submission (M3, v23-ux-audit-r1)', async () => {
  await render(<PartialResultBanner assessedCount={2} mediaType="photo" />);

  expect(screen.getByTestId('partial-banner-body').props.children).toBe(
    '2 of 4 pillars scored from this photo. The rest are marked not assessed; no score is estimated.'
  );
});
