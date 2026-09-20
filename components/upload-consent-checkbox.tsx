/**
 * The future-uploads attestation checkbox (sign-up, 2026-09-20) — a single controlled row: the
 * page's drawn checkbox square plus two sentences — the health-processing statement that keeps
 * `UPLOAD_HEALTH_CONSENT`'s meaning, then the future-uploads attestation — with "Privacy Policy" inside it as a real,
 * live link rather than the sign-up screen's existing Terms/Privacy line, whose underlines are
 * deliberately inert (see `app/(auth)/sign-in.tsx`'s header: that link sits inside the
 * checkbox's own tap target, so it needs a control of its own). This component gives it one, by
 * keeping the link OUTSIDE the checkbox's `Pressable` instead of nested inside it — the checkbox
 * toggles on its own tap target, the link opens the policy on its own, and neither swallows the
 * other's touch.
 *
 * Stateless and controlled, like `components/age-band-choice.tsx`: the host owns `checked`
 * because its submit gate has to read it. No import of `lib/consent.ts` here — this component
 * only collects the tick; the host records the grant.
 *
 * The drawn idiom is `components/age-band-choice.tsx`'s: a 20 pt square (`Layout.consentCheckbox`)
 * holding a `CheckIcon` when ticked, `line`-ruled on `bgRaised` when not.
 */
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { PRIVACY_POLICY_URL } from '@/constants/links';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';

type Props = {
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  testID: string;
};

/** The page's checked box sits 2 pt down so it centres on the first line of a bodySm label,
 *  same offset `age-band-choice.tsx` uses for the same reason. */
const BOX_TOP_OFFSET = 2;

function openPrivacyPolicy() {
  // Same non-dialog "swallow rejection" handling as app/settings.tsx's own openPrivacyPolicy —
  // there is no handler-missing case worth surfacing to the user here either.
  Linking.openURL(PRIVACY_POLICY_URL).catch(() => undefined);
}

export function UploadConsentCheckbox({ checked, onToggle, disabled = false, testID }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        testID={testID}
        onPress={onToggle}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={`${Copy.auth.consent.healthProcessing} ${Copy.auth.consent.futureUploads.checkbox}`}
        style={styles.checkboxTarget}
        hitSlop={Space.sm}>
        <View style={[styles.box, checked ? styles.boxChecked : styles.boxUnchecked]}>
          {checked ? <CheckIcon /> : null}
        </View>
      </Pressable>
      {/* Legal text wraps; it must never end in an ellipsis. */}
      <Text style={styles.label}>
        {Copy.auth.consent.healthProcessing} {Copy.auth.consent.futureUploads.checkbox}{' '}
        <Text
          style={styles.link}
          accessibilityRole="link"
          accessibilityLabel={Copy.auth.consent.privacy}
          onPress={openPrivacyPolicy}>
          {Copy.auth.consent.privacy}
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
  },
  checkboxTarget: {
    minHeight: Layout.hitTarget,
    justifyContent: 'flex-start',
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
  label: {
    ...Type.bodySm,
    color: Ink.ink2,
    flex: 1,
    marginTop: BOX_TOP_OFFSET,
  },
  link: {
    color: Ink.ink,
    textDecorationLine: 'underline',
  },
});
