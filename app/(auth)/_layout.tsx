import { Stack } from 'expo-router';

import { Ink, Motion } from '@/constants/v23-theme';

/**
 * The signed-out group. Its first two screens are the V23 entry flow, walked in this order:
 * `welcome` (V23-02 hero, and since 2026-09-20 the pillars story beneath it in one paged scroll —
 * `components/pillar-story.tsx`) → `sign-in` (V23-06, sign-up and sign-in on one screen). The
 * 2026-09-13 `details` route (V23-03's grid) is gone; its content is the story. `welcome` is the
 * group's initial route (`unstable_settings` below), so a cold, signed-out launch — and every
 * sign-out — lands on the hero.
 *
 * THE HERO IS `welcome`, NOT `index`, AND THAT IS LOAD-BEARING. An `(auth)/index.tsx` would
 * resolve to the URL `/` alongside `(tabs)/index.tsx`, and expo-router's path matcher picks the
 * `(auth)` candidate from any route outside `(tabs)` — so every signed-in `router.replace('/')`
 * (analyzing's Cancel, result's and extracting's "home") would target a screen the session guard
 * has removed from the navigator and silently do nothing. Code review, 2026-09-14. A regression
 * lock lives in `app/__tests__/root-path-is-unique.test.ts`.
 *
 * `contentStyle` paints the navigator's own card in the theme sheet's `bg`: every screen here is
 * that flat black edge to edge, and the root navigator's Cold Read card colour would otherwise
 * show through for a frame during the 250 ms fade. That fade is the theme sheet's page-transition
 * token and is set here as well as on the root Stack: a nested navigator does not inherit its
 * parent's `screenOptions`, and without it hero → sign-up would slide in from the right instead.
 */
export const unstable_settings = {
  initialRouteName: 'welcome',
};

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        animationDuration: Motion.duration.page,
        contentStyle: { backgroundColor: Ink.bg },
      }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="sign-in" />
      {/* Issue #81 — password reset. reset-password: enter email, request the link.
          update-password: reached only via that emailed deep link; consumes the recovery
          session and sets the new password. See update-password.tsx's header comment for a
          load-bearing routing caveat these two screens are currently subject to. */}
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="update-password" />
    </Stack>
  );
}
