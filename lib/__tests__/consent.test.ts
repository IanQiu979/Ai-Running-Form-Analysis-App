/**
 * Regression locks for `lib/consent.ts` (issues #68 and #94).
 *
 * This module is a compliance control, and compliance controls fail quietly. Issue #74 is open
 * in this repo right now because `lib/hibp.ts` fails OPEN — it silently reports every password
 * as safe when the network is down, and every lint/typecheck/happy-path test stays green while
 * it does. A consent check that failed the same way would be worse: it would let Art. 9 health
 * data be processed with no legal basis and no signal that anything had gone wrong.
 *
 * So the load-bearing case here is case 5 — an error THROWS. Without it, `hasConsented` can
 * regress to `return false` on error (or, worse, `return true`) and every other test in this
 * file still passes.
 *
 * WHAT THIS SUITE CANNOT PROVE: "the latest row wins" is enforced by Postgres, not by JS — the
 * ordering happens in the database. A unit test with a mocked client can only prove that the
 * query ASKS for `created_at desc, limit 1` (case 4). That the database honors it is verified
 * against the real project in Task 1 of the plan, not here.
 *
 * `FUTURE_UPLOADS_ATTESTATION_CONSENT` and `THIRD_PARTY_ATTESTATION_CONSENT` need no new
 * behavior in this module — `hasConsented`/`grantConsent`/`withdrawConsent` are already generic
 * over `ConsentKey`, and every case above already proves the generic behavior. The one thing
 * worth locking down here instead is the keys' own VALUES: they must actually be distinct
 * strings, or the record's ability to distinguish one grant from another would be false at the
 * data layer regardless of what the UI does.
 */
import {
  ensureConsentsGranted,
  FUTURE_UPLOADS_ATTESTATION_CONSENT,
  grantConsent,
  hasConsented,
  readConsentState,
  THIRD_PARTY_ATTESTATION_CONSENT,
  UPLOAD_HEALTH_CONSENT,
  withdrawConsent,
} from '../consent';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

type Row = { granted: boolean };
type QueryError = { message: string };
type KeyState = 'none' | 'granted' | 'withdrawn' | 'error';

/**
 * Mocks `.from('consents')` with a per-key newest row for the SELECT chain and a recording INSERT,
 * so `ensureConsentsGranted`'s two reads and any grants all route through the one `from` mock.
 * Returns the inserts that landed, in order.
 */
function mockConsentTable(
  states: Record<string, KeyState>,
  options: { insertError?: QueryError | ((key: string) => QueryError | null) } = {}
) {
  const inserted: { consent_key: string; granted: boolean }[] = [];
  mockFrom.mockImplementation(() => {
    let key = '';
    const maybeSingle = jest.fn().mockImplementation(async () => {
      const state = states[key] ?? 'none';
      if (state === 'error') return { data: null, error: { message: `read failed for ${key}` } };
      if (state === 'none') return { data: null, error: null };
      return { data: { granted: state === 'granted' }, error: null };
    });
    const limit = jest.fn().mockReturnValue({ maybeSingle });
    const order = jest.fn().mockReturnValue({ limit });
    const eq = jest.fn().mockImplementation((_column: string, value: string) => {
      key = value;
      return { order };
    });
    const select = jest.fn().mockReturnValue({ eq });
    const insert = jest.fn().mockImplementation(async (row: { consent_key: string; granted: boolean }) => {
      const err =
        typeof options.insertError === 'function' ? options.insertError(row.consent_key) : options.insertError ?? null;
      if (err) return { error: err };
      inserted.push(row);
      return { error: null };
    });
    return { select, insert } as never;
  });
  return inserted;
}

/** Mocks `.from('consents').select(..).eq(..).order(..).limit(..).maybeSingle()`. */
function mockSelectChain(result: { data: Row | null; error: QueryError | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ maybeSingle });
  const order = jest.fn().mockReturnValue({ limit });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select } as never);
  return { select, eq, order, limit, maybeSingle };
}

/** Mocks `.from('consents').insert(..)`. */
function mockInsertChain(result: { error: QueryError | null }) {
  const insert = jest.fn().mockResolvedValue(result);
  mockFrom.mockReturnValue({ insert } as never);
  return { insert };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hasConsented', () => {
  // Case 1: a user who never consented has no rows at all.
  it('returns false when the user has no consent rows', async () => {
    mockSelectChain({ data: null, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(false);
  });

  // Case 2: the newest row is a grant.
  it('returns true when the newest row is a grant', async () => {
    mockSelectChain({ data: { granted: true }, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(true);
  });

  // Case 3: the newest row is a withdrawal, which supersedes any earlier grant purely by
  // being newer — there is no special case for it in the code, and there should not be.
  it('returns false when the newest row is a withdrawal', async () => {
    mockSelectChain({ data: { granted: false }, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(false);
  });

  // Case 4: THE query lock. Cases 1-3 would all still pass if the query forgot to sort, and
  // would then return whichever row Postgres happened to hand back first — which, after a
  // withdrawal, could be the stale grant. This is the only test that catches that.
  it('asks for the newest row: created_at descending, limit 1, scoped to the key', async () => {
    const chain = mockSelectChain({ data: { granted: true }, error: null });

    await hasConsented(UPLOAD_HEALTH_CONSENT);

    expect(mockFrom).toHaveBeenCalledWith('consents');
    expect(chain.select).toHaveBeenCalledWith('granted');
    expect(chain.eq).toHaveBeenCalledWith('consent_key', 'upload.health.v1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  // Case 5: FAIL CLOSED. The load-bearing case — see the suite docblock.
  it('throws when the query fails, rather than defaulting to consented or not-consented', async () => {
    mockSelectChain({ data: null, error: { message: 'network unreachable' } });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('network unreachable');
  });
});

describe('readConsentState', () => {
  // The distinction `hasConsented` collapses and a repair path must not: no row at all is a
  // legacy account that may be healed silently; a newest row of granted = false is a withdrawal
  // the user made on purpose, and re-granting over it would forge an Art. 9 consent.
  it("reports 'none' when the user has no rows for the key", async () => {
    mockSelectChain({ data: null, error: null });

    await expect(readConsentState(UPLOAD_HEALTH_CONSENT)).resolves.toBe('none');
  });

  it("reports 'granted' when the newest row is a grant", async () => {
    mockSelectChain({ data: { granted: true }, error: null });

    await expect(readConsentState(UPLOAD_HEALTH_CONSENT)).resolves.toBe('granted');
  });

  it("reports 'withdrawn' — not 'none' — when the newest row is a withdrawal", async () => {
    mockSelectChain({ data: { granted: false }, error: null });

    await expect(readConsentState(UPLOAD_HEALTH_CONSENT)).resolves.toBe('withdrawn');
  });

  it('asks for the newest row scoped to the key, same as hasConsented', async () => {
    const chain = mockSelectChain({ data: { granted: false }, error: null });

    await readConsentState(UPLOAD_HEALTH_CONSENT);

    expect(chain.eq).toHaveBeenCalledWith('consent_key', 'upload.health.v1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('throws when the query fails, rather than reporting any state', async () => {
    mockSelectChain({ data: null, error: { message: 'network unreachable' } });

    await expect(readConsentState(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('network unreachable');
  });
});

describe('grantConsent', () => {
  it('appends a row with granted = true', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(UPLOAD_HEALTH_CONSENT);

    expect(mockFrom).toHaveBeenCalledWith('consents');
    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.health.v1',
      granted: true,
    });
  });

  // Case 7: the insert must NOT name a user. user_id defaults to auth.uid() in the database,
  // so a client that supplies its own user_id is a client that could supply someone else's.
  // (The INSERT policy's with-check would reject it — but the right fix is not to send it.)
  it('never sends a user_id — the column defaults to auth.uid() from the JWT', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(UPLOAD_HEALTH_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith(expect.not.objectContaining({ user_id: expect.anything() }));
  });

  // Case 8: fail closed on write, too. A grant that silently didn't persist is worse than no
  // grant at all — the user believes they consented, and no record exists to prove it.
  it('throws when the insert fails', async () => {
    mockInsertChain({ error: { message: 'permission denied' } });

    await expect(grantConsent(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('permission denied');
  });
});

describe('withdrawConsent', () => {
  // Art. 7(3): withdrawing consent must be as easy as giving it. Unused until Settings (#53)
  // exists, but the record supports it now because the table shape is the hard part to change.
  it('appends a row with granted = false', async () => {
    const chain = mockInsertChain({ error: null });

    await withdrawConsent(UPLOAD_HEALTH_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.health.v1',
      granted: false,
    });
  });

  it('throws when the insert fails', async () => {
    mockInsertChain({ error: { message: 'permission denied' } });

    await expect(withdrawConsent(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('permission denied');
  });
});

describe('consent keys', () => {
  // The data-layer guarantee: the three keys must be three different strings, or the record's
  // ability to distinguish one grant from another collapses.
  it('gives the health, future-uploads, and third-party-attestation keys distinct values', () => {
    const keys = [UPLOAD_HEALTH_CONSENT, FUTURE_UPLOADS_ATTESTATION_CONSENT, THIRD_PARTY_ATTESTATION_CONSENT];

    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grants FUTURE_UPLOADS_ATTESTATION_CONSENT under its own key, not the self-consent key', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(FUTURE_UPLOADS_ATTESTATION_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.futureUploadsAttestation.v1',
      granted: true,
    });
  });

  it('grants THIRD_PARTY_ATTESTATION_CONSENT under its own key, not the self-consent key', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(THIRD_PARTY_ATTESTATION_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.thirdPartyAttestation.v1',
      granted: true,
    });
  });

  it('reads FUTURE_UPLOADS_ATTESTATION_CONSENT scoped to its own key', async () => {
    const chain = mockSelectChain({ data: { granted: true }, error: null });

    await hasConsented(FUTURE_UPLOADS_ATTESTATION_CONSENT);

    expect(chain.eq).toHaveBeenCalledWith('consent_key', 'upload.futureUploadsAttestation.v1');
  });
});

describe('ensureConsentsGranted', () => {
  // The self-heal every sign-up path relies on. It must decide per KEY — the sign-up grant runs
  // both inserts concurrently, so one landing says nothing about the other — and it must never
  // write over a withdrawal.
  it('is a no-op when both sign-up keys are already granted', async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'granted',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'granted',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('granted');
    expect(inserted).toEqual([]);
  });

  it('grants only the missing key when the health key landed but the future-uploads key did not', async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'granted',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'none',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('granted');
    expect(inserted).toEqual([{ consent_key: FUTURE_UPLOADS_ATTESTATION_CONSENT, granted: true }]);
  });

  it('grants only the missing key when the future-uploads key landed but the health key did not', async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'none',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'granted',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('granted');
    expect(inserted).toEqual([{ consent_key: UPLOAD_HEALTH_CONSENT, granted: true }]);
  });

  it('grants both keys for an account with no rows at all', async () => {
    const inserted = mockConsentTable({});

    await expect(ensureConsentsGranted()).resolves.toBe('granted');
    expect(inserted).toEqual(
      expect.arrayContaining([
        { consent_key: UPLOAD_HEALTH_CONSENT, granted: true },
        { consent_key: FUTURE_UPLOADS_ATTESTATION_CONSENT, granted: true },
      ])
    );
    expect(inserted).toHaveLength(2);
  });

  it("reports 'withdrawn' and writes nothing when the health key was withdrawn — even if the other key is missing", async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'withdrawn',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'none',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('withdrawn');
    expect(inserted).toEqual([]);
  });

  it("reports 'withdrawn' and writes nothing when only the future-uploads key was withdrawn", async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'granted',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'withdrawn',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('withdrawn');
    expect(inserted).toEqual([]);
  });

  it("reports 'failed' when a needed grant errors, instead of throwing", async () => {
    mockConsentTable({}, { insertError: { message: 'permission denied' } });

    await expect(ensureConsentsGranted()).resolves.toBe('failed');
  });

  it("reports 'failed' when reading either key's state errors, instead of guessing", async () => {
    const inserted = mockConsentTable({
      [UPLOAD_HEALTH_CONSENT]: 'granted',
      [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'error',
    });

    await expect(ensureConsentsGranted()).resolves.toBe('failed');
    expect(inserted).toEqual([]);
  });

  it("resolves 'failed' when the round trip outlives `timeoutMs`, so a stalled connection never holds the caller", async () => {
    jest.useFakeTimers();
    try {
      mockFrom.mockImplementation(() => {
        const maybeSingle = jest.fn().mockReturnValue(new Promise(() => undefined));
        const limit = jest.fn().mockReturnValue({ maybeSingle });
        const order = jest.fn().mockReturnValue({ limit });
        const eq = jest.fn().mockReturnValue({ order });
        const select = jest.fn().mockReturnValue({ eq });
        return { select } as never;
      });

      const pending = ensureConsentsGranted({ timeoutMs: 3000 });
      let settled = false;
      void pending.then(() => { settled = true; });

      await jest.advanceTimersByTimeAsync(2999);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toBe('failed');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let the timeout fire after a fast result has already settled', async () => {
    jest.useFakeTimers();
    try {
      mockConsentTable({
        [UPLOAD_HEALTH_CONSENT]: 'granted',
        [FUTURE_UPLOADS_ATTESTATION_CONSENT]: 'granted',
      });

      await expect(ensureConsentsGranted({ timeoutMs: 3000 })).resolves.toBe('granted');
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
