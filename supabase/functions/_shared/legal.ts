/**
 * `docs/privacy-policy.md`'s "Last updated" date, stamped onto every guardian-consent row
 * (`supabase/migrations/20260920120000_guardian_consent.sql`, `guardian_consent.policy_version`)
 * so a recorded consent always says which revision of the policy the guardian actually saw —
 * the same contract V2.2 keeps in its `src/constants/legal.ts`
 * (IanQiu979/Ai-Customized-Running-Plan-App#123). Whenever that "Last updated" date changes,
 * this constant must be bumped in the same commit; `__tests__/legal.test.ts` reads the policy
 * file and fails if the two drift.
 *
 * Lives in `_shared/` (not `constants/`) because only this tree ships in the
 * `supabase functions deploy` bundle, and the SERVER stamps the version — the client never sends
 * it (a client-supplied version would let a caller record consent against a policy nobody saw).
 */
export const PRIVACY_POLICY_VERSION = '2026-09-20';
