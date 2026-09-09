import {
  assertEquals,
  assertMatch,
  assertNotEquals,
  assertRejects,
  assertStringIncludes,
} from 'jsr:@std/assert@1';
import {
  ANALYZE_FORM_ANALYZER_REVISION,
  deriveAnalyzeFormIdentity,
} from '../analyze-form-fingerprint.ts';
import type { AnalyzeFormPromptInput, PaceFrame } from '../analyze-form-prompt.ts';
import { formatObservedVarianceSummary } from '../evals/stride-burst-latency.live.ts';

const USER_ID = '11111111-2222-4333-8444-555555555555';

function frame(
  base64: string,
  requestedTimestampMs: number,
  mediaType: PaceFrame['mediaType'] = 'image/jpeg'
): PaceFrame {
  return { base64, mediaType, requestedTimestampMs };
}

function input(overrides: Partial<AnalyzeFormPromptInput> = {}): AnalyzeFormPromptInput {
  return {
    tier: 'elite',
    media: 'video',
    frames: [frame('YWxwaGE=', 12.5), frame('YnJhdm8=', 712.5)],
    ...overrides,
  };
}

Deno.test('analysis identity is stable, lowercase SHA-256, and carries the deliberate analyzer revision', async () => {
  const first = await deriveAnalyzeFormIdentity({ authenticatedUserId: USER_ID, ...input() });
  const second = await deriveAnalyzeFormIdentity({ authenticatedUserId: USER_ID, ...input() });

  assertEquals(first, second);
  assertEquals(first.analyzer_revision, ANALYZE_FORM_ANALYZER_REVISION);
  assertMatch(first.input_fingerprint, /^[a-f0-9]{64}$/);
});

Deno.test('analysis identity hashes decoded bytes so equivalent standard base64 spellings do not fork', async () => {
  const padded = await deriveAnalyzeFormIdentity({
    authenticatedUserId: USER_ID,
    ...input({ frames: [frame('Zg==', 0)] }),
  });
  const unpaddedAndWrapped = await deriveAnalyzeFormIdentity({
    authenticatedUserId: USER_ID,
    ...input({ frames: [frame(' Zg\n', 0)] }),
  });

  assertEquals(unpaddedAndWrapped, padded);
});

Deno.test('analysis identity is user-scoped and excludes client idempotency and server tier', async () => {
  const elite = await deriveAnalyzeFormIdentity({ authenticatedUserId: USER_ID, ...input() });
  const pro = await deriveAnalyzeFormIdentity({
    authenticatedUserId: USER_ID,
    ...input({ tier: 'pro' }),
  });
  const anotherUser = await deriveAnalyzeFormIdentity({
    authenticatedUserId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ...input(),
  });

  assertEquals(pro, elite, 'tier belongs to the DB reuse key, not the raw evidence digest');
  assertNotEquals(anotherUser.input_fingerprint, elite.input_fingerprint);
});

Deno.test('analysis identity binds media kind, ordered frame count, exact timestamps, frame media type, and decoded bytes', async () => {
  const baselineInput = input();
  const baseline = await deriveAnalyzeFormIdentity({ authenticatedUserId: USER_ID, ...baselineInput });
  const changes: [string, AnalyzeFormPromptInput][] = [
    ['media kind', input({ media: 'photo' })],
    ['ordered frame count', input({ frames: baselineInput.frames.slice(0, 1) })],
    ['frame order', input({ frames: [...baselineInput.frames].reverse() })],
    [
      'exact timestamp',
      input({ frames: [frame('YWxwaGE=', 12.500000000000002), baselineInput.frames[1]] }),
    ],
    [
      'frame media type',
      input({ frames: [frame('YWxwaGE=', 12.5, 'image/png'), baselineInput.frames[1]] }),
    ],
    ['decoded bytes', input({ frames: [frame('YWxwaGY=', 12.5), baselineInput.frames[1]] })],
  ];

  for (const [label, changed] of changes) {
    const identity = await deriveAnalyzeFormIdentity({ authenticatedUserId: USER_ID, ...changed });
    assertNotEquals(identity.input_fingerprint, baseline.input_fingerprint, `${label} was not bound`);
  }
});

Deno.test('analysis identity fails honestly instead of hashing malformed base64', async () => {
  for (const malformed of ['*', 'A', 'Zh==']) {
    await assertRejects(
      () =>
        deriveAnalyzeFormIdentity({
          authenticatedUserId: USER_ID,
          ...input({ frames: [frame(malformed, 0)] }),
        }),
      Error,
      'frame 0 contains malformed base64'
    );
  }
});

Deno.test('live harness reports explicit observed ranges, unique bands, score/band stability, and first-attempt configuration', () => {
  const records = [
    varianceRecord({ posture: [74, 'good'], armSwing: [68, 'mid'], cadence: [58, 'mid'], elasticity: [55, 'mid'] }, [63, 'mid']),
    varianceRecord({ posture: [68, 'mid'], armSwing: [72, 'good'], cadence: [42, 'low'], elasticity: [55, 'mid'] }, [57, 'mid']),
    varianceRecord({ posture: [74, 'good'], armSwing: [58, 'mid'], cadence: [55, 'mid'], elasticity: [55, 'mid'] }, [63, 'mid']),
  ];

  const summary = formatObservedVarianceSummary(records, {
    repeat: 3,
    model: 'claude-sonnet-5',
    effort: 'low',
    maxTokens: 8000,
  });

  assertStringIncludes(summary, 'observed variance summary — N=3');
  assertStringIncludes(summary, 'model claude-sonnet-5 · effort low · max_tokens 8000');
  assertStringIncludes(summary, 'first-attempt direct path (no production retry or fallback)');
  assertStringIncludes(summary, 'posture');
  assertStringIncludes(summary, 'min 68 · max 74 · observed range 6');
  assertStringIncludes(summary, 'unique bands good, mid · score/band verdict UNSTABLE');
  assertStringIncludes(summary, 'cadence');
  assertStringIncludes(summary, 'min 42 · max 58 · observed range 16');
  assertStringIncludes(summary, 'unique bands low, mid · score/band verdict UNSTABLE');
  assertStringIncludes(summary, 'elasticity');
  assertStringIncludes(summary, 'min 55 · max 55 · observed range 0');
  assertStringIncludes(summary, 'unique bands mid · score/band verdict STABLE');
  assertStringIncludes(summary, 'overall');
  assertStringIncludes(summary, 'min 57 · max 63 · observed range 6');
  assertStringIncludes(summary, 'unique bands mid · score/band verdict UNSTABLE');
  assertEquals(summary.includes('maximum variance'), false, 'finite samples establish an observed range, not a bound');
});

type ScoreBand = readonly [number, string];

function varianceRecord(
  pillars: Record<'posture' | 'armSwing' | 'cadence' | 'elasticity', ScoreBand>,
  overall: ScoreBand
): Record<string, unknown> {
  return {
    pillars: Object.fromEntries(
      Object.entries(pillars).map(([id, [score, band]]) => [id, { score, band }])
    ),
    overall: { score: overall[0], band: overall[1] },
  };
}
