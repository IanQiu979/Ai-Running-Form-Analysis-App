/**
 * `PRIVACY_POLICY_VERSION` is stamped onto every guardian-consent row as "the policy the guardian
 * saw", so it has to be the date the published policy actually carries. This reads
 * `docs/privacy-policy.md`'s "Last updated" line and fails the moment the two drift — the same
 * lock V2.2 keeps in `src/constants/__tests__/legal.test.ts`. Runs under Jest (listed in
 * `supabase/functions/deno.json`'s `exclude`, like `pace.test.ts`).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { PRIVACY_POLICY_VERSION } from '../legal';

describe('PRIVACY_POLICY_VERSION', () => {
  it('is an ISO date', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('matches docs/privacy-policy.md "Last updated"', () => {
    const policy = readFileSync(join(__dirname, '../../../../docs/privacy-policy.md'), 'utf8');
    const match = policy.match(/\*\*Last updated: (\d{4}-\d{2}-\d{2})\*\*/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(PRIVACY_POLICY_VERSION);
  });
});
