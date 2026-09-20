/**
 * The consent record (issues #68 and #94 — one workstream).
 *
 * A checkbox is not consent — it COLLECTS consent. GDPR Art. 7(1) requires the controller to be
 * able to DEMONSTRATE that consent was given, and the injury-risk inferences this app produces
 * are Art. 9 health data at rest (see docs/privacy-checklist-m7.md). This module is the record:
 * an append-only log in public.consents, one immutable row per grant or withdrawal.
 *
 * Everything here FAILS CLOSED — see hasConsented().
 *
 * Three consent keys, not one — see `components/consent-gate.tsx`'s docblock for the full
 * reasoning behind why they exist and why they don't share a "once granted, never asked again"
 * lifecycle. In one line: `UPLOAD_HEALTH_CONSENT` and `AGE_CONFIRMATION_CONSENT` are facts about
 * the ACCOUNT and are granted once, ever; `THIRD_PARTY_ATTESTATION_CONSENT` is a fact about a
 * SPECIFIC upload (who's actually in that photo or video) and is granted fresh every time the
 * uploader says the subject is someone else — a returning "self-consent" grant proves nothing
 * about who is in today's clip. Using a distinct key per grant is also what "the record must
 * distinguish self-consent from third-party attestation" (issue #94) means in practice: the
 * `consent_key` column IS that distinction — no extra table or column was needed.
 */
import { supabase } from './supabase';

/**
 * Consent to the upload → Anthropic → health-feedback processing chain, at the exact wording
 * shipped in `Copy.consent.upload` (copy-deck.md § Consent). Self-consent — this is the uploader
 * consenting to processing of THEIR OWN images. See `THIRD_PARTY_ATTESTATION_CONSENT` for the
 * distinct grant recorded when the uploader says someone else is in the frame.
 *
 * The version lives in the key on purpose. Consent to one wording is not consent to a later one,
 * so rewording the deck means minting `upload.health.v2` here — at which point hasConsented() is
 * false for every existing user until they re-tick, automatically and without a migration. A
 * separate `version` column would have to be remembered and compared at every call site.
 */
export const UPLOAD_HEALTH_CONSENT = 'upload.health.v1';

/**
 * Confirmation that the account holder is 16 or older, per what was `docs/privacy-policy.md`'s
 * "Age and other people in your media" section (split on 2026-09-20 into "Age", which now sets a
 * 13-and-up floor with guardian consent, and "Other people in your media" — see
 * `docs/status.md` Known Issue #52 follow-up 1 for the resulting contradiction) — stated there
 * but, before issue #94, never asked or recorded anywhere in the app. Granted once, ever, alongside `UPLOAD_HEALTH_CONSENT` on the same
 * first-upload screen (age only moves in one direction, so there is nothing to re-ask).
 */
export const AGE_CONFIRMATION_CONSENT = 'upload.ageConfirmation.v1';

/**
 * The uploader's attestation, given fresh for a specific upload, that the person shown — who is
 * NOT the uploader — has agreed to this analysis, or their parent/guardian has if they're a
 * minor. Recorded ONLY when `components/consent-gate.tsx`'s subject phase answers "someone else"
 * — a coach filming a different athlete each session is a different data subject each time, so
 * this is deliberately not a once-ever grant the way the two keys above are (see this module's
 * docblock and the component's for the full reasoning).
 */
export const THIRD_PARTY_ATTESTATION_CONSENT = 'upload.thirdPartyAttestation.v1';

export type ConsentKey =
  | typeof UPLOAD_HEALTH_CONSENT
  | typeof AGE_CONFIRMATION_CONSENT
  | typeof THIRD_PARTY_ATTESTATION_CONSENT;

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
