## Summary

On the iOS EAS development build, in-app video **Record** (`app/capture/record.tsx`, `record-button`)
cannot start a recording on the iOS Simulator at all. `CameraView`'s `record()` call rejects
immediately with a native `SimulatorNotSupported` error, surfaced to the user as an uncaught
LogBox toast. This blocks `happy-path.yaml` and `dead-end-offline.yaml` — the only two flows that
reach the capture step — at the identical point: right after tapping `record-button`, before the
"2s / 15s" recording timer ever appears.

This is a **simulator/SDK capability gap, not app or flow drift**. It directly contradicts
`.maestro/README.md`'s prerequisite #3, written 2026-07-13, which states "Xcode 15+ Simulators can
drive [`CameraView`] with a synthetic test-pattern feed" — that assumption does not hold for this
build's `expo-camera` version. No app code was changed to investigate or work around this, per this
task's "flow drift only" scope.

## Environment

- EAS development build: `dbd22da6-b42b-4d4b-a270-0e6fd138e42b` (`dbd22da6`)
- Bundle ID: `com.ian.paceanalysisai`
- Simulator: `PACE-e2e-203`, iPhone 17 (`iPhone18,3`)
- Simulator runtime: iOS 26.5
- Maestro: 2.10.0 (upgraded from 1.39.0 during this task; see `.maestro/README.md`)

## Reproduction

1. Sign in (fixture account or any account) and reach Home.
2. Tap "Start analysis" → "Add footage" → the in-app **Record** card.
3. Grant the health/age/subject consent gate.
4. Grant camera permission (soft-ask → OS "Allow").
5. Tap `record-button` to start recording.

Observed: the record button tap never starts a visible recording; a LogBox error toast appears
immediately with the exact accessibility text:

```
Uncaught (in promise, id: 0) Error: FunctionCallException: Calling the 'record' function has
failed (at ExpoModulesCore/AsyncFunctionDefinition.swift:123)
→ Caused by: SimulatorNotSupported: This operation is not supported on the simulator
(at ExpoCamera/CameraViewModule.swift:290)
```

Expected (per `.maestro/README.md`'s own documented assumption): a synthetic test-pattern feed
records for the requested duration and the "Ns / 15s" timer advances.

Reproduced identically on two separate flows (`happy-path.yaml`, `dead-end-offline.yaml`), each on
a fresh install, confirming this is deterministic — not the iOS-accessibility-bridge flakiness
`.maestro/README.md` documents elsewhere in this file's history.

## Evidence

![LogBox toast showing the SimulatorNotSupported error, captured mid `happy-path.yaml` run](./record-unsupported-on-simulator.png)

## Impact

Neither `happy-path.yaml` nor `dead-end-offline.yaml` can currently reach the capture→analyze
handoff (and therefore the real, paid `analyze-form` call) on an iOS **Simulator** at all, via the
in-app Record path. **Zero real `analyze-form`/model calls were made during this task** — every
attempted run stopped at this step.

## Not investigated further (flow-drift-only scope)

- Whether a different Simulator runtime, Xcode version, or `expo-camera` version restores
  simulator recording support.
- The Upload path (native Photos picker + a seeded `xcrun simctl addmedia` asset) as an
  alternative capture mechanism — `.maestro/README.md`'s prerequisite #3 already explains why this
  repo deliberately avoids scripting that picker and avoids committing running-form media as a
  fixture (CLAUDE.md's uploaded-media-is-sensitive rule).
- A real device run, which is out of this task's headless-simulator-only scope.
