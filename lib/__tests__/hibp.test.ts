/**
 * Regression locks for `lib/hibp.ts` (issue #70).
 *
 * These are not coverage padding. `checkPasswordBreached` has several ways to ship
 * "passing but inert" — silently reporting `safe` for every password forever while every
 * lint/typecheck/happy-path smoke test stays green. Each REQUIRED case below pins down one
 * specific way that can happen:
 *
 *   - expo-crypto returns a LOWERCASE hex digest (real behavior); HIBP's range rows are
 *     UPPERCASE. A case-mismatch here is a silent, permanent no-op (case 1).
 *   - A captive portal / Cloudflare challenge returns HTTP 200 with an HTML body. Falling
 *     through to `safe` here means reporting a breached password as clean (case 2).
 *   - HIBP's response uses CRLF line endings, and the implementation guards that two ways:
 *     splitting on `\r?\n` AND trimming each line. Because of the second guard, this suite's
 *     CRLF fixture does NOT by itself prove the split is CRLF-aware — a `\n`-only split would
 *     still pass this test too, since `rawLine.trim()` strips the trailing `\r` regardless of
 *     which one produced it. What case 3 actually locks is the end-to-end outcome (a real,
 *     CRLF-delimited HIBP body parses and the match is found), not the split regex in
 *     isolation.
 *   - `Add-Padding: true` decoy rows carry count 0 and must never be treated as a match
 *     (case 6).
 *   - The full plaintext password must never appear anywhere in the outbound request — only
 *     the 5-char prefix. This is the test that actually proves k-anonymity holds (case 13).
 *
 * Verified test vector (confirmed via `shasum`):
 *   SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
 *   prefix "5BAA6", suffix "1E4C9B93F3F0682250B6CF8331B7EE68FD8"
 */

import { digestStringAsync } from 'expo-crypto';

import { checkPasswordBreached } from '../hibp';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA1: 'SHA-1' },
  digestStringAsync: jest.fn(),
}));

const mockDigestStringAsync = digestStringAsync as jest.MockedFunction<typeof digestStringAsync>;

// "password" → SHA-1 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 (confirmed via shasum).
const PASSWORD = 'password';
const FULL_HASH_UPPER = '5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8';
const FULL_HASH_LOWER = FULL_HASH_UPPER.toLowerCase();
const PREFIX = '5BAA6';
const SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';
const BREACH_COUNT = 3861493;

// Decoy 35-char hex suffixes, distinct from SUFFIX, standing in for the rows
// `Add-Padding: true` asks HIBP to mix into every response.
const PADDING_SUFFIXES = [
  '12301B97050B05BFCC982583A5FD9648720',
  'B1D75C62941C4E4E989B2AD9CBF4DE33527',
  '718B94FC65A717919544D1696D45DF725A9',
];

/**
 * Builds a real-shape HIBP range response body: UPPERCASE hex, **CRLF** line endings, and a
 * mix of count-0 padding rows. A fixture built with lowercase hex would let a broken
 * implementation (missing the uppercase normalization) pass. Note the CRLF line endings alone
 * do NOT isolate a missing `\r?\n` split, since `rawLine.trim()` strips a trailing `\r`
 * either way — see the suite docblock above.
 */
function buildRangeBody(options: { includeMatch?: boolean; matchCount?: number } = {}): string {
  const { includeMatch = true, matchCount = BREACH_COUNT } = options;
  const rows = [
    `${PADDING_SUFFIXES[0]}:0`,
    ...(includeMatch ? [`${SUFFIX}:${matchCount}`] : []),
    `${PADDING_SUFFIXES[1]}:0`,
    `${PADDING_SUFFIXES[2]}:0`,
  ];
  return rows.join('\r\n') + '\r\n';
}

function mockFetchResolvedResponse(options: {
  status?: number;
  body?: string;
  contentType?: string | null;
}): void {
  const { status = 200, body = '', contentType = 'text/plain' } = options;
  const response = {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    text: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
  (global.fetch as jest.Mock).mockResolvedValueOnce(response);
}

describe('checkPasswordBreached', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
    // Default: expo-crypto's real behavior is LOWERCASE hex output. Any test that needs a
    // different digest overrides this.
    mockDigestStringAsync.mockResolvedValue(FULL_HASH_LOWER);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reports breached when expo-crypto returns a lowercase digest (real device behavior)', async () => {
    // expo-crypto genuinely returns lowercase hex; if the implementation ever drops its
    // uppercase normalization, the suffix compare silently mismatches forever and this
    // password (and every other one) is reported `safe` no matter how breached it is.
    mockDigestStringAsync.mockResolvedValue(FULL_HASH_LOWER);
    mockFetchResolvedResponse({ body: buildRangeBody() });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'breached', count: BREACH_COUNT });
  });

  it.each([
    ['an empty string', ''],
    ['a base64-looking string', 'WWpQnHi4nAcQfxlZBaTV+2WztgY='],
  ])(
    'returns unavailable and never calls fetch when digestStringAsync resolves to %s',
    async (_label, digest) => {
      // The tripwire for "expo-crypto changed its output encoding": if digestStringAsync ever
      // stopped returning 40-char hex (e.g. switched to base64, or started returning ''), the
      // FULL_HASH_PATTERN guard must catch it before a prefix is ever sliced off and sent —
      // deleting that guard would keep every other test in this file green.
      mockDigestStringAsync.mockResolvedValue(digest);

      const result = await checkPasswordBreached(PASSWORD);

      expect(result).toEqual({ status: 'unavailable' });
      expect(global.fetch).not.toHaveBeenCalled();
    }
  );

  it('returns unavailable, not safe, on HTTP 200 with an HTML body (captive portal / challenge)', async () => {
    // A non-2xx check alone does NOT catch this: the response is 200 OK but its body is a
    // captive-portal or Cloudflare-challenge HTML page, not real range data. Falling through
    // to `safe` here would report a possibly-breached password as clean.
    mockFetchResolvedResponse({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body>Sign in to the network</body></html>',
    });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('parses a CRLF-delimited response body and finds the match (case 3)', async () => {
    const body = buildRangeBody();
    expect(body).toContain('\r\n');
    expect(body).not.toMatch(/[^\r]\n/); // sanity: every \n is preceded by \r, no bare \n rows
    mockFetchResolvedResponse({ body });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'breached', count: BREACH_COUNT });
  });

  it('returns breached with the correct count when the suffix is present with count > 0', async () => {
    mockFetchResolvedResponse({ body: buildRangeBody({ matchCount: 42 }) });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'breached', count: 42 });
  });

  it('returns safe when the suffix is absent from an otherwise well-formed range response', async () => {
    mockFetchResolvedResponse({ body: buildRangeBody({ includeMatch: false }) });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'safe' });
  });

  it('never treats a count-0 padding row as a match, even when its suffix is the real one', async () => {
    // If `Add-Padding: true` ever mixed a padding row using the *real* matching suffix, a
    // naive "first row wins" implementation could report `safe` for a breached password. The
    // count must gate the match, not just the suffix.
    mockFetchResolvedResponse({ body: buildRangeBody({ matchCount: 0 }) });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'safe' });
  });

  it.each([500, 429])('returns unavailable on a non-2xx response (HTTP %d)', async (status) => {
    // The body is a genuinely well-formed, matching range response — the ONLY thing wrong is
    // the status code. That isolates this test from the "zero parseable rows" fallback (case
    // 12): an unparseable error body would return `unavailable` even if the `response.ok`
    // check were dropped entirely, so it wouldn't actually prove the status check exists.
    mockFetchResolvedResponse({ status, body: buildRangeBody() });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
    // A non-2xx is never retried — only a network failure/abort is. Only one mock response is
    // queued above; if this were ever 2, an accidental retry-on-non-2xx would silently consume
    // it and this assertion is what would catch that regression.
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable when fetch rejects with a network error', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('returns unavailable when the request times out and is aborted, without retrying', async () => {
    jest.useFakeTimers();
    // Simulate a fetch that never resolves on its own, and only rejects once the shared
    // AbortController's deadline fires — the real behavior of a hung request.
    (global.fetch as jest.Mock).mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        })
    );

    const resultPromise = checkPasswordBreached(PASSWORD);
    // One shared 4s deadline covers both the attempt and the (skipped) retry — not a fresh
    // 3s timeout per attempt. By the time it fires, the signal is already aborted, so the
    // retry-eligibility check (`!controller.signal.aborted`) correctly declines to retry.
    await jest.advanceTimersByTimeAsync(4000);
    const result = await resultPromise;

    expect(result).toEqual({ status: 'unavailable' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once after a failed attempt and still returns the correct result', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new TypeError('Network request failed'));
    mockFetchResolvedResponse({ body: buildRangeBody() });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'breached', count: BREACH_COUNT });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns unavailable when the content-type is not text/plain', async () => {
    // The body here is otherwise a perfectly well-formed, matching range response — the ONLY
    // thing wrong with it is the content-type. That isolates this test from the "zero
    // parseable rows" fallback (case 12): if the content-type gate were ever dropped, this
    // exact body would parse fine and wrongly return `breached`, not `unavailable`.
    mockFetchResolvedResponse({
      contentType: 'application/json',
      body: buildRangeBody(),
    });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('does not retry a bad content-type response, even though a retry is queued', async () => {
    // A second, well-formed mock response is queued below. If a wrong-content-type response
    // were ever (wrongly) retried, this test would flip to `breached` and fail — proving the
    // retry really is gated to network-failure/abort only, not "any unusable response".
    mockFetchResolvedResponse({ contentType: 'application/json', body: buildRangeBody() });
    mockFetchResolvedResponse({ body: buildRangeBody() });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns unavailable, not safe, when a text/plain body has zero parseable rows', async () => {
    mockFetchResolvedResponse({ contentType: 'text/plain', body: '' });

    const result = await checkPasswordBreached(PASSWORD);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('sends only the 5-char hash prefix in the request URL — never the suffix, full hash, or password', async () => {
    mockFetchResolvedResponse({ body: buildRangeBody() });

    await checkPasswordBreached(PASSWORD);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(typeof url).toBe('string');

    // Inspect only the URL's path, not the full string: the real HIBP hostname
    // ("pwnedpasswords.com") incidentally contains the substring "password", which would
    // make a naive `urlString.includes(PASSWORD)` check false-positive on every request
    // regardless of what this function actually sends. The path is what actually carries
    // the k-anonymity payload, so that's what has to be proven minimal.
    const { pathname } = new URL(url);
    const rangeParam = pathname.split('/').filter(Boolean).pop();

    expect(rangeParam).toBe(PREFIX);
    expect(rangeParam).toHaveLength(5);
    expect(pathname).not.toContain(SUFFIX);
    expect(pathname).not.toContain(FULL_HASH_UPPER);
    expect(pathname).not.toContain(FULL_HASH_LOWER);
    expect(pathname.toLowerCase()).not.toContain(PASSWORD);

    // Belt-and-suspenders: the plaintext password, the full hash, and the suffix must not
    // appear anywhere in the request init (headers, signal, etc.) either — the prefix in the
    // URL path is the only thing this function is allowed to send.
    const initSerialized = JSON.stringify(init);
    expect(initSerialized.toLowerCase()).not.toContain(PASSWORD);
    expect(initSerialized.toUpperCase()).not.toContain(SUFFIX);
    expect(initSerialized.toUpperCase()).not.toContain(FULL_HASH_UPPER);
  });

  it('requests with GET and the Add-Padding header, so response size cannot leak the match count', async () => {
    mockFetchResolvedResponse({ body: buildRangeBody() });

    await checkPasswordBreached(PASSWORD);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Add-Padding']).toBe('true');
  });
});
