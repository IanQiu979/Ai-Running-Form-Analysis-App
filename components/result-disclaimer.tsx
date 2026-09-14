/**
 * The "not medical advice" disclaimer (issue #68) — rendered on EVERY result, every tier, no
 * exceptions (copy-deck.md § Disclaimer).
 *
 * The string is `Copy.result.disclaimer.footer`, from the copy deck — NOT the differently-worded
 * version in `knowledge/injury_flags.md`, which is prompt content for the model. Issue #68 points
 * at the knowledge file; it is wrong.
 *
 * V23-08 sets it as bare footnote text between the readout card and the button — no box of its
 * own. This is a component, not a route; `app/result/[id].tsx` owns where it sits.
 */
import { StyleSheet, Text } from 'react-native';

import { Copy } from '@/constants/copy';
import { Ink, Type } from '@/constants/v23-theme';

export function ResultDisclaimer() {
  return (
    <Text testID="result-disclaimer-text" style={[Type.footnote, styles.text]}>
      {Copy.result.disclaimer.footer}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    color: Ink.ink2,
  },
});
