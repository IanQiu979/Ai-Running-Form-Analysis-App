import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Live-updating read of the OS "Reduce Motion" accessibility setting (issue #29).
 *
 * `docs/design/motion-consult.md`'s reduced-motion map is binding for every animation the app
 * will grow (result reveal, wait-state, Stack push transitions, etc.), but this app has almost
 * no motion yet — this hook is the mechanism issue #61 (the motion work) plugs into, not new
 * motion itself. Its one consumer today is `app/_layout.tsx`, gating the Stack's default push
 * transition.
 *
 * Deliberately built on `AccessibilityInfo` directly rather than `react-native-reanimated`'s
 * own `useReducedMotion()` (same name, different module/behavior — don't confuse the two): a
 * plain RN hook keeps this usable from any screen, including ones that render before Reanimated
 * has anything else to do, and gives explicit control over the initial-read + live-subscription
 * shape below.
 *
 * `isReduceMotionEnabled()` is read once on mount for the initial value; the `reduceMotionChanged`
 * event keeps it current if the OS setting changes while the app is foregrounded (e.g. the user
 * opens Settings from Control Center). Subscription is removed on unmount.
 */
export function useReducedMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (isMounted) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}
