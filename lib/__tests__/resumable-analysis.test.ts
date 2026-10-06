/**
 * Locks for `lib/resumable-analysis.ts` — the session-expired resume hold (2026-10-06).
 *
 * The properties that matter:
 *   - IDENTITY. A resume hands back the very object it was given (`toBe`), never a rebuilt one —
 *     `analyze-form` refuses changed frames under one idempotency key.
 *   - ACCOUNT SCOPE. Only the user the hold was made for can take it; any other take discards it,
 *     so a different account can never inherit the frames, even on a later try.
 *   - STALENESS. A 401 that arrives after the runner cancelled (a stale generation) cannot re-arm
 *     the hold, and a hold older than the TTL never resumes.
 *
 * The module keeps its state at module level, so each test starts from `discardResumableAnalysis()`
 * — itself part of the public contract — which drops any hold left by the test before.
 */
import type { AnalyzeFormRequest } from '../analyze-form';
import {
  RESUME_HOLD_TTL_MS,
  currentResumeGeneration,
  discardResumableAnalysis,
  discardResumableAnalysisUnlessOwnedBy,
  hasResumableAnalysis,
  holdForResume,
  takeResumableAnalysis,
} from '../resumable-analysis';

const USER_A = 'user-a';
const USER_B = 'user-b';
const HELD_AT = new Date('2026-10-06T12:00:00.000Z').getTime();

function makeRequest(): AnalyzeFormRequest {
  return {
    mediaType: 'video',
    frames: ['QUFBQQ==', 'QkJCQg=='],
    timestamps: [0, 250],
    idempotencyKey: 'idem-key-1',
  };
}

function holdNow(request: AnalyzeFormRequest, userId: string, now: number = HELD_AT): void {
  holdForResume(request, userId, currentResumeGeneration(), now);
}

beforeEach(() => {
  discardResumableAnalysis();
});

describe('holdForResume / takeResumableAnalysis', () => {
  it('hands the same user back the very same request object, frames and key untouched', () => {
    const request = makeRequest();
    const frames = request.frames;
    holdNow(request, USER_A);

    const taken = takeResumableAnalysis(USER_A, HELD_AT + 1000);

    expect(taken).toBe(request);
    expect(taken?.frames).toBe(frames);
    expect(taken?.idempotencyKey).toBe('idem-key-1');
  });

  it('is one-shot: a second take by the same user gets nothing', () => {
    holdNow(makeRequest(), USER_A);

    expect(takeResumableAnalysis(USER_A, HELD_AT)).not.toBeNull();
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBeNull();
    expect(hasResumableAnalysis()).toBe(false);
  });

  it('returns null to a different user AND discards the hold, so the owner cannot take it later', () => {
    holdNow(makeRequest(), USER_A);

    expect(takeResumableAnalysis(USER_B, HELD_AT)).toBeNull();
    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBeNull();
  });

  it.each([null, undefined, ''])('returns null to no user (%p) and discards the hold', (noUser) => {
    holdNow(makeRequest(), USER_A);

    expect(takeResumableAnalysis(noUser, HELD_AT)).toBeNull();
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBeNull();
  });

  it('refuses a hold with an empty user id', () => {
    holdNow(makeRequest(), '');

    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis('', HELD_AT)).toBeNull();
  });

  it('refuses a late hold from an attempt the runner walked away from (stale generation)', () => {
    // The attempt starts and reads its generation...
    const attemptGeneration = currentResumeGeneration();
    // ...the runner taps Cancel...
    discardResumableAnalysis();
    // ...and only then does the 401 arrive and try to hold.
    holdForResume(makeRequest(), USER_A, attemptGeneration, HELD_AT);

    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBeNull();
  });

  it('replaces an earlier hold with a later one', () => {
    const first = makeRequest();
    const second = { ...makeRequest(), idempotencyKey: 'idem-key-2' };
    holdNow(first, USER_A);
    holdNow(second, USER_A);

    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBe(second);
  });
});

describe('the hold TTL', () => {
  it('still resumes at exactly the TTL', () => {
    const request = makeRequest();
    holdNow(request, USER_A);

    expect(takeResumableAnalysis(USER_A, HELD_AT + RESUME_HOLD_TTL_MS)).toBe(request);
  });

  it('never resumes a hold older than the TTL, and drops it', () => {
    holdNow(makeRequest(), USER_A);

    expect(takeResumableAnalysis(USER_A, HELD_AT + RESUME_HOLD_TTL_MS + 1)).toBeNull();
    expect(hasResumableAnalysis()).toBe(false);
  });
});

describe('discardResumableAnalysisUnlessOwnedBy', () => {
  it("keeps the incoming user's own hold for Home to take", () => {
    const request = makeRequest();
    holdNow(request, USER_A);

    discardResumableAnalysisUnlessOwnedBy(USER_A);

    expect(hasResumableAnalysis()).toBe(true);
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBe(request);
  });

  it("drops another account's hold the moment a different user appears", () => {
    holdNow(makeRequest(), USER_A);

    discardResumableAnalysisUnlessOwnedBy(USER_B);

    expect(hasResumableAnalysis()).toBe(false);
    expect(takeResumableAnalysis(USER_A, HELD_AT)).toBeNull();
  });

  it('is a no-op with nothing held', () => {
    const before = currentResumeGeneration();
    discardResumableAnalysisUnlessOwnedBy(USER_B);
    expect(hasResumableAnalysis()).toBe(false);
    expect(currentResumeGeneration()).toBe(before);
  });
});

describe('hasResumableAnalysis', () => {
  it('reflects whether frames are being kept', () => {
    expect(hasResumableAnalysis()).toBe(false);
    holdNow(makeRequest(), USER_A);
    expect(hasResumableAnalysis()).toBe(true);
    discardResumableAnalysis();
    expect(hasResumableAnalysis()).toBe(false);
  });
});
