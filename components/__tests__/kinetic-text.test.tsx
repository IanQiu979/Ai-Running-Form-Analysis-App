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

import { KineticText } from '../kinetic-text';

// See the wordmark regression lock below for where this line comes from.
const THREE_WORDS = 'Pace Analysis AI';

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

  // Regression lock for the old sign-in wordmark bug: the (since removed, 2026-09-13)
  // `Copy.auth.wordmark` string once read 'Pace AnalysisAI' (two words, "Analysis" and "AI"
  // glued together with no space), which this component's whitespace split turned into only two
  // animated word-tokens instead of three, and the second one visually read as "AnalysisAI". The
  // literal below is that string spelled correctly; the split it locks is the component's.
  it('splits a three-word line into three independent words, not two', async () => {
    await render(<KineticText testID="kt">{THREE_WORDS}</KineticText>);

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

  // Regression lock for the sign-in wordmark mid-word wrap: a real device showed "Analysis"
  // (a single flex item with no space to break on) render as "Analysi" on one line and a lone
  // "s" on the next, because Yoga can constrain a word's flex item to less than its natural
  // width and native Text then wraps by character rather than moving the whole word down. Every
  // word must carry the same shrink-to-fit guard `pace-readout.tsx`'s overall-score numeral
  // uses, so a too-wide word shrinks instead of breaking or clipping.
  it('guards every word against mid-word wrapping by shrinking to fit its line, never breaking it', async () => {
    await render(<KineticText testID="kt">{THREE_WORDS}</KineticText>);

    const word = screen.getByTestId('kt-word-1', { includeHiddenElements: true });
    expect(word.props.numberOfLines).toBe(1);
    expect(word.props.adjustsFontSizeToFit).toBe(true);
    expect(word.props.minimumFontScale).toBeGreaterThan(0);
    expect(word.props.minimumFontScale).toBeLessThan(1);
  });
});
