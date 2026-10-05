/**
 * Regression lock for <ResultDisclaimer /> (issue #68, folded 2026-10-05).
 *
 * The full text is pinned to the copy deck deliberately. Issue #68 tells you to source this text
 * from `knowledge/injury_flags.md`, and that is WRONG: that file is prompt content fed to the
 * model, and its wording is not the shipped wording. The deck's `result.disclaimer.footer` is, and
 * it calls itself "its final, shipped form". This suite pins the component to the deck so the next
 * person to follow the issue's instructions gets a red test instead of a legally weaker disclaimer.
 *
 * Since the captain's 2026-10-03 device test the disclaimer is folded to one line and opens on a
 * tap. Reanimated tweens do not advance under Jest here (CLAUDE.md § Testing), so the open/fold
 * round trip is asserted with reduced motion (where it is instant), and the animated path is held
 * to its first frame and its structure.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ResultDisclaimer } from '../result-disclaimer';
import { Copy } from '@/constants/copy';

const { summary, footer } = Copy.result.disclaimer;

async function press() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('result-disclaimer'));
  });
}

it('is folded by default: one short line, as a collapsed button', async () => {
  await render(<ResultDisclaimer reduceMotion />);

  const toggle = screen.getByRole('button', { name: summary });
  expect(toggle.props.accessibilityState).toEqual({ expanded: false });
  expect(screen.getByText(summary)).toBeTruthy();
  expect(screen.queryByText(footer)).toBeNull();
  expect(screen.queryByTestId('result-disclaimer-text')).toBeNull();
});

it('the short line is plain and restrained, and is the full text’s own first sentence', () => {
  expect(summary).toBe('This is not medical advice');
  expect(footer.startsWith(`${summary}.`)).toBe(true);
});

it('opens to the copy deck disclaimer verbatim, then folds again', async () => {
  await render(<ResultDisclaimer reduceMotion />);

  await press();
  expect(screen.getByText(footer)).toBeTruthy();
  const open = screen.getByTestId('result-disclaimer');
  expect(open.props.accessibilityState).toEqual({ expanded: true });
  // Open, the button's label is the whole disclaimer, so a screen reader reads all of it.
  expect(open.props.accessibilityLabel).toBe(footer);

  await press();
  expect(screen.queryByText(footer)).toBeNull();
  const folded = screen.getByTestId('result-disclaimer');
  expect(folded.props.accessibilityState).toEqual({ expanded: false });
  expect(folded.props.accessibilityLabel).toBe(summary);
});

// The disclaimer must LEAD with the disavowal, not bury it — a reader who stops after one
// sentence must still have been told this is not medical advice. Asserts against the rendered
// node, not against the Copy constant (which would only be testing that a string is itself).
it('leads with the disavowal rather than burying it', async () => {
  await render(<ResultDisclaimer reduceMotion />);
  await press();

  const rendered = screen.getByTestId('result-disclaimer-text');
  expect(rendered.props.children).toEqual(expect.stringMatching(/^This is not medical advice\./));
});

it('with motion on, opens into a clipping box that starts closed and transparent', async () => {
  await render(<ResultDisclaimer reduceMotion={false} />);
  await press();

  expect(screen.getByTestId('result-disclaimer').props.accessibilityState).toEqual({ expanded: true });
  // The text is mounted at once; the box around it reveals it from height 0.
  const text = screen.getByTestId('result-disclaimer-text');
  expect(text.props.children).toBe(footer);
  const style = StyleSheet.flatten(screen.getByTestId('result-disclaimer-clip').props.style) as Record<string, unknown>;
  expect(style.overflow).toBe('hidden');
  expect(style.height).toBe(0);
  expect(style.opacity).toBe(0);
});

it('with motion on, a second tap announces the fold at once', async () => {
  await render(<ResultDisclaimer reduceMotion={false} />);
  await press();
  await press();

  const folded = screen.getByTestId('result-disclaimer');
  expect(folded.props.accessibilityState).toEqual({ expanded: false });
  expect(folded.props.accessibilityLabel).toBe(summary);
});
