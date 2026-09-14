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
 * awaited through `act()` — every render below is awaited for that reason, and every ordinary
 * press goes through `press()`, which wraps `fireEvent.press` in an awaited `act`: two bare
 * presses in one test leave an act scope open under this Jest setup and the NEXT test's render
 * produces an empty tree. The race tests deliberately hold a press un-awaited and say so.
 *
 * The V23-10 locks at the end are structural — which tone a box takes, that the disabled primary
 * is the page's solid fill rather than a dimmed one — never a pixel value.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { ConsentGate } from '../consent-gate';
import { Copy } from '@/constants/copy';
import { Ink, Layout } from '@/constants/v23-theme';
import {
  AGE_CONFIRMATION_CONSENT,
  grantConsent,
  hasConsented,
  THIRD_PARTY_ATTESTATION_CONSENT,
  UPLOAD_HEALTH_CONSENT,
} from '@/lib/consent';

// The gate reads its own safe-area insets now (V23-10 draws it as the whole phone); the
// library's Jest mock supplies zeros, which the `Layout.canvas` minimums then override.
jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

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

/** One awaited, act-wrapped press by testID — see the module docblock. */
async function press(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** Whether the primary CTA reports itself disabled to the a11y tree. */
function primaryDisabled(): boolean {
  return screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled;
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
  await press('consent-checkbox');
  await press('consent-age-checkbox');
  await press('consent-cta-primary');
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

    expect(primaryDisabled()).toBe(true);

    await press('consent-checkbox');
    expect(primaryDisabled()).toBe(true);

    await press('consent-age-checkbox');
    expect(primaryDisabled()).toBe(false);
  });

  it('does not record anything when the CTA is pressed before both checkboxes are ticked', async () => {
    await renderAtHealthPhase();

    await press('consent-cta-primary');
    expect(mockGrantConsent).not.toHaveBeenCalled();

    await press('consent-checkbox');
    await press('consent-cta-primary');
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  it('records both the health consent and the age confirmation, and advances to phase subject, once both checkboxes are ticked and the CTA is pressed', async () => {
    const { onConsented } = await renderAtHealthPhase();

    await press('consent-checkbox');
    await press('consent-age-checkbox');
    await press('consent-cta-primary');

    expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(AGE_CONFIRMATION_CONSENT);
    await waitFor(() => expect(screen.getByTestId('consent-subject-option-me')).toBeTruthy());
    // Phase 'subject' still needs answering — onConsented must not fire yet.
    expect(onConsented).not.toHaveBeenCalled();
  });

  it('does not advance to phase subject when recording fails, and says so', async () => {
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const { onConsented } = await renderAtHealthPhase();

    await press('consent-checkbox');
    await press('consent-age-checkbox');
    await press('consent-cta-primary');

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

      await press('consent-checkbox');
      await press('consent-age-checkbox');
      await press('consent-cta-primary');

      await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.error.record));
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('cancels without recording anything', async () => {
    const { onCancel } = await renderAtHealthPhase();

    await press('consent-cta-secondary');

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

    await press('consent-checkbox');
    await press('consent-age-checkbox');

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

    expect(primaryDisabled()).toBe(true);

    await press('consent-subject-option-me');
    expect(primaryDisabled()).toBe(false);
  });

  it('requires the third-party attestation checkbox once "Someone else" is selected, and the CTA stays disabled until it is ticked', async () => {
    await renderAtSubjectPhase();

    await press('consent-subject-option-other');
    expect(primaryDisabled()).toBe(true);

    await press('consent-subject-checkbox');
    expect(primaryDisabled()).toBe(false);
  });

  it('does not show the attestation checkbox when "This is me" is selected', async () => {
    await renderAtSubjectPhase();

    await press('consent-subject-option-me');

    expect(screen.queryByTestId('consent-subject-checkbox')).toBeNull();
  });

  // Case: self path. No NEW consent record — self-processing is already covered by the
  // once-ever UPLOAD_HEALTH_CONSENT grant.
  it('advances immediately with no new consent record when "This is me" is chosen', async () => {
    const { onConsented } = await renderAtSubjectPhase();

    await press('consent-subject-option-me');
    await press('consent-cta-primary');

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).not.toHaveBeenCalled();
  });

  // THE lock for #94: a "someone else" answer records a DIFFERENT key than self-consent —
  // proving the record actually distinguishes self-consent from third-party attestation, not
  // just that some write happened.
  it('records THIRD_PARTY_ATTESTATION_CONSENT, distinct from the self-consent key, when "Someone else" is chosen', async () => {
    const { onConsented } = await renderAtSubjectPhase();

    await press('consent-subject-option-other');
    await press('consent-subject-checkbox');
    await press('consent-cta-primary');

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).toHaveBeenCalledWith(THIRD_PARTY_ATTESTATION_CONSENT);
    expect(mockGrantConsent).not.toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
  });

  it('does not advance when recording the third-party attestation fails, and says so', async () => {
    mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
    const { onConsented } = await renderAtSubjectPhase();

    await press('consent-subject-option-other');
    await press('consent-subject-checkbox');
    await press('consent-cta-primary');

    await waitFor(() => expect(screen.getByText(Copy.consent.upload.subject.error.record)).toBeTruthy());
    expect(onConsented).not.toHaveBeenCalled();
  });

  it('announces the subject-phase attestation failure on iOS (issue #11)', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
      await renderAtSubjectPhase();

      await press('consent-subject-option-other');
      await press('consent-subject-checkbox');
      await press('consent-cta-primary');

      await waitFor(() =>
        expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.subject.error.record)
      );
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('cancels without recording anything', async () => {
    const { onCancel } = await renderAtSubjectPhase();

    await press('consent-cta-secondary');

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

    await press('consent-subject-option-other');
    await press('consent-subject-checkbox');

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

    await press('consent-subject-option-other');
    await press('consent-subject-checkbox');

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

    await act(async () => {
      fireEvent.press(view.getByTestId('consent-subject-option-other'));
    });
    await act(async () => {
      fireEvent.press(view.getByTestId('consent-subject-checkbox'));
    });

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

    await press('consent-subject-option-other');
    expect(screen.getByText(Copy.consent.upload.subject.thirdParty.checkbox)).toBeTruthy();
  });
});

// Issue #62 audit finding #3: `useAnnounce` only ever covered the `error` state — the
// 'checking' -> 'health'/'subject' and 'health' -> 'subject' phase transitions silently swapped
// the whole screen's title/content with no VoiceOver announcement at all. Fixed by folding the
// active phase's title into the same `useAnnounce` call.
describe('phase-transition announcements on iOS (issue #62)', () => {
  it('announces the phase-health title once the gate settles into phase health', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      await renderAtHealthPhase();

      await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.title));
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('announces the phase-subject title when advancing from phase health to phase subject', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'ios';
    try {
      await advanceToSubjectPhase();

      await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.subject.title));
      // The health-phase announcement must still have fired first — the transition is announced,
      // not just the final destination.
      expect(mockAnnounce).toHaveBeenCalledWith(Copy.consent.upload.title);
    } finally {
      Platform.OS = originalOS;
    }
  });

  it('does not announce a phase title on Android — accessibilityLiveRegion covers it there (issue #11)', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    try {
      await renderAtHealthPhase();

      expect(mockAnnounce).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
  });
});

describe('end-to-end: a first-time user who is filming someone else', () => {
  it('walks through phase health then phase subject, recording all three distinct consents', async () => {
    const { onConsented } = await advanceToSubjectPhase();

    await press('consent-subject-option-other');
    await press('consent-subject-checkbox');
    await press('consent-cta-primary');

    await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
    expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(AGE_CONFIRMATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledWith(THIRD_PARTY_ATTESTATION_CONSENT);
    expect(mockGrantConsent).toHaveBeenCalledTimes(3);
  });
});

// V23-10 (second artboard): the gate's drawn state. Structural claims about which tone each
// node takes; the visual match is the screenshot pass.
describe('V23-10 structure', () => {
  function boxOf(testID: string): TestInstance {
    // The Pressable's first child is the drawn 20 pt square; the sentence is the second.
    return screen.getByTestId(testID).children[0] as TestInstance;
  }

  it('draws an unticked box ruled in `line` on `bgRaised`, and a ticked one filled `ink` with the check glyph', async () => {
    await renderAtHealthPhase();

    const before = StyleSheet.flatten(boxOf('consent-checkbox').props.style);
    expect(before.width).toBe(Layout.consentCheckbox);
    expect(before.borderColor).toBe(Ink.line);
    expect(before.backgroundColor).toBe(Ink.bgRaised);
    expect(screen.queryByTestId('consent-check-glyph', { includeHiddenElements: true })).toBeNull();

    await press('consent-checkbox');

    const after = StyleSheet.flatten(boxOf('consent-checkbox').props.style);
    expect(after.borderColor).toBe(Ink.ink);
    expect(after.backgroundColor).toBe(Ink.ink);
    expect(screen.getByTestId('consent-check-glyph', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders the disabled primary as the page\'s solid `ink3` block, and the enabled one as the `accent` fill', async () => {
    await renderAtHealthPhase();

    expect(StyleSheet.flatten(screen.getByTestId('consent-cta-primary').props.style).backgroundColor).toBe(Ink.ink3);

    await press('consent-checkbox');
    await press('consent-age-checkbox');

    expect(StyleSheet.flatten(screen.getByTestId('consent-cta-primary').props.style).backgroundColor).toBe(Ink.accent);
  });

  it('shows the privacy link and a 44 pt Cancel link under the primary', async () => {
    await renderAtHealthPhase();

    expect(screen.getByText(Copy.consent.upload.link.privacy)).toBeTruthy();
    const cancel = StyleSheet.flatten(screen.getByTestId('consent-cta-secondary').props.style);
    expect(cancel.minHeight).toBe(Layout.hitTarget);
    expect(cancel.backgroundColor).toBeUndefined();
  });

  it('draws the subject options as radio-role squares that hold an `ink` mark once selected', async () => {
    await renderAtSubjectPhase();

    const me = screen.getByTestId('consent-subject-option-me');
    expect(me.props.accessibilityRole).toBe('radio');
    expect(boxOf('consent-subject-option-me').children).toHaveLength(0);

    await press('consent-subject-option-me');

    expect(StyleSheet.flatten(boxOf('consent-subject-option-me').props.style).borderColor).toBe(Ink.ink);
    expect(boxOf('consent-subject-option-me').children).toHaveLength(1);
    expect(me.props.accessibilityState).toEqual({ checked: true });
  });
});
