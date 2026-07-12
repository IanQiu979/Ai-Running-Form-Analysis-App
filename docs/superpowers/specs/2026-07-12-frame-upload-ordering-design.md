# Frame-upload ordering: the server uploads, after the model call

**Issue:** #88 — "Frame-upload ordering is unbuildable: `{user_id}/{analysis_id}/` is circular, and a rejected reserve orphans body images forever"
**Date:** 2026-07-12
**Status:** approved, ready for implementation plan
**Blocks:** #34, #35, #44, #57, #58. Closes #8. Closes #7.

## Problem

Two defects in one contract, both provable from the committed SQL.

**(a) The path scheme is circular.** `reserve_analysis`
(`supabase/migrations/20260711150400_quota_reserve_settle_release.sql:164`) mints the analysis
id server-side (`insert … returning id into v_new_id`) and takes `p_media_paths` as an *input*.
`docs/architecture.md:375` confirms the ordering: the frames are "**already** uploaded
direct-to-bucket, and their storage paths ride in the request." So the client must name
`{user_id}/{analysis_id}/` before the `analysis_id` that path needs exists. The scheme named in
`CLAUDE.md`, in `docs/architecture.md:403`, and in the title of #35 cannot be built.

**(b) Every rejected reserve orphans frames forever.** All four rejection branches —
`invalid_*` (`:61-67`), `frame_cap_exceeded` (`:115`), `too_many_failed_attempts` (`:152`),
`quota_exceeded` (`:156`) — return *before* the insert at `:159`. No row is created. But the
frames are already in the private bucket.

So the single most routine flow in the product — a Free user who has spent their one lifetime
analysis picks a video, the client extracts and uploads frames, the server returns 402 —
permanently leaves images of that person's body in Storage with nothing in the database
pointing at them. They never see an analysis, so they can never delete it. This directly
contradicts `CLAUDE.md`'s promise that frames are "purged when the user deletes an analysis."

**A third, unlisted defect:** `docs/architecture.md:376` has the frames riding in the request
body as base64 *and* being uploaded direct-to-bucket. The client was specced to upload every
frame twice.

## The invariant

Everything below reduces to one rule, checkable by inspection, and it has to hold in **both**
directions:

> **No object exists in the media bucket unless an `analyses` row already points at it —
> and no row can be destroyed while its objects survive.**

The forward direction is what #88 is about: the upload moves server-side, into the edge
function, and happens *after* `reserve_analysis` has already minted the row. The circular
dependency dissolves — by the time anything is written, `analysis_id` exists — and the orphan
becomes structurally impossible rather than swept up after the fact.

The reverse direction is a hazard this change would otherwise *create*. `analyses` currently
carries a client DELETE policy (`20260711150200_analyses.sql:71`), described in
`docs/architecture.md:550` as a deliberate fallback path. Once the client loses its storage
DELETE (§2), a client-side row delete would strand that row's frames with no row pointing at
them and no client-side means of removing them — reintroducing #88's own bug from the other
end, and making #3 strictly worse. So the `analyses` DELETE policy is dropped in the same
migration: deletion becomes the exclusive job of the `DELETE /analysis/:id` edge function
(#57), which removes the row and prefix-purges the objects in one place.

Nothing regresses today — no client code deletes an analysis (the only client reference to the
table is a quota-display `SELECT` at `app/(tabs)/index.tsx:82`) and the M6 delete UI does not
exist. But **#57 is now a hard prerequisite for that UI**, and for any user-facing delete at
all.

## Alternatives rejected

**Client mints the analysis id** (client generates a UUID, uploads to `{user_id}/{uuid}/`, passes
the id into `reserve_analysis`). The path scheme works, but every rejection still orphans
frames, so it needs a reconciliation cron *and* a per-user byte budget to be safe. It also lets
a client choose a primary key: an id colliding with another user's analysis trips the
`unique_violation` handler at `:168`, whose recovery `select` is filtered by `user_id` and so
finds nothing — returning `allowed: true` with a null id.

**Split reserve into its own endpoint** (client calls reserve, gets the id, uploads, then calls
analyze-form). No orphans, but it adds a round trip before the model call, expands the API
surface, and still has the client uploading each frame twice.

## Design

### 1. RPC signatures

`reserve_analysis` **drops** `p_media_paths`. There is no longer any such thing as a
client-supplied storage path anywhere in the system. The old 5-arg function must be
`drop function`'d, not merely replaced — leaving it in place creates an overload that PostgREST
could still resolve.

`settle_analysis` **gains** `p_media_paths text[] default '{}'`. Paths are recorded at settle,
by the same code that just wrote the objects. It also gains a guard: every element must begin
with `p_user_id || '/' || p_analysis_id || '/'`, else the call returns
`{ ok: false, reason: 'invalid_media_path' }` and writes nothing. That is what closes #8
permanently — after this, not even the service role can record a path outside the row's own
namespace.

Both new signatures keep the existing `SECURITY DEFINER` + pinned `search_path` shape, and the
`revoke execute … from public, anon, authenticated` / `grant execute … to service_role` pair
must be re-applied to the *new* signatures (grants do not follow a signature change).

`analyses.media_paths` already defaults to `'{}'` and is `not null`, so a `reserved` row simply
has no paths yet. No table change is needed.

### 2. RLS policies

On `storage.objects` for bucket `media` (from `20260711150500_media_storage_bucket.sql`):

| Policy | Fate | Why |
|---|---|---|
| SELECT (own prefix) | **keep** | The client needs it to mint short-TTL signed URLs for the M6 frame strip. |
| INSERT (own prefix) | **drop** | The server uploads with service-role, which bypasses RLS. Removing this closes #7 — a bucket-fill by an authenticated client stops being *possible*, rather than being budgeted against. |
| DELETE (own prefix) | **drop** | Purge belongs to the `DELETE /analysis/:id` (#57) and delete-account (#58) edge functions, both service-role. A client DELETE policy buys nothing and lets a client purge objects out from under a live row. |
| UPDATE | unchanged (none) | Frames remain write-once. |

On `public.analyses` (from `20260711150200_analyses.sql`):

| Policy | Fate | Why |
|---|---|---|
| SELECT (own) | **keep** | Quota display and Past Analyses read it. |
| DELETE (own) | **drop** | See "The invariant" above — with the client's storage DELETE gone, a client-side row delete would permanently strand that row's frames. Deletion moves to #57's edge function. |
| INSERT / UPDATE | unchanged (none) | Rows are written only by the RPCs. |

### 3. Deletion authority — the rule that ripples into #57, #58 and #47

**Purge deletes by prefix `{user_id}/{analysis_id}/`. It never iterates `media_paths`.**

Reachability comes from *the row existing*, not from `media_paths` being populated. If the
function crashes between the upload and the settle, objects exist under a prefix whose row is
still `reserved` with an empty `media_paths`. A prefix-delete finds them. A
`media_paths`-driven delete would not — and would reinvent the exact orphan this spec exists to
remove.

So `media_paths` is the **display list** for the frame strip, not the deletion authority. #57,
#58 and #47 all inherit this rule.

### 4. Path scheme

`{user_id}/{analysis_id}/frame-{NN}.jpg`, `NN` zero-padded from `01`, ordered by sampled
timestamp. Derived entirely server-side from values the server already holds. The nested prefix
is preserved exactly as `CLAUDE.md` and `docs/architecture.md` describe it, so #57/#58's
prefix-delete logic is unaffected by this change.

### 5. The `analyze-form` contract (hands off to #44)

`mediaPaths` comes **out** of the request body. The client sends
`{ mediaType, frames: base64[], timestamps: number[], idempotencyKey }`.

```
reserve_analysis(user, key, type, frames.length)
  ├─ reject (402 / frame cap / anti-farming / invalid) → return. Nothing uploaded, nothing to clean.
  ├─ existing row → return cached result (idempotent, unchanged)
  └─ row created, id minted
        │
   Claude vision call (+1 retry)
        ├─ fail → release_analysis(). No upload ever happened. No orphan.
        └─ ok / honest-partial
              ├─ upload frames, service-role → {user_id}/{id}/frame-NN.jpg
              ├─ settle_analysis(user, id, result, is_fallback, paths_that_landed)
              └─ return { result, analysisId, isFallback }
```

**Failure handling.** A frame that fails to upload does not fail the request: we settle with
whichever paths landed (possibly none), so `media_paths` never names an object that does not
exist. The user gets the analysis they paid for and the frame strip degrades to partial or
empty — a cosmetic M6 feature is never worth discarding a billed vision result, and never worth
burning one of the user's three anti-farming attempts over a Storage blip.

A failed *settle* leaves a `reserved` row plus its objects. #47's stale-reserve sweep releases
the row and purges the prefix; quota is not burned and nothing leaks. #47 must therefore purge
the prefix, not just release the row — an addition to that issue.

### 6. Client

`lib/frames.ts` (#34) extracts, downscales, budget-checks and returns base64. It does not touch
Storage.

**#35 as written becomes obsolete** — there is no direct-to-bucket upload to build. The
architecture doc's resumable/TUS bullet (`:417`) goes with it. Net effect: the client stops
uploading every frame twice, and the ≤5MB request body becomes the single bandwidth
constraint.

## Scope

This change lands the **contract**, not the feature. In scope:

1. One new migration: the two RPC signature changes + the three dropped policies (storage
   INSERT, storage DELETE, `analyses` DELETE).
2. Doc updates that encode the decision: `docs/architecture.md` (the analyze-form flow, the
   media-pipeline section, the API table, the RPC descriptions, the RLS paragraph), `CLAUDE.md`
   (the client no longer writes to the bucket), `docs/change_log.md`.
3. Issue updates so the blocked work is built against the right contract: close #8 and #7,
   re-scope or close #35, add the prefix-delete rule to #3/#57/#58, add prefix-purge to #47,
   record that #57 is now a hard prerequisite for any user-facing delete, unblock #34/#44.

Explicitly **out of scope**: building `analyze-form` itself (#44), `lib/frames.ts` (#34), and
the delete/purge edge functions (#57, #58). The whole point is to fix the contract *before*
that code encodes the broken ordering.

## Verification

The repo has no pgTAP harness and this change adds no TypeScript, so `typecheck && lint && test`
will pass trivially and prove nothing on its own. Real verification is against the live
database, via the Supabase MCP:

- `reserve_analysis` exists with exactly 4 arguments and no 5-arg overload remains.
- `settle_analysis` exists with exactly 5 arguments and no 4-arg overload remains.
- Both are `SECURITY DEFINER`, `search_path = public`, and `EXECUTE` is granted to
  `service_role` only — not to `public`, `anon` or `authenticated`.
- `storage.objects` has exactly one policy for bucket `media` (SELECT); the INSERT and DELETE
  policies are gone.
- `public.analyses` has exactly one policy (SELECT); the DELETE policy is gone, and RLS is still
  enabled on the table.
- A `settle_analysis` call with a path outside `{user_id}/{analysis_id}/` returns
  `invalid_media_path` and leaves `media_paths` untouched.
- `get_advisors` reports no new security findings.
