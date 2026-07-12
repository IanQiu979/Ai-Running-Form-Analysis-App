/**
 * Regression lock for <ResultDisclaimer /> (issue #68).
 *
 * This looks like a snapshot of a static string, and it is — deliberately. Issue #68 tells you to
 * source this text from `knowledge/injury_flags.md`, and that is WRONG: that file is prompt
 * content fed to the model, and its wording is not the shipped wording. The deck's
 * `result.disclaimer.footer` is, and it calls itself "its final, shipped form". This test pins the
 * component to the deck so the next person to follow the issue's instructions gets a red test
 * instead of a legally weaker disclaimer.
 */
import { render, screen } from '@testing-library/react-native';

import { ResultDisclaimer } from '../result-disclaimer';
import { Copy } from '@/constants/copy';

it('renders the copy deck disclaimer verbatim', async () => {
  await render(<ResultDisclaimer />);

  expect(screen.getByText(Copy.result.disclaimer.footer)).toBeTruthy();
});

// The disclaimer must LEAD with the disavowal, not bury it — a reader who stops after one
// sentence must still have been told this is not medical advice. Asserts against the rendered
// node, not against the Copy constant (which would only be testing that a string is itself).
it('leads with the disavowal rather than burying it', async () => {
  await render(<ResultDisclaimer />);

  const rendered = screen.getByTestId('result-disclaimer-text');
  expect(rendered.props.children).toEqual(expect.stringMatching(/^This is not medical advice\./));
});
