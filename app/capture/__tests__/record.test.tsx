/**
 * Screen-level regression lock for `app/capture/record.tsx`'s clip measurement.
 *
 * THE BUG. `CameraView.recordAsync()` reports no duration, so this screen measures the clip
 * itself. It used to do that with one wall-clock span: `Date.now()` on the record tap, subtracted
 * from `Date.now()` at the moment `recordAsync`'s promise RESOLVED. That promise settles once the
 * movie file has been finalized — after the last recorded frame — so the reported duration always
 * overshot the clip. Because `recordAsync` is given `maxDuration: MAX_CLIP_DURATION_MS / 1000`, a
 * full-length recording is exactly 15.000s of media and the span around it is strictly more than
 * 15000ms, which `app/capture/extracting.tsx`'s pre-flight `checkMediaCaps` rejects as
 * `clipTooLong` — the app refusing the longest clip its own recorder had just produced. The same
 * overshoot stretched `lib/frames.ts`'s `sampleTimestamps` window past the real last frame, so the
 * late samples came back as duplicates of the final still instead of showing motion.
 *
 * WHY THIS TEST LIVES AT THE SCREEN AND NOT ONLY IN `lib/__tests__/recorded-clip-duration.test.ts`.
 * That suite proves the pure measurement clamps correctly. It cannot prove this screen USES it, or
 * that it stamps the stop time at `stopRecording()` rather than at resolve — and the bug was
 * exactly a screen handing the wrong two numbers downstream. CLAUDE.md's own rule: "a screen-level
 * test is the only thing that can prove which arguments a screen actually passes downstream."
 * `Date.now` is driven manually below so the finalization gap is explicit rather than timing-
 * dependent.
 *
 * The V23-10 block at the end locks the re-themed overlay's structure — which line is shown,
 * which tone the control's mark takes, that the back control leaves while recording — never a
 * pixel value.
 *
 * Every press is wrapped in an awaited `act`: two bare `fireEvent.press` calls in one test leave
 * an act scope open under this Jest setup, and the NEXT test's `render` then produces an empty
 * tree.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { TestInstance } from 'test-renderer';

import { Copy } from '@/constants/copy';
import { Ink } from '@/constants/v23-theme';
import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';

import RecordScreen from '../record';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    canGoBack: () => mockCanGoBack,
  }),
}));

jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));

/** Resolves the in-flight `recordAsync` promise — the test's stand-in for the native recorder
 *  finishing its file write, which is what really settles that promise. */
let mockFinishRecording: ((video: { uri: string } | undefined) => void) | null = null;
/** Issue #232: the test's stand-in for a native `recordAsync` rejection (the `SimulatorNotSupported`
 *  case and any other native failure). */
let mockFailRecording: ((error: unknown) => void) | null = null;
/** Set when the screen calls `stopRecording()`, so a test can assert the screen asked to stop
 *  before the promise settled (the whole point of the two separate stamps). */
let mockStopRecordingCalledAt: number | null = null;

jest.mock('expo-camera', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native');

  const CameraView = react.forwardRef(
    (props: { onCameraReady?: () => void }, ref: unknown) => {
      react.useImperativeHandle(ref, () => ({
        recordAsync: () =>
          new Promise((resolve, reject) => {
            mockFinishRecording = resolve;
            mockFailRecording = reject;
          }),
        stopRecording: () => {
          mockStopRecordingCalledAt = Date.now();
        },
      }));
      react.useEffect(() => {
        props.onCameraReady?.();
      }, []);
      return react.createElement(rn.View, { testID: 'mock-camera-view' });
    }
  );

  return {
    CameraView,
    useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
  };
});

jest.setTimeout(30_000);
const WAIT = { timeout: 15_000 } as const;

/** Wall clock the screen reads through `Date.now()`. Advanced explicitly by each test. */
let nowMs = 1_700_000_000_000;
let dateNowSpy: jest.SpyInstance<number, []>;

beforeEach(() => {
  jest.clearAllMocks();
  nowMs = 1_700_000_000_000;
  mockFinishRecording = null;
  mockFailRecording = null;
  mockCanGoBack = true;
  mockStopRecordingCalledAt = null;
  dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

/** One awaited, act-wrapped press of the record control — see the module docblock. */
async function pressRecord() {
  await act(async () => {
    fireEvent.press(screen.getByTestId('record-button'));
  });
}

/** The single `durationMs` the screen handed `/capture/extracting`, as a number. */
function pushedDurationMs(): number {
  expect(mockPush).toHaveBeenCalledTimes(1);
  return Number(mockPush.mock.calls[0][0].params.durationMs);
}

async function startRecording() {
  await render(<RecordScreen />);
  await waitFor(() => expect(screen.getByTestId('record-button')).toBeTruthy(), WAIT);
  await pressRecord();
  await waitFor(() => expect(mockFinishRecording).not.toBeNull(), WAIT);
}

/** Settles the in-flight `recordAsync` promise, then yields so its continuation — the
 *  `router.push` each case asserts on — runs before the assertions do.
 *
 *  Wrapped in its own awaited `act()`, because the press that started the clip has already been
 *  awaited through one (`pressRecord`) and closed its scope: the `setRecording(false)` the screen
 *  runs when the recorder resolves would otherwise land outside any act scope and React warns.
 *  (This used to be deliberately unwrapped, back when the presses were bare `fireEvent.press`
 *  calls whose own act scope was still open here — nesting a second one then left the NEXT test's
 *  render uncommitted.) The `waitFor` each caller follows this with settles the tree. */
async function finishRecording(video: { uri: string } | undefined) {
  await act(async () => {
    mockFinishRecording?.(video);
    await Promise.resolve();
  });
}

/** Issue #232: rejects the in-flight `recordAsync` promise, the same way it settles for a real
 *  native failure — the screen's own `try`/`catch` is what keeps this from ever reaching an
 *  uncaught-promise LogBox toast. See `finishRecording` above for why this needs its own `act`. */
async function failRecording(error: unknown) {
  await act(async () => {
    mockFailRecording?.(error);
    await Promise.resolve();
  });
}

describe('RecordScreen — the clip duration handed to /capture/extracting', () => {
  // THE headline lock. 15.000s of media, then 400ms of file finalization before `recordAsync`
  // resolves. The old code measured 15400 and the extraction screen rejected the clip outright;
  // the fix measures to the stop tap and clamps to the recorder's own maxDuration guarantee.
  it('measures a full-length recording at the cap, not at the finalization time', async () => {
    await startRecording();

    // The full clip the recorder auto-caps at.
    nowMs += MAX_CLIP_DURATION_MS;
    await pressRecord();
    expect(mockStopRecordingCalledAt).toBe(nowMs);

    // File finalization — real elapsed time that is NOT part of the recorded media.
    nowMs += 400;
    await finishRecording({ uri: 'file:///tmp/clip.mov' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1), WAIT);
    expect(pushedDurationMs()).toBe(MAX_CLIP_DURATION_MS);
    // Named explicitly: this is the value the wall-clock-to-resolve measurement produced, and
    // `checkMediaCaps` rejects anything above the cap as `clipTooLong`.
    expect(pushedDurationMs()).not.toBe(MAX_CLIP_DURATION_MS + 400);
    expect(pushedDurationMs()).toBeLessThanOrEqual(MAX_CLIP_DURATION_MS);
  });

  // The ordinary short clip: the finalization gap must be excluded here too, or every clip's
  // sampling window runs a few hundred milliseconds past its real last frame.
  it('excludes the finalization gap from an ordinary hand-stopped clip', async () => {
    await startRecording();

    nowMs += 6_000;
    await pressRecord();

    nowMs += 350;
    await finishRecording({ uri: 'file:///tmp/clip.mov' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1), WAIT);
    expect(pushedDurationMs()).toBe(6_000);
  });

  // The auto-stop path: the recorder hits `maxDuration` on its own, so nothing in the screen ever
  // calls `stopRecording()` and there is no stop stamp to read. The measurement falls back to the
  // resolve-time wall clock, and the clamp is what keeps that from tripping the cap check.
  it('clamps the auto-stop path, where no stop stamp exists', async () => {
    await startRecording();

    nowMs += MAX_CLIP_DURATION_MS + 500;
    await finishRecording({ uri: 'file:///tmp/clip.mov' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1), WAIT);
    expect(mockStopRecordingCalledAt).toBeNull();
    expect(pushedDurationMs()).toBe(MAX_CLIP_DURATION_MS);
  });

  it('navigates with the video params /capture/extracting parses', async () => {
    await startRecording();

    nowMs += 4_000;
    await pressRecord();
    await finishRecording({ uri: 'file:///tmp/clip.mov' });

    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1), WAIT);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/capture/extracting',
      params: { mediaType: 'video', uri: 'file:///tmp/clip.mov', durationMs: '4000' },
    });
  });

  // A recorder that hands back nothing usable must not navigate at all — `sampleTimestamps` throws
  // a RangeError on a non-positive duration, which would surface as a dead-end error screen.
  it('does not navigate when the recorder returns no clip', async () => {
    await startRecording();

    nowMs += 3_000;
    await pressRecord();
    await finishRecording(undefined);

    await waitFor(() => expect(screen.getByTestId('record-button')).toBeTruthy(), WAIT);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// V23-10 (third artboard): the overlay's drawn state.
describe('RecordScreen — the V23-10 overlay', () => {
  /** The control's inner mark: the one child of the record Pressable. */
  function recordMark(): TestInstance {
    return screen.getByTestId('record-button').children[0] as TestInstance;
  }

  it('shows the joined tip + muted line, the auto-cap caption and an `ink` mark while idle', async () => {
    await render(<RecordScreen />);
    await waitFor(() => expect(screen.getByTestId('record-button')).toBeTruthy(), WAIT);

    expect(screen.getByText(`${Copy.capture.overlay.tip} ${Copy.capture.overlay.muted}`)).toBeTruthy();
    expect(screen.getByText(Copy.capture.recording.autoCap)).toBeTruthy();
    expect(screen.getByRole('header', { name: Copy.capture.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
    expect(StyleSheet.flatten(recordMark().props.style).backgroundColor).toBe(Ink.ink);
    expect(screen.getByTestId('framing-guide', { includeHiddenElements: true })).toBeTruthy();
  });

  it('drops the tip and the back control, shows the timer and turns the mark `danger` while recording', async () => {
    await startRecording();

    expect(screen.getByText(Copy.capture.overlay.muted)).toBeTruthy();
    expect(screen.queryByText(`${Copy.capture.overlay.tip} ${Copy.capture.overlay.muted}`)).toBeNull();
    expect(screen.getByText(Copy.capture.recording.timer(0))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.getByRole('header', { name: Copy.capture.title })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop recording' })).toBeTruthy();
    expect(StyleSheet.flatten(recordMark().props.style).backgroundColor).toBe(Ink.danger);

    // Settle the in-flight recording so nothing leaks into the next test.
    nowMs += 2_000;
    await pressRecord();
    await finishRecording({ uri: 'file:///tmp/clip.mov' });
    await waitFor(() => expect(mockPush).toHaveBeenCalledTimes(1), WAIT);
  });
});

// Issue #232: `recordAsync` rejects with a native `SimulatorNotSupported` error on the iOS
// Simulator, which used to reach the user as an uncaught LogBox toast. Both cases below prove the
// rejection is always caught and always surfaced through the same `<ConfirmDialog>` — never left
// uncaught — and that the recording state is fully reset rather than left stuck mid-clip.
describe('RecordScreen — recordAsync rejection (issue #232)', () => {
  const SIMULATOR_ERROR = new Error(
    "FunctionCallException: Calling the 'record' function has failed (at ExpoModulesCore/AsyncFunctionDefinition.swift:123)\n" +
      '→ Caused by: SimulatorNotSupported: This operation is not supported on the simulator (at ExpoCamera/CameraViewModule.swift:290)'
  );

  it('shows the simulator-unsupported dialog and returns to the capture chooser on primary', async () => {
    await startRecording();

    await failRecording(SIMULATOR_ERROR);

    await waitFor(
      () => expect(screen.getByText(Copy.capture.recordingError.simulatorUnsupported.title)).toBeTruthy(),
      WAIT
    );
    expect(screen.getByText(Copy.capture.recordingError.simulatorUnsupported.body)).toBeTruthy();
    // The recording state is fully reset — no clip stuck in flight — and nothing navigated.
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    // There is no camera to retry with, so the notice offers only the way to Upload.
    expect(screen.queryByTestId('recording-error-dialog-secondary')).toBeNull();

    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: Copy.capture.recordingError.simulatorUnsupported.cta })
      );
    });
    // Pops back to the chooser that pushed this screen rather than stacking a second one.
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(Copy.capture.recordingError.simulatorUnsupported.title)).toBeNull();
  });

  it('falls back to replacing the route with the chooser when there is nothing to go back to', async () => {
    mockCanGoBack = false;
    await startRecording();

    await failRecording(SIMULATOR_ERROR);

    await waitFor(
      () => expect(screen.getByText(Copy.capture.recordingError.simulatorUnsupported.title)).toBeTruthy(),
      WAIT
    );
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: Copy.capture.recordingError.simulatorUnsupported.cta })
      );
    });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/capture');
  });

  it('shows the generic recording-failed dialog for any other native rejection and stays put on Try again', async () => {
    await startRecording();

    await failRecording(new Error('Disk full'));

    await waitFor(
      () => expect(screen.getByText(Copy.capture.recordingError.recordingFailed.title)).toBeTruthy(),
      WAIT
    );
    expect(screen.getByText(Copy.capture.recordingError.recordingFailed.body)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: Copy.capture.recordingError.recordingFailed.cta }));
    });
    // "Try again" honours its label: the dialog closes, nothing navigates, the recorder is still here.
    expect(screen.queryByText(Copy.capture.recordingError.recordingFailed.title)).toBeNull();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-button')).toBeTruthy();
  });

  it('offers Choose Upload as the generic dialog secondary, which leaves for the chooser', async () => {
    await startRecording();

    await failRecording(new Error('Disk full'));

    await waitFor(
      () => expect(screen.getByText(Copy.capture.recordingError.recordingFailed.title)).toBeTruthy(),
      WAIT
    );
    await act(async () => {
      fireEvent.press(
        screen.getByRole('button', { name: Copy.capture.recordingError.recordingFailed.secondary })
      );
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText(Copy.capture.recordingError.recordingFailed.title)).toBeNull();
  });
});
