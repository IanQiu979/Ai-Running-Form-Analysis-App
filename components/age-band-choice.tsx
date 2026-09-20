/**
 * The age choice (2026-09-20) — two options and, under the second, the parent/guardian
 * attestation. Drawn twice: on the sign-up form (`app/(auth)/sign-in.tsx`) and on the one-time
 * screen an OAuth-created account gets (`components/age-band-gate.tsx`), so the two ask the same
 * question with the same words, the same testIDs and the same accessibility tree.
 *
 * Controlled and stateless: the host owns `value` and `guardianConsent` because the host's submit
 * gate has to read them (the sign-up button, the gate's Continue), and a choice that lived in here
 * would have to be read back through a ref. `selectionOf()` is the one pure rule both hosts share —
 * "is this a complete, sendable choice?" — so the button gate and the request body cannot disagree.
 *
 * The drawn idiom is `components/consent-gate.tsx`'s: the V23 sheet draws one square for both a
 * checkbox and a radio (a smaller `ink` square when a radio is selected, a check glyph when a box is
 * ticked). Under 13 is not offered — `eligibility` says so in one line — so there is nothing to
 * disable and nothing to refuse client-side: a user who is under 13 has no option to pick.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '@/components/ui/v23-icons';
import { Copy } from '@/constants/copy';
import { Ink, Layout, Space, Type } from '@/constants/v23-theme';
import type { AgeBand, AgeBandChoice } from '@shared/age-band';

type Props = {
  value: AgeBand | null;
  onChange: (band: AgeBand) => void;
  guardianConsent: boolean;
  onToggleGuardianConsent: () => void;
  disabled?: boolean;
  /** Prefix for the three testIDs (`-18-plus`, `-13-17`, `-guardian-consent`). */
  testIDPrefix: string;
};

/**
 * The complete choice a host may send, or `null` while the form is not sendable: no band picked,
 * or 13–17 picked without the attestation. One rule, shared by both hosts' submit gates.
 */
export function selectionOf(value: AgeBand | null, guardianConsent: boolean): AgeBandChoice | null {
  if (value === null) return null;
  if (value === '13_17' && !guardianConsent) return null;
  return { ageBand: value, guardianConsent: value === '13_17' };
}

export function AgeBandChoiceGroup({
  value,
  onChange,
  guardianConsent,
  onToggleGuardianConsent,
  disabled = false,
  testIDPrefix,
}: Props) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={Copy.auth.ageBand.legend}>
      <Text style={styles.legend}>{Copy.auth.ageBand.legend}</Text>
      <RadioRow
        testID={`${testIDPrefix}-18-plus`}
        selected={value === '18_plus'}
        label={Copy.auth.ageBand.option.adult}
        accessibilityLabel={Copy.auth.ageBand.a11y.adult}
        disabled={disabled}
        onPress={() => onChange('18_plus')}
      />
      <RadioRow
        testID={`${testIDPrefix}-13-17`}
        selected={value === '13_17'}
        label={Copy.auth.ageBand.option.minor}
        accessibilityLabel={Copy.auth.ageBand.a11y.minor}
        disabled={disabled}
        onPress={() => onChange('13_17')}
      />
      {value === '13_17' && (
        // The attestation is drawn only once 13–17 is picked, and it is a separate, affirmative
        // tick — never pre-checked, never folded into the option itself. Choosing the option says
        // "I am 13–17"; ticking this says "and my parent or guardian agrees". The server requires
        // both (`guardian_consent_required`), and so does `selectionOf` above.
        <Pressable
          testID={`${testIDPrefix}-guardian-consent`}
          onPress={onToggleGuardianConsent}
          disabled={disabled}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: guardianConsent, disabled }}
          accessibilityLabel={Copy.auth.ageBand.guardian.checkbox}
          style={[styles.row, styles.guardianRow]}
          hitSlop={Space.sm}>
          <View style={[styles.box, guardianConsent ? styles.boxChecked : styles.boxUnchecked]}>
            {guardianConsent ? <CheckIcon /> : null}
          </View>
          {/* Legal text wraps; it must never end in an ellipsis. */}
          <Text style={styles.guardianLabel}>{Copy.auth.ageBand.guardian.checkbox}</Text>
        </Pressable>
      )}
      <Text style={styles.eligibility}>{Copy.auth.ageBand.eligibility}</Text>
    </View>
  );
}

function RadioRow({
  testID,
  selected,
  label,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  testID: string;
  selected: boolean;
  label: string;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
      hitSlop={Space.sm}>
      <View style={[styles.box, selected ? styles.radioSelected : styles.boxUnchecked]}>
        {selected ? <View style={styles.radioMark} /> : null}
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

// consent-gate.tsx's geometry: the 20 pt square sits 2 pt down so it centres on the first line
// of a bodySm label; the selected-radio mark is a 10 pt `ink` square inside it.
const BOX_TOP_OFFSET = 2;
const RADIO_MARK_SIZE = 10;

const styles = StyleSheet.create({
  group: {
    gap: Space.md,
  },
  legend: {
    ...Type.label,
    color: Ink.ink2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Space.md,
    minHeight: Layout.hitTarget,
  },
  guardianRow: {
    // Indented under the 13–17 option it belongs to: the square's width plus the row gap.
    paddingStart: Layout.consentCheckbox + Space.md,
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
  guardianLabel: {
    ...Type.small,
    color: Ink.ink2,
    flex: 1,
  },
  eligibility: {
    ...Type.small,
    color: Ink.ink2,
  },
});
