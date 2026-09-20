/**
 * `POST /functions/v1/record-age-band` (2026-09-20) — the one-time age choice for an account that
 * an OAuth provider created. `signup-with-captcha` records the band as part of email sign-up, but
 * a "Continue with Google" account is minted by GoTrue inside the OAuth exchange, where no request
 * body of ours travels — so the app gates FIRST USE of such an account behind the same age choice
 * (`components/age-band-gate.tsx`) and this function persists it, through the same
 * `pace_record_age_band` RPC and the same server-stamped policy version.
 *
 * AUTHENTICATED: the user id is the JWT's, never the body's — the caller can only ever record a
 * band for themselves. The write itself runs on the secret key (`age-band-recorder-client.ts`),
 * because the RPC is `service_role`-only by design.
 *
 *     Authorization: Bearer <user JWT>
 *     { ageBand: '18_plus' | '13_17', guardianConsent?: boolean }
 *       -> 200 { ageBand, guardianConsentRecorded }
 *       -> 400 { error, code: 'invalid_body' | 'age_band_required' | 'guardian_consent_required' }
 *       -> 401 { error, code: 'unauthorized' }
 *       -> 409 { error, code: 'age_band_already_recorded' }   (write-once; the app re-reads the profile)
 *       -> 500 { error, code: 'age_band_unavailable' }
 *
 * Portable layer (Deno + Jest): the recorder is injected, so `__tests__/record-age-band.deno.test.ts`
 * drives every arm without a project. `record-age-band/index.ts` is the HTTP/env glue.
 */
import { parseAgeBandChoice, type AgeBandChoice, type RecordAgeBandResponseBody } from './age-band.ts';
import type { AgeBandRecorder } from './age-band-recorder.ts';

export type RecordAgeBandResult =
  | { status: 200; body: RecordAgeBandResponseBody }
  | { status: 400 | 409 | 500; body: { error: string; code: string } };

export type ParseRecordAgeBandResult =
  | { ok: true; choice: AgeBandChoice }
  | { ok: false; error: string; code: string };

export function parseRecordAgeBandRequest(rawBody: unknown): ParseRecordAgeBandResult {
  if (typeof rawBody !== 'object' || rawBody === null) {
    return { ok: false, error: 'Request body must be a JSON object.', code: 'invalid_body' };
  }
  const parsed = parseAgeBandChoice(rawBody as Record<string, unknown>);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: parsed.code };
  return { ok: true, choice: parsed.choice };
}

export async function handleRecordAgeBand(
  deps: { ageBandRecorder: AgeBandRecorder },
  callerUserId: string,
  rawBody: unknown,
): Promise<RecordAgeBandResult> {
  const parsed = parseRecordAgeBandRequest(rawBody);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error, code: parsed.code } };
  }

  const recorded = await deps.ageBandRecorder.record(callerUserId, parsed.choice);
  switch (recorded.outcome) {
    case 'recorded':
      return {
        status: 200,
        body: { ageBand: parsed.choice.ageBand, guardianConsentRecorded: parsed.choice.guardianConsent },
      };
    case 'already_recorded':
      // Not an error the user can act on and not a success either: the band on file wins, and the
      // client's gate closes by re-reading the profile rather than by trusting this call's input.
      return {
        status: 409,
        body: { error: 'An age range is already recorded for this account.', code: 'age_band_already_recorded' },
      };
    case 'refused':
      // Unreachable through `parseAgeBandChoice` for the two choice rules; `profile_not_found` would
      // mean a JWT for a user with no profile row, which `handle_new_user()` makes impossible for a
      // live account. Surfaced by name rather than folded into the 500 so a log line says why.
      return { status: 400, body: { error: 'The age choice could not be recorded.', code: recorded.code } };
    case 'unavailable':
      return {
        status: 500,
        body: { error: 'Your age choice could not be saved. Please try again.', code: 'age_band_unavailable' },
      };
    default: {
      const _exhaustive: never = recorded;
      return _exhaustive;
    }
  }
}
