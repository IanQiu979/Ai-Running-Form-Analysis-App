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
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { MAX_CLIP_DURATION_MS } from '@/lib/media-caps';

import RecordScreen from '../record';

jest.mock('react-native-safe-area-context', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('react-native-safe-area-context/jest/mock').default
);

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

jest.mock('expo-linking', () => ({ openSettings: jest.fn() }));

// `@expo/vector-icons` pulls in `expo-font` -> `expo-asset`, which this project does not have
// installed (it is a transitive dep of a path nothing else in the app exercises under Jest), so
// the icon module fails to resolve before the screen under test ever renders. The back button's
// glyph is not what this suite is about; stubbing the one icon component keeps the failure from
// masquerading as a defect in the screen.
jest.mock('@expo/vector-icons/MaterialIcons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rn = require('react-native');
  return { __esModule: true, default: () => react.createElement(rn.View) };
});

/** Resolves the in-flight `recordAsync` promise — the test's stand-in for the native recorder
 *  finishing its file write, which is what really settles that promise. */
let mockFinishRecording: ((video: { uri: string } | undefined) => void) | null = null;
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
          new Promise((resolve) => {
            mockFinishRecording = resolve;
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
  mockStopRecordingCalledAt = null;
  dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

/** The single `durationMs` the screen handed `/capture/extracting`, as a number. */
function pushedDurationMs(): number {
  expect(mockPush).toHaveBeenCalledTimes(1);
  return Number(mockPush.mock.calls[0][0].params.durationMs);
}

async function startRecording() {
  await render(<RecordScreen />);
  await waitFor(() => expect(screen.getByTestId('record-button')).toBeTruthy(), WAIT);
  fireEvent.press(screen.getByTestId('record-button'));
  await waitFor(() => expect(mockFinishRecording).not.toBeNull(), WAIT);
}

/** Settles the in-flight `recordAsync` promise, then yields so its continuation — the
 *  `router.push` each case asserts on — runs before the assertions do.
 *
 *  Deliberately NOT wrapped in `act()`: this installed RNTL (v14) already drives its own act scope
 *  from `render`/`fireEvent`, and nesting a manual one here leaves the next test's render
 *  uncommitted, which surfaces as "Unable to find an element with testID: record-button" in every
 *  case after the first rather than as anything resembling its real cause. The `waitFor` each
 *  caller follows this with is what actually settles the tree. */
async function finishRecording(video: { uri: string } | undefined) {
  mockFinishRecording?.(video);
  await Promise.resolve();
}

describe('RecordScreen — the clip duration handed to /capture/extracting', () => {
  // THE headline lock. 15.000s of media, then 400ms of file finalization before `recordAsync`
  // resolves. The old code measured 15400 and the extraction screen rejected the clip outright;
  // the fix measures to the stop tap and clamps to the recorder's own maxDuration guarantee.
  it('measures a full-length recording at the cap, not at the finalization time', async () => {
    await startRecording();

    // The full clip the recorder auto-caps at.
    nowMs += MAX_CLIP_DURATION_MS;
    fireEvent.press(screen.getByTestId('record-button'));
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
    fireEvent.press(screen.getByTestId('record-button'));

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
    fireEvent.press(screen.getByTestId('record-button'));
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
    fireEvent.press(screen.getByTestId('record-button'));
    await finishRecording(undefined);

    await waitFor(() => expect(screen.getByTestId('record-button')).toBeTruthy(), WAIT);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
