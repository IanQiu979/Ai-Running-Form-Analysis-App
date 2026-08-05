/**
 * `<KineticText>` splits a sentence into one `Text` per word so each can reveal independently.
 * That is a real accessibility hazard — done naively, a screen reader announces a headline one
 * word at a time — so the locks below are mostly about the a11y tree, not about the animation.
 *
 * What is proven here:
 *   - the whole, unsplit string reaches assistive tech as ONE node (the regression that would
 *     otherwise ship silently, because it looks perfect on screen);
 *   - the word nodes are hidden from that tree, so nothing is announced twice;
 *   - `play={false}` and reduced motion both still render every word (the content must never
 *     depend on the animation having run — a user with Reduce Motion on must not see a blank
 *     headline);
 *   - `onComplete` fires under reduced motion too, so a caller sequencing off it is never hung.
 */
import { render, screen, waitFor } from '@testing-library/react-native';

import { Copy } from '@/constants/copy';

import { KineticText } from '../kinetic-text';

const mockUseReducedMotion = jest.fn(() => false);
jest.mock('@/hooks/use-reduced-motion', () => ({
  useReducedMotion: () => mockUseReducedMotion(),
}));

const SENTENCE = 'Foot lands well ahead of your hips.';

describe('KineticText', () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReturnValue(false);
  });

  it('exposes the whole sentence to assistive tech as one node, not one node per word', async () => {
    await render(<KineticText testID="kt">{SENTENCE}</KineticText>);

    expect(screen.getByLabelText(SENTENCE)).toBeTruthy();
  });

  it('hides every word node from the a11y tree, so nothing is announced twice', async () => {
    await render(<KineticText testID="kt">{SENTENCE}</KineticText>);

    // Reachable only WITH includeHiddenElements — i.e. genuinely hidden. See CLAUDE.md § Testing.
    const firstWord = screen.getByTestId('kt-word-0', { includeHiddenElements: true });
    expect(firstWord.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByTestId('kt-word-0')).toBeNull();
  });

  it('renders one node per whitespace-separated word', async () => {
    await render(<KineticText testID="kt">{SENTENCE}</KineticText>);

    const wordCount = SENTENCE.split(/\s+/).filter(Boolean).length;
    expect(screen.getByTestId(`kt-word-${wordCount - 1}`, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId(`kt-word-${wordCount}`, { includeHiddenElements: true })).toBeNull();
  });

  it('keeps every word but the last trailing-spaced, so wrapping matches an unsplit Text', async () => {
    await render(<KineticText testID="kt">{SENTENCE}</KineticText>);

    expect(screen.getByTestId('kt-word-0', { includeHiddenElements: true }).props.children).toBe('Foot ');
    // The last word carries no trailing space — otherwise a centred line would sit visibly off-centre.
    expect(screen.getByTestId('kt-word-6', { includeHiddenElements: true }).props.children).toBe('hips.');
  });

  it('still renders the full content with play={false} — the static/re-open case', async () => {
    await render(
      <KineticText testID="kt" play={false}>
        {SENTENCE}
      </KineticText>
    );

    expect(screen.getByLabelText(SENTENCE)).toBeTruthy();
    expect(screen.getByTestId('kt-word-0', { includeHiddenElements: true })).toBeTruthy();
  });

  it('still renders the full content under reduced motion', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    await render(<KineticText testID="kt">{SENTENCE}</KineticText>);

    expect(screen.getByLabelText(SENTENCE)).toBeTruthy();
    expect(screen.getByTestId('kt-word-0', { includeHiddenElements: true })).toBeTruthy();
  });

  it('fires onComplete under reduced motion, so a sequencing caller is never left hanging', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const onComplete = jest.fn();
    await render(
      <KineticText testID="kt" onComplete={onComplete}>
        {SENTENCE}
      </KineticText>
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it('carries an explicit header role through when the text is a screen heading', async () => {
    await render(
      <KineticText testID="kt" accessibilityRole="header">
        {SENTENCE}
      </KineticText>
    );

    expect(screen.getByTestId('kt').props.accessibilityRole).toBe('header');
  });

  // Regression lock for the sign-in wordmark bug: `constants/copy.ts`'s `wordmark` string once
  // read 'Pace AnalysisAI' (two words, "Analysis" and "AI" glued together with no space), which
  // this component's whitespace split turned into only two animated word-tokens instead of
  // three, and the second one visually read as "AnalysisAI". Asserting the split here catches
  // any future edit to the copy string that reintroduces a missing space between words.
  it("splits the sign-in wordmark into three independent words, not two", async () => {
    await render(<KineticText testID="kt">{Copy.auth.wordmark}</KineticText>);

    expect(screen.getByTestId('kt-word-0', { includeHiddenElements: true }).props.children).toBe(
      'Pace '
    );
    expect(screen.getByTestId('kt-word-1', { includeHiddenElements: true }).props.children).toBe(
      'Analysis '
    );
    expect(screen.getByTestId('kt-word-2', { includeHiddenElements: true }).props.children).toBe(
      'AI'
    );
    expect(screen.queryByTestId('kt-word-3', { includeHiddenElements: true })).toBeNull();
  });
});
