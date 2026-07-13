import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Fires `AccessibilityInfo.announceForAccessibility` on iOS whenever `message` changes to a new
 * truthy value — the iOS-side complement to `accessibilityLiveRegion="polite"` (issue #11).
 *
 * `accessibilityLiveRegion` is Android-only: React Native maps it to
 * `android:accessibilityLiveRegion`, which is a no-op on iOS. Every dynamic-status text that
 * relied on it alone (an auth error, a quota caption) was therefore completely silent to
 * VoiceOver on iOS, the platform this app ships to first. This hook does not replace that prop —
 * callers keep `accessibilityLiveRegion="polite"` on the element that shows `message` (Android)
 * and additionally call `useAnnounce(message)` (iOS). The two mechanisms are complementary, not
 * alternatives.
 *
 * iOS-only by design: Android already gets its announcement from `accessibilityLiveRegion`, so
 * calling `announceForAccessibility` there too would double-announce every change.
 *
 * `message` is `string | null | undefined` because every call site derives it from state that
 * can legitimately have nothing to announce yet (no error, still loading, etc.) — a falsy value
 * is a no-op, not an empty announcement.
 *
 * Built once, here, rather than per screen (this project's second consumer already exists —
 * app/(tabs)/index.tsx's three quota captions — and every M2–M6 screen will add more).
 */
export function useAnnounce(message: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'ios' || !message) {
      return;
    }
    AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
