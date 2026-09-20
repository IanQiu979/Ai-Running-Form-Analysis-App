/**
 * Issue #232: `expo-camera`'s `CameraView.recordAsync` rejects on the iOS Simulator (no camera
 * hardware) with a native error whose message contains `SimulatorNotSupported` — there is no
 * `expo-device` dependency in this project and `expo-constants` exposes no pre-call simulator
 * flag, so `app/capture/record.tsx` detects the case by matching the rejection's own message
 * instead of adding a dependency just for this. Anything else `recordAsync` throws is treated as
 * a generic recording failure.
 */
export function isSimulatorNotSupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /SimulatorNotSupported|not supported on the simulator/i.test(message);
}
