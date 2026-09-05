// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // eslint-config-expo's SDK 56 bump pulled in eslint-plugin-react-hooks v7's React
    // Compiler rule-set, which turns on `react-hooks/immutability` by default. That rule
    // flags any `foo.value = ...` assignment as mutating a value React considers immutable —
    // but that IS Reanimated's documented API for shared values (`useSharedValue`), which this
    // app's whole animation layer is built on (Motion-token-driven `withTiming`/`withSpring`
    // calls throughout components/ and app/). The rule has no way to distinguish a Reanimated
    // SharedValue from actual React state, so it's a blanket false positive here, not a real
    // hazard — React Compiler's own worklet handling is already carved out separately by
    // Reanimated's Babel plugin.
    rules: {
      'react-hooks/immutability': 'off',
      // Same v7 rule-set bump: flags `useRef(x).current` read back immediately after creation
      // (app/analyzing.tsx:112, app/paywall.tsx's TierCard refs) as "accessing a ref during
      // render" — it can't distinguish that idiom (stable-value-via-ref, same shape as
      // useMemo) from actually branching render output on a ref that changed after mount.
      'react-hooks/refs': 'off',
      // And flags the standard "fetch on mount" `useEffect(() => { void fetchX(); }, [fetchX])`
      // pattern used across app/paywall.tsx, app/settings.tsx, app/(auth)/update-password.tsx
      // etc. as "calling setState synchronously in an effect" — the setState calls are inside
      // fetchX's own async body, after an await, not synchronous in the effect itself.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
