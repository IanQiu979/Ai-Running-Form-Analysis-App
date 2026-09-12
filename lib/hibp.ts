/**
 * Client-side HaveIBeenPwned leaked-password check (issue #70).
 *
 * **As of 2026-09-12 this is the ONLY compromised-password screening V2.3 has.** Supabase's
 * built-in server-side leaked-password protection (`password_hibp_enabled`, the same HIBP data)
 * was enabled on 2026-07-12 while the org was on the Pro plan, but the plan was cancelled on
 * 2026-09-12 and that feature is Pro-only, so it is now OFF and cannot be re-enabled on Free —
 * the security advisor's `auth_leaked_password_protection` lint is back and is expected. There
 * is nothing to configure server-side; the 422 `weak_password` / `reasons: ['pwned']` rejection
 * that `lib/auth-errors.ts`'s `mapAuthError` still maps to `Copy.auth.error.passwordBreached`
 * no longer fires. It stays mapped so that if the org ever returns to Pro and re-enables the
 * setting, the server path lights up again with no client change.
 *
 * So this check is no longer a courtesy pre-check ahead of an authoritative server rule; it is
 * the control of record — still bypassable by a hostile client (it runs on the device), but the
 * thing that stops an ordinary user from choosing a known-breached password. It gives instant
 * inline feedback on submit, before the `signUp` round-trip, and it
 * reimplements the check against HIBP's free, keyless Pwned Passwords **range API**, which is
 * built on k-anonymity: only the first 5 hex characters of the password's SHA-1 hash ever leave
 * the device. The plaintext password and the full 40-char hash never do. `Add-Padding: true`
 * asks the API to pad its response with decoy rows so response size can't be used to infer
 * the true match count via traffic analysis.
 *
 * NEVER call this on the sign-in path. On sign-up, the prefix describes a *candidate*
 * password that may be discarded (the account may never be created). On sign-in it would
 * describe the user's *actual, live* password, leaked to a third party alongside their IP
 * address on every single login. A future password-reset/change-password flow is fine to
 * wire this into (the new password is a candidate again, same as sign-up) but that must be a
 * conscious decision made at the call site, not an accident of this function being generic.
 *
 * This function handles a plaintext password, so three rules are non-negotiable:
 *   1. Never `console.*` anything in this file — crash SDKs (Sentry etc.) capture console
 *      breadcrumbs, and a hash prefix or timing detail logged here becomes a durable record.
 *   2. Never throw with context. Every path returns the `BreachCheck` union; every unexpected
 *      failure is caught and folded into `unavailable`. A thrown `Error` carrying any part of
 *      the hash would be one careless `err.message` log away from disclosure. (`mapAuthError` in
 *      `lib/auth-errors.ts` *reads* `err.message` to match against, but only ever returns fixed
 *      `Copy.auth.error.*` strings — it never surfaces the raw message. Keep it that way.)
 *   3. Never cache or memoize keyed by the plaintext password. A `Map<password, result>` (or
 *      any structure keyed the same way) would pin the plaintext in memory for the process
 *      lifetime, defeating the entire point of hashing it first.
 *
 * Operational note for later: if/when a crash SDK (e.g. Sentry) is added to this app, it MUST
 * configure `denyUrls` / `beforeBreadcrumb` to drop `api.pwnedpasswords.com` requests.
 * Without that, every outbound request URL (which contains the 5-char prefix plus the
 * `Add-Padding` response) becomes a durable, identity-linked 20-bit fingerprint of the user's
 * password, sitting in crash-report breadcrumbs tied to their account.
 *
 * This function fails open and never logs, which makes it silently unobservable in production
 * (issue #74). Its live-endpoint health is therefore watched from outside, by
 * `lib/__tests__/hibp.canary.test.ts` on a daily cron (`.github/workflows/hibp-canary.yml`):
 * that canary runs THIS function against the real range API and files an issue when it rots.
 * If you change this file's parsing, response handling, or the range-API URL, the canary is
 * what tells you whether it still works against the real thing.
 *
 * The one concession to observability is the `reason` on `unavailable`: a fixed string naming
 * WHICH fail-open path was taken (deadline, network, non-2xx, wrong content-type, unparseable
 * body, ...). It carries no status code, no header, no body fragment and nothing derived from
 * the password or its hash, so it is safe to surface anywhere. It exists because the 2026-09-05
 * canary outage produced a week of `unavailable` with no way to tell "HIBP changed" from "our
 * request never left the process" without instrumenting this file by hand — the canary now
 * prints it on failure, and a caller that ever grows telemetry may report it as-is.
 */
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';

/**
 * Why a check fell open. Every value is a fixed literal — never a status code, header, body
 * fragment, or anything derived from the password/hash — so it is safe to log or report.
 *   - `hash`: the digest was not a 40-char SHA-1 hex string (never reaches the network).
 *   - `timeout`: the shared deadline (`TOTAL_TIMEOUT_MS`) fired before a body was read.
 *   - `network`: `fetch` threw or the body read failed, on both attempts, before the deadline.
 *   - `bad-status`: HIBP (or whatever answered) returned a non-2xx status. Not retried.
 *   - `bad-content-type`: 2xx, but not `text/plain` — a captive portal or challenge page.
 *   - `unparseable`: `text/plain`, but not one well-formed range row in it.
 *   - `unexpected`: something threw outside the paths above (the catch-all).
 */
export type BreachCheckUnavailableReason =
  | 'hash'
  | 'timeout'
  | 'network'
  | 'bad-status'
  | 'bad-content-type'
  | 'unparseable'
  | 'unexpected';

export type BreachCheck =
  | { status: 'safe' }
  | { status: 'breached'; count: number }
  | { status: 'unavailable'; reason: BreachCheckUnavailableReason };

const RANGE_API_URL = 'https://api.pwnedpasswords.com/range/';
// One shared deadline for the whole check — both the initial attempt and its retry, and the
// body read of whichever attempt succeeds, not a fresh timeout per attempt. Two independent
// 3s-per-attempt timeouts would let the worst case reach 6s of blocking in front of the most
// conversion-critical action in the app; one 4s AbortController armed once bounds it at ~4s
// total instead.
const TOTAL_TIMEOUT_MS = 4000;
// Full 40-char uppercase SHA-1 hex. Asserting this (rather than trusting digestStringAsync's
// output shape blindly) also removes any injection surface from the URL path built below —
// only a string matching this pattern is ever interpolated into the fetch URL.
const FULL_HASH_PATTERN = /^[0-9A-F]{40}$/;
// A single well-formed range-response row: 35 hex chars (the hash suffix), a colon, a count.
const RANGE_ROW_PATTERN = /^[0-9A-F]{35}:\d+$/i;

// One attempt at the range request, including the body read. The outcome is a discriminated
// union rather than a boolean/null so the caller can tell apart the one retry-eligible case
// (the attempt never produced a usable response at all) from the two that must never be
// retried (a non-2xx or wrong-content-type response, which a retry would just get again).
type RangeFetch =
  | { outcome: 'network-failure' } // fetch threw, was aborted, or the body read failed
  | { outcome: 'bad-status' } // responded, but non-2xx — retrying is pointless
  | { outcome: 'bad-content-type' } // responded 2xx, but not text/plain — retrying is pointless
  | { outcome: 'body'; body: string };

async function fetchRangeAttempt(prefix: string, signal: AbortSignal): Promise<RangeFetch> {
  let response: Response;
  try {
    response = await fetch(`${RANGE_API_URL}${prefix}`, {
      method: 'GET',
      headers: { 'Add-Padding': 'true' },
      signal,
      // HIBP's response sets a `__cf_bm` Cloudflare bot-management cookie scoped to
      // `.pwnedpasswords.com`, and React Native's fetch uses the platform's shared cookie jar
      // by default. Without this, repeat lookups from this device would be correlatable by
      // Cloudflare via that cookie for ~30 min — irrelevant for a one-shot signup check today,
      // but this function is documented above as safe to reuse for a future password-change
      // flow, where repeat calls are the norm. Omitting credentials costs nothing now.
      credentials: 'omit',
    });
  } catch {
    // fetch() throws identically on a real network failure and on this attempt's AbortSignal
    // firing (shared-deadline timeout) — both mean "no response was ever produced" and are the
    // only outcome eligible for a retry.
    return { outcome: 'network-failure' };
  }

  if (!response.ok) {
    return { outcome: 'bad-status' };
  }

  // A captive portal or Cloudflare challenge can return HTTP 200 with an HTML body — that
  // is NOT caught by the non-2xx check above, and would parse to zero matching rows and
  // wrongly report `safe` for a possibly-breached password. Guard against it explicitly:
  // require a text/plain content-type before trusting the body at all.
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('text/plain')) {
    return { outcome: 'bad-content-type' };
  }

  try {
    // Read the whole body — never cap/chunk it, a truncated read could drop the matching row
    // and yield a false `safe`. This read shares the same AbortSignal as the fetch call above
    // (armed once, for the whole checkPasswordBreached call — see TOTAL_TIMEOUT_MS) rather
    // than being unguarded once headers arrive. Without that, a connection that stalls
    // mid-body would leave `response.text()` pending forever with no abort armed to unstick
    // it, which would leave the caller's `pendingAction` stuck and the sign-up screen
    // permanently spinning until the app is restarted.
    const body = await response.text();
    return { outcome: 'body', body };
  } catch {
    return { outcome: 'network-failure' };
  }
}

export async function checkPasswordBreached(password: string): Promise<BreachCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  try {
    // expo-crypto returns LOWERCASE hex; HIBP's range response rows are UPPERCASE. Uppercase
    // the full digest once, immediately, before any slicing — uppercasing only the prefix
    // (or only the suffix) is the classic half-fix that leaves the other half's comparison
    // case-mismatched and the check a permanent, silent no-op.
    const rawHash = await digestStringAsync(CryptoDigestAlgorithm.SHA1, password);
    const hash = rawHash.toUpperCase();
    if (!FULL_HASH_PATTERN.test(hash)) {
      return { status: 'unavailable', reason: 'hash' };
    }

    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5); // 35 chars

    // One attempt, then one retry — but ONLY when the first attempt never produced a response
    // at all (network failure or the shared deadline firing mid-attempt). A non-2xx or
    // wrong-content-type response is never retried: it's not going to change, and retrying it
    // would just burn the shared deadline for nothing. Once the deadline has already fired,
    // don't bother retrying either — the retry would abort immediately too.
    let attempt = await fetchRangeAttempt(prefix, controller.signal);
    if (attempt.outcome === 'network-failure' && !controller.signal.aborted) {
      attempt = await fetchRangeAttempt(prefix, controller.signal);
    }
    if (attempt.outcome === 'network-failure') {
      // `fetchRangeAttempt` deliberately cannot tell an abort from a socket error (see its
      // catch); the shared controller can, after the fact.
      return { status: 'unavailable', reason: controller.signal.aborted ? 'timeout' : 'network' };
    }
    if (attempt.outcome !== 'body') {
      return { status: 'unavailable', reason: attempt.outcome };
    }

    const lines = attempt.body.split(/\r?\n/);

    let sawParseableLine = false;
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') continue;
      if (!RANGE_ROW_PATTERN.test(line)) continue;
      sawParseableLine = true;

      const [lineSuffix, countStr] = line.split(':');
      // Full 35-char exact match. `RANGE_ROW_PATTERN` above already pins every parsed row's
      // suffix to exactly 35 hex chars, so an `includes` compare would behave identically to
      // this `!==` today — this exact compare is defence-in-depth, not the thing currently
      // stopping padding rows from false-positiving. It only becomes load-bearing if that
      // regex's `{35}` is ever loosened, at which point `includes` would let a shorter/longer
      // row's suffix falsely match `suffix` and hard-block a legitimate signup.
      if (lineSuffix.toUpperCase() !== suffix) continue;

      const count = Number(countStr);
      // Padding rows (from Add-Padding: true) come back with count 0 and must never count
      // as a match — they exist purely to defeat response-size traffic analysis.
      if (count > 0) {
        return { status: 'breached', count };
      }
    }

    // `safe` is a positive assertion, not a default: it is only returned once we've
    // positively parsed at least one well-formed range row and found no matching, non-padding
    // suffix among them. Zero parseable lines (e.g. an unexpected body shape that still
    // happened to claim text/plain) means the response was never actually verified as a real
    // range response, so it falls through to `unavailable` below rather than `safe`.
    if (sawParseableLine) {
      return { status: 'safe' };
    }
    return { status: 'unavailable', reason: 'unparseable' };
  } catch {
    // Catch-all: never let any failure here throw (see header note 2) — everything not
    // resolved to `safe`/`breached` above falls open to `unavailable`.
    return { status: 'unavailable', reason: 'unexpected' };
  } finally {
    // Only cleared once every attempt and the body read have settled — clearing it any
    // earlier (e.g. right after `fetch()` resolves, before the body is read) would leave the
    // body read unguarded by the timeout it's supposed to share. See TOTAL_TIMEOUT_MS above.
    clearTimeout(timer);
  }
}
