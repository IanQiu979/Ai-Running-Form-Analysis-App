# Stale-Frame Orphan (#130) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an orphaned frame impossible by settling the `analyses` row *before* uploading its frames, so `sweep_stale_reservations()` provably has nothing to purge.

**Architecture:** `analyze-form` currently uploads frames (`flow.ts:758`) and *then* settles the row (`flow.ts:761`). We invert that. `settle_analysis` is called with no media paths (its `p_media_paths` already defaults to `'{}'`), and a new `service_role`-only RPC, `attach_media_paths`, records the paths afterwards. Everything after the settle becomes non-fatal, because by then the analysis is delivered and the user's quota is spent.

**Tech Stack:** Postgres (Supabase migrations), Deno + TypeScript (edge functions), Deno test (`npm run test:edge`), Jest (`npm test`).

## Global Constraints

- **THE INVARIANT this plan establishes:** a `'reserved'` row can never have frames. Frames are uploaded only after the row has left `'reserved'` for `'delivered'`.
- Full design and rationale: `docs/superpowers/specs/2026-07-13-stale-frame-orphan-design.md`. Read it before starting.
- `media_paths` is the frame-strip **DISPLAY** list, never the deletion authority. Deletion always walks the `{user_id}/{analysis_id}/` **prefix** (`flow.ts:906`, CLAUDE.md). Never change this.
- Every RPC in this schema is `security definer`, `set search_path = public`, and `revoke execute … from public, anon, authenticated` + `grant execute … to service_role`. The new one is no exception.
- Migration filenames must sort **after** `20260713130000_stale_reservation_sweep.sql`.
- Do **not** run `supabase db push`. Production is deliberately being left alone; this adds a fourth unapplied migration to the three tracked by #131.
- Gate before every commit: `npm run typecheck && npm run lint && npm test`. `test:edge` needs Deno on `PATH` (`~/.local/bin/deno`).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260713140000_attach_media_paths.sql` | **Create.** The new `attach_media_paths` RPC. |
| `supabase/__tests__/attach-media-paths.test.ts` | **Create.** Jest structural lock on that migration's SQL text. |
| `supabase/functions/analyze-form/flow.ts` | **Modify.** Invert settle/upload; add `attachMediaPaths` + non-throwing `safeAttachFrames`. |
| `supabase/functions/analyze-form/__tests__/flow.deno.test.ts` | **Modify.** Update 4 existing tests; add 4 new ones. |
| `supabase/migrations/20260713130000_stale_reservation_sweep.sql` | **Modify.** Header comment only — record why no storage purge is needed. Zero SQL change. |
| `docs/change_log.md`, `docs/status.md`, `docs/architecture.md` | **Modify.** Close Known Issue #16's still-open half. |

---

## Task 1: The `attach_media_paths` RPC

**Files:**
- Create: `supabase/migrations/20260713140000_attach_media_paths.sql`
- Test: `supabase/__tests__/attach-media-paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.attach_media_paths(p_user_id uuid, p_analysis_id uuid, p_media_paths text[]) returns jsonb`. Returns `{ok: true, id, media_paths}` or `{ok: false, reason: 'invalid_media_path' | 'not_delivered_or_already_attached'}`. Task 2 calls it.

- [ ] **Step 1: Write the failing test**

Create `supabase/__tests__/attach-media-paths.test.ts`. This mirrors the structural-lock style already used by `supabase/__tests__/frame-upload-ordering.test.ts` — it asserts the migration's SQL **text**, because the repo has no pgTAP harness and no non-prod database (#92).

```typescript
/**
 * Structural regression lock for the #130 migration
 * (`supabase/migrations/20260713140000_attach_media_paths.sql`).
 *
 * WHAT THIS SUITE CAN PROVE: the migration's text carries the three load-bearing guards — the
 * namespace guard (a fresh entry point for the bug #8 closed, since this is a NEW writer of
 * `media_paths`), the delivered-only guard, and the write-once guard — and that EXECUTE is
 * service_role-only.
 *
 * WHAT IT CANNOT PROVE: that the SQL is valid Postgres or behaves as written. There is no
 * non-production Supabase environment (#92), so behavioral verification happens when whoever
 * applies this migration (with #131's other three) runs it against the live database.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '20260713140000_attach_media_paths.sql'
);
const sql = readFileSync(MIGRATION_PATH, 'utf8');

function attachBody(): string {
  const start = sql.indexOf('create or replace function public.attach_media_paths(');
  const end = sql.indexOf('$$;', start);
  expect(start).toBeGreaterThan(-1);
  return sql.slice(start, end);
}

describe('attach_media_paths: the namespace guard is replicated, not assumed', () => {
  it('rejects a path outside {p_user_id}/{p_analysis_id}/ before ever touching the row', () => {
    const body = attachBody();
    const guardIdx = body.indexOf('invalid_media_path');
    const updateIdx = body.indexOf('update public.analyses');

    expect(guardIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(-1);
    // The guard must run BEFORE the update. This RPC is a second writer of `media_paths`, so
    // without the guard it would reopen #8 from a new direction: a compromised or buggy edge
    // function pointing one user's analyses row at another user's frames.
    expect(guardIdx).toBeLessThan(updateIdx);
    expect(body).toMatch(
      /v_prefix\s*:=\s*p_user_id::text\s*\|\|\s*'\/'\s*\|\|\s*p_analysis_id::text\s*\|\|\s*'\/'/
    );
  });

  it('rejects the whole call rather than silently dropping the bad path', () => {
    // Same discipline as settle_analysis: a foreign path is a bug or an attack, and swallowing it
    // would hide both. The guard returns, it does not `continue`.
    expect(attachBody()).toMatch(/return jsonb_build_object\('ok',\s*false,\s*'reason',\s*'invalid_media_path'\)/);
  });
});

describe('attach_media_paths: it can only ever fill in a delivered row, once', () => {
  it('updates only rows already in status = delivered', () => {
    // Paths can never be attached to a 'reserved' row (that would break THE INVARIANT) or to a
    // 'released' one (that would name frames on a row the sweep just reclaimed).
    expect(attachBody()).toMatch(/status\s*=\s*'delivered'/);
  });

  it('is write-once: it refuses a row whose media_paths is already populated', () => {
    expect(attachBody()).toMatch(/cardinality\(coalesce\(media_paths,\s*'\{\}'\)\)\s*=\s*0/);
  });

  it('reports a refusal rather than throwing, so the caller can log and move on', () => {
    expect(attachBody()).toContain('not_delivered_or_already_attached');
  });

  it('never writes status, result, is_fallback, or delivered_at — settle_analysis owns those', () => {
    const body = attachBody();
    const update = body.slice(body.indexOf('update public.analyses'));
    const setClause = update.slice(0, update.indexOf('where'));

    expect(setClause).toContain('media_paths');
    expect(setClause).not.toContain('status =');
    expect(setClause).not.toContain('result =');
    expect(setClause).not.toContain('is_fallback =');
    expect(setClause).not.toContain('delivered_at =');
  });
});

describe('attach_media_paths: no client can ever call it', () => {
  it('is security definer with a pinned search_path', () => {
    const body = attachBody();
    expect(body).toContain('security definer');
    expect(body).toContain('set search_path = public');
  });

  it('grants EXECUTE to service_role only', () => {
    expect(sql).toContain(
      'revoke execute on function public.attach_media_paths(uuid, uuid, text[]) from public, anon, authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.attach_media_paths(uuid, uuid, text[]) to service_role;'
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest supabase/__tests__/attach-media-paths.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open '.../20260713140000_attach_media_paths.sql'`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260713140000_attach_media_paths.sql`:

```sql
-- Issue #130 (M4): attach_media_paths — the half of the settle that runs AFTER the frames land.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- WHY THIS FUNCTION EXISTS: THE INVARIANT
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   A 'reserved' row can never have frames.
--
-- `analyze-form` used to upload the frames and THEN call settle_analysis with their paths. That
-- ordering created orphans in TWO ways, one of which #130 did not even describe:
--
--   1. THE CRASH (what #47/#130 are about). The isolate is killed (wall-clock, OOM, a deploy)
--      between the upload and the settle. The row stays 'reserved' and the frames sit in the
--      bucket with nothing pointing at them. `sweep_stale_reservations()` reclaims the row — but
--      it is SQL, it cannot call Storage's HTTP API, so the frames leak permanently.
--
--   2. THE REFUSED SETTLE (no crash required, and the reason a purge bolted onto the sweep would
--      NOT have been enough). settle_analysis returns `not_reserved_or_not_found` whenever the row
--      has already left 'reserved' — a concurrent duplicate, a late replay. By then the frames are
--      ALREADY uploaded. flow.ts throws, the `finally` calls release_analysis, and the released row
--      never names them. That row is never touched by the sweep, so no sweep-side purge could ever
--      reach those objects.
--
-- Inverting the order kills both by construction. settle_analysis now runs FIRST, with no paths
-- (its p_media_paths already defaults to '{}'). Only once the row is 'delivered' do the frames go
-- up — and then THIS function records where they went. Now:
--
--   * killed before the settle -> 'reserved' row, ZERO frames uploaded. The sweep reclaims the row
--     and has nothing to purge. This is why sweep_stale_reservations() needs no Storage access, no
--     pg_net, no Vault secret, and no scheduled edge function — see that migration's Design
--     Decision 5.
--   * settle refuses           -> released row, ZERO frames uploaded. Case 2 above cannot happen.
--   * killed mid-upload        -> 'delivered' row whose frames sit under its OWN prefix, where
--     deletion (DELETE /analysis/:id #57, delete-account #58) finds them anyway — purge walks the
--     PREFIX, never `media_paths`.
--
-- THE PRICE, stated rather than hidden: a 'delivered' row can now carry an empty or short
-- `media_paths`. That shortens the Past Analyses frame strip (#55) for that one analysis and does
-- nothing else. `media_paths` has always been the DISPLAY list, never the deletion authority
-- (flow.ts's own uploadFrames header), so nothing downstream is weakened by it being incomplete.
--
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- THE THREE GUARDS, all load-bearing
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
--   1. THE NAMESPACE GUARD, byte-for-byte the one settle_analysis carries
--      (20260712123606_frame_upload_ordering.sql). This is NOT belt-and-braces: this function is a
--      SECOND writer of `media_paths`, i.e. a brand-new entry point for exactly the bug #8 closed.
--      Without the guard, a compromised or buggy edge function could point one user's analyses row
--      at another user's frames — through here, even though settle_analysis is airtight. A foreign
--      path rejects the WHOLE call; it is never silently dropped, because a caller passing one is a
--      bug or an attack and swallowing it would hide both.
--
--   2. status = 'delivered'. Paths cannot be attached to a 'reserved' row (that would violate the
--      invariant this whole file exists to establish) nor to a 'released' one (that would name
--      frames on a row the sweep just reclaimed).
--
--   3. WRITE-ONCE (cardinality(media_paths) = 0). A replay or a second call cannot rewrite the
--      display list of an already-complete analysis. Deliberate consequence: a partial upload can
--      never be repaired by a later retry. Accepted — the strip is cosmetic, and the simpler rule
--      is the safer one.
--
-- Refusals RETURN, they never raise: the caller (flow.ts's safeAttachFrames) is running after the
-- analysis is already delivered and already charged, and must never be able to turn a bookkeeping
-- miss into a failed request.

create or replace function public.attach_media_paths(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_media_paths text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.analyses;
  v_prefix text;
  v_path   text;
begin
  v_prefix := p_user_id::text || '/' || p_analysis_id::text || '/';

  -- Guard 1. Identical to settle_analysis's. Runs before the row is touched.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  -- Guards 2 and 3 live in the WHERE clause, so they are enforced by the write itself rather than
  -- by a check-then-write that a concurrent caller could race.
  update public.analyses
  set media_paths = coalesce(p_media_paths, '{}')
  where id = p_analysis_id
    and user_id = p_user_id
    and status = 'delivered'
    and cardinality(coalesce(media_paths, '{}')) = 0
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_delivered_or_already_attached');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'media_paths', to_jsonb(v_row.media_paths)
  );
end;
$$;

revoke execute on function public.attach_media_paths(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.attach_media_paths(uuid, uuid, text[]) to service_role;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest supabase/__tests__/attach-media-paths.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean. (The Deno suite is untouched so far and must still pass.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713140000_attach_media_paths.sql supabase/__tests__/attach-media-paths.test.ts
git commit -m "feat(#130): add attach_media_paths RPC — the settle's post-upload half

Settling before the upload needs a second writer for media_paths. Carries
settle_analysis's namespace guard (this is a new entry point for the bug #8
closed), a delivered-only guard, and a write-once guard.

Not applied to production — a fourth unapplied migration, see #131."
```

---

## Task 2: Invert settle/upload in `flow.ts`

**Files:**
- Modify: `supabase/functions/analyze-form/flow.ts:369-394` (the `settleAnalysis` helper), `:753-776` (the call site), `:896-906` (the `uploadFrames` doc comment)
- Test: `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`

**Interfaces:**
- Consumes: `public.attach_media_paths(uuid, uuid, text[])` from Task 1.
- Produces: nothing further tasks depend on in code. Task 3 documents this behavior.

- [ ] **Step 1: Teach the fake RPC about the new function**

In `supabase/functions/analyze-form/__tests__/flow.deno.test.ts`, add one line to `FakeRpc.handlers` (it currently ends with `release_analysis`). Without this, every test throws `FakeRpc: unstubbed rpc "attach_media_paths"`.

```typescript
    settle_analysis: () => ({ data: { ok: true }, error: null }),
    attach_media_paths: () => ({ data: { ok: true }, error: null }),
    release_analysis: () => ({ data: { ok: true }, error: null }),
```

- [ ] **Step 2: Write the failing tests**

Four existing tests encode the old ordering and must be rewritten; four new tests lock the new one.

**Rewrite** `rule 1: frames are uploaded under the JWT user id, inside the row's own namespace` — the paths now arrive at `attach_media_paths`, not `settle_analysis`:

```typescript
Deno.test('rule 1: frames are uploaded under the JWT user id, inside the row\'s own namespace', async () => {
  const h = harness([ok()]);
  await run(h, { ...VIDEO_BODY, userId: ATTACKER_TARGET });

  // `attach_media_paths`'s namespace guard rejects the whole call for any path outside
  // `{p_user_id}/{p_analysis_id}/` — but the paths must be right in the first place, not merely
  // caught downstream.
  assertEquals(h.storage.uploads.map((u) => u.path), [
    `${CALLER}/${ANALYSIS_ID}/frame-01.jpg`,
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
  assertEquals(h.rpc.to('attach_media_paths')[0].args.p_media_paths, [
    `${CALLER}/${ANALYSIS_ID}/frame-01.jpg`,
    `${CALLER}/${ANALYSIS_ID}/frame-02.jpg`,
  ]);
});
```

**Rewrite** `rule 3: a settle that refuses still releases` — this is the #130 regression lock for the non-crash orphan:

```typescript
Deno.test('rule 3: a settle that refuses still releases — and uploads NOTHING (#130)', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.settle_analysis = () => ({
    data: { ok: false, reason: 'not_reserved_or_not_found' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 500);
  assertEquals(releaseReasonFrom(h.rpc), 'internal_error');
  // THE #130 REGRESSION LOCK — the orphan that needed no crash. Under the old upload-then-settle
  // order the frames were already in the bucket by the time the settle refused (a late replay or a
  // concurrent duplicate is enough), and the released row never named them: a permanent orphan that
  // no sweep-side purge could ever have reached, because the sweep only touches 'reserved' rows.
  assertEquals(h.storage.uploads.length, 0);
  assertEquals(h.rpc.to('attach_media_paths').length, 0);
});
```

**Rewrite** `rule 3: a storage outage does NOT fail the request, and does NOT release` — the outage now happens after the settle, and nothing is attached:

```typescript
Deno.test('rule 3: a storage outage does NOT fail the request, and does NOT release', async () => {
  // The analysis is done, correct, and ALREADY SETTLED. Refusing to deliver it because a thumbnail
  // did not persist would be absurd — and releasing would hand back a slot for work we did.
  const h = harness([ok()]);
  h.storage.failOn = () => true;

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
  assertEquals(
    h.rpc.to('attach_media_paths').length,
    0,
    'nothing landed, so nothing is attached — media_paths never names an object that does not exist'
  );
});
```

**Rewrite** `rule 5: gate ordering` — the chain gains a link:

```typescript
Deno.test('rule 5: gate ordering is auth -> consent -> gate -> reserve -> settle -> attach', async () => {
  const h = harness([ok()]);
  await run(h);

  assertEquals(h.rpc.names(), [
    'gate_ai_call',
    'reserve_analysis',
    'settle_analysis',
    'attach_media_paths',
    'record_ai_call',
  ]);
});
```

**Add** a new suite at the end of the file:

```typescript
// ===========================================================================
// ISSUE #130 — THE INVARIANT: a 'reserved' row can never have frames.
// ===========================================================================

Deno.test('#130: the row is DELIVERED before the first frame is uploaded', async () => {
  // The whole design in one assertion. If this inverts, orphans come back.
  const h = harness([ok()]);
  let uploadsAtSettleTime = -1;
  const settleOk = h.rpc.handlers.settle_analysis;
  h.rpc.handlers.settle_analysis = (args) => {
    uploadsAtSettleTime = h.storage.uploads.length;
    return settleOk(args);
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(uploadsAtSettleTime, 0, 'a reserved row must never have frames — settle runs FIRST');
  assertEquals(h.storage.uploads.length, 2);
});

Deno.test('#130: settle_analysis is called with NO media paths', async () => {
  const h = harness([ok()]);
  await run(h);

  // Not `[]` — absent. There is nothing to pass: the frames do not exist yet. The RPC's own
  // `p_media_paths text[] default '{}'` covers the omission.
  assertEquals(h.rpc.to('settle_analysis')[0].args.p_media_paths, undefined);
});

Deno.test('#130: a THROWING attach_media_paths still delivers 200 and still does not release', async () => {
  // The analysis is delivered and the quota is SPENT. A throw here used to be impossible (the
  // settle was last); now it must be caught, or a bookkeeping miss would 500 an analysis the user
  // already paid for and cannot retry.
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => {
    throw new Error('the database fell over mid-attach');
  };

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
});

Deno.test('#130: a REFUSING attach_media_paths still delivers 200 and still does not release', async () => {
  const h = harness([ok()]);
  h.rpc.handlers.attach_media_paths = () => ({
    data: { ok: false, reason: 'not_delivered_or_already_attached' },
    error: null,
  });

  const res = await run(h);

  assertEquals(res.status, 200);
  assertEquals(h.rpc.to('release_analysis').length, 0);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:edge`
Expected: FAIL. The new `#130: the row is DELIVERED before the first frame is uploaded` reports `uploadsAtSettleTime` of `2`, not `0` — the current code uploads first. The ordering and `attach_media_paths` assertions fail too.

- [ ] **Step 4: Change `settleAnalysis` and add `attachMediaPaths`**

In `flow.ts`, replace the `settleAnalysis` helper (currently lines 369-394) with:

```typescript
async function settleAnalysis(
  rpc: RpcClient,
  args: {
    userId: string;
    analysisId: string;
    result: PaceResult;
    isFallback: boolean;
  }
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc.rpc('settle_analysis', {
    p_user_id: args.userId,
    p_analysis_id: args.analysisId,
    p_result: args.result,
    p_is_fallback: args.isFallback,
    // FOUR args, not five (#130). `p_media_paths` still exists on the RPC and still defaults to
    // '{}' — we simply have nothing to pass it, because nothing has been uploaded yet. The frames
    // go up AFTER this call succeeds and `attach_media_paths` records them. THE INVARIANT: a
    // 'reserved' row can never have frames.
  });
  if (error) {
    throw new Error(`settle_analysis failed: ${error.message}`);
  }
  return data as { ok: boolean; reason?: string };
}

async function attachMediaPaths(
  rpc: RpcClient,
  args: { userId: string; analysisId: string; mediaPaths: string[] }
): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await rpc.rpc('attach_media_paths', {
    p_user_id: args.userId,
    p_analysis_id: args.analysisId,
    // Namespace-guarded inside the RPC exactly as `settle_analysis` is — it rejects the whole call
    // rather than dropping a foreign path — and we pass only the paths that ACTUALLY landed, so
    // `media_paths` never names an object that does not exist.
    p_media_paths: args.mediaPaths,
  });
  if (error) {
    throw new Error(`attach_media_paths failed: ${error.message}`);
  }
  return data as { ok: boolean; reason?: string };
}
```

- [ ] **Step 5: Invert the call site**

In `flow.ts`, replace the block currently at lines 753-776 (from the `// ── 10. Upload the frames, THEN settle.` comment through `outcome = isFallback ? 'partial' : 'success';`) with:

```typescript
    // ── 10. Settle FIRST, then upload. Never the other way round (#130). ──────────────────────
    //
    // THE INVARIANT: a 'reserved' row can never have frames. Frames go up only once the row is
    // 'delivered'. That is what makes an orphaned object impossible:
    //
    //   * killed before the settle -> 'reserved' row, ZERO frames uploaded. `sweep_stale_
    //     reservations()` (#47) reclaims the row and has nothing to purge — which is precisely why
    //     that sweep needs no Storage access at all.
    //   * settle REFUSES           -> we throw, the `finally` releases, and again nothing was
    //     uploaded. This is the leak the old upload-then-settle order had that needed NO CRASH: a
    //     late replay or a concurrent duplicate makes `settle_analysis` return
    //     `not_reserved_or_not_found` AFTER the frames are already in the bucket, and the released
    //     row never names them. No sweep could ever have reached those objects — the sweep only
    //     touches rows still stuck in 'reserved'.
    //   * killed mid-upload        -> 'delivered' row whose frames sit under its OWN prefix, where
    //     deletion finds them anyway. Purge walks the PREFIX, never `media_paths`.
    //
    // THE PRICE: a delivered row can carry an empty or short `media_paths`. That shortens the Past
    // Analyses frame strip (#55) and nothing else — `media_paths` is the DISPLAY list, never the
    // deletion authority.
    const settled = await settleAnalysis(deps.rpc, {
      userId: callerUserId,
      analysisId,
      result: decision.result,
      isFallback,
    });

    if (!settled.ok) {
      // The row was not in `'reserved'` when we got here. Nothing was delivered and — the whole
      // point of the new ordering — nothing was uploaded. The `finally` releases (a no-op if
      // something else already moved the row) and we do not pretend otherwise.
      throw new Error(`settle_analysis refused: ${settled.reason ?? 'unknown'}`);
    }

    reservationSettled = true;
    outcome = isFallback ? 'partial' : 'success';

    // Everything from here on is NON-FATAL. The analysis is delivered and the quota is spent.
    framesUploaded = await safeAttachFrames(deps, callerUserId, analysisId, request.frames);
```

- [ ] **Step 6: Add the non-throwing `safeAttachFrames` helper**

In `flow.ts`, add this immediately above the `uploadFrames` function (which stays unchanged — it already catches per-frame and never throws):

```typescript
/**
 * Upload the frames, then record them on the ALREADY-DELIVERED row. NEVER THROWS (#130).
 *
 * By the time this runs, `settle_analysis` has succeeded: the analysis is delivered and the user's
 * quota is spent. A throw from here would land in `runAnalyzeForm`'s `catch` and turn a delivered,
 * charged analysis into a 500 the user cannot retry — a failure the old settle-last ordering made
 * structurally impossible and this ordering has to close by hand. Same discipline as the `finally`
 * helpers below: it must never be able to break the request it is decorating.
 *
 * Returns the number of frames that landed, for the observability line.
 */
async function safeAttachFrames(
  deps: AnalyzeFormDeps,
  userId: string,
  analysisId: string,
  frames: PaceFrame[]
): Promise<number> {
  try {
    const mediaPaths = await uploadFrames(deps, userId, analysisId, frames);
    if (mediaPaths.length === 0) {
      // A total storage outage. The row keeps `media_paths = '{}'`: the frame strip is empty, the
      // analysis is intact, and we never name an object that does not exist.
      return 0;
    }

    const attached = await attachMediaPaths(deps.rpc, { userId, analysisId, mediaPaths });
    if (!attached.ok) {
      // The frames ARE in the bucket, under this row's own prefix, so deletion still reaches them
      // (purge walks the prefix). Only the display list is missing.
      console.error(`analyze-form: attach_media_paths refused: ${attached.reason ?? 'unknown'}`);
    }
    return mediaPaths.length;
  } catch (err) {
    console.error(
      'analyze-form: frames could not be attached — the analysis is still delivered',
      err instanceof Error ? err.message : err
    );
    return 0;
  }
}
```

- [ ] **Step 7: Update the `uploadFrames` doc comment**

Its header (around line 900) currently says the prefix is "the exact prefix `settle_analysis`'s namespace guard enforces". Change that clause to name the new guard:

```typescript
 * `{user_id}/{analysis_id}/frame-{NN}.jpg` — the exact prefix `attach_media_paths`'s namespace
 * guard enforces and `DELETE /analysis/:id` (#57) purges by. Returns only the paths that LANDED.
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npm run test:edge`
Expected: PASS — the whole `flow.deno.test.ts` suite, including the four rewritten tests and the four new `#130:` ones.

- [ ] **Step 9: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add supabase/functions/analyze-form/flow.ts supabase/functions/analyze-form/__tests__/flow.deno.test.ts
git commit -m "fix(#130): settle before uploading frames — orphans become impossible

A 'reserved' row can now never have frames, so sweep_stale_reservations()
provably has nothing to purge. Also closes the orphan that needed no crash:
a refused settle (late replay, concurrent duplicate) used to release a row
whose frames were already in the bucket, and no sweep would ever reach them.

Everything after the settle is now non-fatal — safeAttachFrames cannot throw,
because by then the analysis is delivered and the quota is spent."
```

---

## Task 3: Record why the sweep needs no purge, and close Known Issue #16

**Files:**
- Modify: `supabase/migrations/20260713130000_stale_reservation_sweep.sql` (header comment only — **zero SQL change**)
- Modify: `docs/status.md:262-267`, `docs/change_log.md`, `docs/architecture.md`

**Interfaces:**
- Consumes: the invariant established by Task 2.
- Produces: nothing.

- [ ] **Step 1: Add Design Decision 5 to the sweep migration**

The sweep's SQL does not change. But its header must record *why* it never purges Storage, or the next reader holding #130 will helpfully add one back. Insert this immediately after the "DESIGN DECISION 4" block ends and before the `-- 1. Enable pg_cron.` section:

```sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESIGN DECISION 5 — WHY THIS SWEEP NEVER TOUCHES STORAGE (issue #130). DO NOT "FIX" THIS.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
--
-- Issue #130 asked for this sweep to also purge the swept row's `{user_id}/{analysis_id}/` Storage
-- prefix, on the reasoning that a run which uploads its frames and then dies before settling
-- strands both a 'reserved' row AND its frames. That reasoning was correct about the OLD ordering,
-- and #130 was closed by changing the ordering instead — see
-- `docs/superpowers/specs/2026-07-13-stale-frame-orphan-design.md`.
--
-- analyze-form now SETTLES BEFORE IT UPLOADS (`flow.ts`, section 10; the paths are recorded
-- afterwards by `public.attach_media_paths`, 20260713140000_attach_media_paths.sql). That
-- establishes an invariant this function gets to rely on for free:
--
--   A 'reserved' row can never have frames.
--
-- This sweep only ever touches rows still stuck in 'reserved'. So a swept row has, by construction,
-- ZERO objects under its prefix — there is nothing to purge, and a purge here would be dead code
-- that lists an always-empty prefix on every cron tick.
--
-- That is also why this migration needs no `pg_net`, no Supabase Vault secret, and no scheduled
-- edge function to reach Storage's HTTP API — the exact wiring Design Decision 3 above declined to
-- introduce, and which #130 would otherwise have forced back onto the table.
--
-- IF YOU ARE ABOUT TO ADD A STORAGE PURGE HERE: first check that `flow.ts` still settles before it
-- uploads. If someone has inverted that back, the invariant is gone and the orphan is real again —
-- and the fix is to restore the ordering, not to bolt a purge onto this sweep. (A purge here could
-- never have been sufficient anyway: the same old ordering leaked frames on a REFUSED settle too,
-- which releases the row through `release_analysis` and so is never seen by this sweep at all.)
```

- [ ] **Step 2: Close the still-open half in `docs/status.md`**

At `docs/status.md:266-267`, the M4 requirements list currently ends the sweep bullet with:

> `It only flips the row's `status`/`release_reason`; it does not purge the row's Storage prefix — see Known Issue #16 below for that still-open half.`

Replace that sentence with:

```markdown
      It only flips the row's `status`/`release_reason` and — since #130 (2026-07-13) — that is
      now provably all it needs to do: `analyze-form` settles the row **before** it uploads any
      frames, so a `'reserved'` row can never have frames and a swept row has nothing to purge.
      Known Issue #16's still-open half is **closed**, and closed by construction rather than by a
      second cron job reaching into Storage. See
      `docs/superpowers/specs/2026-07-13-stale-frame-orphan-design.md`.
```

- [ ] **Step 3: Append the change-log entry**

Add to `docs/change_log.md`, following the file's existing dated-entry format:

```markdown
### 2026-07-13 — #130: frame orphans closed by construction (settle before upload)

`analyze-form` now calls `settle_analysis` **before** `uploadFrames`, and records the paths
afterwards via a new `service_role`-only RPC, `public.attach_media_paths`
(`supabase/migrations/20260713140000_attach_media_paths.sql`). This establishes the invariant that
a `'reserved'` row can never have frames, which means `sweep_stale_reservations()` (#47) provably
has nothing to purge — no `pg_net`, no Vault secret, no scheduled edge function needed.

It also closes a second orphan path the issue did not describe: a **refused** settle (a late replay
or concurrent duplicate returns `not_reserved_or_not_found`) used to release a row whose frames were
*already* in the bucket. That row is released by `release_analysis`, never by the sweep, so no
sweep-side purge could ever have reached those objects. No crash was required to trigger it.

Accepted cost: a `'delivered'` row can now carry an empty or short `media_paths`, which shortens the
Past Analyses frame strip (#55) for that analysis. `media_paths` has always been the display list,
never the deletion authority — purge walks the prefix.

Everything after the settle is now non-fatal (`safeAttachFrames` cannot throw): by then the analysis
is delivered and the quota is spent, so a bookkeeping miss must never become a 500.

**Not applied to production.** This is a fourth unapplied migration; see #131.
```

- [ ] **Step 4: Update `docs/architecture.md`**

Step 10 of the `analyze-form` call-ordering list (`docs/architecture.md:1021-1027`) currently describes the **old** order — and, note, actively asserts something now known to be false ("the row already exists, so no object can ever be orphaned"; a `'reserved'` row is exactly the case where one could). Replace the whole of item 10 with:

```markdown
10. **Settle, then upload** — on a success or honest-partial, the function first marks the
    reservation delivered, persisting the result to `analyses` (`result` JSONB, `tier_at_run`,
    `frame_count`, `is_fallback`) with **no** `media_paths`. Only then does it upload the frames
    itself (service-role) to `{user_id}/{analysis_id}/frame-{NN}.jpg`, and record where they went
    via `attach_media_paths` — the second, and only other, writer of `media_paths`. This order is
    what makes an orphaned object impossible (#130): a `'reserved'` row can never have frames, so a
    row stranded by a killed invocation has nothing under its prefix and
    `sweep_stale_reservations()` (#47) has nothing to purge. Everything after the settle is
    non-fatal — the analysis is already delivered and the quota already spent — so a frame that
    fails to upload, or an `attach_media_paths` that refuses, does **not** fail the request: it
    only shortens the Past Analyses frame strip. `media_paths` is the display list, never the
    deletion authority; purge walks the prefix. On a release path nothing is uploaded at all.
```

- [ ] **Step 5: Run the full gate**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean. (Docs-only plus a SQL comment — but the sweep file is read by no test, so confirm nothing regressed.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713130000_stale_reservation_sweep.sql docs/status.md docs/change_log.md docs/architecture.md
git commit -m "docs(#130): record why the sweep needs no storage purge; close Known Issue #16

The sweep's SQL is unchanged. Its header now states the invariant it relies on
(a 'reserved' row can never have frames) so the next reader holding #130 does
not helpfully add a purge back."
```

---

## Verification

After Task 3, before closing #130:

- [ ] `npm run typecheck && npm run lint && npm test` is clean.
- [ ] `git log --oneline -3` shows the three commits.
- [ ] `grep -n "p_media_paths" supabase/functions/analyze-form/flow.ts` returns **only** the `attachMediaPaths` helper — never `settleAnalysis`.
- [ ] `supabase migration list` still shows production at `20260712230000`. **Nothing was pushed.** This plan adds a fourth unapplied migration; pushing all four is #131's job.

## Out of scope

- Applying any migration (#131).
- Deploying `analyze-form` — it has never been deployed and no open issue tracks that.
- Repairing a `'delivered'` row whose `media_paths` is short. Write-once is deliberate; see the spec.
- Alerting when the sweep fires often (#47's own "KNOWN GAP").
