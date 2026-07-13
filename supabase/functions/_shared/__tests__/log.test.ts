/**
 * Regression lock for `log.ts` (issue #85). THIS is the load-bearing suite, not a happy-path
 * "does it print JSON" check: it proves the forbidden fields listed in the issue — frame content,
 * media/storage paths, base64 payloads, signed URLs, auth tokens, email addresses, and the
 * `result` JSONB (health data) — never survive `redact()` / `logEvent()`, including when they show
 * up under a key nobody thought to denylist. Jest-only (`.test.ts`, not `.deno.test.ts`) — listed
 * in `../../deno.json`'s `exclude`, same pattern as `ai-guard.test.ts` / `ai-pricing.test.ts` /
 * `pace.test.ts`.
 */
import {
  createLogger,
  errorClassOf,
  hashUserId,
  logEvent,
  newRequestId,
  redact,
  type LogFields,
} from '../log';

// A realistic base64 JPEG-ish blob — long enough to trip the length-floored base64 pattern, the
// same shape `lib/frames.ts` actually emits for a frame.
const FAKE_FRAME_BASE64 = 'A'.repeat(400) + '==';
const FAKE_USER_ID = '11111111-1111-4111-8111-111111111111';
const FAKE_ANALYSIS_ID = '22222222-2222-4222-8222-222222222222';
const FAKE_MEDIA_PATH = `${FAKE_USER_ID}/${FAKE_ANALYSIS_ID}/frame-01.jpg`;
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36P';
const FAKE_EMAIL = 'runner@example.com';
const FAKE_SIGNED_URL =
  'https://vputdomdlknvthnzritt.supabase.co/storage/v1/object/sign/media/11111111/frame-01.jpg?token=abc123def456';

describe('redact — the forbidden fields never survive', () => {
  it('redacts frame content under known keys (frames, frame, base64)', () => {
    const out = redact({ frames: [FAKE_FRAME_BASE64, FAKE_FRAME_BASE64] }) as Record<string, unknown>;
    expect(out.frames).toBe('[redacted]');
  });

  it('redacts media/storage paths under known keys (mediaPaths, media_paths)', () => {
    const camel = redact({ mediaPaths: [FAKE_MEDIA_PATH] }) as Record<string, unknown>;
    const snake = redact({ media_paths: [FAKE_MEDIA_PATH] }) as Record<string, unknown>;
    expect(camel.mediaPaths).toBe('[redacted]');
    expect(snake.media_paths).toBe('[redacted]');
  });

  it('redacts the result JSONB (health data) under "result"', () => {
    const out = redact({
      result: { pillars: { posture: { score: 72 } }, injuryRiskFlags: ['achilles_tightness'] },
    }) as Record<string, unknown>;
    expect(out.result).toBe('[redacted]');
  });

  it('redacts auth tokens under every spelling this codebase uses', () => {
    const out = redact({
      token: 'secret',
      accessToken: 'secret',
      access_token: 'secret',
      refreshToken: 'secret',
      authorization: 'Bearer secret',
      apiKey: 'sk-ant-secret',
    }) as Record<string, unknown>;
    expect(out.token).toBe('[redacted]');
    expect(out.accessToken).toBe('[redacted]');
    expect(out.access_token).toBe('[redacted]');
    expect(out.refreshToken).toBe('[redacted]');
    expect(out.authorization).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
  });

  it('redacts email addresses under "email"', () => {
    const out = redact({ email: FAKE_EMAIL }) as Record<string, unknown>;
    expect(out.email).toBe('[redacted]');
  });

  it('redacts the raw request body and the dormant free-text health note', () => {
    const out = redact({
      rawBody: { frames: ['x'], mediaType: 'video' },
      note: 'Achilles has been tight for two weeks, I am 54.',
    }) as Record<string, unknown>;
    expect(out.rawBody).toBe('[redacted]');
    expect(out.note).toBe('[redacted]');
  });

  it('redacts forbidden fields nested arbitrarily deep, not just at the top level', () => {
    const out = redact({
      gate: { detail: { retry: { frames: [FAKE_FRAME_BASE64] } } },
    }) as any;
    expect(out.gate.detail.retry.frames).toBe('[redacted]');
  });

  it('redacts forbidden fields inside arrays of objects (one bad item does not spare the rest)', () => {
    const out = redact({
      attempts: [{ tier: 'pro' }, { tier: 'pro', result: { score: 90 } }],
    }) as any;
    expect(out.attempts[0].tier).toBe('pro');
    expect(out.attempts[1].result).toBe('[redacted]');
  });

  it('does NOT redact benign integer fields whose key merely contains "frame" — frameCount and framesUploaded must survive', () => {
    const out = redact({ frameCount: 8, framesUploaded: 3 }) as Record<string, unknown>;
    expect(out.frameCount).toBe(8);
    expect(out.framesUploaded).toBe(3);
  });

  it('does NOT redact mediaType — it is an enum ("photo"/"video"), not a path', () => {
    const out = redact({ mediaType: 'video' }) as Record<string, unknown>;
    expect(out.mediaType).toBe('video');
  });
});

describe('redact — value-pattern scan catches forbidden content under an UNLISTED key (defense in depth)', () => {
  it('catches an email under an arbitrary key', () => {
    const out = redact({ contact: FAKE_EMAIL }) as Record<string, unknown>;
    expect(out.contact).toBe('[redacted]');
  });

  it('catches a JWT-shaped string under an arbitrary key', () => {
    const out = redact({ someField: FAKE_JWT }) as Record<string, unknown>;
    expect(out.someField).toBe('[redacted]');
  });

  it('catches a "Bearer <token>" string under an arbitrary key', () => {
    const out = redact({ header: 'Bearer abc.def.ghi' }) as Record<string, unknown>;
    expect(out.header).toBe('[redacted]');
  });

  it('catches a data: URI under an arbitrary key', () => {
    const out = redact({ thumbnail: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }) as Record<string, unknown>;
    expect(out.thumbnail).toBe('[redacted]');
  });

  it('catches the bucket\'s {user_id}/{analysis_id}/... path shape under an arbitrary key', () => {
    const out = redact({ path: FAKE_MEDIA_PATH }) as Record<string, unknown>;
    expect(out.path).toBe('[redacted]');
  });

  it('catches a signed Storage URL under an arbitrary key', () => {
    const out = redact({ url: FAKE_SIGNED_URL }) as Record<string, unknown>;
    expect(out.url).toBe('[redacted]');
  });

  it('catches a long base64 blob under an arbitrary key', () => {
    const out = redact({ payload: FAKE_FRAME_BASE64 }) as Record<string, unknown>;
    expect(out.payload).toBe('[redacted]');
  });

  it('does NOT flag a short, ordinary opaque id string (no false-positive over-redaction)', () => {
    const out = redact({ analysisId: FAKE_ANALYSIS_ID, requestId: newRequestId() }) as Record<
      string,
      unknown
    >;
    expect(out.analysisId).toBe(FAKE_ANALYSIS_ID);
    expect(typeof out.requestId).toBe('string');
  });
});

describe('redact — length truncation as a last resort for fields nobody anticipated', () => {
  it('truncates an overly long benign string rather than leaking it whole', () => {
    const longButBenign = 'the model returned prose instead of a tool call. '.repeat(20); // ~1000 chars, not base64/email/etc
    const out = redact({ detail: longButBenign }) as Record<string, unknown>;
    expect(typeof out.detail).toBe('string');
    expect((out.detail as string).length).toBeLessThan(longButBenign.length);
    expect(out.detail as string).toMatch(/\[truncated \d+ chars\]$/);
  });

  it('leaves a short benign string untouched', () => {
    const out = redact({ outcome: 'success' }) as Record<string, unknown>;
    expect(out.outcome).toBe('success');
  });
});

describe('hashUserId', () => {
  it('is deterministic — the same user id always hashes to the same pseudonym', async () => {
    const a = await hashUserId(FAKE_USER_ID);
    const b = await hashUserId(FAKE_USER_ID);
    expect(a).toBe(b);
  });

  it('is opaque — the raw user id never appears in the output', async () => {
    const hash = await hashUserId(FAKE_USER_ID);
    expect(hash).not.toContain(FAKE_USER_ID);
    expect(hash).not.toBe(FAKE_USER_ID);
    expect(hash).toMatch(/^u_[0-9a-f]{16}$/);
  });

  it('differs across users (not a constant sentinel)', async () => {
    const a = await hashUserId(FAKE_USER_ID);
    const b = await hashUserId(FAKE_ANALYSIS_ID); // any other distinct string stands in for a 2nd user
    expect(a).not.toBe(b);
  });
});

describe('newRequestId', () => {
  it('mints a fresh, UUID-shaped id each call', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });
});

describe('errorClassOf', () => {
  it('returns the error name, never the message', () => {
    const err = new TypeError('the analysis id was 11111111-1111-4111-8111-111111111111');
    expect(errorClassOf(err)).toBe('TypeError');
  });

  it('falls back to the constructor name for a custom Error subclass', () => {
    class UnknownModelError extends Error {}
    expect(errorClassOf(new UnknownModelError('claude-nonexistent'))).toBe('UnknownModelError');
  });

  it('never throws and returns something sane for a non-Error value', () => {
    expect(errorClassOf('a plain string')).toBe('string');
    expect(errorClassOf(null)).toBe('null');
    expect(errorClassOf(undefined)).toBe('undefined');
  });
});

describe('logEvent — end-to-end: the serialized line never contains forbidden raw content', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('a realistic analyze-form failure payload never leaks frames, mediaPaths, result, tokens, or email in the emitted line', () => {
    const fields: LogFields = {
      level: 'error',
      fn: 'analyze-form',
      event: 'analyze_form_completed',
      requestId: newRequestId(),
      userId: 'u_deadbeefcafef00d',
      outcome: 'internal_error',
      errorClass: 'TypeError',
      durationMs: 4213,
      // The kind of accidental over-logging this test exists to catch — a future edit that widens
      // the log payload without reading this file's header first.
      frames: [FAKE_FRAME_BASE64],
      mediaPaths: [FAKE_MEDIA_PATH],
      result: { pillars: {}, injuryRiskFlags: ['sharp_pain'] },
      accessToken: 'super-secret-token',
      requesterEmail: FAKE_EMAIL, // an unlisted key — must be caught by the value scan, not the denylist
      rawSignedUrl: FAKE_SIGNED_URL,
    };

    logEvent(fields);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0][0] as string;

    // The line is well-formed JSON, not free text.
    expect(() => JSON.parse(line)).not.toThrow();

    // None of the forbidden raw content appears ANYWHERE in the serialized line.
    expect(line).not.toContain(FAKE_FRAME_BASE64);
    expect(line).not.toContain(FAKE_MEDIA_PATH);
    expect(line).not.toContain('super-secret-token');
    expect(line).not.toContain(FAKE_EMAIL);
    expect(line).not.toContain(FAKE_SIGNED_URL);
    expect(line).not.toContain('sharp_pain'); // buried inside `result`, which must be gone wholesale

    // The legitimate, safe fields survive.
    const parsed = JSON.parse(line);
    expect(parsed.fn).toBe('analyze-form');
    expect(parsed.event).toBe('analyze_form_completed');
    expect(parsed.outcome).toBe('internal_error');
    expect(parsed.errorClass).toBe('TypeError');
    expect(parsed.durationMs).toBe(4213);
    expect(parsed.userId).toBe('u_deadbeefcafef00d');
  });

  it('routes level:"error" to console.error, "warn" to console.warn, and others to console.log', () => {
    logEvent({ level: 'error', fn: 'x', event: 'e', requestId: 'r' });
    logEvent({ level: 'warn', fn: 'x', event: 'e', requestId: 'r' });
    logEvent({ level: 'info', fn: 'x', event: 'e', requestId: 'r' });
    logEvent({ level: 'debug', fn: 'x', event: 'e', requestId: 'r' });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it('never throws even if a field cannot be serialized (e.g. a BigInt)', () => {
    expect(() =>
      logEvent({
        level: 'info',
        fn: 'x',
        event: 'e',
        requestId: 'r',
        // @ts-expect-error — deliberately malformed input, proving the sink degrades instead of throwing.
        weird: 10n,
      })
    ).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1); // the log_sink_failed fallback line
  });
});

describe('createLogger — the bound convenience API redacts exactly like logEvent', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('binds fn/requestId/userId once and still redacts forbidden fields on every call', () => {
    const requestId = newRequestId();
    const logger = createLogger('quota-status', requestId, 'u_abc123');

    logger.error('quota_status_failed', {
      errorClass: 'PostgrestError',
      mediaPaths: [FAKE_MEDIA_PATH],
      email: FAKE_EMAIL,
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0] as string);
    expect(parsed.fn).toBe('quota-status');
    expect(parsed.requestId).toBe(requestId);
    expect(parsed.userId).toBe('u_abc123');
    expect(parsed.event).toBe('quota_status_failed');
    expect(parsed.mediaPaths).toBe('[redacted]');
    expect(parsed.email).toBe('[redacted]');
  });
});
