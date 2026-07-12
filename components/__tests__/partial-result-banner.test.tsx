/**
 * Lock for <PartialResultBanner /> (issue #56) — `isFallback: true` must be visibly, honestly
 * flagged, never hidden and never presented as a full result.
 */
import { render, screen } from '@testing-library/react-native';

import { PartialResultBanner } from '../partial-result-banner';
import { Copy } from '@/constants/copy';

it('renders the deck "Partial read" title verbatim', async () => {
  await render(<PartialResultBanner assessedCount={2} />);

  expect(screen.getByText(Copy.result.partial.banner.title)).toBeTruthy();
});

it('interpolates the assessed-pillar count into the body and never fabricates a full score', async () => {
  await render(<PartialResultBanner assessedCount={2} />);

  expect(screen.getByTestId('partial-banner-body').props.children).toBe(
    "We could confidently score 2 of 4 pillars from this clip. The rest are marked not assessed — we don't guess at a score."
  );
});

it('reflects a different assessed count correctly', async () => {
  await render(<PartialResultBanner assessedCount={3} />);

  expect(screen.getByTestId('partial-banner-body').props.children).toEqual(
    expect.stringContaining('3 of 4 pillars')
  );
});
