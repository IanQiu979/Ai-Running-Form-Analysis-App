/**
 * `_shared/record-age-band.ts` (the OAuth-account age gate's server half) and
 * `_shared/age-band-recorder.ts` (the RPC wrapper both functions share), driven with fakes. The
 * database function's own behaviour is proven separately against real Postgres in
 * `guardian-consent-sql.deno.test.ts`; this file proves the HTTP shaping around it.
 */
import { assertEquals } from 'jsr:@std/assert@1';
import { parseAgeBandChoice, type AgeBandChoice } from '../age-band.ts';
import {
  createAgeBandRecorder,
  type AgeBandRecorder,
  type AgeBandRpc,
  type RecordAgeBandOutcome,
} from '../age-band-recorder.ts';
import { PRIVACY_POLICY_VERSION } from '../legal.ts';
import { handleRecordAgeBand } from '../record-age-band.ts';

class FakeRecorder implements AgeBandRecorder {
  calls: Array<{ userId: string; choice: AgeBandChoice }> = [];
  constructor(private result: RecordAgeBandOutcome = { outcome: 'recorded' }) {}
  record(userId: string, choice: AgeBandChoice) {
    this.calls.push({ userId, choice });
    return Promise.resolve(this.result);
  }
}

const CALLER = 'caller-user-id';

Deno.test('parseAgeBandChoice: the three answers', () => {
  assertEquals(parseAgeBandChoice({ ageBand: '18_plus' }), { ok: true, choice: { ageBand: '18_plus', guardianConsent: false } });
  assertEquals(parseAgeBandChoice({ ageBand: '13_17', guardianConsent: true }), {
    ok: true,
    choice: { ageBand: '13_17', guardianConsent: true },
  });
  assertEquals(parseAgeBandChoice({}).ok, false);
  assertEquals((parseAgeBandChoice({ ageBand: 'under_13' }) as { code: string }).code, 'age_band_required');
  assertEquals((parseAgeBandChoice({ ageBand: '13_17' }) as { code: string }).code, 'guardian_consent_required');
  assertEquals((parseAgeBandChoice({ ageBand: '13_17', guardianConsent: 'yes' }) as { code: string }).code, 'guardian_consent_required');
});

Deno.test('handleRecordAgeBand: the three refusals are 400s by name and never reach the recorder', async () => {
  for (const [body, code] of [
    ['not an object', 'invalid_body'],
    [{}, 'age_band_required'],
    [{ ageBand: 'under_13' }, 'age_band_required'],
    [{ ageBand: '13_17' }, 'guardian_consent_required'],
  ] as const) {
    const recorder = new FakeRecorder();
    const result = await handleRecordAgeBand({ ageBandRecorder: recorder }, CALLER, body);
    assertEquals(result.status, 400);
    if (result.status !== 200) assertEquals(result.body.code, code);
    assertEquals(recorder.calls.length, 0);
  }
});

Deno.test('handleRecordAgeBand: records for the JWT caller, never for an id in the body', async () => {
  const recorder = new FakeRecorder();
  const result = await handleRecordAgeBand(
    { ageBandRecorder: recorder },
    CALLER,
    { ageBand: '13_17', guardianConsent: true, userId: 'someone-else', p_user_id: 'someone-else' },
  );
  assertEquals(result, { status: 200, body: { ageBand: '13_17', guardianConsentRecorded: true } });
  assertEquals(recorder.calls, [{ userId: CALLER, choice: { ageBand: '13_17', guardianConsent: true } }]);
});

Deno.test('handleRecordAgeBand: 18_plus reports no consent recorded', async () => {
  const result = await handleRecordAgeBand({ ageBandRecorder: new FakeRecorder() }, CALLER, { ageBand: '18_plus' });
  assertEquals(result, { status: 200, body: { ageBand: '18_plus', guardianConsentRecorded: false } });
});

Deno.test('handleRecordAgeBand: write-once is a 409, an outage a 500, a DB refusal a 400 by name', async () => {
  const cases: Array<[RecordAgeBandOutcome, number, string]> = [
    [{ outcome: 'already_recorded' }, 409, 'age_band_already_recorded'],
    [{ outcome: 'unavailable', message: 'boom' }, 500, 'age_band_unavailable'],
    [{ outcome: 'refused', code: 'profile_not_found' }, 400, 'profile_not_found'],
  ];
  for (const [outcome, status, code] of cases) {
    const result = await handleRecordAgeBand({ ageBandRecorder: new FakeRecorder(outcome) }, CALLER, { ageBand: '18_plus' });
    assertEquals(result.status, status);
    if (result.status !== 200) assertEquals(result.body.code, code);
  }
});

Deno.test('createAgeBandRecorder: calls the RPC with the server-stamped policy version and maps its errors', async () => {
  const calls: unknown[] = [];
  let nextError: { message: string } | null = null;
  const rpc: AgeBandRpc = {
    rpc: (fn, args) => {
      calls.push([fn, args]);
      return Promise.resolve({ error: nextError });
    },
  };
  const recorder = createAgeBandRecorder(rpc);

  assertEquals(await recorder.record('u1', { ageBand: '13_17', guardianConsent: true }), { outcome: 'recorded' });
  assertEquals(calls, [
    [
      'pace_record_age_band',
      { p_user_id: 'u1', p_age_band: '13_17', p_guardian_consent: true, p_policy_version: PRIVACY_POLICY_VERSION },
    ],
  ]);

  nextError = { message: 'age_band_already_recorded' };
  assertEquals(await recorder.record('u1', { ageBand: '18_plus', guardianConsent: false }), { outcome: 'already_recorded' });
  nextError = { message: 'guardian_consent_required' };
  assertEquals(await recorder.record('u1', { ageBand: '13_17', guardianConsent: false }), {
    outcome: 'refused',
    code: 'guardian_consent_required',
  });
  nextError = { message: 'age_band_invalid' };
  assertEquals((await recorder.record('u1', { ageBand: '18_plus', guardianConsent: false })).outcome, 'refused');
  nextError = { message: 'profile_not_found' };
  assertEquals((await recorder.record('u1', { ageBand: '18_plus', guardianConsent: false })).outcome, 'refused');
  nextError = { message: 'Could not find the function public.pace_record_age_band' };
  assertEquals((await recorder.record('u1', { ageBand: '18_plus', guardianConsent: false })).outcome, 'unavailable');

  const throwing: AgeBandRpc = { rpc: () => Promise.reject(new Error('network')) };
  assertEquals(await createAgeBandRecorder(throwing).record('u1', { ageBand: '18_plus', guardianConsent: false }), {
    outcome: 'unavailable',
    message: 'network',
  });
});
