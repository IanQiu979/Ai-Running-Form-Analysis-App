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

/**
 * Turns a configured hostname into a base URL. Accepts either a bare hostname
 * (`example.com`) or a full origin (`https://example.com`), because both are things an operator
 * plausibly pastes out of the Cloudflare dashboard, and silently producing `https://https://…`
 * from the second would fail in a way nothing surfaces. A bare hostname is assumed `https:` —
 * Turnstile is only served over TLS.
 */
function baseUrlFromHostname(hostname: string): string | null {
  const withScheme = /^https?:\/\//i.test(hostname) ? hostname : `https://${hostname}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

/**
 * Returns the config to render the widget with, or `null` when Turnstile is not usably
 * configured — which the caller must surface as an honest "sign-up unavailable" state rather
 * than a widget that can only ever fail. `null` is returned when the site key is missing (the
 * ordinary unconfigured build) AND when a site key is present but no hostname can be derived at
 * all, because a widget rendered with no base URL is a guaranteed 110200, not a maybe.
 */
export function resolveTurnstileConfig(
  siteKey: string | undefined,
  hostname: string | undefined,
  supabaseUrl: string | undefined
): TurnstileConfig | null {
  const key = trimmedOrNull(siteKey);
  if (key === null) return null;

  const configuredHostname = trimmedOrNull(hostname);
  if (configuredHostname !== null) {
    const baseUrl = baseUrlFromHostname(configuredHostname);
    return baseUrl === null ? null : { siteKey: key, baseUrl };
  }

  const fallback = trimmedOrNull(supabaseUrl);
  if (fallback === null) return null;
  try {
    const url = new URL(fallback);
    if (!url.hostname) return null;
    return { siteKey: key, baseUrl: `${url.origin}/` };
  } catch {
    return null;
  }
}
