# Design — Close the stale-frame orphan by construction (issue #130)

**Date:** 2026-07-13
**Issue:** [#130](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/130) — "#47's stale-reservation sweep reclaims the row but leaks the frames"
**Related:** #47 (the sweep), #88 (upload-after-model-success ordering), #8 (the `media_paths` namespace guard), #131 (the unapplied migrations), `docs/status.md` Known Issue #16

---

## 1. Problem

`sweep_stale_reservations()` (`supabase/migrations/20260713130000_stale_reservation_sweep.sql`)
reclaims a stranded `'reserved'` row by flipping its status to `'released'` with
`release_reason = 'stale_sweep'`. It never touches Storage. An `analyze-form` invocation that
uploads its frames and then dies before settling therefore strands the frames under
`{user_id}/{analysis_id}/` permanently — no row references them and no cleanup path is keyed off
a swept row.

Issue #130 proposed *adding a storage purge to the sweep*. This design rejects that framing.

### 1.1 A second orphan path the issue did not describe

Today `flow.ts` runs, in order:

| Line | Step |
|---|---|
| 758 | `uploadFrames(...)` — frames land in Storage |
| 761 | `settleAnalysis(...)` |
| 772 | `if (!settled.ok) throw` |

`settle_analysis` returns `not_reserved_or_not_found` whenever the row has already left
`'reserved'` — a concurrent duplicate, a late replay. On that path the frames are **already
uploaded**, the `throw` lands in the `catch`, and the `finally` releases the row.

**That is an orphan with no crash involved** — deterministic, reachable in normal operation,
requiring no timeout, OOM, or bad deploy. #130 described only the kill case. Any fix that only
teaches the sweep to purge would leave this path leaking, because the row it releases is released
by `release_analysis`, not by the sweep.

## 2. Non-goals

- Purging frames that a *delivered* analysis legitimately owns. Those are kept by design and
  removed only by `DELETE /analysis/:id` (#57) and `delete-account` (#58).
- Recovering a lost analysis. A swept row's model call succeeded (frames are only uploaded after
  the model answers), but the result died in the killed isolate — `settle_analysis` is what
  persists it. The frames are provably worthless: there is no result to pair them with.
- Alerting when the sweep fires often. Out of scope (see #47's header, "KNOWN GAP").
- Live-database behavioral tests. No non-prod environment exists (#92).

## 3. Decision

**Make the orphan impossible rather than cleaning it up: settle first, upload second.**

### The invariant

> **A `'reserved'` row can never have frames.**
> Frames are uploaded only after the row has left `'reserved'` for `'delivered'`.

`sweep_stale_reservations()` only ever touches rows still stuck in `'reserved'`. Given the
invariant, it provably has nothing to purge. It needs **no storage access, no `pg_net`, no Vault
secret, and no scheduled edge function.** The sweep's SQL is unchanged. #130 closes not by adding
a purge, but by making the purge unnecessary.

### Rejected alternatives

**A — A durable purge queue drained by a scheduled edge function.** Keep the sweep; add a
`media_purged_at` column, a `sweep-media` edge function reusing `purgePrefix`, a `pg_cron` +
`pg_net.http_post` trigger, and a service-role key hand-inserted into Supabase Vault. Correct and
retriable, and it does not touch `analyze-form`. Rejected: it is a new cron job, a new edge
function, a new column, a new RPC, and a secret whose absence fails silently at deploy time — a
large moving surface to clean up after a bug we can instead prevent. It also cannot fix §1.1.
Note that the sweep cannot know *whether* a swept row has frames (`media_paths` is never written
for it), so this design would have to attempt a Storage list for every swept row regardless.

**B — Move the whole sweep into the edge function.** One scheduled job does reclaim + purge.
Rejected outright: the quota reclaim would then depend on the Vault wiring being correct, and a
missing secret would cost users their quota permanently — strictly worse than leaking frames.

**Why C is affordable now.** `analyze-form` has never been deployed (the live project has exactly
one edge function, `analysis`), and `public.analyses` has zero rows. Reordering the flow is free
today and gets monotonically more expensive after it ships. "Closed by construction, not by
convention" is the standard #47's own header holds itself to; C meets it, A does not.

## 4. Architecture

### 4.1 The new happy path in `flow.ts`

1. Model call succeeds → `decision.result`.
2. `settle_analysis(userId, analysisId, result, isFallback)` — **no media paths**. The SQL already
   declares `p_media_paths text[] default '{}'`, so this needs no signature change. Row goes
   `'reserved'` → `'delivered'`.
3. `reservationSettled = true` — the `finally` will no longer release it.
4. **Best-effort, non-fatal:** `uploadFrames(...)` → `attach_media_paths(...)`.
5. Return 200 with `decision.result`, regardless of whether step 4 succeeded.

### 4.2 Every crash window

| Killed / failing at | Row ends as | Frames | Orphan? |
|---|---|---|---|
| Before the settle | `reserved` → swept to `released` | none uploaded yet | **No** — nothing to purge |
| Settle refuses (§1.1) | `released` | none uploaded yet | **No** — the deterministic leak is closed |
| Mid-upload, after settle | `delivered` | partial, under its **own** prefix | **No** — purged by prefix on delete |
| Attach fails, after upload | `delivered` | complete, `media_paths` empty | **No** — purged by prefix on delete |

Deletion has always walked the **prefix**, never `media_paths` (`flow.ts:906`; CLAUDE.md). This
design leans on a property the code already guarantees.

### 4.3 The accepted cost

A `'delivered'` row can now exist with `media_paths` empty or short. This degrades the Past
Analyses frame strip (#55) for that one analysis. It corrupts nothing: `media_paths` is already
declared "the frame-strip DISPLAY list, never the deletion authority" (`flow.ts:756`). There is
also a sub-second window in which a just-delivered analysis has no frames yet.

## 5. Components

### 5.1 New migration — `public.attach_media_paths(uuid, uuid, text[])`

A `security definer`, `search_path`-pinned, `service_role`-only RPC that fills `media_paths` after
the settle. Three guards, all load-bearing:

1. **The namespace guard, identical to `settle_analysis`'s** — every path must start with
   `{p_user_id}/{p_analysis_id}/` and name a file inside it; reject the whole call with
   `{ok: false, reason: 'invalid_media_path'}` rather than dropping the bad element. Non-negotiable:
   a new RPC that writes `media_paths` is a fresh entry point for exactly the bug #8 closed, and
   would reopen it without this.
2. **`status = 'delivered'`** — paths can never be attached to a `'reserved'` or `'released'` row.
3. **`cardinality(media_paths) = 0` — write-once.** A replay or second call cannot rewrite the
   display list of an already-complete analysis; it returns `{ok: false, reason:
   'not_delivered_or_already_attached'}` and is logged. Deliberate: a partial upload can never be
   repaired by a later retry. Accepted because the strip is cosmetic and the simpler rule is safer.

Followed by `revoke execute … from public, anon, authenticated` and `grant execute … to
service_role`, matching every other RPC in this schema.

### 5.2 `flow.ts`

- `settleAnalysis()` drops its `mediaPaths` argument.
- A new `safeAttachFrames()` helper runs upload + attach. It **cannot throw** — it try/catches
  internally, logs failures, and returns the landed count for the observability line. This mirrors
  the discipline already stated at `flow.ts:951` ("these must never throw, or they would mask the
  real failure"), and it is what stops a post-settle failure from turning an analysis that is
  *already delivered and already charged* into a 500.
- `uploadFrames()` is unchanged — it already catches per-frame and never throws (`flow.ts:908`).

### 5.3 The sweep migration — a comment, not code

`sweep_stale_reservations()` does not change. Its header gains a design note recording *why* it
needs no storage purge (the §3 invariant), so a future reader holding #130 does not helpfully
re-add one. The file is unapplied to production, so this is a repo-only edit.

## 6. Testing

Follows the two existing patterns: Deno tests drive `flow.ts` through injected `rpc`/`storage`
deps (`supabase/functions/analyze-form/__tests__/flow.deno.test.ts`); Jest tests assert migration
**SQL text** — guards, grants, dropped signatures (`supabase/__tests__/frame-upload-ordering.test.ts`).

### Existing tests that must change

Four, all of which encode the old ordering:

- `flow.deno.test.ts:685` — *"gate ordering is auth → consent → gate → reserve → settle"* becomes
  `… → reserve → settle → attach`. This test **is** the §3 invariant, expressed executably.
- `flow.deno.test.ts:478` — *"a settle that refuses still releases"* gains the assertion that closes
  §1.1: **when the settle refuses, `storage.upload` was called zero times.**

- `flow.deno.test.ts:504` — *"a storage outage does NOT fail the request, and does NOT release."*
  Its **assertions** are the proof that `safeAttachFrames` is genuinely non-fatal — under this
  design the outage now happens *after* the settle, and the request must still return 200 and still
  not release. Those two assertions carry over unchanged. Its third assertion does not: it currently
  reads `settle_analysis[0].args.p_media_paths === []`, and `settle_analysis` no longer receives
  media paths at all, so that assertion moves to "`attach_media_paths` was never called."
- `flow.deno.test.ts:267` — *"frames are uploaded under the JWT user id, inside the row's own
  namespace"* — same edit: the paths it asserts on now arrive at `attach_media_paths`.

### New tests

**Deno (`flow.deno.test.ts`):**
- `settle_analysis` is called with no `p_media_paths`.
- `attach_media_paths` receives exactly the paths that landed.
- A *throwing* `attach_media_paths` RPC still returns 200 and still does not release.

**Jest (`supabase/__tests__/attach-media-paths.test.ts`):** the new RPC declares the namespace
guard; updates only `status = 'delivered'` rows; carries the write-once `cardinality` guard; and
grants EXECUTE to `service_role` alone after revoking from `public`/`anon`/`authenticated`.

### Explicitly not tested

None of this runs against a live database. Migration tests assert SQL *text*, not SQL *behavior* —
the existing standard in this repo, stated rather than papered over. See #92.

## 7. Docs to update on landing

- `docs/change_log.md` — dated entry.
- `docs/architecture.md` — the `analyze-form` flow's settle/upload ordering.
- `docs/status.md` — **close Known Issue #16**: the sweep is now provably not required to purge
  anything.

## 8. Deployment note

This adds a **fourth** unapplied migration to the three tracked by #131. It must be pushed with
them, and it must sort **after** `20260713130000_stale_reservation_sweep.sql`. The `flow.ts` change
ships whenever `analyze-form` is first deployed — which has not happened yet, and which is itself
untracked by any open issue.
