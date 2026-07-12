/**
 * The consent record (issue #68).
 *
 * A checkbox is not consent — it COLLECTS consent. GDPR Art. 7(1) requires the controller to be
 * able to DEMONSTRATE that consent was given, and the injury-risk inferences this app produces
 * are Art. 9 health data at rest (see docs/privacy-checklist-m7.md). This module is the record:
 * an append-only log in public.consents, one immutable row per grant or withdrawal.
 *
 * Everything here FAILS CLOSED — see hasConsented().
 */
import { supabase } from './supabase';

/**
 * Consent to the upload → Anthropic → health-feedback processing chain, at the exact wording
 * shipped in `Copy.consent.upload` (copy-deck.md § Consent).
 *
 * The version lives in the key on purpose. Consent to one wording is not consent to a later one,
 * so rewording the deck means minting `upload.health.v2` here — at which point hasConsented() is
 * false for every existing user until they re-tick, automatically and without a migration. A
 * separate `version` column would have to be remembered and compared at every call site.
 */
export const UPLOAD_HEALTH_CONSENT = 'upload.health.v1';

export type ConsentKey = typeof UPLOAD_HEALTH_CONSENT;

/**
 * True if the newest consent event for this key is a grant.
 *
 * Withdrawal needs no special case: it is simply a newer row with granted = false, so reading
 * the latest row returns it. The ordering is done by Postgres, not here.
 *
 * THROWS on any query failure — offline, RLS misconfigured, network flake. It deliberately does
 * NOT return `false` dressed up as "probably fine", and it does NOT return `true` to avoid
 * inconveniencing the user. Returning true would process Art. 9 health data with no legal basis.
 * Returning false silently would be indistinguishable from a user who genuinely never consented,
 * which hides the outage — that is exactly the bug open at #74, where lib/hibp.ts fails open and
 * nothing says so. The caller must treat a throw as "cannot upload" and surface it.
 */
export async function hasConsented(key: ConsentKey): Promise<boolean> {
  // No user_id filter: RLS scopes SELECT to the owner, so this can only ever see our own rows.
  const { data, error } = await supabase
    .from('consents')
    .select('granted')
    .eq('consent_key', key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read consent "${key}": ${error.message}`);
  }

  return data?.granted ?? false;
}

/** Record an explicit grant. Appends a row; never updates one. */
export async function grantConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, true);
}

/**
 * Record a withdrawal (Art. 7(3): withdrawing consent must be as easy as giving it). Appends a
 * row with granted = false, which supersedes the earlier grant by being newer.
 *
 * Unused until the Settings screen exists (#53). The record supports withdrawal before there is
 * any UI to trigger it because the table shape is the expensive thing to change later, not the
 * button.
 */
export async function withdrawConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, false);
}

async function recordConsent(key: ConsentKey, granted: boolean): Promise<void> {
  // user_id is omitted on purpose: the column defaults to auth.uid() from the verified JWT, so
  // the client never names a user at all. The INSERT policy's with-check re-verifies it anyway.
  const { error } = await supabase.from('consents').insert({ consent_key: key, granted });

  if (error) {
    throw new Error(`Could not record consent "${key}" (granted: ${granted}): ${error.message}`);
  }
}
