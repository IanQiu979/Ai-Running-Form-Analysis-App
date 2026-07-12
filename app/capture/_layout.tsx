import { Stack } from 'expo-router';

// The capture flow (design brief screens 3-5, issue #36): source picker -> in-app record ->
// frame extraction. Registered in the signed-in half of the root Stack (app/_layout.tsx) — same
// mechanism as (tabs)/(auth), see that file's comment on Stack.Protected.
export default function CaptureLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="record" />
      <Stack.Screen name="extracting" />
    </Stack>
  );
}
