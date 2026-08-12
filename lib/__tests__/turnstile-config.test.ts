/**
 * `lib/turnstile-config.ts` — the resolution that decides whether email sign-up is offered at
 * all, and under which hostname the Turnstile challenge is loaded.
 *
 * THE BUG THIS SUITE EXISTS FOR (v23-signup-signin-cloudflare-fix-r1). Email sign-up was
 * impossible against the live project for the whole of #166's life, for two stacked reasons that
 * looked like one "Cloudflare is broken" symptom:
 *
 *   1. `EXPO_PUBLIC_TURNSTILE_SITE_KEY` was never provisioned anywhere real — empty in every
 *      `.env`, absent from all three EAS environments. Only `eas.json`'s two `*-local` profiles
 *      carried a value, and that value was Cloudflare's dummy always-passes key. With no key the
 *      widget never renders, no token is ever issued, and "Create account" is permanently
 *      disabled — verified live on 2026-08-12: `auth.users` on the production project held not a
 *      single email/password identity, only one Google one. No email sign-up had ever succeeded.
 *   2. Even with a real key the widget could not have worked, because the challenge was loaded
 *      with no base URL and therefore no hostname for Cloudflare to validate (error 110200).
 *      The dummy keys ignore hostnames, which is precisely why (1) hid (2).
 *
 * So the invariant worth locking is not "a key is present" — CI cannot see the operator's
 * Cloudflare account — but "a key ALONE never yields a config". Every case below where a site
 * key is present asserts a non-empty `baseUrl` came with it.
 */
import { resolveTurnstileConfig } from '../turnstile-config';

const SUPABASE_URL = 'https://vputdomdlknvthnzritt.supabase.co';

describe('resolveTurnstileConfig', () => {
  describe('when no usable site key is configured', () => {
    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ['whitespace only', '   '],
    ])('returns null for %s, so the caller shows the unavailable notice', (_label, siteKey) => {
      expect(resolveTurnstileConfig(siteKey, undefined, SUPABASE_URL)).toBeNull();
    });
  });

  describe('when a site key is configured', () => {
    it('falls back to the Supabase project origin when no hostname is set', () => {
      expect(resolveTurnstileConfig('0x4AAA-real-key', undefined, SUPABASE_URL)).toEqual({
        siteKey: '0x4AAA-real-key',
        baseUrl: 'https://vputdomdlknvthnzritt.supabase.co/',
      });
    });

    it('prefers an explicitly configured hostname over the Supabase fallback', () => {
      expect(resolveTurnstileConfig('0x4AAA-real-key', 'signup.example.com', SUPABASE_URL)).toEqual(
        { siteKey: '0x4AAA-real-key', baseUrl: 'https://signup.example.com/' }
      );
    });

    // Both are things an operator plausibly pastes out of the Cloudflare dashboard. Naively
    // prefixing `https://` onto the second yields `https://https://…`, which parses to hostname
    // `https` and fails Cloudflare's check in a way nothing on screen would explain.
    it('accepts a full origin as well as a bare hostname', () => {
      expect(
        resolveTurnstileConfig('key', 'https://signup.example.com', SUPABASE_URL)?.baseUrl
      ).toBe('https://signup.example.com/');
    });

    it('keeps the scheme and port of a local Supabase stack in the fallback', () => {
      expect(resolveTurnstileConfig('key', undefined, 'http://127.0.0.1:54321')?.baseUrl).toBe(
        'http://127.0.0.1:54321/'
      );
    });

    it('trims surrounding whitespace off both values', () => {
      expect(resolveTurnstileConfig('  key  ', '  example.com  ', SUPABASE_URL)).toEqual({
        siteKey: 'key',
        baseUrl: 'https://example.com/',
      });
    });

    // A key with an unusable hostname is the 110200 case: the widget would render and could only
    // ever call `onError`. Refusing outright makes the screen show the honest unavailable notice
    // instead of a challenge that cannot be solved.
    it.each([
      ['an unparseable hostname', 'not a hostname at all'],
      ['a scheme with no host', 'https://'],
    ])('returns null for %s rather than rendering a widget that can only fail', (_label, host) => {
      expect(resolveTurnstileConfig('key', host, SUPABASE_URL)).toBeNull();
    });

    it('returns null when neither a hostname nor a usable Supabase URL is available', () => {
      expect(resolveTurnstileConfig('key', undefined, undefined)).toBeNull();
      expect(resolveTurnstileConfig('key', undefined, 'not-a-url')).toBeNull();
    });
  });

  // Jest runs on Node, whose `URL` is spec-compliant; React Native's built-in one is not (it
  // neither validates input nor implements `origin`/`hostname`, and only
  // `react-native-url-polyfill/auto` — imported for its side effect by `lib/supabase.ts`, not by
  // this module — repairs it). So a resolver that parsed with `URL` would pass every case above
  // and still resolve to null on a device the moment that unrelated import order changed, turning
  // a perfectly valid site key back into "sign-up unavailable". This removes Node's `URL` for the
  // duration of the call to prove the resolution does not reach for it.
  it('resolves without a spec-compliant global URL, as on a device with no polyfill loaded', () => {
    const realUrl = globalThis.URL;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).URL = undefined;
    try {
      expect(resolveTurnstileConfig('key', undefined, SUPABASE_URL)?.baseUrl).toBe(
        'https://vputdomdlknvthnzritt.supabase.co/'
      );
      expect(resolveTurnstileConfig('key', 'signup.example.com', SUPABASE_URL)?.baseUrl).toBe(
        'https://signup.example.com/'
      );
      expect(resolveTurnstileConfig('key', 'not a hostname at all', undefined)).toBeNull();
    } finally {
      globalThis.URL = realUrl;
    }
  });

  // The load-bearing invariant, stated once as a property over every input combination rather
  // than relying on the individual cases above to stay exhaustive: a site key can never produce
  // a config without a base URL to render it under.
  it('never returns a config with a missing or empty baseUrl', () => {
    const siteKeys = [undefined, '', 'key'];
    const hostnames = [undefined, '', 'example.com', 'https://example.com', 'bad host', 'https://'];
    const supabaseUrls = [undefined, '', SUPABASE_URL, 'http://127.0.0.1:54321', 'nonsense'];

    for (const siteKey of siteKeys) {
      for (const hostname of hostnames) {
        for (const supabaseUrl of supabaseUrls) {
          const config = resolveTurnstileConfig(siteKey, hostname, supabaseUrl);
          if (config !== null) {
            expect(config.siteKey.length).toBeGreaterThan(0);
            expect(config.baseUrl.length).toBeGreaterThan(0);
            expect(new URL(config.baseUrl).hostname.length).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
