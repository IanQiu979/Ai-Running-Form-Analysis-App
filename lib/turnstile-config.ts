/**
 * Resolves the two values `components/turnstile-widget.tsx` needs before it can render a
 * Cloudflare Turnstile challenge: the site key, and the **base URL the challenge HTML is loaded
 * under**. Both are required; a site key on its own is not enough, and shipping one without the
 * other is exactly how sign-up was broken in production for the whole of #166's life.
 *
 * WHY A BASE URL IS NOT OPTIONAL. Turnstile widgets are hostname-bound: Cloudflare's own
 * Hostname Management docs state "every widget requires at least one hostname to be configured.
 * You cannot create a widget without specifying at least one authorized hostname", and there is
 * no way to turn that validation off. `challenges.cloudflare.com` checks the embedding page's
 * hostname against that list and refuses with error 110200 ("unknown domain") when it doesn't
 * match. A `react-native-webview` given `source={{ html }}` and nothing else loads that HTML
 * under `about:blank` (iOS) / a `null` origin (Android) — no hostname at all — so a **real**
 * production site key can never validate there. `source={{ html, baseUrl }}` is what gives the
 * page a hostname to be checked.
 *
 * WHY THIS WAS INVISIBLE UNTIL PRODUCTION. Cloudflare's *dummy* site keys (`1x00000000000000000000AA`
 * and friends, the ones `eas.json`'s `development-local`/`preview-local` profiles use) are
 * documented to "be used from any domain" — they bypass hostname validation entirely. So every
 * environment this project could actually run the widget in bypassed the check that a real key
 * would have failed, and #166's verification passed on a code path production never takes.
 *
 * WHICH HOSTNAME. `EXPO_PUBLIC_TURNSTILE_HOSTNAME` when set — that is the escape hatch for a
 * widget configured against a real product domain. When unset it falls back to the Supabase
 * project's own origin, which is guaranteed present (`lib/supabase.ts` throws without it), is a
 * real https hostname this project already owns, and therefore needs nothing more from the
 * operator than adding it to the widget's hostname list in Cloudflare. See `.env.example`.
 *
 * Pure and dependency-free on purpose — every value arrives as an argument so this is unit
 * testable without touching `process.env`, and so the one place that DOES read `process.env`
 * (`app/(auth)/sign-in.tsx`) keeps the static dot access the `expo/no-dynamic-env-var` rule
 * requires. See CLAUDE.md § Secrets & env.
 *
 * "Dependency-free" includes the global `URL`, which is why the origin is parsed here by hand.
 * React Native's built-in `URL` neither validates its input nor implements `origin`/`hostname`;
 * only `react-native-url-polyfill/auto` (side-effect imported by `lib/supabase.ts`) makes those
 * work, so parsing with `URL` here would silently depend on an unrelated module having been
 * imported first — and would degrade to "sign-up unavailable" with a perfectly valid key if that
 * import order ever changed. Jest could never catch it, since Node supplies a compliant `URL`.
 */

export interface TurnstileConfig {
  /** Cloudflare's public site key — safe to inline into the client bundle by design. */
  siteKey: string;
  /** The URL the challenge HTML is loaded under, e.g. `https://example.com/`. Its hostname MUST
   * appear in the widget's hostname list in the Cloudflare dashboard. */
  baseUrl: string;
}

function trimmedOrNull(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `scheme://authority`, where the authority runs up to the first `/`, `?` or `#`. */
const ABSOLUTE_URL = /^(https?):\/\/([^/?#]*)/i;
/** A host (name, IPv4, or bracketed IPv6) with an optional numeric port — deliberately strict,
 *  so `not a hostname at all` is rejected rather than smuggled through as a hostname. */
const HOST_AND_PORT = /^(?:[A-Za-z0-9._~-]+|\[[0-9A-Fa-f:.]+\])(?::\d+)?$/;

/**
 * The single parse in this file: an absolute `http(s)` URL in, its origin with a trailing slash
 * out, `null` for anything this can't turn into a real hostname. Both callers below go through
 * here, so there is one place that decides what a usable base URL is.
 */
function baseUrlFromAbsoluteUrl(value: string): string | null {
  const match = ABSOLUTE_URL.exec(value);
  if (match === null) return null;
  const authority = match[2];
  // Strip any `user:pass@` — the credentials are not part of the origin Cloudflare checks.
  const hostAndPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (!HOST_AND_PORT.test(hostAndPort)) return null;
  return `${match[1].toLowerCase()}://${hostAndPort.toLowerCase()}/`;
}

/**
 * Turns a configured hostname into a base URL. Accepts either a bare hostname
 * (`example.com`) or a full origin (`https://example.com`), because both are things an operator
 * plausibly pastes out of the Cloudflare dashboard, and silently producing `https://https://…`
 * from the second would fail in a way nothing surfaces. A bare hostname is assumed `https:` —
 * Turnstile is only served over TLS.
 */
function baseUrlFromHostname(hostname: string): string | null {
  const withScheme = /^https?:\/\//i.test(hostname) ? hostname : `https://${hostname}`;
  return baseUrlFromAbsoluteUrl(withScheme);
}

/**
 * The two ways this resolver can return `null` produce the SAME user-facing notice
 * (`copy.auth.signUp.unavailable`), which is correct for the reader and useless for whoever has
 * to fix it: a build shipped with no key at all and a build whose key is fine but whose hostname
 * was mistyped are indistinguishable on screen. That invisibility is the same class of failure
 * that hid the 110200 bug for the whole of #166, so each branch leaves a dev-only trail naming
 * which one it was.
 *
 * `__DEV__`-guarded because this is a diagnostic for the operator, not telemetry: a release
 * build stays silent. The site key value is NEVER logged — it is public by design, but a log
 * line is not where an operator should be reading it back from — only the *rejected hostname or
 * URL* is echoed, because that value is the thing being debugged.
 */
function warnUnusable(reason: string): void {
  if (!__DEV__) return;
  console.warn(`[turnstile] sign-up disabled: ${reason}`);
}

/**
 * Returns the config to render the widget with, or `null` when Turnstile is not usably
 * configured — which the caller must surface as an honest "sign-up unavailable" state rather
 * than a widget that can only ever fail. `null` is returned when the site key is missing (the
 * ordinary unconfigured build) AND when a site key is present but no hostname can be derived at
 * all, because a widget rendered with no base URL is a guaranteed 110200, not a maybe. Both
 * branches warn in dev only; the return contract is `null` either way.
 */
export function resolveTurnstileConfig(
  siteKey: string | undefined,
  hostname: string | undefined,
  supabaseUrl: string | undefined
): TurnstileConfig | null {
  const key = trimmedOrNull(siteKey);
  if (key === null) {
    warnUnusable('EXPO_PUBLIC_TURNSTILE_SITE_KEY is not set in this build.');
    return null;
  }

  const configuredHostname = trimmedOrNull(hostname);
  if (configuredHostname !== null) {
    const baseUrl = baseUrlFromHostname(configuredHostname);
    if (baseUrl === null) {
      warnUnusable(
        `a site key is set, but EXPO_PUBLIC_TURNSTILE_HOSTNAME is not a hostname or absolute https URL: ${JSON.stringify(configuredHostname)}. Cloudflare wildcards ("*.example.com") are not accepted here — use the exact host the challenge is rendered under.`
      );
    }
    return baseUrl === null ? null : { siteKey: key, baseUrl };
  }

  // The fallback is an env var this project sets itself, so it must already be an absolute URL —
  // no scheme is inferred for it, and a malformed value resolves to null rather than becoming a
  // hostname that could only ever fail Cloudflare's check.
  const fallback = trimmedOrNull(supabaseUrl);
  if (fallback === null) {
    warnUnusable(
      'a site key is set, but neither EXPO_PUBLIC_TURNSTILE_HOSTNAME nor EXPO_PUBLIC_SUPABASE_URL is set, so the challenge has no base URL to load under.'
    );
    return null;
  }
  const baseUrl = baseUrlFromAbsoluteUrl(fallback);
  if (baseUrl === null) {
    warnUnusable(
      `a site key is set, but no EXPO_PUBLIC_TURNSTILE_HOSTNAME was given and EXPO_PUBLIC_SUPABASE_URL is not an absolute http(s) URL: ${JSON.stringify(fallback)}.`
    );
  }
  return baseUrl === null ? null : { siteKey: key, baseUrl };
}
