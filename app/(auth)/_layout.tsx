import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
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
