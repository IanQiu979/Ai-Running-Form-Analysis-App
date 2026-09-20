/**
 * `lib/age-band.ts` — who gets the one-time age gate, how the band on file is read, and that the
 * `record-age-band` client parses the SERVER's 200 body (built from `@shared/record-age-band`'s own
 * handler, never transcribed — CLAUDE.md's wire-shape rule) and passes refusals through by name.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { handleRecordAgeBand } from '@shared/record-age-band';

import {
  describeRecordAgeBandError,
  hasAgeBandBeenRecordedLocally,
  isOAuthCreatedAccount,
  markAgeBandRecordedLocally,
  readAgeBand,
  recordAgeBand,
  type RecordAgeBandErrorCode,
} from '../age-band';
import { supabase } from '../supabase';
import { Copy } from '@/constants/copy';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn(), functions: { invoke: jest.fn() } },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

function mockProfileRead(result: { data: { age_band: string | null } | null; error: { message: string } | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ limit });
  mockFrom.mockReturnValue({ select } as never);
  return { select };
}

function fakeJsonResponse(body: unknown) {
  return { json: () => Promise.resolve(body), status: 400 } as unknown as Response;
}

function sessionWithProvider(provider: string | undefined) {
  return { user: { id: 'u1', app_metadata: provider === undefined ? {} : { provider } } } as never;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockInvoke.mockReset();
});

describe('isOAuthCreatedAccount', () => {
  it('is true for google (and any non-email provider), false for email, null and unknown', () => {
    expect(isOAuthCreatedAccount(sessionWithProvider('google'))).toBe(true);
    expect(isOAuthCreatedAccount(sessionWithProvider('apple'))).toBe(true);
    expect(isOAuthCreatedAccount(sessionWithProvider('email'))).toBe(false);
    expect(isOAuthCreatedAccount(sessionWithProvider(undefined))).toBe(false);
    expect(isOAuthCreatedAccount(null)).toBe(false);
  });
});

describe('readAgeBand', () => {
  it('reads profiles.age_band with no user filter (RLS scopes the row)', async () => {
    const { select } = mockProfileRead({ data: { age_band: '13_17' }, error: null });
    await expect(readAgeBand()).resolves.toBe('13_17');
    expect(mockFrom).toHaveBeenCalledWith('profiles');
    expect(select).toHaveBeenCalledWith('age_band');
  });

  it('is null for a NULL band, a missing row, or an unrecognised value', async () => {
    mockProfileRead({ data: { age_band: null }, error: null });
    await expect(readAgeBand()).resolves.toBeNull();
    mockProfileRead({ data: null, error: null });
    await expect(readAgeBand()).resolves.toBeNull();
    mockProfileRead({ data: { age_band: 'under_13' }, error: null });
    await expect(readAgeBand()).resolves.toBeNull();
  });

  it('throws on a query failure rather than guessing either way', async () => {
    mockProfileRead({ data: null, error: { message: 'network request failed' } });
    await expect(readAgeBand()).rejects.toThrow(/network request failed/);
  });
});

describe('recordAgeBand', () => {
  it('sends the server\'s field names and parses the server\'s own 200 body', async () => {
    const server = await handleRecordAgeBand(
      { ageBandRecorder: { record: async () => ({ outcome: 'recorded' }) } },
      'u1',
      { ageBand: '13_17', guardianConsent: true }
    );
    if (server.status !== 200) throw new Error('stub should succeed');
    mockInvoke.mockResolvedValue({ data: server.body, error: null } as never);

    const result = await recordAgeBand({ ageBand: '13_17', guardianConsent: true });

    expect(result).toEqual({ ok: true, data: { ageBand: '13_17', guardianConsentRecorded: true } });
    expect(mockInvoke).toHaveBeenCalledWith('record-age-band', {
      method: 'POST',
      body: { ageBand: '13_17', guardianConsent: true },
    });
  });

  it.each([
    'age_band_required',
    'guardian_consent_required',
    'age_band_already_recorded',
    'age_band_unavailable',
    'unauthorized',
  ] as const)('passes the server\'s %s code through by name', async (code) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'refused', code })),
    } as never);
    await expect(recordAgeBand({ ageBand: '18_plus', guardianConsent: false })).resolves.toEqual({ ok: false, code });
  });

  it('folds an unknown code to unknown and a network failure to network', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'x', code: 'some_future_code' })),
    } as never);
    await expect(recordAgeBand({ ageBand: '18_plus', guardianConsent: false })).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
    mockInvoke.mockResolvedValue({ data: null, error: new TypeError('Network request failed') } as never);
    await expect(recordAgeBand({ ageBand: '18_plus', guardianConsent: false })).resolves.toEqual({
      ok: false,
      code: 'network',
    });
  });

  it('refuses a 200 whose body is not the shared shape instead of trusting it', async () => {
    mockInvoke.mockResolvedValue({ data: { age_band: '18_plus' }, error: null } as never);
    await expect(recordAgeBand({ ageBand: '18_plus', guardianConsent: false })).resolves.toEqual({
      ok: false,
      code: 'unknown',
    });
  });
});

describe('describeRecordAgeBandError', () => {
  it('names the two actionable refusals and uses the save error for everything else', () => {
    expect(describeRecordAgeBandError('age_band_required')).toBe(Copy.auth.error.ageBandRequired);
    expect(describeRecordAgeBandError('guardian_consent_required')).toBe(Copy.auth.error.guardianConsentRequired);
    const rest: RecordAgeBandErrorCode[] = [
      'invalid_body',
      'unauthorized',
      'age_band_already_recorded',
      'age_band_unavailable',
      'network',
      'unknown',
    ];
    for (const code of rest) expect(describeRecordAgeBandError(code)).toBe(Copy.auth.ageGate.error.save);
  });
});

describe('the per-device "answered" note', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is false until marked, then true, and keyed per user', async () => {
    expect(await hasAgeBandBeenRecordedLocally('u1')).toBe(false);
    await markAgeBandRecordedLocally('u1');
    expect(await hasAgeBandBeenRecordedLocally('u1')).toBe(true);
    expect(await hasAgeBandBeenRecordedLocally('u2')).toBe(false);
  });

  it('never throws when storage fails — a convenience, not a gate', async () => {
    const getSpy = jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    const setSpy = jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    expect(await hasAgeBandBeenRecordedLocally('u1')).toBe(false);
    await expect(markAgeBandRecordedLocally('u1')).resolves.toBeUndefined();
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
