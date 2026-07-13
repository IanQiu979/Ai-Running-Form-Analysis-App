/**
 * Compliance locks for <ConsentGate /> (issues #68 and #68's follow-on, #94).
 *
 * The gate now has two phases (see the component's own docblock for the full reasoning):
 *   - 'health' — #68's self-consent checkbox + #94's age-confirmation checkbox, both once-ever.
 *   - 'subject' — #94's "who is actually in this photo or video" question, asked EVERY time,
 *     with a fresh third-party attestation required whenever the answer is "someone else."
 *
 * Three assertions in this file matter more than the rest:
 *   1. The phase-'health' primary CTA is disabled until BOTH checkboxes are ticked (not just
 *      one) — otherwise the age confirmation #94 added would be decorative.
 *   2. Phase 'subject' is never skipped, even for a user who granted phase 'health' long ago —
 *      a once-ever grant proves nothing about who is in TODAY's clip.
 *   3. A "someone else" answer and a "this is me" answer record DIFFERENT consent keys
 *      (`THIRD_PARTY_ATTESTATION_CONSENT` vs. nothing new at all) — the record must distinguish
 *      self-consent from third-party attestation, and the only thing that can prove it does is a
 *      test that inspects which key `grantConsent` was actually called with.
 *
 * `@testing-library/react-native@14`'s `render`/`fireEvent.*` return Promises that must be
 * awaited through `act()` — every render/press below is awaited for that reason (see the
 * original file this was extended from for the fuller explanation).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { ConsentGate } from '../consent-gate';
import { Copy } from '@/constants/copy';
import {
  AGE_CONFIRMATION_CONSENT,
  grantConsent,
  hasConsented,
  THIRD_PARTY_ATTESTATION_CONSENT,
  UPLOAD_HEALTH_CONSENT,
} from '@/lib/consent';

jest.mock('@/lib/consent', () => ({
  UPLOAD_HEALTH_CONSENT: 'upload.health.v1',
  AGE_CONFIRMATION_CONSENT: 'upload.ageConfirmation.v1',
  THIRD_PARTY_ATTESTATION_CONSENT: 'upload.thirdPartyAttestation.v1',
  grantConsent: jest.fn(),
  hasConsented: jest.fn(),
}));

const mockGrantConsent = grantConsent as jest.MockedFunction<typeof grantConsent>;
const mockHasConsented = hasConsented as jest.MockedFunction<typeof hasConsented>;
// Issue #11: `accessibilityLiveRegion="polite"` on this component's error Text is Android-only —
// `lib/use-announce.ts` is the iOS complement. Asserted below alongside the existing
// error-rendering tests, not as a separate describe block, so each stays next to the scenario
// that produces the error it announces.
const mockAnnounce = AccessibilityInfo.announceForAccessibility as jest.Mock;

// Walks up from a host element to the nearest ancestor Pressable's own `onPress` prop, reading
// it off the underlying fiber (test-renderer's `unstable_fiber`, the same field fireEvent.press
// itself resorts to internally). Used only by the race tests below, and only for the press that
// must NOT go through fireEvent.press's own act()-wrapping — see those tests for why.
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
  // Default: neither once-ever consent has been granted yet — the common "first ever upload"
  // case — so the gate starts at phase 'health'. Tests that want the returning-user case
  // (phase 'subject' straight away) override this per-test.
  mockHasConsented.mockResolvedValue(false);
});

/** Renders the gate and waits for its initial hasConsented() check to resolve into phase
 *  'health' — the default starting phase for a user who has never granted either once-ever
 *  consent. */
async function renderAtHealthPhase() {
  const onConsented = jest.fn();
  const onCancel = jest.fn();
  await render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);
  await waitFor(() => expect(screen.getByTestId('consent-checkbox')).toBeTruthy());
  return { onConsented, onCancel };
}

/** Renders the gate with both once-ever consents already granted, and waits for it to skip
 *  straight to phase 'subject' — the returning-user case #94 added. */
async function renderAtSubjectPhase() {
  mockHasConsented.mockResolvedValue(true);
  const onConsented = jest.fn();
  const onCancel = jest.fn();
  await render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);
  await waitFor(() => expect(screen.getByTestId('consent-subject-option-me')).toBeTruthy());
  return { onConsented, onCancel };
}

/** Walks a first-time user through phase 'health' so a test can start from phase 'subject'
 *  without pre-granting anything — proves the transition itself works, unlike
 *  `renderAtSubjectPhase`, which skips phase 'health' by mocking it as already granted. */
async function advanceToSubjectPhase() {
  const result = await renderAtHealthPhase();
  await fireEvent.press(screen.getByTestId('consent-checkbox'));
  await fireEvent.press(screen.getByTestId('consent-age-checkbox'));
  await fireEvent.press(screen.getByTestId('consent-cta-primary'));
  await waitFor(() => expect(screen.getByTestId('consent-subject-option-me')).toBeTruthy());
  return result;
}

describe('starting phase', () => {
  it('shows a loading indicator while determining the starting phase', async () => {
    // Two calls go out (health + age — see the next test), each its own Promise instance, so
    // every resolver must be captured and resolved — a single shared `resolve` variable would
    // get overwritten by the second call and leave the first permanently pending.
    const resolvers: ((value: boolean) => void)[] = [];
    mockHasConsented.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolvers.push(resolve);
        })
    );

    await render(<ConsentGate onConsented={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('consent-loading')).toBeTruthy();

    resolvers.forEach((resolve) => resolve(false));
    await waitFor(() => expect(screen.getByTestId('consent-checkbox')).toBeTruthy());
  });

  it('checks both the health and age once-ever consents before deciding whether to skip phase health', async () => {
    await renderAtHealthPhase();

    expect(mockHasConsented).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockHasConsented).toHaveBeenCalledWith(AGE_CONFIRMATION_CONSENT);
  });

  it('does not skip phase health if only one of the two once-ever consents was previously granted', async () => {
    mockHasConsented.mockImplementation(async (key: string) => key === UPLOAD_HEALTH_CONSENT);

    await render(<ConsentGate onConsented={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('consent-checkbox')).toBeTruthy());
  });

  it('skips straight to phase subject once both once-ever consents are already granted', async () => {
    await renderAtSubjectPhase();

    expect(screen.queryByTestId('consent-checkbox')).toBeNull();
  });

  // Fail closed (lib/consent.ts's own contract): a thrown hasConsented() must not be read as
  // "already granted" — that would skip Art. 9 consent entirely on a network flake.
  it('treats a thrown hasConsented() as not-yet-granted and starts at phase health', async () => {
    mockHasConsented.mockRejectedValue(new Error('network unreachable'));

    await render(<ConsentGate onConsented={jest.fn()} onCancel={jest.fn()} />);

    await waitFor(() => expect(screen.getByTestId('consent-checkbox')).toBeTruthy());
  });
});

describe('phase: health (issue #68 self-consent + issue #94 age confirmation)', () => {
  // THE lock, extended: the button starts unusable, and one checkbox alone is not enough.
  it('disables the primary CTA until BOTH the self-consent and age checkboxes are ticked', async () => {
    await renderAtHealthPhase();

    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('consent-age-checkbox'));
    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(false);
  });

  it('does not record anything when the CTA is pressed before both checkboxes are ticked', async () => {
    await renderAtHealthPhase();

    await fireEvent.press(screen.getByTestId('consent-cta-primary'));
    expect(mockGrantConsent).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('records both the health consent and the age confirmation, and advances to phase subject, once both checkboxes are ticked and the CTA is pressed', async () => {
    const { onConsented } = await renderAtHealthPhase();

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-age-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(AGE_CONFIRMATION_CONSENT);
    await waitFor(() => expect(screen.getByTestId('consent-subject-option-me')).toBeTruthy());
    // Phase 'subject' still needs answering — onConsented must not fire yet.
    expect(onConsented).not.toHaveBeenCalled();
  });

  it('does not advance to phase subject when recording fails, and says so', async () => {
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const { onConsented } = await renderAtHealthPhase();

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-age-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    await waitFor(() => expect(screen.getByText(Copy.consent.upload.error.record)).toBeTruthy());
    expect(screen.getByTestId('consent-checkbox')).toBeTruthy();
    expect(onConsented).not.toHaveBeenCalled();
  });

  it('announces the health-phase recording failure on iOS (issue #11)', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
      await renderAtHealthPhase();

      await fireEvent.press(screen.getByTestId('consent-checkbox'));
      await fireEvent.press(screen.getByTestId('consent-age-checkbox'));
      await fireEvent.press(screen.getByTestId('consent-cta-primary'));

      await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.error.record));
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('cancels without recording anything', async () => {
    const { onCancel } = await renderAtHealthPhase();

    await fireEvent.press(screen.getByTestId('consent-cta-secondary'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('never calls onConsented if Cancel is pressed while the health/age grant write is still pending', async () => {
    // Two grantConsent calls go out together (Promise.all — health + age), each its own Promise
    // instance, so every resolver must be captured — a single shared `resolve` variable would be
    // overwritten by the second call and leave the first (and therefore the whole Promise.all)
    // permanently pending.
    const resolvers: (() => void)[] = [];
    mockGrantConsent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const { onConsented, onCancel } = await renderAtHealthPhase();

    await fireEvent.press(screen.getByTestId('consent-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-age-checkbox'));

    // Deliberately not awaited — see the module docblock's original race test for why.
    const primaryPress = fireEvent.press(screen.getByTestId('consent-cta-primary'));

    getOnPress(screen.getByTestId('consent-cta-secondary'))();
    expect(onCancel).toHaveBeenCalledTimes(1);

    resolvers.forEach((resolve) => resolve());
    await primaryPress;

    expect(onConsented).not.toHaveBeenCalled();
  });

  it('renders the deck consent copy verbatim, including the new age checkbox', async () => {
    await renderAtHealthPhase();

    expect(screen.getByText(Copy.consent.upload.title)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.body)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.checkbox)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.age.checkbox)).toBeTruthy();
  });
});

describe('phase: subject (issue #94 — third-party attestation)', () => {
  it('requires selecting a subject before the primary CTA enables', async () => {
    await renderAtSubjectPhase();

    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('consent-subject-option-me'));
    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(false);
  });

  it('requires the third-party attestation checkbox once "Someone else" is selected, and the CTA stays disabled until it is ticked', async () => {
    await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));
    expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(false);
  });

  it('does not show the attestation checkbox when "This is me" is selected', async () => {
    await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-me'));

    expect(screen.queryByTestId('consent-subject-checkbox')).toBeNull();
  });

  // Case: self path. No NEW consent record — self-processing is already covered by the
  // once-ever UPLOAD_HEALTH_CONSENT grant.
  it('advances immediately with no new consent record when "This is me" is chosen', async () => {
    const { onConsented } = await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-me'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  // THE lock for #94: a "someone else" answer records a DIFFERENT key than self-consent —
  // proving the record actually distinguishes self-consent from third-party attestation, not
  // just that some write happened.
  it('records THIRD_PARTY_ATTESTATION_CONSENT, distinct from the self-consent key, when "Someone else" is chosen', async () => {
    const { onConsented } = await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).toHaveBeenCalledWith(THIRD_PARTY_ATTESTATION_CONSENT);
    expect(mockGrantConsent).not.toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
  });

  it('does not advance when recording the third-party attestation fails, and says so', async () => {
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const { onConsented } = await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    await waitFor(() => expect(screen.getByText(Copy.consent.upload.subject.error.record)).toBeTruthy());
    expect(onConsented).not.toHaveBeenCalled();
  });

  it('announces the subject-phase attestation failure on iOS (issue #11)', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
      await renderAtSubjectPhase();

      await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
      await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));
      await fireEvent.press(screen.getByTestId('consent-cta-primary'));

      await waitFor(() =>
        expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.subject.error.record)
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('cancels without recording anything', async () => {
    const { onCancel } = await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-cta-secondary'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('never calls onConsented if Cancel is pressed while the third-party attestation write is still pending', async () => {
    let resolveGrant: () => void = () => {};
    mockGrantConsent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveGrant = resolve;
        })
    );
    const { onConsented, onCancel } = await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));

    const primaryPress = fireEvent.press(screen.getByTestId('consent-cta-primary'));

    getOnPress(screen.getByTestId('consent-cta-secondary'))();
    expect(onCancel).toHaveBeenCalledTimes(1);

    resolveGrant();
    await primaryPress;

    expect(onConsented).not.toHaveBeenCalled();
  });

  it('disables the Cancel button while the third-party attestation write is still pending', async () => {
    let resolveGrant: () => void = () => {};
    mockGrantConsent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveGrant = resolve;
        })
    );
    await renderAtSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));

    const p = fireEvent.press(screen.getByTestId('consent-cta-primary'));
    await waitFor(() =>
      expect(screen.getByTestId('consent-cta-secondary').props.accessibilityState.disabled).toBe(true)
    );

    resolveGrant();
    await p;
  });

  it('never calls onConsented if the gate is unmounted while the third-party attestation write is still pending', async () => {
    let resolveGrant: () => void = () => {};
    mockGrantConsent.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveGrant = resolve;
        })
    );
    mockHasConsented.mockResolvedValue(true);
    const onConsented = jest.fn();
    const onCancel = jest.fn();
    const view = await render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);
    await waitFor(() => expect(view.getByTestId('consent-subject-option-other')).toBeTruthy());

    await fireEvent.press(view.getByTestId('consent-subject-option-other'));
    await fireEvent.press(view.getByTestId('consent-subject-checkbox'));

    const primaryPress = fireEvent.press(view.getByTestId('consent-cta-primary'));
    await waitFor(() =>
      expect(view.getByTestId('consent-cta-secondary').props.accessibilityState.disabled).toBe(true)
    );

    await view.unmount();

    resolveGrant();
    await primaryPress;

    expect(onConsented).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('renders the subject-phase copy verbatim, including the third-party attestation wording', async () => {
    await renderAtSubjectPhase();

    expect(screen.getByText(Copy.consent.upload.subject.title)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.subject.body)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.subject.option.me)).toBeTruthy();
    expect(screen.getByText(Copy.consent.upload.subject.option.other)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    expect(screen.getByText(Copy.consent.upload.subject.thirdParty.checkbox)).toBeTruthy();
  });
});

describe('end-to-end: a first-time user who is filming someone else', () => {
  it('walks through phase health then phase subject, recording all three distinct consents', async () => {
    const { onConsented } = await advanceToSubjectPhase();

    await fireEvent.press(screen.getByTestId('consent-subject-option-other'));
    await fireEvent.press(screen.getByTestId('consent-subject-checkbox'));
    await fireEvent.press(screen.getByTestId('consent-cta-primary'));

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(AGE_CONFIRMATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(THIRD_PARTY_ATTESTATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledTimes(3);
  });
});
