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
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Accent,
  Colors,
  ControlHeight,
  CheckboxSize,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Semantic,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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

export function ConsentGate({ onConsented, onCancel }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors, scheme), [colors, scheme]);

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
  // app/(auth)/sign-in.tsx.
  useAnnounce(error);
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
      <View style={styles.container}>
        <ActivityIndicator
          testID="consent-loading"
          color={colors.text.secondary}
          accessibilityLabel="Checking your consent status"
        />
      </View>
    );
  }

  if (phase === 'health') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>{Copy.consent.upload.title}</Text>
        <Text style={styles.body}>{Copy.consent.upload.body}</Text>

        <Pressable
          testID="consent-checkbox"
          onPress={() => setHealthChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: healthChecked }}
          accessibilityLabel={Copy.consent.upload.checkbox}
          style={styles.checkboxRow}
          hitSlop={Spacing.sm}>
          <View style={[styles.checkbox, healthChecked && styles.checkboxChecked]}>
            {healthChecked ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>{Copy.consent.upload.checkbox}</Text>
        </Pressable>

        <Pressable
          testID="consent-age-checkbox"
          onPress={() => setAgeChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ageChecked }}
          accessibilityLabel={Copy.consent.upload.age.checkbox}
          style={styles.checkboxRow}
          hitSlop={Spacing.sm}>
          <View style={[styles.checkbox, ageChecked && styles.checkboxChecked]}>
            {ageChecked ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>{Copy.consent.upload.age.checkbox}</Text>
        </Pressable>

        <Text style={styles.privacyLink}>{Copy.consent.upload.link.privacy}</Text>

        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}

        <Pressable
          testID="consent-cta-primary"
          onPress={handleHealthSubmit}
          disabled={!canProceedHealth}
          accessibilityRole="button"
          accessibilityState={{ disabled: !canProceedHealth }}
          style={[styles.primaryCta, !canProceedHealth && styles.primaryCtaDisabled]}>
          {pending ? (
            <ActivityIndicator color={Accent.onAccent} />
          ) : (
            <Text style={styles.primaryCtaLabel}>{Copy.consent.upload.cta.primary}</Text>
          )}
        </Pressable>

        <Pressable
          testID="consent-cta-secondary"
          onPress={handleCancel}
          disabled={pending}
          accessibilityRole="button"
          accessibilityState={{ disabled: pending }}
          style={styles.secondaryCta}>
          <Text style={styles.secondaryCtaLabel}>{Copy.consent.upload.cta.secondary}</Text>
        </Pressable>
      </View>
    );
  }

  // phase === 'subject'
  const primaryLabel = Copy.consent.upload.subject.cta.primary(subject === 'other' ? 'other' : 'me');

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{Copy.consent.upload.subject.title}</Text>
      <Text style={styles.body}>{Copy.consent.upload.subject.body}</Text>

      <Pressable
        testID="consent-subject-option-me"
        onPress={() => setSubject('me')}
        accessibilityRole="radio"
        accessibilityState={{ checked: subject === 'me' }}
        accessibilityLabel={Copy.consent.upload.subject.option.me}
        style={[styles.optionRow, subject === 'me' && styles.optionRowSelected]}
        hitSlop={Spacing.sm}>
        <View style={[styles.radio, subject === 'me' && styles.radioSelected]}>
          {subject === 'me' ? <View style={styles.radioDot} /> : null}
        </View>
        <Text style={styles.optionLabel}>{Copy.consent.upload.subject.option.me}</Text>
      </Pressable>

      <Pressable
        testID="consent-subject-option-other"
        onPress={() => setSubject('other')}
        accessibilityRole="radio"
        accessibilityState={{ checked: subject === 'other' }}
        accessibilityLabel={Copy.consent.upload.subject.option.other}
        style={[styles.optionRow, subject === 'other' && styles.optionRowSelected]}
        hitSlop={Spacing.sm}>
        <View style={[styles.radio, subject === 'other' && styles.radioSelected]}>
          {subject === 'other' ? <View style={styles.radioDot} /> : null}
        </View>
        <Text style={styles.optionLabel}>{Copy.consent.upload.subject.option.other}</Text>
      </Pressable>

      {subject === 'other' ? (
        <Pressable
          testID="consent-subject-checkbox"
          onPress={() => setThirdPartyChecked((value) => !value)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: thirdPartyChecked }}
          accessibilityLabel={Copy.consent.upload.subject.thirdParty.checkbox}
          style={styles.checkboxRow}
          hitSlop={Spacing.sm}>
          <View style={[styles.checkbox, thirdPartyChecked && styles.checkboxChecked]}>
            {thirdPartyChecked ? <Text style={styles.checkboxMark}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>{Copy.consent.upload.subject.thirdParty.checkbox}</Text>
        </Pressable>
      ) : null}

      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Pressable
        testID="consent-cta-primary"
        onPress={handleSubjectSubmit}
        disabled={!canProceedSubject}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canProceedSubject }}
        style={[styles.primaryCta, !canProceedSubject && styles.primaryCtaDisabled]}>
        {pending ? (
          <ActivityIndicator color={Accent.onAccent} />
        ) : (
          <Text style={styles.primaryCtaLabel}>{primaryLabel}</Text>
        )}
      </Pressable>

      <Pressable
        testID="consent-cta-secondary"
        onPress={handleCancel}
        disabled={pending}
        accessibilityRole="button"
        accessibilityState={{ disabled: pending }}
        style={styles.secondaryCta}>
        <Text style={styles.secondaryCtaLabel}>{Copy.consent.upload.subject.cta.secondary}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors, scheme: ColorScheme) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.sheet,
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    title: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
    },
    body: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    checkboxRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: Spacing.md,
      minHeight: HitTarget.min,
    },
    checkbox: {
      alignItems: 'center',
      // `control.border`, not `hairline` — a checkbox's box is a UI-component boundary WCAG
      // 1.4.11 names explicitly, so it needs the >=3:1 interactive-boundary role, not the
      // decorative hairline rule (issue #96). The checked state already clears 3:1 via
      // `Accent.value` (see `checkboxChecked` below); this covers the unchecked state.
      borderColor: colors.control.border,
      borderRadius: Radius.card,
      borderWidth: CheckboxSize.border,
      height: CheckboxSize.box,
      justifyContent: 'center',
      width: CheckboxSize.box,
    },
    checkboxChecked: {
      backgroundColor: Accent.value,
      borderColor: Accent.value,
    },
    checkboxMark: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.bold,
      fontSize: FontSize.xs,
    },
    checkboxLabel: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    // The subject phase's "who is this" picker (#94) — same interactive-boundary contrast
    // reasoning as `checkbox` above, reusing `control.border`/`Accent.value` rather than
    // inventing a new pair of colors for what is functionally the same affordance (a bordered,
    // tappable, selectable row).
    optionRow: {
      alignItems: 'center',
      borderColor: colors.control.border,
      borderRadius: Radius.card,
      borderWidth: CheckboxSize.border,
      flexDirection: 'row',
      gap: Spacing.md,
      minHeight: HitTarget.min,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    optionRowSelected: {
      borderColor: Accent.value,
    },
    radio: {
      alignItems: 'center',
      borderColor: colors.control.border,
      borderRadius: Radius.pill,
      borderWidth: CheckboxSize.border,
      height: CheckboxSize.box,
      justifyContent: 'center',
      width: CheckboxSize.box,
    },
    radioSelected: {
      borderColor: Accent.value,
    },
    radioDot: {
      backgroundColor: Accent.value,
      borderRadius: Radius.pill,
      height: CheckboxSize.box / 2,
      width: CheckboxSize.box / 2,
    },
    optionLabel: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    privacyLink: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.xs,
    },
    // Semantic.error, not Score.low. This component originally borrowed the score scale's
    // "Needs work" clay because no error role existed; issue #24 added one on main while this
    // branch was open. Borrowing the clay would bleed *score* meaning into a consent failure —
    // and on the result screen it would sit next to real clay pillar bars.
    error: {
      color: Semantic.error[scheme],
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
    primaryCta: {
      alignItems: 'center',
      backgroundColor: Accent.value,
      borderRadius: Radius.card,
      height: ControlHeight.standard,
      justifyContent: 'center',
    },
    primaryCtaDisabled: {
      opacity: Opacity.disabled,
    },
    primaryCtaLabel: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
    },
    secondaryCta: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: HitTarget.min,
    },
    secondaryCtaLabel: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
  });
}
