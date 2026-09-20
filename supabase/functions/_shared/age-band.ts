/**
 * The age choice every account records at creation (captain's plan, approved 2026-09-20;
 * mirrors V2.2's IanQiu979/Ai-Customized-Running-Plan-App#123, cross-app decision in that repo's
 * issue #95). Shared by the app (via the `@shared/*` alias — `components/age-band-choice.tsx`,
 * `lib/age-band.ts`) and by both edge functions that persist it (`signup-with-captcha` for
 * email sign-up, `record-age-band` for accounts an OAuth provider created), so the wire shape
 * cannot drift between the two sides — CLAUDE.md's "a `lib/` client NEVER restates the response
 * shape by hand" rule.
 *
 * TWO BANDS, NOT AN AGE. Under 13 is not offered at all (the app is for ages 13 and up), and
 * the exact age is never asked — the only fact the server needs is which legal regime applies:
 *   - `18_plus`: an adult agreeing to the Terms and Privacy Policy for themselves.
 *   - `13_17`:   a minor whose parent or guardian has read the Privacy Policy and agrees to it on
 *                their behalf. That attestation (`guardianConsent: true`) is REQUIRED with this
 *                band and is what the server records in `public.guardian_consent`, stamped with
 *                `PRIVACY_POLICY_VERSION` (`legal.ts`). GDPR Art. 9(2)(a) / Thai PDPA s.26 both
 *                require explicit consent for a minor's health data, and "explicit" has to be
 *                provable after the fact — a client-side checkbox proves nothing on its own.
 */

export const AGE_BANDS = ['18_plus', '13_17'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function isAgeBand(value: unknown): value is AgeBand {
  return value === '18_plus' || value === '13_17';
}

/** What a client sends: the band, plus the guardian attestation when the band needs one. */
export interface AgeBandChoice {
  ageBand: AgeBand;
  guardianConsent: boolean;
}

/**
 * The two refusals a bad age choice produces, as the `code` strings both functions emit on a 400.
 * `age_band_required` covers a missing OR unrecognised band (a client that sends `'under_13'`
 * gets the same answer as one that sends nothing — there is no third band to be told about).
 */
export type AgeBandRefusalCode = 'age_band_required' | 'guardian_consent_required';

export type AgeBandParseResult =
  | { ok: true; choice: AgeBandChoice }
  | { ok: false; code: AgeBandRefusalCode; error: string };

/**
 * Validates the age fields off a raw request body. Shape/presence only — the same "no business
 * rules duplicated here" discipline `parseSignupRequest` follows; the database function
 * (`pace_record_age_band`) re-checks both rules and is the layer that cannot be bypassed.
 */
export function parseAgeBandChoice(body: Record<string, unknown>): AgeBandParseResult {
  const { ageBand } = body;
  if (!isAgeBand(ageBand)) {
    return {
      ok: false,
      code: 'age_band_required',
      error: 'Select an age range: 18 or older, or 13 to 17 with a parent or guardian who agrees.',
    };
  }
  const guardianConsent = body.guardianConsent === true;
  if (ageBand === '13_17' && !guardianConsent) {
    return {
      ok: false,
      code: 'guardian_consent_required',
      error: 'A parent or guardian must agree to the Privacy Policy on behalf of a runner aged 13 to 17.',
    };
  }
  return { ok: true, choice: { ageBand, guardianConsent: ageBand === '13_17' } };
}

/**
 * The 200 body of `POST /functions/v1/record-age-band` — and what a client reads back; the app's
 * `lib/age-band.ts` imports this rather than restating it.
 */
export interface RecordAgeBandResponseBody {
  ageBand: AgeBand;
  /** True only for the `13_17` band: a `guardian_consent` row now exists for this user. */
  guardianConsentRecorded: boolean;
}

/**
 * The named failures `pace_record_age_band` raises (`supabase/migrations/20260920120000_
 * guardian_consent.sql`), matched by message text by the Deno-side recorder so a bad band or a
 * second write can be told apart from an outage. Postgres carries them in `error.message`.
 */
export const AGE_BAND_DB_ERRORS = {
  invalidBand: 'age_band_invalid',
  guardianConsentRequired: 'guardian_consent_required',
  alreadyRecorded: 'age_band_already_recorded',
  profileNotFound: 'profile_not_found',
} as const;
