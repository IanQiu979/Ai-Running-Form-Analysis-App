/**
 * The one server-side write path for an account's age band — a thin, injectable wrapper over the
 * `pace_record_age_band` RPC (`supabase/migrations/20260920120000_guardian_consent.sql`), shared by
 * `signup-with-captcha` (email sign-up: right after `auth.admin.createUser`) and `record-age-band`
 * (an OAuth-created account's one-time age screen).
 *
 * Portable (no `npm:`/`Deno.env` import): the `AgeBandRpc` surface is what the Deno-only client
 * factories inject, so both handlers' tests run without a live project. The Deno-only factory
 * lives in `age-band-recorder-client.ts`, same split as `quota-status.ts` / `quota-status-client.ts`.
 *
 * The database function raises its refusals as plain exceptions whose message IS the code
 * (`AGE_BAND_DB_ERRORS`); PostgREST forwards that message verbatim in `error.message`, which is
 * what `classifyRpcError` reads. Anything else — a network fault, a missing function on a project
 * that has not had the migration pushed yet — is `unavailable`, and callers treat it as a 500.
 */
import { AGE_BAND_DB_ERRORS, type AgeBandChoice } from './age-band.ts';
import { PRIVACY_POLICY_VERSION } from './legal.ts';

export interface AgeBandRpc {
  rpc(
    fn: 'pace_record_age_band',
    args: { p_user_id: string; p_age_band: string; p_guardian_consent: boolean; p_policy_version: string }
  ): Promise<{ error: { message: string } | null }>;
}

export type RecordAgeBandOutcome =
  | { outcome: 'recorded' }
  | { outcome: 'already_recorded' }
  | { outcome: 'refused'; code: 'age_band_invalid' | 'guardian_consent_required' | 'profile_not_found' }
  | { outcome: 'unavailable'; message: string };

export interface AgeBandRecorder {
  record(userId: string, choice: AgeBandChoice): Promise<RecordAgeBandOutcome>;
}

function classifyRpcError(message: string): RecordAgeBandOutcome {
  if (message.includes(AGE_BAND_DB_ERRORS.alreadyRecorded)) return { outcome: 'already_recorded' };
  if (message.includes(AGE_BAND_DB_ERRORS.invalidBand)) return { outcome: 'refused', code: 'age_band_invalid' };
  if (message.includes(AGE_BAND_DB_ERRORS.guardianConsentRequired)) {
    return { outcome: 'refused', code: 'guardian_consent_required' };
  }
  if (message.includes(AGE_BAND_DB_ERRORS.profileNotFound)) return { outcome: 'refused', code: 'profile_not_found' };
  return { outcome: 'unavailable', message };
}

export function createAgeBandRecorder(client: AgeBandRpc): AgeBandRecorder {
  return {
    async record(userId, choice) {
      try {
        const { error } = await client.rpc('pace_record_age_band', {
          p_user_id: userId,
          p_age_band: choice.ageBand,
          p_guardian_consent: choice.guardianConsent,
          // Stamped HERE, server-side, never taken from the request: the version a client sends
          // would be the version it claims the guardian saw, not the one that was published.
          p_policy_version: PRIVACY_POLICY_VERSION,
        });
        if (error) return classifyRpcError(error.message);
        return { outcome: 'recorded' };
      } catch (err) {
        return { outcome: 'unavailable', message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
