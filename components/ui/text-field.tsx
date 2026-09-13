/**
 * V23-01's text input: 56 pt, `bgRaised` fill, 1 px `line` border, no radius, 16 pt side padding,
 * Body 16/24 in `ink` with the placeholder in `ink3`. In its error state (V23-06's third
 * artboard) the border turns `danger` and a Small 13/16 `danger` line sits 8 pt beneath it — the
 * one place the sheet allows the chromatic value.
 *
 * A thin wrapper over `TextInput`: every native prop passes straight through, so a screen keeps
 * owning keyboard type, autofill and focus chaining exactly as before.
 */
import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';

import { Ink, Layout, Space, Type } from '@/constants/v23-theme';

type TextFieldProps = TextInputProps & {
  /** Inline error beneath the field. Sets the border to `danger` and announces politely. */
  error?: string | null;
  containerStyle?: StyleProp<ViewStyle>;
};

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { error, containerStyle, style, ...inputProps },
  ref
) {
  const hasError = !!error;
  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        ref={ref}
        placeholderTextColor={Ink.ink3}
        selectionColor={Ink.ink}
        keyboardAppearance="dark"
        {...inputProps}
        style={[styles.input, hasError && styles.inputError, style]}
      />
      {hasError ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: Space.sm,
  },
  input: {
    ...Type.body,
    // A TextInput's `lineHeight` shifts the caret on iOS; the 56 pt box centres the text itself.
    lineHeight: undefined,
    height: Layout.controlHeight,
    paddingHorizontal: Layout.cardPadding,
    backgroundColor: Ink.bgRaised,
    borderWidth: Layout.hairline,
    borderColor: Ink.line,
    borderRadius: Layout.radius,
    color: Ink.ink,
  },
  inputError: {
    borderColor: Ink.danger,
  },
  error: {
    ...Type.small,
    color: Ink.danger,
  },
});
