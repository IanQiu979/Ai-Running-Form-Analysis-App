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
import type { TestInstance } from 'test-renderer';

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

// Walks up from a host element to the nearest ancestor Pressable's own `onPress` prop, reading
// it off the underlying fiber (test-renderer's `unstable_fiber`, the same field fireEvent.press
// itself resorts to internally). Used only by the race test below, and only for the press that
// must NOT go through fireEvent.press's own act()-wrapping — see that test for why.
function getOnPress(instance: TestInstance): () => void {
  let fiber = instance.unstable_fiber;
  while (fiber) {
    if (typeof fiber.memoizedProps?.onPress === 'function') {
      return fiber.memoizedProps.onPress;
    }
    fiber = fiber.return;
  }
  throw new Error(`no onPress handler found above ${String(instance.type)}`);
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

// Finding 1: a cancel-mid-write race must not fire both callbacks. Per this component's own
// contract, onCancel() unmounts/replaces the gate — but the in-flight grantConsent() write
// keeps running underneath and, unguarded, its resolution would call onConsented() from a
// stale closure, advancing a user into upload right after they cancelled.
it('never calls onConsented if Cancel is pressed while the grant write is still pending', async () => {
  // A controlled promise standing in for the network round-trip: it does not resolve until this
  // test calls `resolveGrant()`, which is what lets us press Cancel WHILE the write is in flight.
  let resolveGrant: () => void = () => {};
  mockGrantConsent.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveGrant = resolve;
      })
  );
  const { onConsented, onCancel } = await renderGate();

  await fireEvent.press(screen.getByTestId('consent-checkbox'));

  // Deliberately not awaited: `fireEvent.press` wraps the press in `act()`, and because
  // `handleConsent` is async and doesn't settle until grantConsent's still-pending promise
  // resolves, awaiting this here would hang the test on the very thing we're trying to
  // interrupt with Cancel.
  const primaryPress = fireEvent.press(screen.getByTestId('consent-cta-primary'));

  // Press Cancel while that write is still in flight — but via the raw handler, not another
  // `fireEvent.press`. A second `fireEvent.press` would open its own `act()` scope before the
  // first (still-pending) one closes, which React disallows ("overlapping act() calls") and
  // which corrupts every test that runs after this one. Calling the handler directly is safe
  // here because it performs no React state update (see the component: it only flips a ref and
  // calls the `onCancel` prop) — there's nothing for `act()` to flush.
  getOnPress(screen.getByTestId('consent-cta-secondary'))();
  expect(onCancel).toHaveBeenCalledTimes(1);

  // The write resolves only now — after the user already cancelled.
  resolveGrant();
  await primaryPress;

  expect(onConsented).not.toHaveBeenCalled();
});

// Same trigger as the race test above, but pins a different property: the Cancel button must
// actually be disabled while the write is in flight, not merely inert-by-luck because the race
// test never presses it through fireEvent. `getOnPress` (used above) reads the raw handler off
// the fiber and bypasses Pressable's own `disabled` gate entirely, so that test cannot catch a
// regression here — this one presses nothing, it only asserts the prop, so there is no second
// fireEvent.press and no act()-overlap to work around.
it('disables the Cancel button while the grant write is still pending', async () => {
  let resolveGrant: () => void = () => {};
  mockGrantConsent.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveGrant = resolve;
      })
  );
  await renderGate();

  await fireEvent.press(screen.getByTestId('consent-checkbox'));

  const p = fireEvent.press(screen.getByTestId('consent-cta-primary'));
  await waitFor(() =>
    expect(screen.getByTestId('consent-cta-secondary').props.accessibilityState.disabled).toBe(
      true
    )
  );

  resolveGrant();
  await p;
});

// Finding 1 (re-review): the button isn't the only way this gate goes away mid-write. A
// modal-host backdrop tap, hardware back, swipe-to-dismiss, or navigating away all unmount this
// component without ever running handleCancel — so the guard has to be keyed to the component's
// lifecycle, not to that one button.
it('never calls onConsented if the gate is unmounted while the grant write is still pending', async () => {
  let resolveGrant: () => void = () => {};
  mockGrantConsent.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resolveGrant = resolve;
      })
  );
  const onConsented = jest.fn();
  const onCancel = jest.fn();
  const view = await render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);

  await fireEvent.press(view.getByTestId('consent-checkbox'));

  const primaryPress = fireEvent.press(view.getByTestId('consent-cta-primary'));
  await waitFor(() =>
    expect(view.getByTestId('consent-cta-secondary').props.accessibilityState.disabled).toBe(true)
  );

  await view.unmount();

  // The write resolves only now — after the host already tore the gate down.
  resolveGrant();
  await primaryPress;

  expect(onConsented).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});

// The checkbox label names the health processing and Anthropic by name. That naming is what
// carries Art. 9 — a generic "I agree to the terms" would not.
it('renders the deck consent copy verbatim', async () => {
  await renderGate();

  expect(screen.getByText(Copy.consent.upload.title)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.body)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.checkbox)).toBeTruthy();
});
