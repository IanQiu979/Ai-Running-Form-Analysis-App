import { readAnalysisRow, type AnalysisRow } from '../analysis-result';
import { fallbackResult, photoResult } from '@/lib/pace-fixtures';

function baseRow(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    status: 'delivered',
    result: photoResult,
    is_fallback: false,
    media_paths: ['user-1/analysis-1/frame-00.jpg'],
    media_type: 'photo',
    deleted_at: null,
    ...overrides,
  };
}

it('reads a delivered, structurally valid row as ready', () => {
  const state = readAnalysisRow(baseRow());

  expect(state).toEqual({
    kind: 'ready',
    outcome: { result: photoResult, isFallback: false },
    mediaPaths: ['user-1/analysis-1/frame-00.jpg'],
    mediaType: 'photo',
  });
});

it('carries isFallback through for a partial result', () => {
  const state = readAnalysisRow(baseRow({ result: fallbackResult, is_fallback: true }));

  expect(state.kind).toBe('ready');
  if (state.kind === 'ready') {
    expect(state.outcome.isFallback).toBe(true);
  }
});

it('treats a missing row (bad id, or RLS hid someone else\'s) as notFound', () => {
  expect(readAnalysisRow(null)).toEqual({ kind: 'notFound' });
});

it('treats a soft-deleted row as notFound, even if result/media_paths were somehow still present', () => {
  const state = readAnalysisRow(baseRow({ deleted_at: '2026-07-12T00:00:00Z' }));
  expect(state).toEqual({ kind: 'notFound' });
});

it('treats a still-reserved (mid-flight) row as notFound — the Analyzing screen owns that wait', () => {
  const state = readAnalysisRow(baseRow({ status: 'reserved', result: null }));
  expect(state).toEqual({ kind: 'notFound' });
});

it('treats a released (failed, no partial delivered) row as notFound', () => {
  const state = readAnalysisRow(baseRow({ status: 'released', result: null }));
  expect(state).toEqual({ kind: 'notFound' });
});

it('treats a delivered row with a structurally malformed result as invalid, not a crash', () => {
  const state = readAnalysisRow(baseRow({ result: { garbage: true } }));
  expect(state).toEqual({ kind: 'invalid' });
});

it('treats a delivered row with a null result as invalid rather than silently rendering nothing', () => {
  const state = readAnalysisRow(baseRow({ result: null }));
  expect(state).toEqual({ kind: 'invalid' });
});
