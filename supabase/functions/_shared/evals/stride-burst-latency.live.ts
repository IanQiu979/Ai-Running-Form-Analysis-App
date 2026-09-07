#!/usr/bin/env -S deno run
/**
 * STRIDE-BURST LATENCY EVAL — THIS FILE MAKES REAL, BILLED ANTHROPIC CALLS.
 *
 * Named `.live.ts`, not `.test.ts`, for the same structural reason as `grounding-eval.live.ts`:
 * Deno's test discovery cannot see it, so `npm test` / `npm run test:edge` can never run it by
 * accident. Read that file's header for the full rationale; it applies here unchanged.
 *
 * ── WHAT THIS PROVES, AND WHAT IT DOES NOT ──────────────────────────────────────────────────
 *
 * The stride-burst migration (#199/#206, `lib/frames.ts` `sampleTimestamps`) and the effort drop
 * to `low` were both landed offline; the only live numbers behind them were the core-purpose
 * audit's eleven calls (spread frames, `medium`) and a four-call `low`-vs-`medium` check on
 * 5-frame bursts. Nothing had ever measured an 8-frame (Elite) burst against the per-attempt
 * timeout, and the audit was explicit that the timeout/token constants were set before any real
 * video had been run through them. This harness closes that gap: it sends REAL burst frames —
 * extracted from a real clip at the exact timestamps production would request — through the
 * production request builder and response reader, and reports wall-clock latency against
 *   - `MODEL_CALL_TIMEOUT_MS` (the current per-attempt cap, `analyze-form/flow.ts`), and
 *   - the 65s bound the audit and the captain's brief measured against (the pre-#206 cap),
 * plus `stop_reason` and `output_tokens` against `MAX_OUTPUT_TOKENS_BY_TIER[tier]`, so a
 * truncation risk is visible as a margin, not only as a failure.
 *
 * It also greps every pillar's `feedback` and every injury flag's `detail` — the two runner-facing
 * prose fields — for a steps-per-minute figure or range, and persists both. The burst is
 * about one stride cycle — too short to count steps (see `STRIDE_BURST_VIDEO_RULES` in
 * `analyze-form-prompt.ts`) — so ANY SPM number in a burst result is the model overclaiming and is
 * printed as a WARN. That is a truth check on the prompt, not a latency number.
 *
 * It does NOT prove coaching quality (the grounding eval and a human reading the output do
 * that), does NOT measure run-to-run variance unless `--repeat` is used (model output is
 * stochastic; a single sample is one sample), and does NOT touch Supabase — no reservation, no
 * ledger row, no Storage write. What comes from production and must never be forked here: the
 * request body (`buildAnalyzeFormRequest`) and the response reader (`readAttempt`).
 *
 * ── FRAME INPUT ────────────────────────────────────────────────────────────────────────────
 *
 * `--frames DIR` must hold a `manifest.json`:
 *
 *   { "clip": "s003", "description": "...", "durationMs": 9977,
 *     "frames": [ { "file": "f1.jpg", "timestampMs": 4639 }, ... ] }
 *
 * where each `timestampMs` is what `lib/frames.ts`'s `sampleTimestamps(durationMs, count)` would
 * request for that clip and the JPEGs are the frames decoded at those instants, downscaled to a
 * 1568px long edge at JPEG q≈0.7 (`ffmpeg -ss <t> -i clip -frames:v 1 -vf scale=... -q:v 5`).
 * Frames are NOT committed to the repo — they are images of people.
 *
 * ── RUN ────────────────────────────────────────────────────────────────────────────────────
 *
 *   deno run --config supabase/functions/deno.json --env-file=supabase/functions/.env \
 *     --allow-env=ANTHROPIC_API_KEY --allow-net=api.anthropic.com --allow-read --allow-write=DIR \
 *     supabase/functions/_shared/evals/stride-burst-latency.live.ts \
 *     --frames DIR --tier elite [--repeat 2] [--effort low] [--out DIR/results.json] [--dry-run]
 *
 * One call per `--repeat` (default 1). `--dry-run` builds the request, prints its size and burst
 * classification, and makes zero calls — start there.
 */

import {
  ANALYZE_FORM_EFFORT,
  ANALYZE_FORM_MODEL,
  buildAnalyzeFormRequest,
  formatFrameManifest,
  type AnalyzeFormRequest,
  type PaceEffort,
  type PaceFrame,
} from '../analyze-form-prompt.ts';
import { readAttempt, type AnthropicMessageResponse } from '../analyze-form-validation.ts';
import { MODEL_CALL_TIMEOUT_MS } from '../../analyze-form/flow.ts';
import { AI_MODEL_PRICING, computeCostUsd, MAX_OUTPUT_TOKENS_BY_TIER } from '../ai-pricing.ts';
import { PACE_FRAME_CAP, PACE_PILLARS, type PaceTier } from '../pace.ts';
import { toBase64 } from './grounding-eval-images.ts';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** The per-attempt cap the audit and the captain's brief measured against — the value
 * `MODEL_CALL_TIMEOUT_MS` held before #206 raised it. Reported alongside the current cap so a
 * reader can see how much of the raise a real burst actually needs. */
const LEGACY_ATTEMPT_TIMEOUT_MS = 65_000;

/** A steps-per-minute figure or range anywhere in runner-facing prose — `feedback` AND
 * `flags[].detail`, the two fields that carry a claim about THIS runner (the same scope
 * `grounding-eval.ts`'s `checkNoFalsePrecision` uses, and for the same reason: `drills[]`
 * instructions are quoted from the certified corpus and legitimately say "~2 SPM").
 * Case-insensitive; the unit alternation covers "SPM", "steps per minute", "steps/min" and
 * "steps a minute". */
const SPM_UNIT = String.raw`(?:spm\b|steps\s*(?:per|a|\/)\s*min(?:ute)?s?\b)`;
const SPM_RANGE = new RegExp(String.raw`\b\d{2,3}\s*(?:[-–—]|\bto\b)\s*\d{2,3}\s*${SPM_UNIT}`, 'i');
const SPM_POINT = new RegExp(String.raw`\b\d{2,3}\s*${SPM_UNIT}`, 'i');

interface Manifest {
  clip: string;
  description?: string;
  durationMs: number;
  frames: { file: string; timestampMs: number }[];
}

interface Args {
  framesDir: string;
  tier: PaceTier;
  repeat: number;
  effort: PaceEffort;
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const framesDir = get('--frames');
  const tier = get('--tier') as PaceTier | undefined;
  if (!framesDir || !tier) {
    console.error('usage: --frames DIR --tier pro|elite [--repeat N] [--effort low] [--out FILE] [--dry-run]');
    Deno.exit(2);
  }
  if (!(tier in PACE_FRAME_CAP)) {
    console.error(`unknown tier "${tier}"`);
    Deno.exit(2);
  }
  const rawRepeat = get('--repeat');
  const repeat = rawRepeat === undefined ? 1 : Number(rawRepeat);
  if (!Number.isInteger(repeat) || repeat < 1) {
    console.error(`--repeat must be a positive integer, got "${rawRepeat}"`);
    Deno.exit(2);
  }
  return {
    framesDir,
    tier,
    repeat,
    effort: (get('--effort') as PaceEffort | undefined) ?? ANALYZE_FORM_EFFORT,
    out: get('--out') ?? `${framesDir}/latency-results.json`,
    dryRun: argv.includes('--dry-run'),
  };
}

async function loadFrames(framesDir: string): Promise<{ manifest: Manifest; frames: PaceFrame[]; bytes: number }> {
  const manifest = JSON.parse(await Deno.readTextFile(`${framesDir}/manifest.json`)) as Manifest;
  const frames: PaceFrame[] = [];
  let bytes = 0;
  for (const entry of manifest.frames) {
    const base64 = toBase64(await Deno.readFile(`${framesDir}/${entry.file}`));
    bytes += base64.length;
    frames.push({ base64, mediaType: 'image/jpeg', requestedTimestampMs: entry.timestampMs });
  }
  return { manifest, frames, bytes };
}

/** The results file is an append-only JSON array. A missing file is the first run; a file holding
 * anything else is a mistake worth refusing while it is still free to refuse. */
async function loadExistingRecords(out: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await Deno.readTextFile(out);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`${out} exists but is not valid JSON. Move or delete it, or pass a different --out.`);
    Deno.exit(2);
  }
  if (!Array.isArray(parsed)) {
    console.error(`${out} exists but does not hold a JSON array. Move or delete it, or pass a different --out.`);
    Deno.exit(2);
  }
  return parsed;
}

interface CallResult {
  latencyMs: number;
  response?: AnthropicMessageResponse;
  error?: string;
}

async function callAnthropic(apiKey: string, request: AnalyzeFormRequest, timeoutMs: number): Promise<CallResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const res = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    if (!res.ok) {
      return { latencyMs, error: `Anthropic returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 600)}` };
    }
    return { latencyMs, response: (await res.json()) as AnthropicMessageResponse };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    return {
      latencyMs,
      error: controller.signal.aborted ? `Call exceeded ${timeoutMs}ms` : err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(Deno.args);
  const { manifest, frames, bytes } = await loadFrames(args.framesDir);
  const request = buildAnalyzeFormRequest(
    { tier: args.tier, media: 'video', frames },
    { effort: args.effort }
  );
  const manifestText = formatFrameManifest(frames);
  const isBurst = manifestText.includes('STRIDE BURST');
  const span = frames[frames.length - 1].requestedTimestampMs - frames[0].requestedTimestampMs;

  console.log(`clip ${manifest.clip}: ${manifest.description ?? ''}`);
  console.log(
    `tier ${args.tier} · ${frames.length} frames · span ${span}ms · ${(bytes / 1024).toFixed(0)}KB base64 · ` +
      `${isBurst ? 'STRIDE BURST' : 'NOT A BURST'} · model ${request.model} · effort ${args.effort} · max_tokens ${request.max_tokens}`
  );
  if (!isBurst) {
    console.error('The manifest does not classify as a stride burst — these are not the frames production would send.');
    Deno.exit(2);
  }
  if (args.dryRun) {
    console.log('dry run: no call made.');
    return;
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is not set.');
    Deno.exit(2);
  }

  // Read the results file BEFORE spending money: a pre-existing file holding something other than
  // a JSON array would otherwise blow up the append after the calls are already paid for.
  const existing = await loadExistingRecords(args.out);

  const pricing = AI_MODEL_PRICING[request.model];
  const records: unknown[] = [];
  for (let run = 1; run <= args.repeat; run++) {
    console.log(`\n[${run}/${args.repeat}] calling…`);
    const call = await callAnthropic(apiKey, request, MODEL_CALL_TIMEOUT_MS);
    const record: Record<string, unknown> = {
      runAt: new Date().toISOString(),
      clip: manifest.clip,
      tier: args.tier,
      frameCount: frames.length,
      spanMs: span,
      base64Bytes: bytes,
      model: request.model,
      effort: args.effort,
      maxTokens: request.max_tokens,
      latencyMs: call.latencyMs,
      withinLegacy65s: call.latencyMs <= LEGACY_ATTEMPT_TIMEOUT_MS,
      withinCurrentTimeout: call.latencyMs <= MODEL_CALL_TIMEOUT_MS,
    };

    if (!call.response) {
      record.error = call.error;
      console.log(`  FAILED after ${call.latencyMs}ms: ${call.error}`);
      records.push(record);
      continue;
    }

    const attempt = readAttempt(call.response);
    const usage = attempt.usage;
    const outputTokens = usage.output_tokens ?? 0;
    const costUsd = pricing
      ? computeCostUsd(pricing, {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheCreationInputTokens: usage.cache_creation_input_tokens,
          cacheReadInputTokens: usage.cache_read_input_tokens,
        })
      : null;
    Object.assign(record, {
      stopReason: attempt.stopReason,
      failure: attempt.failure,
      usage,
      outputTokenHeadroom: MAX_OUTPUT_TOKENS_BY_TIER[args.tier] - outputTokens,
      costUsd,
    });

    console.log(
      `  latency ${(call.latencyMs / 1000).toFixed(1)}s ` +
        `(65s bound: ${record.withinLegacy65s ? 'OK' : 'EXCEEDED'}; ${MODEL_CALL_TIMEOUT_MS / 1000}s cap: ${record.withinCurrentTimeout ? 'OK' : 'EXCEEDED'}) · ` +
        `stop ${attempt.stopReason} · out ${outputTokens}/${MAX_OUTPUT_TOKENS_BY_TIER[args.tier]} tokens · ` +
        `in ${usage.input_tokens ?? 0} (+cache r${usage.cache_read_input_tokens ?? 0}/w${usage.cache_creation_input_tokens ?? 0}) · ` +
        `${costUsd === null ? 'cost n/a' : `$${costUsd.toFixed(3)}`}`
    );

    if (attempt.failure) {
      console.log(`  failure: ${attempt.failure}${attempt.salvage ? ' (partial salvage available)' : ''}`);
    }
    if (attempt.result) {
      const pillars: Record<string, unknown> = {};
      const spmMentions: string[] = [];
      for (const id of PACE_PILLARS) {
        const p = attempt.result.pillars[id];
        const feedback = p.feedback ?? '';
        const runnerFacing: { where: string; text: string }[] = [
          { where: 'feedback', text: feedback },
          ...p.flags.map((f) => ({ where: `flag ${f.pattern}`, text: f.detail ?? '' })),
        ];
        for (const { where, text } of runnerFacing) {
          const spm = text.match(SPM_RANGE)?.[0] ?? text.match(SPM_POINT)?.[0];
          if (spm) spmMentions.push(`${id} ${where}: "${spm}"`);
        }
        pillars[id] = {
          score: p.score,
          band: p.band,
          notAssessedReason: p.notAssessedReason ?? null,
          flags: p.flags.map((f) => ({ pattern: f.pattern, detail: f.detail })),
          drills: p.drills.map((d) => d.name),
          feedback,
        };
        console.log(
          `  ${id.padEnd(10)} ${p.score === null ? `null (${p.notAssessedReason ?? '?'})` : `${p.score} ${p.band}`}` +
            `${p.flags.length ? ` flags[${p.flags.map((f) => f.pattern).join(', ')}]` : ''}` +
            ` — ${feedback.slice(0, 140).replace(/\s+/g, ' ')}…`
        );
      }
      console.log(`  overall ${attempt.result.overall.score ?? 'null'} ${attempt.result.overall.band ?? ''}`);
      if (spmMentions.length) {
        console.log(`  WARN steps-per-minute figure in a burst result (the burst cannot count steps): ${spmMentions.join('; ')}`);
      }
      Object.assign(record, { pillars, overall: attempt.result.overall, spmMentions });
    }
    records.push(record);
  }

  try {
    await Deno.writeTextFile(args.out, JSON.stringify([...existing, ...records], null, 2));
    console.log(`\nwrote ${records.length} record(s) to ${args.out}`);
  } catch (err) {
    // The calls are already billed; never let a write failure discard them.
    const fallback = `${args.out}.${Date.now()}.json`;
    console.error(`\nfailed to write ${args.out}: ${err instanceof Error ? err.message : String(err)}`);
    try {
      await Deno.writeTextFile(fallback, JSON.stringify(records, null, 2));
      console.error(`wrote ${records.length} record(s) to ${fallback} instead.`);
    } catch {
      console.error('could not write a fallback file either; dumping the records to stdout:');
      console.log(JSON.stringify(records, null, 2));
    }
    Deno.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
