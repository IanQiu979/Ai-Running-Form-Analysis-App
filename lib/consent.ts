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
 * Consent keys, and their lifecycles — they do NOT all share a "once granted, never asked again"
 * shape. `UPLOAD_HEALTH_CONSENT` is a fact about the ACCOUNT, granted once, ever, at sign-up or
 * first Google use. `FUTURE_UPLOADS_ATTESTATION_CONSENT` is granted at that same moment and
 * covers every upload/recording the account will ever make, present and future — it replaced the
 * old per-upload `THIRD_PARTY_ATTESTATION_CONSENT` flow (see that key's own doc). The former age
 * key (`upload.ageConfirmation.v1`) is gone: sign-up's age-band flow (`@shared/age-band`,
 * `components/age-band-choice.tsx`) supersedes it, and nothing writes it anymore — historical
 * rows for that key remain in `public.consents` but the app no longer types or grants it.
 */
import { supabase } from './supabase';

/**
 * Consent to the upload → Anthropic → health-feedback processing chain. Collected by the
 * account-level sign-up/first-use flow, not a health-specific checkbox of its own: the tick on
 * `components/upload-consent-checkbox.tsx` covers BOTH `Copy.auth.consent.healthProcessing`
 * (the one sentence naming uploads as health-related data processed by AI, which is what keeps
 * this key's meaning) and the adjacent `Copy.auth.consent.futureUploads.checkbox` wording (see
 * `FUTURE_UPLOADS_ATTESTATION_CONSENT` below); a Google account reads the same statement on
 * `components/age-band-gate.tsx` before its confirm. Self-consent — this is the uploader consenting to
 * processing of THEIR OWN images. See `THIRD_PARTY_ATTESTATION_CONSENT` for the distinct grant
 * recorded when the uploader says someone else is in the frame.
 *
 * The version lives in the key on purpose. Consent to one wording is not consent to a later one,
 * so rewording the deck means minting `upload.health.v2` here — at which point hasConsented() is
 * false for every existing user until they re-tick, automatically and without a migration. A
 * separate `version` column would have to be remembered and compared at every call site.
 */
export const UPLOAD_HEALTH_CONSENT = 'upload.health.v1';

/**
 * RETIRED. The uploader's attestation, given fresh for a specific upload, that the person shown
 * — who is NOT the uploader — has agreed to this analysis, or their parent/guardian has if
 * they're a minor. Was recorded when the (now-deleted) `components/consent-gate.tsx`'s subject
 * phase answered "someone else" — a coach filming a different athlete each session was treated as
 * a different data subject each time. Superseded by `FUTURE_UPLOADS_ATTESTATION_CONSENT`, granted
 * once at sign-up and covering every future upload instead of asking per upload. No longer
 * granted anywhere going forward; the export stays only so historical rows keep a type.
 */
export const THIRD_PARTY_ATTESTATION_CONSENT = 'upload.thirdPartyAttestation.v1';

/**
 * Granted once, ever — at sign-up (email) or on first use (a Google-created account, via
 * `components/age-band-gate.tsx`) — alongside `UPLOAD_HEALTH_CONSENT`. States that every photo or
 * video the account uploads or records, now and in the future, shows only the account holder or
 * someone who has agreed to be analyzed. Supersedes the old per-upload attestation flow
 * (`THIRD_PARTY_ATTESTATION_CONSENT`, retired above): rather than asking who is in THIS clip every
 * time, the account holder attests up front to a standing rule that covers every future upload.
 */
export const FUTURE_UPLOADS_ATTESTATION_CONSENT = 'upload.futureUploadsAttestation.v1';

export type ConsentKey =
  | typeof UPLOAD_HEALTH_CONSENT
  | typeof THIRD_PARTY_ATTESTATION_CONSENT
  | typeof FUTURE_UPLOADS_ATTESTATION_CONSENT;

/**
 * The three states a key can be in, read from the newest row alone. `none` is an account that has
 * never recorded anything for the key (a legacy account from before that key existed, or a grant
 * that was never written); `withdrawn` is an account whose newest row is a `granted = false` —
 * an explicit act the user took, which no client code may silently reverse (Art. 7(3)); `granted`
 * is a live consent. Callers that repair a missing grant MUST branch on `none`, never on
 * "not granted", or they would re-grant over a withdrawal.
 */
export type ConsentState = 'none' | 'granted' | 'withdrawn';

/**
 * Reads the newest consent event for this key. Withdrawal needs no special case: it is simply a
 * newer row with granted = false, so reading the latest row returns it. The ordering is done by
 * Postgres, not here.
 *
 * THROWS on any query failure — offline, RLS misconfigured, network flake. It deliberately does
 * NOT return `none` dressed up as "probably fine", and it does NOT return `granted` to avoid
 * inconveniencing the user. Returning `granted` would process Art. 9 health data with no legal
 * basis. Returning `none` silently would be indistinguishable from a user who genuinely never
 * consented, which hides the outage — that is exactly the bug open at #74, where lib/hibp.ts
 * fails open and nothing says so. The caller must treat a throw as "cannot upload" and surface it.
 */
export async function readConsentState(key: ConsentKey): Promise<ConsentState> {
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

  if (!data) return 'none';
  return data.granted ? 'granted' : 'withdrawn';
}

/**
 * True if the newest consent event for this key is a grant. Same read and the same fail-closed
 * throw as `readConsentState`; `none` and `withdrawn` both read as false here, so a caller that
 * needs to tell them apart (a repair path) must use `readConsentState` instead.
 */
export async function hasConsented(key: ConsentKey): Promise<boolean> {
  return (await readConsentState(key)) === 'granted';
}

/** Record an explicit grant. Appends a row; never updates one. */
export async function grantConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, true);
}

/**
 * Record a withdrawal (Art. 7(3): withdrawing consent must be as easy as giving it). Appends a
 * row with granted = false, which supersedes the earlier grant by being newer.
 *
 * Triggered from the Settings screen's Consent row, which is also where a withdrawn consent is
 * given again (`grantConsent`) — nothing at capture time re-asks or re-grants a withdrawn key.
 */
export async function withdrawConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, false);
}

/**
 * The two keys a single sign-up tick grants together and Settings withdraws/restores together.
 * Every repair path checks each of them on its own: one landing does not prove the other did.
 */
export const SIGNUP_CONSENT_KEYS = [UPLOAD_HEALTH_CONSENT, FUTURE_UPLOADS_ATTESTATION_CONSENT] as const;

export type EnsureConsentsResult = 'granted' | 'withdrawn' | 'failed';

/**
 * Check-and-repair for the sign-up consents. Reads BOTH keys' states and grants only the ones with
 * NO row at all. A `withdrawn` state on either key is the user's own explicit act in Settings and
 * is never reversed here — nothing is written and `withdrawn` is returned so the caller can point
 * at Settings, the one surface that re-grants. Never throws: a read or grant failure (or, with
 * `timeoutMs`, a round trip that outlives the budget) resolves `failed`, and the caller decides
 * whether that blocks (the age-band gate) or proceeds best-effort (capture, where `analyze-form`'s
 * server gate still fails closed).
 */
export async function ensureConsentsGranted(
  options: { timeoutMs?: number } = {}
): Promise<EnsureConsentsResult> {
  const work = (async (): Promise<EnsureConsentsResult> => {
    try {
      const states = await Promise.all(SIGNUP_CONSENT_KEYS.map((key) => readConsentState(key)));
      if (states.includes('withdrawn')) return 'withdrawn';
      const missing = SIGNUP_CONSENT_KEYS.filter((_, i) => states[i] === 'none');
      await Promise.all(missing.map((key) => grantConsent(key)));
      return 'granted';
    } catch {
      return 'failed';
    }
  })();

  if (options.timeoutMs === undefined) return work;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<EnsureConsentsResult>((resolve) => {
    timer = setTimeout(() => resolve('failed'), options.timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function recordConsent(key: ConsentKey, granted: boolean): Promise<void> {
  // user_id is omitted on purpose: the column defaults to auth.uid() from the verified JWT, so
  // the client never names a user at all. The INSERT policy's with-check re-verifies it anyway.
  const { error } = await supabase.from('consents').insert({ consent_key: key, granted });

  if (error) {
    throw new Error(`Could not record consent "${key}" (granted: ${granted}): ${error.message}`);
  }
}
