/**
 * Regression locks for `lib/history.ts` (issue #55).
 *
 * The load-bearing cases in this file, roughly in order of how badly a regression would hurt:
 *   1. `readHistoryRow`/`readHistoryRows` NEVER let a soft-deleted or not-yet-delivered row onto
 *      the list — a regression here would show a user a redacted or in-flight row as if it were
 *      a real result.
 *   2. `signFrameStrip` and `parseSignedUrlBatch` never throw and never crash the whole list over
 *      one row's media being gone (this file's own header: "handle a row whose media is gone
 *      without crashing").
 *   3. `deleteHistoryAnalysis` never reports a success it cannot confirm from a recognized 200
 *      body, mirroring `lib/delete-account.test.ts`'s F1 regression lock for the exact same
 *      class of bug on a sibling endpoint.
 *   4. `formatHistoryItemA11yLabel` never stringifies a null overall score as a number.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import {
  allNotAssessedOutcome,
  fallbackOutcome,
  freeTierOutcome,
} from '../pace-fixtures';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: {
    from: jest.fn(),
    storage: { from: jest.fn() },
    functions: { invoke: jest.fn() },
  },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;
const mockStorageFrom = supabase.storage.from as jest.MockedFunction<typeof supabase.storage.from>;
const mockInvoke = supabase.functions.invoke as jest.MockedFunction<typeof supabase.functions.invoke>;

// Re-imported after the mocks are registered, matching this repo's established pattern
// (lib/__tests__/consent.test.ts, lib/__tests__/delete-account.test.ts).
import {
  deleteHistoryAnalysis,
  fetchHistoryList,
  formatHistoryDate,
  formatHistoryItemA11yLabel,
  formatHistoryItemDeleteA11yLabel,
  parseSignedUrlBatch,
  readHistoryRow,
  readHistoryRows,
  signFrameStrip,
  type HistoryAnalysisRow,
} from '../history';

beforeEach(() => {
  jest.clearAllMocks();
});

// -------------------------------------------------------------------------------------------
// readHistoryRow / readHistoryRows
// -------------------------------------------------------------------------------------------

function baseRow(overrides: Partial<HistoryAnalysisRow> = {}): HistoryAnalysisRow {
  return {
    id: 'a1111111-1111-1111-1111-111111111111',
    created_at: '2026-07-12T10:00:00.000Z',
    status: 'delivered',
    result: freeTierOutcome.result,
    is_fallback: freeTierOutcome.isFallback,
    media_paths: ['user1/a1111111-1111-1111-1111-111111111111/frame-00.jpg'],
    media_type: 'photo',
    deleted_at: null,
    ...overrides,
  };
}

describe('readHistoryRow', () => {
  it('maps a valid delivered row to a list item', () => {
    const row = baseRow();

    expect(readHistoryRow(row)).toEqual({
      id: row.id,
      createdAt: row.created_at,
      mediaType: 'photo',
      outcome: { result: freeTierOutcome.result, isFallback: false },
      mediaPaths: row.media_paths,
    });
  });

  // THE SOFT-DELETE LOCK. Never let a redacted row masquerade as a real one.
  it('returns null for a soft-deleted row, regardless of what result/media_paths still say', () => {
    const row = baseRow({ deleted_at: '2026-07-13T00:00:00.000Z' });
    expect(readHistoryRow(row)).toBeNull();
  });

  it.each(['reserved', 'released'] as const)('returns null for a %s (not yet delivered) row', (status) => {
    const row = baseRow({ status });
    expect(readHistoryRow(row)).toBeNull();
  });

  it('returns null for a delivered row whose result fails structural validation', () => {
    const row = baseRow({ result: { garbage: true } });
    expect(readHistoryRow(row)).toBeNull();
  });

  it('preserves an empty media_paths array rather than treating it as invalid', () => {
    const row = baseRow({ media_paths: [] });
    const item = readHistoryRow(row);
    expect(item?.mediaPaths).toEqual([]);
  });
});

describe('readHistoryRows', () => {
  it('filters out invalid rows and keeps the query order of the rest', () => {
    const first = baseRow({ id: 'a0000000-0000-0000-0000-000000000001' });
    const softDeleted = baseRow({ id: 'a0000000-0000-0000-0000-000000000002', deleted_at: '2026-07-13T00:00:00.000Z' });
    const second = baseRow({ id: 'a0000000-0000-0000-0000-000000000003' });

    const items = readHistoryRows([first, softDeleted, second]);

    expect(items.map((item) => item.id)).toEqual([first.id, second.id]);
  });

  it('returns an empty array for an empty input, never throwing', () => {
    expect(readHistoryRows([])).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// formatHistoryDate
// -------------------------------------------------------------------------------------------

describe('formatHistoryDate', () => {
  it('formats a valid ISO timestamp as a non-empty, locale-formatted string', () => {
    const formatted = formatHistoryDate('2026-07-12T10:00:00.000Z');
    expect(typeof formatted).toBe('string');
    expect(formatted.length).toBeGreaterThan(0);
    // Loose on exact locale rendering (environment-dependent) — only asserts the year survived.
    expect(formatted).toMatch(/2026/);
  });
});

// -------------------------------------------------------------------------------------------
// formatHistoryItemA11yLabel — the null-overall honesty rule.
// -------------------------------------------------------------------------------------------

describe('formatHistoryItemA11yLabel', () => {
  it('fills in date, score, and band for a scored overall', () => {
    const item = readHistoryRow(baseRow())!;
    const label = formatHistoryItemA11yLabel(item, 'Jul 12, 2026');

    expect(label).toBe('Analysis from Jul 12, 2026, overall 64 out of 100, Developing.');
  });

  // THE HONESTY LOCK: a null overall must never render as "overall null out of 100" or "overall
  // 0 out of 100" — both would be a fabricated number for real absence of data.
  it('never stringifies a null overall score — falls back to the not-assessed sentence', () => {
    const row = baseRow({ result: allNotAssessedOutcome.result, is_fallback: allNotAssessedOutcome.isFallback });
    const item = readHistoryRow(row)!;
    const label = formatHistoryItemA11yLabel(item, 'Jul 12, 2026');

    expect(label).toBe('Analysis from Jul 12, 2026, not assessed.');
    expect(label).not.toMatch(/null|undefined|NaN/);
  });

  it('reports a real score for a fallback/partial result whose overall is still scored', () => {
    const row = baseRow({ result: fallbackOutcome.result, is_fallback: fallbackOutcome.isFallback });
    const item = readHistoryRow(row)!;
    const label = formatHistoryItemA11yLabel(item, 'Jul 12, 2026');

    expect(label).toBe('Analysis from Jul 12, 2026, overall 61 out of 100, Developing.');
  });
});

// -------------------------------------------------------------------------------------------
// formatHistoryItemDeleteA11yLabel — issue #62 audit finding #2: the per-row Delete button used
// to announce the bare static string "Delete" for every row, indistinguishable from any other
// row's Delete control. This mirrors formatHistoryItemA11yLabel's own honesty rule and its test
// coverage above.
// -------------------------------------------------------------------------------------------

describe('formatHistoryItemDeleteA11yLabel', () => {
  it('fills in date, score, and band for a scored overall', () => {
    const item = readHistoryRow(baseRow())!;
    const label = formatHistoryItemDeleteA11yLabel(item, 'Jul 12, 2026');

    expect(label).toBe('Delete analysis from Jul 12, 2026, overall 64 out of 100, Developing.');
  });

  // THE HONESTY LOCK, same as formatHistoryItemA11yLabel: a null overall must never render as
  // "overall null out of 100" or "overall 0 out of 100".
  it('never stringifies a null overall score — falls back to the not-assessed sentence', () => {
    const row = baseRow({ result: allNotAssessedOutcome.result, is_fallback: allNotAssessedOutcome.isFallback });
    const item = readHistoryRow(row)!;
    const label = formatHistoryItemDeleteA11yLabel(item, 'Jul 12, 2026');

    expect(label).toBe('Delete analysis from Jul 12, 2026, not assessed.');
    expect(label).not.toMatch(/null|undefined|NaN/);
  });

  // Distinguishes one row's Delete label from another's — the whole point of the fix (a
  // screen-reader user could not previously tell which row a given Delete button would remove).
  it('produces a different label per item, not a static "Delete"', () => {
    const scored = readHistoryRow(baseRow({ id: 'a0000000-0000-0000-0000-000000000001' }))!;
    const notAssessed = readHistoryRow(
      baseRow({
        id: 'a0000000-0000-0000-0000-000000000002',
        result: allNotAssessedOutcome.result,
        is_fallback: allNotAssessedOutcome.isFallback,
      })
    )!;

    const scoredLabel = formatHistoryItemDeleteA11yLabel(scored, 'Jul 12, 2026');
    const notAssessedLabel = formatHistoryItemDeleteA11yLabel(notAssessed, 'Jul 13, 2026');

    expect(scoredLabel).not.toBe(notAssessedLabel);
    expect(scoredLabel).not.toBe('Delete');
    expect(notAssessedLabel).not.toBe('Delete');
  });
});

// -------------------------------------------------------------------------------------------
// parseSignedUrlBatch
// -------------------------------------------------------------------------------------------

describe('parseSignedUrlBatch', () => {
  it('returns an empty array for null/undefined input', () => {
    expect(parseSignedUrlBatch(null)).toEqual([]);
    expect(parseSignedUrlBatch(undefined)).toEqual([]);
  });

  it('drops entries with no signedUrl (the object could not be signed) without throwing', () => {
    const urls = parseSignedUrlBatch([
      { path: 'a', signedUrl: 'https://example.com/a?token=1', error: null },
      { path: 'b', signedUrl: null, error: 'Object not found' },
      { path: 'c', signedUrl: 'https://example.com/c?token=2', error: null },
    ]);

    expect(urls).toEqual(['https://example.com/a?token=1', 'https://example.com/c?token=2']);
  });

  it('returns an empty array when every entry failed to sign', () => {
    const urls = parseSignedUrlBatch([{ path: 'a', signedUrl: null, error: 'gone' }]);
    expect(urls).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// fetchHistoryList
// -------------------------------------------------------------------------------------------

/** Mocks `.from('analyses').select(..).is(..).eq(..).order(..)`. */
function mockAnalysesSelectChain(result: { data: unknown; error: { message: string } | null }) {
  const order = jest.fn().mockResolvedValue(result);
  const eq = jest.fn().mockReturnValue({ order });
  const is = jest.fn().mockReturnValue({ eq });
  const select = jest.fn().mockReturnValue({ is });
  mockFrom.mockReturnValue({ select } as never);
  return { select, is, eq, order };
}

describe('fetchHistoryList', () => {
  it('queries the caller-scoped analyses list: not-deleted, delivered, newest first', async () => {
    const row = baseRow();
    const chain = mockAnalysesSelectChain({ data: [row], error: null });

    const items = await fetchHistoryList();

    expect(mockFrom).toHaveBeenCalledWith('analyses');
    expect(chain.is).toHaveBeenCalledWith('deleted_at', null);
    expect(chain.eq).toHaveBeenCalledWith('status', 'delivered');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(items).toEqual(readHistoryRows([row]));
  });

  it('treats a null data response as an empty list, not a crash', async () => {
    mockAnalysesSelectChain({ data: null, error: null });
    await expect(fetchHistoryList()).resolves.toEqual([]);
  });

  // FAIL CLOSED — same discipline lib/consent.ts's hasConsented documents for itself: a query
  // failure must never silently look like "you have no history yet".
  it('throws when the query fails, rather than returning an empty list', async () => {
    mockAnalysesSelectChain({ data: null, error: { message: 'network unreachable' } });
    await expect(fetchHistoryList()).rejects.toThrow('network unreachable');
  });
});

// -------------------------------------------------------------------------------------------
// signFrameStrip
// -------------------------------------------------------------------------------------------

describe('signFrameStrip', () => {
  it('returns [] immediately for an empty path list, without calling Storage', async () => {
    await expect(signFrameStrip([])).resolves.toEqual([]);
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it('signs every path with the short TTL and returns the usable URLs', async () => {
    const createSignedUrls = jest.fn().mockResolvedValue({
      data: [{ path: 'p1', signedUrl: 'https://example.com/p1?token=1', error: null }],
      error: null,
    });
    mockStorageFrom.mockReturnValue({ createSignedUrls } as never);

    const urls = await signFrameStrip(['p1']);

    expect(mockStorageFrom).toHaveBeenCalledWith('media');
    expect(createSignedUrls).toHaveBeenCalledWith(['p1'], 60 * 60);
    expect(urls).toEqual(['https://example.com/p1?token=1']);
  });

  // "HANDLE A ROW WHOSE MEDIA IS GONE WITHOUT CRASHING" — a Storage-level error must not throw.
  it('returns [] (never throws) when Storage reports a batch-level error', async () => {
    const createSignedUrls = jest.fn().mockResolvedValue({ data: null, error: { message: 'bucket unreachable' } });
    mockStorageFrom.mockReturnValue({ createSignedUrls } as never);

    await expect(signFrameStrip(['p1'])).resolves.toEqual([]);
  });

  it('returns [] (never throws/rejects) when the Storage call itself throws', async () => {
    const createSignedUrls = jest.fn().mockRejectedValue(new Error('network down'));
    mockStorageFrom.mockReturnValue({ createSignedUrls } as never);

    await expect(signFrameStrip(['p1'])).resolves.toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------
// deleteHistoryAnalysis
// -------------------------------------------------------------------------------------------

/** A minimal fake `Response`-shaped object — mirrors lib/__tests__/delete-account.test.ts's
 * identical helper (`FunctionsHttpError.context` is only ever `.json()`-read). */
function fakeJsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe('deleteHistoryAnalysis', () => {
  it('calls DELETE /functions/v1/analysis/:id and reports a plain success', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: true, alreadyDeleted: false }, error: null } as never);

    const result = await deleteHistoryAnalysis('a1111111-1111-1111-1111-111111111111');

    expect(mockInvoke).toHaveBeenCalledWith('analysis/a1111111-1111-1111-1111-111111111111', { method: 'DELETE' });
    expect(result).toEqual({ ok: true, data: { alreadyDeleted: false } });
  });

  it('reports alreadyDeleted: true when a retried delete lands on an already-purged row', async () => {
    mockInvoke.mockResolvedValue({ data: { deleted: true, alreadyDeleted: true }, error: null } as never);

    const result = await deleteHistoryAnalysis('a1111111-1111-1111-1111-111111111111');

    expect(result).toEqual({ ok: true, data: { alreadyDeleted: true } });
  });

  // THE F1-ADJACENT LOCK, same class of bug lib/delete-account.test.ts guards for its own
  // endpoint: a 200 body that doesn't match the documented shape must never read as a success.
  it('does NOT report success for a 200 body it does not recognize', async () => {
    mockInvoke.mockResolvedValue({ data: { unexpected: 'shape' }, error: null } as never);

    const result = await deleteHistoryAnalysis('a1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it.each([
    ['not_found', "No analysis exists with that id."],
    ['not_yours', 'This analysis does not belong to the authenticated user.'],
    ['purge_failed', 'Could not remove the stored media for this analysis. Nothing was deleted — please try again.'],
  ] as const)('maps a documented %s failure through, code and message intact', async (code, error) => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error, code })),
    } as never);

    const result = await deleteHistoryAnalysis('a1');

    expect(result).toEqual({ ok: false, error: { error, code } });
  });

  it('folds an unrecognized error code into the client-side "unknown" bucket', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError(fakeJsonResponse({ error: 'Something new.', code: 'a_future_code' })),
    } as never);

    const result = await deleteHistoryAnalysis('a1');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the failure branch');
    expect(result.error.code).toBe('unknown');
  });

  it('resolves — never rejects — a FunctionsHttpError whose body is not valid JSON', async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: new FunctionsHttpError({
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON');
        },
      } as unknown as Response),
    } as never);

    await expect(deleteHistoryAnalysis('a1')).resolves.toEqual({
      ok: false,
      error: { error: 'This analysis could not be deleted.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — a relay/network error with no structured body at all', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('network down') } as never);

    await expect(deleteHistoryAnalysis('a1')).resolves.toEqual({
      ok: false,
      error: { error: 'This analysis could not be deleted.', code: 'unknown' },
    });
  });

  it('resolves — never rejects — even if invoke() itself throws synchronously', async () => {
    mockInvoke.mockImplementation(() => {
      throw new Error('unexpected synchronous throw');
    });

    await expect(deleteHistoryAnalysis('a1')).resolves.toEqual({
      ok: false,
      error: { error: 'This analysis could not be deleted.', code: 'unknown' },
    });
  });
});
