/**
 * Compliance locks for <ConsentGate /> (issue #68).
 *
 * One assertion in this file matters more than the rest: the primary CTA is DISABLED until the
 * checkbox is ticked (case 1), and grantConsent is not called before then (case 2). That gate is
 * what makes the consent affirmative and unbundled — i.e. Art. 9 explicit consent rather than a
 * "by continuing" notice, which is what the copy deck was upgraded away from in PR #72. If a
 * refactor ever enables that button by default, the consent silently stops being valid and
 * nothing else in the suite notices.
 *
 * `@testing-library/react-native@14` (installed in Task 4) made `render` and `fireEvent.*`
 * return Promises — the new `test-renderer` backing it (react-test-renderer's React-19-era
 * replacement) requires every interaction to flush through an awaited `act()`. Every render/press
 * below is awaited for that reason; skipping the await leaves `screen` pointed at its unattached
 * default (every query throws "`render` function has not been called") because `setRenderResult`
 * only runs once the promise resolves.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ConsentGate } from '../consent-gate';
import { Copy } from '@/constants/copy';
import { grantConsent, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';

jest.mock('@/lib/consent', () => ({
  UPLOAD_HEALTH_CONSENT: 'upload.health.v1',
  grantConsent: jest.fn(),
}));

const mockGrantConsent = grantConsent as jest.MockedFunction<typeof grantConsent>;

async function renderGate() {
  const onConsented = jest.fn();
  const onCancel = jest.fn();
  await render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);
  return { onConsented, onCancel };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrantConsent.mockResolvedValue(undefined);
});

// Case 1: THE lock. The consent is only explicit because this button starts unusable.
it('disables the primary CTA until the checkbox is ticked', async () => {
  await renderGate();

  // Re-query after the press rather than holding the element reference across the re-render —
  // a held reference can be stale and would silently assert against the pre-toggle tree.
  expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

  await fireEvent.press(screen.getByTestId('consent-checkbox'));

  expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(false);
});

// Case 2: and the disabled button must be inert, not merely styled as disabled.
it('does not record consent when the CTA is pressed before the checkbox is ticked', async () => {
  await renderGate();

  await fireEvent.press(screen.getByTestId('consent-cta-primary'));

  expect(mockGrantConsent).not.toHaveBeenCalled();
});

it('records the consent and advances once the checkbox is ticked and the CTA pressed', async () => {
  const { onConsented } = await renderGate();

  await fireEvent.press(screen.getByTestId('consent-checkbox'));
  await fireEvent.press(screen.getByTestId('consent-cta-primary'));

  await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
  expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
});

// Case 4: fail closed. If the record did not persist, the user has NOT consented as far as we
// can prove — so they must not be advanced into the upload flow.
it('does not advance when recording the consent fails, and says so', async () => {
  mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
  const { onConsented } = await renderGate();

  await fireEvent.press(screen.getByTestId('consent-checkbox'));
  await fireEvent.press(screen.getByTestId('consent-cta-primary'));

  await waitFor(() => expect(screen.getByText(Copy.consent.upload.error.record)).toBeTruthy());
  expect(onConsented).not.toHaveBeenCalled();
});

it('cancels without recording anything', async () => {
  const { onCancel } = await renderGate();

  await fireEvent.press(screen.getByTestId('consent-cta-secondary'));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(mockGrantConsent).not.toHaveBeenCalled();
});

// The checkbox label names the health processing and Anthropic by name. That naming is what
// carries Art. 9 — a generic "I agree to the terms" would not.
it('renders the deck consent copy verbatim', async () => {
  await renderGate();

  expect(screen.getByText(Copy.consent.upload.title)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.body)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.checkbox)).toBeTruthy();
});
