/**
 * Regression locks for `lib/consent.ts` (issue #68).
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
 */
import { grantConsent, hasConsented, UPLOAD_HEALTH_CONSENT, withdrawConsent } from '../consent';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

type Row = { granted: boolean };
type QueryError = { message: string };

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
