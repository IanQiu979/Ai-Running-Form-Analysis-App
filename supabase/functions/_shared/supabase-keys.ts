/**
 * Reads the Supabase API keys the platform injects into every edge function.
 *
 * ⚠️ THIS FILE EXISTS BECAUSE THE PREVIOUS PARSER WAS WRONG, IN TEN PLACES AT ONCE, AND IT TOOK
 * THE WHOLE AUTHENTICATED SURFACE OF THE APP DOWN (found 2026-07-26 while verifying issue #128).
 *
 * `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` hold a **JSON OBJECT KEYED BY KEY NAME**,
 * with the platform-created key under `"default"`:
 *
 *     SUPABASE_PUBLISHABLE_KEYS = {"default":"sb_publishable_..."}
 *     SUPABASE_SECRET_KEYS      = {"default":"sb_secret_..."}
 *
 * Verified two ways on 2026-07-26: against Supabase's own docs (the "Environment Variables" guide
 * and the new-API-keys migration guide both state it — *"The new ones hold a JSON object keyed by
 * name, so you parse them and read the key by name … is named `default`"*), and empirically, by
 * matching the SHA-256 digest the secrets API exposes for this project's
 * `SUPABASE_PUBLISHABLE_KEYS` against `JSON.stringify({default: <the project's publishable key>})`
 * — an exact match.
 *
 * THE BUG THIS REPLACES. Every caller had its own copy of:
 *
 *     const parsed = JSON.parse(raw);
 *     if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
 *       return parsed[0];
 *     }
 *     ...
 *     return raw;   // <-- an OBJECT is not an Array, so every call landed here
 *
 * The value parses fine, but it is an object, not an array — so the guard never matched and each
 * function fell through to `return raw`, handing the **entire JSON string**
 * `{"default":"sb_publishable_..."}` to `createClient()` as the API key. GoTrue rejects that as an
 * invalid `apikey`, so `auth.getUser()` returned an error, `resolveCallerUserId` threw, and every
 * request got a `401 unauthorized` — regardless of how valid the caller's JWT was. `quota-status`,
 * `analyze-form`, `purchase-tier`, and `delete-account` were all affected; edge logs showed
 * `quota-status` returning 401 on *every* invocation it had ever received. The service-role side
 * (`SUPABASE_SECRET_KEYS`) was broken identically, so even a request that got past auth would have
 * failed every `reserve_analysis`/`settle_analysis`/Storage call.
 *
 * WHY THIS IS SHARED NOW, REVERSING A DELIBERATE CHOICE. The previous copies each carried a note
 * explaining that a local copy "limits the blast radius of concurrent multi-agent work in
 * `_shared/`." That reasoning is hereby overruled by evidence: the duplication did not limit a
 * blast radius, it *multiplied* one — a single misreading of an env var format was written ten
 * times and had to be found ten times. Key parsing is platform contract, identical for every
 * caller by definition; it is exactly the kind of thing that belongs in one place. Add new
 * callers here, not another copy.
 */

/** Parses one `{"name":"key",...}` env var and returns the requested named key. */
function readNamedKey(envVar: string, keyName: string): string {
  const raw = Deno.env.get(envVar);
  if (!raw) {
    throw new Error(`${envVar} is not set in the edge function environment`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON at all — the legacy single-bare-key form. Use it as-is. This is still the shape
    // `supabase functions serve --env-file` produces for a hand-written local .env, so it is a
    // real case and not just defensive padding.
    return raw;
  }

  // The documented platform shape: a JSON object keyed by key name.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const dict = parsed as Record<string, unknown>;
    const named = dict[keyName];
    if (typeof named === 'string' && named.length > 0) {
      return named;
    }
    // The object exists but has no `default` (e.g. a project whose only key was renamed). Take the
    // first string value rather than failing — any valid key of this class beats none, and the
    // alternative is a total outage over a naming choice.
    for (const value of Object.values(dict)) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
    throw new Error(`${envVar} is a JSON object with no usable string key`);
  }

  // A JSON array of key strings — never observed on the platform, but it was what the old parser
  // expected, so it stays supported rather than becoming a new way to break.
  if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
    return parsed[0];
  }

  // Valid JSON of some other shape (a bare quoted string, a number, null). A quoted string is a
  // legitimate encoding of a single key; anything else is unusable and must fail loudly rather
  // than be handed to createClient() as a fake key — which is precisely the failure mode above.
  if (typeof parsed === 'string' && parsed.length > 0) {
    return parsed;
  }

  throw new Error(`${envVar} is set but is not a recognized key format`);
}

/** The platform's default key name — see this file's header. */
const DEFAULT_KEY_NAME = 'default';

/**
 * The publishable (anon-equivalent) key. Safe to use for a client that will carry an end user's
 * `Authorization` header — it grants nothing on its own and RLS still applies.
 */
export function getPublishableKey(): string {
  return readNamedKey('SUPABASE_PUBLISHABLE_KEYS', DEFAULT_KEY_NAME);
}

/**
 * The secret (service-role-equivalent) key. BYPASSES RLS — only ever for the service-role clients
 * that call the `service_role`-only RPCs (`reserve_analysis`, `settle_analysis`,
 * `release_analysis`, `gate_ai_call`, `record_ai_call`, …). Never send this to a client.
 */
export function getSecretKey(): string {
  return readNamedKey('SUPABASE_SECRET_KEYS', DEFAULT_KEY_NAME);
}

/** `SUPABASE_URL`, which the platform injects as a plain string. */
export function getSupabaseUrl(): string {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  return url;
}
