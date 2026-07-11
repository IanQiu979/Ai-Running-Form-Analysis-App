/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/** Every leaf color token `useThemeColor` can resolve — kept as an explicit union (not a
 * generic dot-path type) so a typo is a compile error, not a silent `undefined`. */
export type ColorToken = 'background' | 'surface.base' | 'surface.raised' | 'text.primary' | 'text.secondary' | 'hairline';

function resolveColorToken(theme: 'light' | 'dark', token: ColorToken): string {
  const palette = Colors[theme];
  switch (token) {
    case 'background':
      return palette.background;
    case 'surface.base':
      return palette.surface.base;
    case 'surface.raised':
      return palette.surface.raised;
    case 'text.primary':
      return palette.text.primary;
    case 'text.secondary':
      return palette.text.secondary;
    case 'hairline':
      return palette.hairline;
  }
}

export function useThemeColor(props: { light?: string; dark?: string }, colorToken: ColorToken) {
  const theme = useColorScheme() ?? 'light';
  const colorFromProps = props[theme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return resolveColorToken(theme, colorToken);
  }
}
