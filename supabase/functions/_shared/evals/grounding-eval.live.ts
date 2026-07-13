#!/usr/bin/env -S deno run
/**
 * THE PAID HALF OF ISSUE #42 — the live grounding eval. THIS FILE MAKES REAL, BILLED ANTHROPIC
 * CALLS.
 *
 * ── IT MUST NEVER RUN IN THE COMMIT GATE, AND STRUCTURALLY CANNOT ───────────────────────────
 *
 * The file is named `.live.ts`, not `.test.ts`. Deno's test discovery globs `*_test.ts`,
 * `*.test.ts`, and `test.ts` — `.live.ts` matches none of them, so `deno test supabase/functions`
 * (which is what `npm test` runs, via `test:edge`) cannot see this file even though it sits in the
 * tree it walks. Verified, not assumed. Jest cannot see it either: it lives outside `__tests__/`
 * and does not end in `.test.ts`.
 *
 * That is the same structural lesson PR #77 applied to the HIBP canary — a test that hits a paid
 * third-party API makes the gate slow, flaky, and expensive, and a rate-limited failure blocks
 * unrelated work — reached by the mechanism appropriate to this runner. The canary is Jest code
 * testing `lib/hibp.ts`, so it uses a second Jest config (`jest.canary.config.js`) to isolate
 * itself. The prompt is Deno code under `supabase/functions/`, so isolation comes from the one
 * thing Deno's runner keys off: the filename. Same pattern (separate runner entry point, separate
 * npm script, scheduled workflow, never the gate); the mechanism differs only because the runner
 * does.
 *
 *     npm run eval:grounding                 # the four fixtures, once. ~4 calls.
 *     npm run eval:grounding -- --dry-run    # what it WOULD cost. Zero calls. Start here.
 *     npm run eval:grounding -- --case still-free
 *     npm run eval:grounding -- --repeat 3   # variance. 3x the cost. Read the note below first.
 *     npm run eval:grounding -- --effort high --model claude-sonnet-5
 *
 * ── ON VARIANCE, AND WHY THE DEFAULT IS A SINGLE RUN ────────────────────────────────────────
 *
 * These systems are stochastic. A single run's difference between two configurations is frequently
 * noise, and no improvement smaller than the run-to-run spread should ever be claimed. The honest
 * default would be `--repeat 3` and a reported variance.
 *
 * It is not the default here, and the reason is a hard constraint rather than a disagreement:
 * Ian's Anthropic credits are a fixed ceiling with auto-reload OFF, and this harness's job is to
 * prove the grounding CONTRACT (which is binary and does not average — a fabricated score is
 * fabricated in every sample), not to measure a quality SCORE (which does). So: run once by
 * default, and when anyone uses this harness to compare two prompts or two effort levels, use
 * `--repeat` and report the spread, because that comparison IS a measurement and a single sample
 * of it is worthless. The results file records `repeat` so a reader can tell which kind of number
 * they are looking at.
 *
 * ── EXIT CODES (the workflow depends on these) ──────────────────────────────────────────────
 *
 *   0  every case passed.
 *   1  a GRADER failed — a real, deterministic signal about the prompt or the model. Retrying
 *      costs money and buys the same red. The workflow must NOT retry this.
 *   2  INFRASTRUCTURE failed — a non-2xx, a network error, a timeout, a missing key. Nothing was
 *      learned and a retry is legitimate. This is the distinction that stops a rate-limited blip
 *      from paying for three identical failures, which is what a blind copy of the HIBP canary's
 *      3-attempt retry loop would have done.
 */

import {
  ANALYZE_FORM_EFFORT,
  ANALYZE_FORM_MODEL,
  type AnalyzeFormRequest,
  type PaceEffort,
} from '../analyze-form-prompt.ts';
import { MODEL_CALL_TIMEOUT_MS } from '../../analyze-form/flow.ts';
import type { AnthropicMessageResponse } from '../analyze-form-validation.ts';
import { estimateCostUsd } from '../ai-pricing.ts';
import { PACE_PILLARS } from '../pace.ts';
import {
  buildCases,
  checkKnowledgeInPrompt,
  gradeCase,
  readAttempt,
  requestForCase,
  type CaseReport,
  type GroundingCase,
} from './grounding-eval.ts';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const RESULTS_PATH = new URL('./grounding-eval.results.json', import.meta.url).pathname;

const EXIT_OK = 0;
const EXIT_GRADER_FAILED = 1;
const EXIT_INFRASTRUCTURE = 2;

// -------------------------------------------------------------------------------------------
// Args
// -------------------------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  caseIds: string[];
  repeat: number;
  effort: PaceEffort;
  model: string;
  write: boolean;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    dryRun: false,
    caseIds: [],
    repeat: 1,
    effort: ANALYZE_FORM_EFFORT,
    model: ANALYZE_FORM_MODEL,
    write: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`${arg} needs a value.`);
      i += 1;
      return value;
    };

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--case':
        options.caseIds.push(next());
        break;
      case '--repeat':
        options.repeat = Number(next());
        break;
      case '--effort':
        options.effort = next() as PaceEffort;
        break;
      case '--model':
        options.model = next();
        break;
      case '--no-write':
        options.write = false;
        break;
      default:
        throw new Error(`Unknown argument "${arg}".`);
    }
  }

  if (!Number.isInteger(options.repeat) || options.repeat < 1) {
    throw new Error(`--repeat must be a positive integer; got ${options.repeat}.`);
  }
  return options;
}

// -------------------------------------------------------------------------------------------
// Transport
// -------------------------------------------------------------------------------------------

type CallResult =
  | { ok: true; response: AnthropicMessageResponse; latencyMs: number }
  | { ok: false; message: string; latencyMs: number };

/**
 * One Messages call. Deliberately NOT imported from `analyze-form/deps.ts`: that module builds the
 * whole dependency bundle (a service-role Supabase client via `npm:@supabase/supabase-js`) and
 * throws without `SUPABASE_URL`/`SUPABASE_SECRET_KEYS`, none of which an eval has or should have.
 * The eval needs an API key and nothing else — and giving it no path to the database is a feature,
 * not a shortcut: this harness cannot reserve a quota slot, cannot write a row, and cannot touch
 * production Storage, because it holds no credential that would let it.
 *
 * What DOES come from production and must never be forked: the request body
 * (`buildAnalyzeFormRequest`) and the response reader (`readAttempt`). Those are the two things the
 * eval is actually testing. The 20 lines of `fetch` between them are not.
 */
async function callAnthropic(
  apiKey: string,
  request: AnalyzeFormRequest,
  timeoutMs: number
): Promise<CallResult> {
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
      const detail = (await res.text().catch(() => '')).slice(0, 600);
      return { ok: false, message: `Anthropic returned ${res.status}: ${detail}`, latencyMs };
    }

    return { ok: true, response: (await res.json()) as AnthropicMessageResponse, latencyMs };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    if (controller.signal.aborted) {
      return { ok: false, message: `Call exceeded ${timeoutMs}ms`, latencyMs };
    }
    return { ok: false, message: err instanceof Error ? err.message : String(err), latencyMs };
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------------------------------------
// Reporting
// -------------------------------------------------------------------------------------------

const usd = (n: number) => `$${n.toFixed(4)}`;
const tok = (n: number) => n.toLocaleString('en-US');

function printCase(report: CaseReport, index: number, total: number): void {
  const head = `[${index}/${total}] ${report.caseId} (${report.tier}/${report.media}, ${report.frameCount} frame${
    report.frameCount === 1 ? '' : 's'
  })`;
  console.log(`\n${head}`);
  console.log(`        ${report.intent}`);
  console.log('');

  for (const check of report.checks) {
    const marker = check.status === 'pass' ? ' ok ' : check.status === 'fail' ? 'FAIL' : check.status.padEnd(4);
    console.log(`   ${marker}  ${check.id.padEnd(21)} ${check.detail}`);
  }

  if (report.result) {
    const scores = PACE_PILLARS.map((id) => {
      const pillar = report.result!.pillars[id];
      return `${id}=${pillar.score === null ? 'not assessed' : `${pillar.score}/${pillar.band}`}`;
    }).join('  ');
    console.log(`\n   scores  ${scores}`);
    console.log(
      `   overall ${report.result.overall.score === null ? 'null' : `${report.result.overall.score}/${report.result.overall.band}`}`
    );
  }

  console.log(
    `\n   ${report.passed ? 'PASS' : 'FAIL'}  ${(report.latencyMs / 1000).toFixed(1)}s  ` +
      `in=${tok(report.usage.inputTokens)} out=${tok(report.usage.outputTokens)} ` +
      `cache_r=${tok(report.usage.cacheReadInputTokens)} cache_w=${tok(report.usage.cacheCreationInputTokens)}  ` +
      `${usd(report.costUsd)}`
  );
}

interface RunTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

function total(reports: CaseReport[]): RunTotals {
  return reports.reduce<RunTotals>(
    (sum, r) => ({
      inputTokens: sum.inputTokens + r.usage.inputTokens,
      outputTokens: sum.outputTokens + r.usage.outputTokens,
      cacheReadInputTokens: sum.cacheReadInputTokens + r.usage.cacheReadInputTokens,
      cacheCreationInputTokens: sum.cacheCreationInputTokens + r.usage.cacheCreationInputTokens,
      costUsd: sum.costUsd + r.costUsd,
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    }
  );
}

// -------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------

async function main(): Promise<number> {
  const options = parseArgs(Deno.args);

  const all = await buildCases();
  const cases: GroundingCase[] =
    options.caseIds.length > 0 ? all.filter((k) => options.caseIds.includes(k.id)) : all;

  if (cases.length === 0) {
    console.error(`No case matched ${JSON.stringify(options.caseIds)}. Known: ${all.map((k) => k.id).join(', ')}`);
    return EXIT_INFRASTRUCTURE;
  }

  console.log('PACE grounding eval (issue #42)');
  console.log(`model=${options.model}  effort=${options.effort}  cases=${cases.length}  repeat=${options.repeat}`);

  // ── GATE 1, ALWAYS, AND FIRST. It is free, and a prompt that lost its certified knowledge must
  // never be allowed to spend money proving it. This is also the only gate that runs in `npm test`.
  console.log('\nGATE 1 — certified knowledge verbatim in the assembled prompt (no model call)');
  let gate1Ok = true;
  for (const kase of cases) {
    const gate = checkKnowledgeInPrompt(kase);
    console.log(
      `   ${gate.ok ? ' ok ' : 'FAIL'}  ${kase.id.padEnd(18)} ${tok(gate.promptChars)} chars` +
        (gate.ok ? '  (pace_framework.md, injury_flags.md, drills.md all verbatim)' : `  MISSING: ${gate.missing.join(', ')}`)
    );
    if (!gate.ok) gate1Ok = false;
  }
  if (!gate1Ok) {
    console.error('\nGATE 1 FAILED. The prompt does not carry the certified knowledge. Not spending a cent to');
    console.error('find out what an ungrounded model says — fix the knowledge bundle first.');
    return EXIT_GRADER_FAILED;
  }

  // ── The estimate, before any spend.
  const estimate =
    options.repeat *
    cases.reduce((sum, k) => sum + estimateCostUsd(options.model, k.frames.length, k.tier), 0);
  console.log(
    `\nWORST-CASE COST for this run: ~${usd(estimate)} ` +
      `(${cases.length} case(s) x ${options.repeat}, priced at ai-pricing.ts's list rate with every`
  );
  console.log('output token spent. The real cost is settled from real usage below and is normally lower.');

  if (options.dryRun) {
    console.log('\n--dry-run: no calls made, nothing billed.');
    for (const kase of cases) {
      console.log(`   ${kase.id.padEnd(18)} ${kase.tier}/${kase.media}, ${kase.frames.length} frame(s)`);
      for (const proves of kase.proves) console.log(`       proves: ${proves}`);
    }
    return EXIT_OK;
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.error('\nANTHROPIC_API_KEY is not set.');
    console.error('  local: it belongs in supabase/functions/.env (gitignored) — see CLAUDE.md § Secrets.');
    console.error('  CI:    add it as the ANTHROPIC_API_KEY repo secret.');
    return EXIT_INFRASTRUCTURE;
  }

  const runs: CaseReport[][] = [];
  let infrastructureFailed = false;

  for (let run = 1; run <= options.repeat; run += 1) {
    if (options.repeat > 1) console.log(`\n=== RUN ${run} of ${options.repeat} ===`);
    const reports: CaseReport[] = [];

    for (const [i, kase] of cases.entries()) {
      const request = requestForCase(kase);
      // The effort/model seams `analyze-form-prompt.ts` explicitly left for #42 to sweep.
      request.output_config.effort = options.effort;
      request.model = options.model;

      const call = await callAnthropic(apiKey, request, MODEL_CALL_TIMEOUT_MS);

      if (!call.ok) {
        // Nothing was learned. This is not a grading signal and must not be reported as one.
        console.error(`\n[${i + 1}/${cases.length}] ${kase.id}\n   INFRASTRUCTURE FAILURE: ${call.message}`);
        infrastructureFailed = true;
        continue;
      }

      const report = gradeCase(kase, readAttempt(call.response), call.latencyMs, options.model);
      reports.push(report);
      printCase(report, i + 1, cases.length);
    }

    runs.push(reports);
  }

  // ── Summary
  const flat = runs.flat();
  const totals = total(flat);
  const failedCases = flat.filter((r) => !r.passed);

  console.log(`\n${'─'.repeat(92)}`);
  console.log('SUMMARY');
  console.log(`${'─'.repeat(92)}`);

  for (const kase of cases) {
    const forCase = flat.filter((r) => r.caseId === kase.id);
    const passes = forCase.filter((r) => r.passed).length;
    const verdict = forCase.length === 0 ? 'NO DATA' : passes === forCase.length ? 'PASS' : `FAIL (${passes}/${forCase.length} passed)`;
    console.log(`   ${verdict.padEnd(24)} ${kase.id}`);
  }

  if (failedCases.length > 0) {
    console.log('\nFAILED CHECKS — the per-case diff, which is the only thing worth reading:');
    for (const report of failedCases) {
      for (const check of report.checks.filter((c) => c.status === 'fail')) {
        console.log(`   ${report.caseId} :: ${check.id}`);
        console.log(`      ${check.detail}`);
      }
    }
  }

  const warnings = flat.flatMap((r) => r.checks.filter((c) => c.status === 'warn').map((c) => ({ r, c })));
  if (warnings.length > 0) {
    console.log('\nWARNINGS (do not fail the run):');
    for (const { r, c } of warnings) console.log(`   ${r.caseId} :: ${c.id} — ${c.detail}`);
  }

  console.log(
    `\nTOKENS  in=${tok(totals.inputTokens)}  out=${tok(totals.outputTokens)}  ` +
      `cache_read=${tok(totals.cacheReadInputTokens)}  cache_write=${tok(totals.cacheCreationInputTokens)}`
  );
  console.log(`COST    ${usd(totals.costUsd)} actual  (worst-case estimate was ~${usd(estimate)})`);

  if (options.repeat === 1) {
    console.log(
      '\nNOTE  repeat=1, so this run carries NO variance data. It proves the grounding CONTRACT ' +
        '(binary,\n      does not average). Do NOT read any quality delta out of a single run — use ' +
        '--repeat and\n      report the spread before claiming one prompt beats another.'
    );
  }

  if (options.write) {
    const results = {
      generatedAt: new Date().toISOString(),
      commit: Deno.env.get('GITHUB_SHA') ?? null,
      model: options.model,
      effort: options.effort,
      repeat: options.repeat,
      note:
        'Fixtures are drawn figures (see grounding-eval-images.ts). This proves the analysis is ' +
        'GROUNDED, STRUCTURED and HONEST. It does NOT prove the coaching is accurate on a real ' +
        'human body — that needs real consented clips with a coach-labelled ground truth.',
      totals: {
        ...totals,
        cases: flat.length,
        passed: flat.length - failedCases.length,
        failed: failedCases.length,
      },
      cases: flat.map((r) => ({
        caseId: r.caseId,
        tier: r.tier,
        media: r.media,
        frameCount: r.frameCount,
        proves: r.proves,
        passed: r.passed,
        parsed: r.parsed,
        failure: r.failure,
        stopReason: r.stopReason,
        checks: r.checks,
        result: r.result,
        usage: r.usage,
        costUsd: Number(r.costUsd.toFixed(6)),
        latencyMs: r.latencyMs,
      })),
    };
    await Deno.writeTextFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nWROTE   ${RESULTS_PATH}`);
  }

  if (infrastructureFailed) {
    console.error('\nAt least one case never produced a response. Nothing was learned from it; a retry is legitimate.');
    return EXIT_INFRASTRUCTURE;
  }
  return failedCases.length > 0 ? EXIT_GRADER_FAILED : EXIT_OK;
}

Deno.exit(await main());
