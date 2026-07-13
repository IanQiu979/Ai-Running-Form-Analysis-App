/**
 * Structured logging for the edge functions (issue #85 — "a failed analyze-form call would be
 * invisible in TestFlight").
 *
 * ═══ THE DECISION THIS FILE IS THE OUTCOME OF ══════════════════════════════════════════════════
 *
 * `docs/app-store-privacy-labels.md` and `docs/privacy-checklist-m7.md` both assert "no analytics
 * or crash SDK is present" as the reason no "Tracking" label and no ATT prompt are required. That
 * claim is about the CLIENT bundle. This file changes nothing there: it is server-side only, runs
 * inside `supabase/functions/`, ships in no app binary, adds no dependency, and needs no privacy-
 * label change. It is deliberately NOT a Sentry/crash-SDK integration — a client SDK is a
 * different decision, with a real privacy-label and consent cost, and belongs to Ian, not to this
 * issue (see issue #85's own steer: "if you conclude a client SDK is genuinely necessary, STOP and
 * write up the recommendation instead of installing it"). This module is the alternative that was
 * chosen instead: structured logs any edge function can emit, readable with Supabase's `get_logs`,
 * with redaction enforced at the boundary rather than left to each call site's discipline.
 *
 * ═══ WHAT MAY NEVER REACH A LOG LINE, AND HOW THIS FILE ENFORCES IT ═══════════════════════════
 *
 * Per issue #85 and `docs/privacy-checklist-m7.md`'s data inventory:
 *   - Uploaded media (frames) and any storage path that names one (`{user_id}/{analysis_id}/
 *     frame-NN.jpg`) — these are images of a person's body (Ruling 1, `docs/mvp-build-prompt.md`).
 *   - Base64 payloads of any kind.
 *   - Signed Storage URLs.
 *   - Auth tokens (access/refresh/bearer/API keys).
 *   - Email addresses.
 *   - The `result` JSONB — GDPR Art. 9 health data at rest (injury-risk flags, posture
 *     descriptions; `docs/privacy-checklist-m7.md` line 16), never just "the output".
 *   - The dormant runner's-note free-text field (`knowledge/injury_flags.md`), if it is ever
 *     revived (`docs/app-store-privacy-labels.md`'s "runner's note" section) — health data
 *     supplied directly by the user, an even stricter case than the inferred flags above.
 *
 * `redact()` enforces this TWICE, independently, so a mistake in one layer does not leak:
 *   1. KEY DENYLIST (`FORBIDDEN_KEYS`) — an exact match (case/`_`/`-`-insensitive) on the field
 *      name redacts the value outright, whatever shape it is. Deliberately an EXACT match, not a
 *      substring match: `frameCount` and `framesUploaded` are legitimate integers this codebase
 *      already logs (`analyze-form/flow.ts`'s `AnalyzeFormLogEvent`) and must not be swallowed by
 *      a naive `key.includes('frame')`.
 *   2. VALUE PATTERN SCAN (`looksSensitive`) — every string, regardless of its key, is checked
 *      against shapes that are never legitimate in a log line: an email, a JWT/bearer-looking
 *      triple, a `data:` URI, the bucket's own `{uuid}/{uuid}/...` path shape, a signed-URL query
 *      string, or a long base64 blob. This is what catches a forbidden value under a key nobody
 *      thought to list.
 * Anything that survives both checks but is merely LONG is still truncated (`MAX_STRING_LENGTH`)
 * — a field this module has never heard of degrades to a clipped string, never a full payload.
 *
 * ═══ THE STANDING CONSTRAINT FROM `lib/hibp.ts` ════════════════════════════════════════════════
 *
 * `lib/hibp.ts`'s header (client-side, unrelated to this file) is non-negotiable, and repeated
 * here because "let's add observability" is exactly the kind of future task that could reach for
 * a client SDK instead of extending this one: if a client-side crash/error SDK (Sentry or similar)
 * is EVER added to the Expo app, it MUST configure `denyUrls`/`beforeBreadcrumb` to drop
 * `api.pwnedpasswords.com` requests. Without that, every outbound request URL to HIBP's range API
 * (which carries a 5-hex-character prefix of a candidate password's SHA-1 hash) becomes a
 * durable, identity-linked 20-bit fingerprint of the user's password sitting in crash-report
 * breadcrumbs tied to their account. This file cannot enforce that from here — it never runs on
 * the client — which is exactly why it is written down again at this other place.
 *
 * ═══ PORTABILITY ════════════════════════════════════════════════════════════════════════════════
 *
 * Zero `npm:`/Deno-only imports, same discipline as `ai-guard.ts` / `ai-pricing.ts` / `pace.ts` —
 * unit-testable under Jest (`_shared/__tests__/log.test.ts`, listed in `deno.json`'s `exclude` the
 * same way `ai-guard.test.ts` / `ai-pricing.test.ts` / `pace.test.ts` already are) even though the
 * edge functions that call it at runtime run under Deno. Uses only `console.*`, `JSON`, and the
 * Web Crypto global (`crypto.randomUUID`, `crypto.subtle.digest`) — all present, unimported, in
 * both Deno and Node 18+.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured payload for one log line. Only `level`/`fn`/`event`/`requestId` are meaningfully
 * required; everything else — including every field beyond the ones named below — is walked by
 * `redact()` before it is ever serialized, so an unexpected extra field degrades to `'[redacted]'`
 * or a truncated string rather than leaking.
 */
export interface LogFields {
  level: LogLevel;
  /** The edge function name (`'analyze-form'`, `'quota-status'`, ...) — never the wire route. */
  fn: string;
  /** A short, greppable event name (`'ai_gate_denied'`, `'retry_gated_out'`, ...), not a sentence
   * — this is the field ops filters on in `get_logs`, so keep it a stable enum-shaped string. */
  event: string;
  /** Correlates every log line emitted while handling ONE request. Mint one with `newRequestId()`
   * per invocation and thread it through every call for that request. */
  requestId: string;
  /** MUST be the output of `hashUserId()`, or `null`/omitted — never a raw `auth.uid`, an email,
   * or any other directly-identifying value. `redact()` cannot verify this on its own (a hash and
   * a raw UUID are both plain strings that don't match `looksSensitive`), which is why this is a
   * documented call-site contract, not just a runtime check — see `hashUserId()`'s own comment for
   * why hashing it is worth doing even though a UUID is already opaque. */
  userId?: string | null;
  durationMs?: number;
  outcome?: string;
  /** `err.name` / `err.constructor.name` ONLY — see `errorClassOf()`. Never `err.message`: a
   * provider or Postgres error string is free text this file cannot prove is clean. */
  errorClass?: string;
  [key: string]: unknown;
}

const REDACTED = '[redacted]';

/** Maximum characters a single string value may contribute to a log line before being clipped.
 * Generous enough for a short error class or a stop-reason list, far short of what a base64 frame
 * or a `result` JSONB dump would need — so even a field this module has never heard of degrades to
 * a stub instead of a payload. */
const MAX_STRING_LENGTH = 500;

/**
 * Exact-match (after lowercasing and stripping `_`/`-`) denylist of field names that are ALWAYS
 * redacted, regardless of the value's shape — deliberately NOT a substring match. `frameCount` and
 * `framesUploaded` (both already-shipped integers in `analyze-form/flow.ts`'s `AnalyzeFormLogEvent`)
 * must survive untouched, so `'frame'`/`'media'` alone are never enough to trigger this on their own.
 */
const FORBIDDEN_KEYS = new Set([
  // Frame content / media (Ruling 1 — extracted frames are images of a person's body).
  'frame',
  'frames',
  'framebytes',
  'framecontent',
  'mediapath',
  'mediapaths',
  'bytes',
  // Encodings that, in this app, only ever carry frame content or similarly large payloads.
  'base64',
  // Storage access.
  'signedurl',
  'signedurls',
  'objecturl',
  // Auth material.
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'authtoken',
  'apikey',
  'jwt',
  'bearer',
  'password',
  // Identity.
  'email',
  'emailaddress',
  // Health data at rest (GDPR Art. 9) — `docs/privacy-checklist-m7.md`'s data inventory.
  'result',
  'paceresult',
  // The request body (may embed any of the above) and the dormant free-text health note
  // (`docs/app-store-privacy-labels.md`'s "runner's note" section — dropped for MVP, not deleted).
  'rawbody',
  'body',
  'requestbody',
  'note',
  'runnersnote',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(normalizeKey(key));
}

// ── Value-shape scan — defense in depth for a forbidden value under a key this file has never
// heard of. Independent of the key denylist above; either one redacting is enough. ─────────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const JWT_RE = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
const BEARER_RE = /^Bearer\s+\S+/i;
const DATA_URI_RE = /^data:/i;
// The bucket's own layout (`{user_id}/{analysis_id}/frame-NN.ext` — CLAUDE.md "Secrets & env").
const STORAGE_PATH_RE = /^[0-9a-f-]{20,}\/[0-9a-f-]{10,}\//i;
const SIGNED_URL_RE = /\/storage\/v1\/object\/sign\/|[?&]token=/i;
// A frame is thousands of characters of base64 (`lib/frames.ts` emits JPEG at q≈0.7); a stray
// short base64-looking token is not what this is guarding against, so the length floor matters as
// much as the charset check — matches the same shape `analyze-form/flow.ts`'s own `BASE64_RE`
// validates request frames against, just with a length floor added.
const BASE64_BLOB_RE = /^[A-Za-z0-9+/]{200,}={0,2}$/;

function looksSensitive(value: string): boolean {
  return (
    EMAIL_RE.test(value) ||
    JWT_RE.test(value) ||
    BEARER_RE.test(value) ||
    DATA_URI_RE.test(value) ||
    STORAGE_PATH_RE.test(value) ||
    SIGNED_URL_RE.test(value) ||
    BASE64_BLOB_RE.test(value)
  );
}

function redactString(value: string): string {
  if (looksSensitive(value)) {
    return REDACTED;
  }
  if (value.length > MAX_STRING_LENGTH) {
    return `${value.slice(0, MAX_STRING_LENGTH)}…[truncated ${value.length - MAX_STRING_LENGTH} chars]`;
  }
  return value;
}

/**
 * Recursively redacts a value for logging. Exported directly (not just through `logEvent()`) so
 * `_shared/__tests__/log.test.ts` can assert on it without parsing a serialized log line — proving
 * this function redacts the forbidden fields is the load-bearing test for issue #85, not the happy
 * path of a log line getting written at all.
 *
 * `keyHint` is the field name this value was found under, used ONLY for the exact-match denylist
 * (`isForbiddenKey`); the value-pattern scan (`looksSensitive`) runs on every string regardless of
 * key, which is what catches a forbidden value under a key nobody thought to list.
 */
export function redact(value: unknown, keyHint?: string): unknown {
  if (keyHint !== undefined && isForbiddenKey(keyHint)) {
    // A forbidden key redacts any STRING/ARRAY/OBJECT value outright — a base64 string, an array
    // of frames, or a nested `result` object — without inspecting it further. Numbers/booleans
    // under a forbidden-sounding key are not the content this rule exists to catch (there is no
    // legitimate case in this app today, but a future `frameHash` counter is not implausible) —
    // pass them through rather than hide a harmless integer.
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    return REDACTED;
  }

  if (typeof value === 'string') {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, keyHint));
  }

  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redact(v, k);
    }
    return out;
  }

  // number / boolean / null / undefined — never the content this file exists to catch.
  return value;
}

/**
 * A short, one-way, per-user pseudonym for log lines ONLY (issue #85's "user id ONLY if hashed/
 * opaque"). `auth.uid` is already an opaque UUID — this hash adds no cryptographic security a
 * determined party couldn't get by reading the same DB rows the raw id already unlocks — but it
 * decouples "the identifier appearing in Supabase's log explorer" from "the identifier that
 * unlocks `analyses`/`consents`/`storage.objects` rows", which is the actual property this issue
 * asks for: someone with log access alone cannot correlate a user to those rows without also
 * knowing this happens to be `sha256(uid)`. Deterministic (same input -> same output) ON PURPOSE —
 * that is what lets ops correlate "this user's last three analyze-form calls all failed" from log
 * lines alone, which is the entire point of issue #85.
 *
 * Never throws: `crypto.subtle` is a Web Crypto global present in both Deno (runtime) and Node 18+
 * (Jest), but a digest failure must degrade the log line, never crash the request it is describing
 * — the same "observability can't break what it observes" rule `analyze-form/flow.ts`'s `finally`
 * block already follows for its own log sink.
 */
export async function hashUserId(userId: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(userId);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    // 16 hex chars = 64 bits — collision risk is irrelevant at this app's log volume, and short
    // enough to visibly read as a pseudonym, not a certificate.
    return `u_${hex.slice(0, 16)}`;
  } catch {
    return 'u_unknown';
  }
}

/** One request id per edge-function invocation — mint it once, thread it through every log line
 * for that request so they can be correlated in `get_logs`. `crypto.randomUUID()` is a Web Crypto
 * global; no import needed. */
export function newRequestId(): string {
  return crypto.randomUUID();
}

/**
 * The error's CLASS (`err.constructor.name`, falling back to `err.name`) ONLY — never
 * `err.message`. A caught error's message is free text from Postgres, Anthropic, or the Deno
 * runtime itself, and this file cannot prove it is clean; its class (`TypeError`,
 * `UnknownModelError`, `AbortError`, ...) is safe by construction and is almost always enough to
 * tell a bug from an outage. `constructor.name` is checked FIRST, not `err.name`: a custom
 * subclass (e.g. `ai-pricing.ts`'s `UnknownModelError`) that forgets to set `this.name` in its
 * constructor still inherits the generic `'Error'` for `err.name`, while `constructor.name`
 * always reflects the real class — strictly more informative, never less.
 */
export function errorClassOf(err: unknown): string {
  if (err instanceof Error) {
    return err.constructor?.name || err.name || 'Error';
  }
  if (err === null) {
    return 'null';
  }
  return typeof err;
}

/**
 * Serializes one structured log line, after `redact()`, to the level-appropriate `console.*`
 * method — `error`/`warn` route to `console.error`/`console.warn` so Supabase's log explorer can
 * filter by severity without parsing the JSON body; everything else goes to `console.log`. Always
 * ONE line of JSON (`JSON.stringify`, no pretty-printing), so `get_logs` can query fields directly
 * instead of regexing prose (CLAUDE.md's "machine-greppable" requirement).
 *
 * Never throws — the same rule `analyze-form/flow.ts`'s `finally` block already applies to its own
 * log sink: a logging call must never be able to break the request it is describing.
 */
export function logEvent(fields: LogFields): void {
  try {
    const safe = redact(fields) as Record<string, unknown>;
    const line = JSON.stringify(safe);
    if (fields.level === 'error') {
      console.error(line);
    } else if (fields.level === 'warn') {
      console.warn(line);
    } else {
      console.log(line);
    }
  } catch {
    // A circular structure, or a JSON.stringify throw from a stray BigInt in an extra field, must
    // not take the request down with it.
    console.error(JSON.stringify({ level: 'error', event: 'log_sink_failed' }));
  }
}

/**
 * Ergonomic per-request binding: `fn`/`requestId`/`userId` set once, so a call site reads as
 * `logger.warn('ai_gate_denied', { outcome, reason })` instead of repeating the same three fields
 * on every call. Purely a convenience wrapper over `logEvent()` — `redact()` still runs on every
 * call, and `fields` is walked exactly the same way `logEvent()`'s own extra fields are.
 */
export interface Logger {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
}

export function createLogger(fn: string, requestId: string, userId?: string | null): Logger {
  const emit =
    (level: LogLevel) =>
    (event: string, fields: Record<string, unknown> = {}): void => {
      logEvent({ level, fn, event, requestId, userId: userId ?? null, ...fields });
    };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
  };
}
