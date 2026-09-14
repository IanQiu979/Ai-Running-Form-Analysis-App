/**
 * The consent gate shown before a user's first upload and, in its second phase, before EVERY
 * upload (issues #68 and #94 — one workstream, see both issues' bodies).
 *
 * Three distinct things are gated here, and they do NOT share a lifecycle:
 *
 *   1. Health-processing consent (#68, Art. 9) — "I consent to my images being analysed…".
 *      Granted ONCE, ever: the fact that this user has agreed their own images may be processed
 *      does not change upload to upload, so `hasConsented(UPLOAD_HEALTH_CONSENT)` gates it.
 *   2. Age confirmation (#94) — "I confirm I'm 16 or older." `docs/privacy-policy.md` already
 *      states a 16+ minimum; nothing enforced it. Also granted ONCE, ever, for the same reason
 *      as (1) — age only moves in one direction.
 *   3. Subject attestation (#94) — "who is actually in this photo or video." THIS CANNOT be a
 *      once-ever grant, because the answer is a property of the specific upload, not of the
 *      account: the same person who filmed themselves yesterday may film a coached athlete
 *      today. So phase 'subject' below runs on every single gate presentation, with no
 *      `hasConsented` short-circuit — skipping it for a "trusted" returning user would mean
 *      assuming today's subject is the same as last time's, which is exactly the assumption this
 *      issue exists to remove. Answering "It's me" costs one tap; answering "Someone else"
 *      requires a fresh attestation checkbox, because a different third party is a different
 *      person who still never consented through this app.
 *
 * Phase 1+2 are combined on one screen (two independent checkboxes, each its own affirmative
 * statement, each recorded as its own consent-key row — this is NOT the "by continuing" bundling
 * #68 replaced; two separate ticks are still two separate, independently provable consents).
 * Phase 3 is a second, always-shown screen. The primary CTA is disabled until each screen's
 * required affirmations are given — same rule as #68, extended to cover the new ones.
 *
 * This is a component, not a route. The host (`app/capture/index.tsx`) decides where it
 * intercepts the source-picker → capture/upload handoff, and now always mounts it (previously it
 * could skip straight past for a returning, already-consented user — that shortcut is gone,
 * because phase 'subject' has no such thing as "already answered").
 *
 * VISUALLY (V23-10, second artboard) the gate IS the screen, not a card on one: it pads itself
 * to the page's `59 / 24 / 34` safe frame (live insets, those as minimums), centres its column
 * vertically and stacks title, body, the checkbox group, the privacy link and the button column
 * at the page's 24 pt gap. The boxes are 20 pt drawn squares (`Layout.consentCheckbox`) — `ink`
 * filled with a `CheckIcon` when ticked, `line`-ruled on `bgRaised` when not — and the disabled
 * primary is the page's solid `ink3` block (`SquareButton disabledTone="fill"`), not a dimmed
 * white one. The subject phase is not drawn on the page; it uses the same idiom, with the two
 * radio rows as the same 20 pt squares holding a 10 pt `ink` square when selected.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SquareButton } from '@/components/ui/square-button';
import { CheckIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import {
  AGE_CONFIRMATION_CONSENT,
  grantConsent,
  hasConsented,
  THIRD_PARTY_ATTESTATION_CONSENT,
  UPLOAD_HEALTH_CONSENT,
} from '@/lib/consent';
import { useAnnounce } from '@/lib/use-announce';

type Props = {
  /**
   * Every required affirmation for THIS upload attempt has been given and recorded. The caller
   * MUST unmount or replace this gate when this fires — see the module docblock above and the
   * "pending is never reset after success" comments below for why a host that leaves the gate
   * mounted instead finds it permanently inert rather than double-granting.
   */
  onConsented: () => void;
  /** Dismissed without consenting/attesting. Nothing was recorded and nothing may be uploaded. */
  onCancel: () => void;
};

type Phase = 'checking' | 'health' | 'subject';
type Subject = 'unset' | 'me' | 'other';

/** The selected radio's inner mark: half the box, as the page's checked box holds a 10 pt tick. */
const RADIO_MARK_SIZE = Layout.consentCheckbox / 2;
/** The page sets each box 2 pt down so it sits on the first line's x-height, not its cap. */
const BOX_TOP_OFFSET = 2;

export function ConsentGate({ onConsented, onCancel }: Props) {
  const insets = useSafeAreaInsets();
  const frame = {
    paddingTop: Math.max(insets.top, Layout.canvas.safeTop),
    paddingBottom: Math.max(insets.bottom, Layout.canvas.safeBottom),
  };

  const [phase, setPhase] = useState<Phase>('checking');

  // Phase 'health' (#68 self-consent + #94 age confirmation, both once-ever).
  const [healthChecked, setHealthChecked] = useState(false);
  const [ageChecked, setAgeChecked] = useState(false);

  // Phase 'subject' (#94, every presentation).
  const [subject, setSubject] = useState<Subject>('unset');
  const [thirdPartyChecked, setThirdPartyChecked] = useState(false);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Issue #11: `accessibilityLiveRegion="polite"` on the error Texts below (both phases share
  // this one piece of state) is Android-only — this is the iOS complement, same pattern as
  // app/(auth)/sign-in.tsx. Issue #62: folded in alongside the phase transitions below (mirroring
  // app/capture/extracting.tsx's single `useAnnounce` covering every state) — without this, the
  // 'checking' -> 'health'/'subject' and 'health' -> 'subject' phase swaps silently replaced the
  // whole screen's title/content with no announcement at all. `error` still takes priority when
  // both are truthy at once, same precedence the original code gave it.
  useAnnounce(
    error
      ? error
      : phase === 'health'
        ? Copy.consent.upload.title
        : phase === 'subject'
          ? Copy.consent.upload.subject.title
          : null
  );
  // Flipped the instant Cancel is pressed, including mid-write, AND on unmount — see
  // components/__tests__/consent-gate.test.tsx's race tests. Unmounting (what the host does on
  // cancel/consent, per this component's contract) does not cancel an in-flight promise below —
  // without this, a late resolve/reject would still touch state or call onConsented() from a
  // stale closure after the user already backed out or the gate already advanced past it.
  const cancelledRef = useRef(false);

  useEffect(() => () => { cancelledRef.current = true; }, []);

  // Determines the starting phase. Phase 'health' is skippable for a returning user who has
  // already granted both once-ever consents; phase 'subject' never is (see module docblock).
  useEffect(() => {
    let cancelled = false;
    Promise.all([hasConsented(UPLOAD_HEALTH_CONSENT), hasConsented(AGE_CONFIRMATION_CONSENT)])
      .then(([health, age]) => {
        if (cancelled) return;
        setPhase(health && age ? 'subject' : 'health');
      })
      .catch(() => {
        // Fail closed (lib/consent.ts's own contract): treat "couldn't confirm" the same as
        // "not yet granted" and show phase 'health' again. Safe either way — re-granting an
        // already-granted consent just appends another true row; it never skips a check.
        if (!cancelled) setPhase('health');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canProceedHealth = healthChecked && ageChecked && !pending;
  const canProceedSubject = subject !== 'unset' && (subject === 'me' || thirdPartyChecked) && !pending;

  async function handleHealthSubmit() {
    if (!canProceedHealth) return;

    setPending(true);
    setError(null);

    try {
      await Promise.all([grantConsent(UPLOAD_HEALTH_CONSENT), grantConsent(AGE_CONFIRMATION_CONSENT)]);
      if (cancelledRef.current) return;
      // Unlike the subject-phase success below, this gate STAYS mounted — the next phase still
      // needs answering — so pending must be reset, or phase 'subject' would render permanently
      // disabled.
      setPhase('subject');
      setPending(false);
    } catch {
      if (cancelledRef.current) return;
      setError(Copy.consent.upload.error.record);
      setPending(false);
    }
  }

  async function handleSubjectSubmit() {
    if (!canProceedSubject) return;

    if (subject === 'me') {
      // No new record needed: self-processing is already covered by UPLOAD_HEALTH_CONSENT.
      // `pending` is still set (never reset after) so a double-press can't fire onConsented twice
      // while the host is in the middle of unmounting/replacing this gate.
      setPending(true);
      onConsented();
      return;
    }

    setPending(true);
    setError(null);

    try {
      await grantConsent(THIRD_PARTY_ATTESTATION_CONSENT);
      if (cancelledRef.current) return;
      onConsented();
      // pending intentionally never reset after this success — see the Props doc and #68's
      // original comment this pattern is inherited from.
    } catch {
      if (cancelledRef.current) return;
      // Fail closed: nothing was recorded, nothing was uploaded, and we say so plainly.
      setError(Copy.consent.upload.subject.error.record);
      setPending(false);
    }
  }

  function handleCancel() {
    cancelledRef.current = true;
    onCancel();
  }

  if (phase === 'checking') {
    return (
      <View style={[styles.frame, styles.checking, frame]}>
        <ActivityIndicator
          testID="consent-loading"
          color={Ink.ink2}
          accessibilityLabel="Checking your consent status"
        />
      </View>
    );
  }

  if (phase === 'health') {
    return (
      // ScrollView + flexGrow, not a plain View: the page centres the column, but at the largest
      // Dynamic Type sizes the two checkbox sentences alone can outgrow a small phone, and the
      // buttons must stay reachable (design brief §7: reflow, never clip).
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.frame, frame]}>
        <Text style={styles.title}>{Copy.consent.upload.title}</Text>
        <Text style={styles.body}>{Copy.consent.upload.body}</Text>

        <View style={styles.group}>
          <CheckboxRow
            testID="consent-checkbox"
            checked={healthChecked}
            label={Copy.consent.upload.checkbox}
            onPress={() => setHealthChecked((value) => !value)}
          />
          <CheckboxRow
            testID="consent-age-checkbox"
            checked={ageChecked}
            label={Copy.consent.upload.age.checkbox}
            onPress={() => setAgeChecked((value) => !value)}
          />
        </View>

        <Text style={styles.privacyLink}>{Copy.consent.upload.link.privacy}</Text>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <View style={styles.buttons}>
          <SquareButton
            testID="consent-cta-primary"
            label={Copy.consent.upload.cta.primary}
            onPress={handleHealthSubmit}
            disabled={!canProceedHealth}
            disabledTone="fill"
            busy={pending}
          />
          <SquareButton
            testID="consent-cta-secondary"
            variant="link"
            label={Copy.consent.upload.cta.secondary}
            onPress={handleCancel}
            disabled={pending}
            style={styles.cancel}
          />
        </View>
      </ScrollView>
    );
  }

  // phase === 'subject'
  const primaryLabel = Copy.consent.upload.subject.cta.primary(subject === 'other' ? 'other' : 'me');

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={[styles.frame, frame]}>
      <Text style={styles.title}>{Copy.consent.upload.subject.title}</Text>
      <Text style={styles.body}>{Copy.consent.upload.subject.body}</Text>

      <View style={styles.group}>
        <RadioRow
          testID="consent-subject-option-me"
          selected={subject === 'me'}
          label={Copy.consent.upload.subject.option.me}
          onPress={() => setSubject('me')}
        />
        <RadioRow
          testID="consent-subject-option-other"
          selected={subject === 'other'}
          label={Copy.consent.upload.subject.option.other}
          onPress={() => setSubject('other')}
        />
        {subject === 'other' ? (
          <CheckboxRow
            testID="consent-subject-checkbox"
            checked={thirdPartyChecked}
            label={Copy.consent.upload.subject.thirdParty.checkbox}
            onPress={() => setThirdPartyChecked((value) => !value)}
          />
        ) : null}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <View style={styles.buttons}>
        <SquareButton
          testID="consent-cta-primary"
          label={primaryLabel}
          onPress={handleSubjectSubmit}
          disabled={!canProceedSubject}
          disabledTone="fill"
          busy={pending}
        />
        <SquareButton
          testID="consent-cta-secondary"
          variant="link"
          label={Copy.consent.upload.subject.cta.secondary}
          onPress={handleCancel}
          disabled={pending}
          style={styles.cancel}
        />
      </View>
    </ScrollView>
  );
}

/** One consent line: the page's 20 pt square and its sentence, the whole row the control. */
function CheckboxRow({
  testID,
  checked,
  label,
  onPress,
}: {
  testID: string;
  checked: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      style={styles.row}
      hitSlop={Space.sm}>
      <View style={[styles.box, checked ? styles.boxChecked : styles.boxUnchecked]}>
        {checked ? <CheckIcon testID="consent-check-glyph" /> : null}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

/** The subject phase's "who is this" option (#94): the same square as a checkbox, holding a
 *  smaller `ink` square when selected — one drawn idiom for both, since the page draws only
 *  the checkbox and a radio here is functionally the same affordance. */
function RadioRow({
  testID,
  selected,
  label,
  onPress,
}: {
  testID: string;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={styles.row}
      hitSlop={Space.sm}>
      <View style={[styles.box, selected ? styles.radioSelected : styles.boxUnchecked]}>
        {selected ? <View style={styles.radioMark} /> : null}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `flex` ONLY — child-layout props are illegal in a ScrollView's `style` and throw at render
  // (issue #63); the frame below is the contentContainerStyle.
  scroll: {
    flex: 1,
  },
  // The page's `padding:59px 24px 34px; justify-content:center; gap:24px`. Top and bottom are
  // overridden per render with the live insets (`frame` in the component).
  frame: {
    flexGrow: 1,
    paddingHorizontal: Layout.gutter,
    justifyContent: 'center',
    gap: Space.xl,
  },
  checking: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    ...Type.displaySm,
    color: Ink.ink,
  },
  body: {
    ...Type.body,
    color: Ink.ink2,
  },
  group: {
    gap: Space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
  },
  box: {
    width: Layout.consentCheckbox,
    height: Layout.consentCheckbox,
    marginTop: BOX_TOP_OFFSET,
    borderWidth: Layout.hairline,
    borderRadius: Layout.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxUnchecked: {
    borderColor: Ink.line,
    backgroundColor: Ink.bgRaised,
  },
  boxChecked: {
    borderColor: Ink.ink,
    backgroundColor: Ink.ink,
  },
  radioSelected: {
    borderColor: Ink.ink,
    backgroundColor: Ink.bgRaised,
  },
  radioMark: {
    width: RADIO_MARK_SIZE,
    height: RADIO_MARK_SIZE,
    backgroundColor: Ink.ink,
  },
  rowLabel: {
    ...Type.bodySm,
    color: Ink.ink,
    flex: 1,
  },
  privacyLink: {
    ...Type.note,
    color: Ink.ink2,
    textDecorationLine: 'underline',
  },
  error: {
    ...Type.small,
    color: Ink.danger,
  },
  buttons: {
    gap: Space.md,
    marginTop: Space.lg,
  },
  // The page's Cancel is a 44 pt link, not the 56 pt control the link variant defaults to.
  cancel: {
    minHeight: Layout.hitTarget,
  },
});
