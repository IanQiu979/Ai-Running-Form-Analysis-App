// AsyncStorage has no native module under Jest; use the mock the package ships.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// expo-crypto has no native module under Jest either, so `Crypto.randomUUID()` silently returns
// `undefined` rather than throwing — which is the dangerous failure mode: code under test appears
// to work while handing `undefined` to whatever consumes the id. Back it with Node's real
// implementation so tests exercise a genuine, correctly-shaped UUID (`app/capture/extracting.tsx`
// mints the idempotency key this way, and `lib/analyze-form.ts`'s mock analysisId must satisfy
// `app/result/[id].tsx`'s UUID_PATTERN guard — see that function's comment).
jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  randomUUID: () => require('node:crypto').randomUUID(),
}));
