/**
 * The client half of the age choice (2026-09-20) — see `@shared/age-band` for the contract and
 * why it exists. Two jobs:
 *
 *   1. `readAgeBand()` — has THIS account recorded a band? Reads `profiles.age_band` through the
 *      owner-scoped SELECT policy (no `user_id` filter needed: RLS returns only our own row).
 *      THROWS on any query failure, like `lib/consent.ts`'s `hasConsented`, and for the same
 *      reason: "could not read" must never be dressed up as either answer.
 *
 *   2. `recordAgeBand()` — the OAuth-account path. Email sign-up records the band inside
 *      `signup-with-captcha` (`lib/signup-with-captcha.ts` sends it in the same request); an
 *      account that Google created has no such moment, so `components/age-band-gate.tsx` asks on
 *      first use and calls `POST /functions/v1/record-age-band` here. The body and the 200 shape
 *      are the shared module's types — never restated (CLAUDE.md's wire-shape rule).
 *
 * WHO GETS GATED — `isOAuthCreatedAccount()`. Only a non-`email` provider (`app_metadata.provider`,
 * the field `lib/delete-account.ts` already reads) with a NULL band. An email account with a NULL
 * band is one created before 2026-09-20 under the old "I am 16+" line; those are deliberately
 * unaffected (no backfill, no gate) — captain's acceptance criterion. A Google account with a NULL
 * band is either brand new or pre-dates this change; both attested 16+ client-side only and
 * nothing was recorded, so both get the one-time screen. That second case is a knowing choice and
 * is written down in `docs/status.md`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';

import { Copy } from '@/constants/copy';
import { isAgeBand, type AgeBand, type AgeBandChoice, type RecordAgeBandResponseBody } from '@shared/age-band';

import { invokeFunction } from './functions-client';
import { supabase } from './supabase';

export type { AgeBand, AgeBandChoice };
export { isAgeBand };

const EDGE_FUNCTION_NAME = 'record-age-band';

/** True for an account an OAuth provider minted (Google today; Apple later). */
export function isOAuthCreatedAccount(session: Pick<Session, 'user'> | null): boolean {
  const provider = session?.user.app_metadata?.provider;
  return typeof provider === 'string' && provider.length > 0 && provider !== 'email';
}

/**
 * The band on file for the signed-in account, or `null` when none is recorded yet. Throws when
 * the read fails — callers decide what "unknown" means for them (the gate fails closed).
 */
export async function readAgeBand(): Promise<AgeBand | null> {
  const { data, error } = await supabase.from('profiles').select('age_band').limit(1).maybeSingle();
  if (error) {
    throw new Error(`Could not read the account's age band: ${error.message}`);
  }
  const band = data?.age_band ?? null;
  return isAgeBand(band) ? band : null;
}

/**
 * A per-device note that THIS account has a band on file, so the gate's profile read runs once
 * per account per device rather than on every launch — and an offline launch never walls an
 * account that answered months ago. Safe to cache because the band is write-once on the server:
 * a cached "yes" can never go stale, and a missing cache only costs one read. Plain
 * `AsyncStorage`, not the Keychain store: it is a boolean hint, not a credential, and the server
 * remains the only authority for the write itself. Every call swallows storage failures — the
 * cache is a convenience, never a gate.
 */
const RECORDED_LOCALLY_KEY_PREFIX = 'age-band.recorded.';

export async function hasAgeBandBeenRecordedLocally(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(RECORDED_LOCALLY_KEY_PREFIX + userId)) === '1';
  } catch {
    return false;
  }
}

export async function markAgeBandRecordedLocally(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(RECORDED_LOCALLY_KEY_PREFIX + userId, '1');
  } catch {
    // Nothing to do: the next launch re-reads the profile, which is the pre-cache behaviour.
  }
}

export type RecordAgeBandErrorCode =
  | 'invalid_body'
  | 'age_band_required'
  | 'guardian_consent_required'
  | 'unauthorized'
  /** Write-once: a band is already on file. The gate treats this as "close" after re-reading. */
  | 'age_band_already_recorded'
  | 'age_band_unavailable'
  | 'network'
  | 'unknown';

export type RecordAgeBandResult =
  | { ok: true; data: RecordAgeBandResponseBody }
  | { ok: false; code: RecordAgeBandErrorCode };

/** Mirrors the `code` strings `supabase/functions/_shared/record-age-band.ts` emits on its non-2xx
 * arms — hand-maintained for the reason `lib/signup-with-captcha.ts` gives: the server types them
 * as a bare `string`. A rename there folds to `'unknown'` here (generic copy), never a crash. */
function isKnownErrorCode(code: string): code is Exclude<RecordAgeBandErrorCode, 'network' | 'unknown'> {
  return (
    code === 'invalid_body' ||
    code === 'age_band_required' ||
    code === 'guardian_consent_required' ||
    code === 'unauthorized' ||
    code === 'age_band_already_recorded' ||
    code === 'age_band_unavailable'
  );
}

function readResponseBody(body: unknown): RecordAgeBandResponseBody | null {
  if (body === null || typeof body !== 'object') return null;
  const { ageBand, guardianConsentRecorded } = body as Record<string, unknown>;
  if (!isAgeBand(ageBand) || typeof guardianConsentRecorded !== 'boolean') return null;
  return { ageBand, guardianConsentRecorded };
}

/** Calls `record-age-band` for the signed-in account. Never throws. */
export async function recordAgeBand(choice: AgeBandChoice): Promise<RecordAgeBandResult> {
  const result = await invokeFunction<RecordAgeBandResponseBody>(EDGE_FUNCTION_NAME, {
    method: 'POST',
    body: { ageBand: choice.ageBand, guardianConsent: choice.guardianConsent },
  });

  if (!result.ok) {
    if (result.error.kind === 'network' || result.error.kind === 'malformed') {
      return { ok: false, code: 'network' };
    }
    const { code } = result.error;
    return { ok: false, code: isKnownErrorCode(code) ? code : 'unknown' };
  }

  const parsed = readResponseBody(result.data);
  if (parsed === null) {
    // A 200 whose body is not the shared shape: the deployed function and this checkout disagree.
    // Parse defensively (a type import proves nothing at runtime) and fail by name.
    return { ok: false, code: 'unknown' };
  }
  return { ok: true, data: parsed };
}

/** The on-screen sentence for a `recordAgeBand` failure the user can act on. */
export function describeRecordAgeBandError(code: RecordAgeBandErrorCode): string {
  switch (code) {
    case 'age_band_required':
      return Copy.auth.error.ageBandRequired;
    case 'guardian_consent_required':
      return Copy.auth.error.guardianConsentRequired;
    case 'invalid_body':
    case 'unauthorized':
    case 'age_band_already_recorded':
    case 'age_band_unavailable':
    case 'network':
    case 'unknown':
      return Copy.auth.ageGate.error.save;
    default: {
      const _exhaustive: never = code;
      return _exhaustive;
    }
  }
}
