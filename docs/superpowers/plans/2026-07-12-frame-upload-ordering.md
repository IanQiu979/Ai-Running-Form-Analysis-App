# Frame-Upload Ordering Fix (#88) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for a frame to exist in the `media` bucket without an `analyses` row pointing at it — by moving the upload server-side, after the model call — and record that contract in the docs before #34/#44/#57/#58 are built against the broken one.

**Architecture:** `reserve_analysis` loses `p_media_paths`; `settle_analysis` gains it, with a guard that every path sits under `{p_user_id}/{p_analysis_id}/`. The client's ability to write to the bucket (storage INSERT/DELETE) and to destroy a row (`analyses` DELETE) is removed, so the only writer is the service-role edge function and the only deleter is #57. No TypeScript changes: this lands the contract, not the feature.

**Tech Stack:** Postgres (Supabase), plpgsql, SQL migrations under `supabase/migrations/`. Verification via the Supabase MCP against the live project.

**Spec:** `docs/superpowers/specs/2026-07-12-frame-upload-ordering-design.md`

## Global Constraints

- **The invariant, both directions:** no object exists in the bucket unless an `analyses` row already points at it; no row can be destroyed while its objects survive.
- **Purge deletes by prefix** `{user_id}/{analysis_id}/`, never by iterating `media_paths`. `media_paths` is the frame-strip display list, not the deletion authority.
- **Path scheme:** `{user_id}/{analysis_id}/frame-{NN}.jpg`, `NN` zero-padded from `01`, ordered by sampled timestamp. Derived server-side only. There is no client-supplied storage path anywhere in the system after this change.
- **Every RPC** stays `SECURITY DEFINER` with `set search_path = public`, and `EXECUTE` is revoked from `public`/`anon`/`authenticated` and granted only to `service_role`. **Grants do not survive a signature change** — they must be re-applied to each new signature.
- **Migration filenames** are `YYYYMMDDHHMMSS_slug.sql`, UTC, and must sort after `20260712030617_consents_grant_hardening.sql`.
- **Out of scope:** building `analyze-form` (#44), `lib/frames.ts` (#34), the delete/purge edge functions (#57, #58). Do not create `supabase/functions/*`.
- Run `npm run typecheck && npm run lint && npm test` clean before every commit (CLAUDE.md).

---

### Task 1: The migration — RPC signatures and RLS policies

**Files:**
- Create: `supabase/migrations/20260712T_______frame_upload_ordering.sql` (fill the timestamp at authoring time with `date -u +%Y%m%d%H%M%S`)
- Test: none — the repo has no pgTAP harness. Task 2 verifies against the live database.

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public.reserve_analysis(p_user_id uuid, p_idempotency_key text, p_media_type public.media_type, p_frame_count integer) returns jsonb` — **4 args**, `p_media_paths` gone.
  - `public.settle_analysis(p_user_id uuid, p_analysis_id uuid, p_result jsonb, p_is_fallback boolean default false, p_media_paths text[] default '{}') returns jsonb` — **5 args**, `p_media_paths` added last so the existing 4-arg call shape still reads naturally.
  - New failure return from `settle_analysis`: `{"ok": false, "reason": "invalid_media_path"}`.
  - `public.release_analysis` — **unchanged**, do not touch it.

- [ ] **Step 1: Get the migration timestamp**

Run: `date -u +%Y%m%d%H%M%S`

Use the output as the filename prefix. It must sort after `20260712030617`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/<timestamp>_frame_upload_ordering.sql`:

```sql
-- #88 — frame-upload ordering. The upload moves server-side, into the
-- analyze-form edge function, and happens AFTER reserve_analysis has already
-- minted the row.
--
-- WHY. The old contract was unbuildable and leaked. reserve_analysis mints the
-- analysis id server-side (insert ... returning id) yet took p_media_paths as an
-- INPUT, so the client had to name {user_id}/{analysis_id}/ before the
-- analysis_id that path needs existed. And all four rejection branches
-- (invalid_*, frame_cap_exceeded, too_many_failed_attempts, quota_exceeded)
-- return BEFORE the insert — so a Free user who has spent their one lifetime
-- analysis uploaded frames, got a 402, and left images of their body in the
-- bucket with no row pointing at them, forever, with no way to ever delete them.
--
-- THE INVARIANT, both directions:
--   * No object exists in the media bucket unless an analyses row already
--     points at it.  (forward: the upload now happens after the reserve)
--   * No row can be destroyed while its objects survive.  (reverse: the client
--     loses DELETE on both storage.objects and analyses; purge is #57's job)
--
-- DELETION AUTHORITY. Purge deletes by PREFIX {user_id}/{analysis_id}/, never by
-- iterating media_paths. Reachability comes from the ROW EXISTING, not from
-- media_paths being populated: a crash between the upload and the settle leaves
-- objects under a prefix whose row is still 'reserved' with an empty
-- media_paths. A prefix-delete finds them; a media_paths-driven delete would
-- not, and would reinvent the exact orphan this migration removes. media_paths
-- is the frame-strip DISPLAY list. #47/#57/#58 all inherit this.

-- ---------------------------------------------------------------------------
-- 1. reserve_analysis: drop p_media_paths.
-- ---------------------------------------------------------------------------
-- The old 5-arg function must be DROPPED, not just replaced: a create-or-replace
-- with fewer args creates an OVERLOAD, leaving the old signature callable and
-- still accepting client-supplied paths (#8).

drop function if exists public.reserve_analysis(uuid, text, public.media_type, integer, text[]);

create or replace function public.reserve_analysis(
  p_user_id         uuid,
  p_idempotency_key text,
  p_media_type      public.media_type,
  p_frame_count     integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing       public.analyses;
  v_tier           public.analysis_tier;
  v_purchased_at   timestamptz;
  v_limit          integer;
  v_frame_cap      integer;
  v_window         tstzrange;
  v_active_count   integer;
  v_released_count integer;
  v_new_id         uuid;
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_idempotency_key');
  end if;
  if p_frame_count is null or p_frame_count < 1 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_frame_count');
  end if;
  if p_media_type = 'photo' and p_frame_count <> 1 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_frame_count_for_photo');
  end if;

  -- Serialize every reserve call for this user — see the original migration's
  -- header for why a bare count-then-insert does not close the race.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':analysis_reserve'));

  select * into v_existing
  from public.analyses
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if found then
    return jsonb_build_object(
      'allowed', true,
      'existing', true,
      'id', v_existing.id,
      'status', v_existing.status,
      'tier', v_existing.tier_at_run,
      'result', v_existing.result,
      'is_fallback', v_existing.is_fallback
    );
  end if;

  select tier, purchased_at into v_tier, v_purchased_at
  from public.subscriptions
  where user_id = p_user_id and status = 'active';

  if not found then
    v_tier := 'free';
  end if;

  v_limit := case v_tier when 'free' then 1 when 'pro' then 10 when 'elite' then 30 end;
  v_frame_cap := case v_tier when 'free' then 1 when 'pro' then 5 when 'elite' then 8 end;

  if p_frame_count > v_frame_cap then
    return jsonb_build_object('allowed', false, 'reason', 'frame_cap_exceeded', 'tier', v_tier, 'frame_cap', v_frame_cap);
  end if;

  if v_tier = 'free' then
    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered');

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released';
  else
    v_window := public.pace_current_period(v_purchased_at, now());

    select count(*) into v_active_count
    from public.analyses
    where user_id = p_user_id and status in ('reserved', 'delivered')
      and created_at <@ v_window;

    select count(*) into v_released_count
    from public.analyses
    where user_id = p_user_id and status = 'released'
      and created_at <@ v_window;
  end if;

  if v_released_count >= 3 then
    return jsonb_build_object('allowed', false, 'reason', 'too_many_failed_attempts', 'tier', v_tier);
  end if;

  if v_active_count >= v_limit then
    return jsonb_build_object('allowed', false, 'reason', 'quota_exceeded', 'tier', v_tier, 'used', v_active_count, 'limit', v_limit);
  end if;

  -- media_paths is deliberately NOT set here. The row is minted first, with an
  -- empty media_paths; the edge function uploads the frames only after the model
  -- call succeeds, then records the paths that actually landed via
  -- settle_analysis. That ordering is the whole point of #88.
  insert into public.analyses (
    user_id, media_type, frame_count, tier_at_run, status, idempotency_key
  ) values (
    p_user_id, p_media_type, p_frame_count, v_tier, 'reserved', p_idempotency_key
  )
  returning id into v_new_id;

  return jsonb_build_object('allowed', true, 'existing', false, 'id', v_new_id, 'status', 'reserved', 'tier', v_tier);
exception
  when unique_violation then
    select * into v_existing
    from public.analyses
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
    return jsonb_build_object(
      'allowed', true, 'existing', true, 'id', v_existing.id,
      'status', v_existing.status, 'tier', v_existing.tier_at_run,
      'result', v_existing.result, 'is_fallback', v_existing.is_fallback
    );
end;
$$;

revoke execute on function public.reserve_analysis(uuid, text, public.media_type, integer) from public, anon, authenticated;
grant execute on function public.reserve_analysis(uuid, text, public.media_type, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 2. settle_analysis: gain p_media_paths, with a namespace guard.
-- ---------------------------------------------------------------------------
-- Same overload hazard as above — drop the 4-arg signature explicitly.
--
-- The guard is what permanently closes #8: after this, not even the service role
-- can record a path outside the row's own {user_id}/{analysis_id}/ namespace, so
-- a compromised or buggy edge function cannot point one user's analyses row at
-- another user's frames.

drop function if exists public.settle_analysis(uuid, uuid, jsonb, boolean);

create or replace function public.settle_analysis(
  p_user_id     uuid,
  p_analysis_id uuid,
  p_result      jsonb,
  p_is_fallback boolean default false,
  p_media_paths text[] default '{}'
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

  -- Every path must sit under this row's own prefix, and must name a file
  -- inside it (not the bare prefix). Reject the whole call rather than silently
  -- dropping the bad element — a caller passing a foreign path is a bug or an
  -- attack, and swallowing it would hide both.
  foreach v_path in array coalesce(p_media_paths, '{}')
  loop
    if v_path is null or position(v_prefix in v_path) <> 1 or length(v_path) <= length(v_prefix) then
      return jsonb_build_object('ok', false, 'reason', 'invalid_media_path');
    end if;
  end loop;

  update public.analyses
  set status = 'delivered',
      result = p_result,
      is_fallback = coalesce(p_is_fallback, false),
      media_paths = coalesce(p_media_paths, '{}'),
      delivered_at = now()
  where id = p_analysis_id and user_id = p_user_id and status = 'reserved'
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_reserved_or_not_found');
  end if;

  return jsonb_build_object(
    'ok', true, 'id', v_row.id, 'status', v_row.status,
    'result', v_row.result, 'is_fallback', v_row.is_fallback,
    'media_paths', to_jsonb(v_row.media_paths)
  );
end;
$$;

revoke execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) from public, anon, authenticated;
grant execute on function public.settle_analysis(uuid, uuid, jsonb, boolean, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. storage.objects: the client no longer writes to the bucket at all.
-- ---------------------------------------------------------------------------
-- The frames now ride in the analyze-form request body as base64 (they always
-- did — the old spec had the client uploading each frame TWICE, once to the
-- bucket and once in the body) and the edge function writes them with the
-- service-role key, which bypasses RLS. So the client needs no INSERT.
--
-- Dropping INSERT closes #7: a bucket-fill by an authenticated client stops
-- being POSSIBLE, rather than being budgeted against with a per-user byte cap.
--
-- Dropping DELETE keeps the client from purging objects out from under a live
-- row. Purge is #57 (DELETE /analysis/:id) and #58 (delete-account), both
-- service-role, both by prefix.
--
-- SELECT stays: the client mints short-TTL signed URLs for the M6 frame strip,
-- which requires SELECT on the object.

drop policy if exists "Users can upload their own media objects" on storage.objects;
drop policy if exists "Users can delete their own media objects" on storage.objects;

-- ---------------------------------------------------------------------------
-- 4. public.analyses: drop the client DELETE policy.
-- ---------------------------------------------------------------------------
-- This is the REVERSE direction of the invariant. With the client's storage
-- DELETE gone (section 3), a client-side row delete would strand that row's
-- frames: no row pointing at them, and no client-side way to remove them — #88's
-- own bug, reintroduced from the other end, and #3 made strictly worse.
--
-- So deletion becomes the exclusive job of the DELETE /analysis/:id edge
-- function (#57), which removes the row AND prefix-purges the objects in one
-- place. Nothing regresses today: no client code deletes an analysis (the only
-- client reference to the table is a quota-display SELECT in
-- app/(tabs)/index.tsx) and the M6 delete UI does not exist yet.
--
-- CONSEQUENCE: #57 is now a hard prerequisite for any user-facing delete.

drop policy if exists "Users can delete their own analyses" on public.analyses;
```

- [ ] **Step 3: Confirm the SQL is self-consistent before applying**

Re-read the file and check, by eye:
- `drop function` is present for **both** old signatures, before their `create or replace`.
- The `revoke`/`grant` pair names the **new** arg list in both cases (4 args / 5 args).
- `release_analysis` is not mentioned anywhere.
- The `insert into public.analyses` no longer lists `media_paths`.

- [ ] **Step 4: Apply the migration to the live project**

Apply via the Supabase MCP `apply_migration` tool, name `frame_upload_ordering`.
Expected: success, no error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/
git commit -m "fix(db): server uploads frames after the model call (#88)

reserve_analysis drops p_media_paths; settle_analysis gains it with a
{user_id}/{analysis_id}/ namespace guard. Client loses INSERT/DELETE on
storage.objects and DELETE on analyses, so no object can outlive its row
and no row can be destroyed while its objects survive.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Verify the migration against the live database

**Files:** none — this task only reads live state.

**Interfaces:**
- Consumes: the migration from Task 1.
- Produces: a pass/fail verdict on each of the spec's six verification criteria. No code.

There is no pgTAP harness and this change adds no TypeScript, so `npm test` proves nothing here. The real assertions run against the live database via the Supabase MCP `execute_sql` tool.

- [ ] **Step 1: Assert the RPC signatures, with no stale overloads**

Run via `execute_sql`:

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('reserve_analysis', 'settle_analysis', 'release_analysis')
order by p.proname, args;
```

Expected: **exactly three rows**.
- `release_analysis(p_user_id uuid, p_analysis_id uuid, p_reason text)`
- `reserve_analysis(p_user_id uuid, p_idempotency_key text, p_media_type media_type, p_frame_count integer)` — **no `text[]`**
- `settle_analysis(p_user_id uuid, p_analysis_id uuid, p_result jsonb, p_is_fallback boolean, p_media_paths text[])`

All three: `security_definer = true`, `proconfig = {search_path=public}`.

**If a 5-arg `reserve_analysis` or a 4-arg `settle_analysis` also appears, the drop failed and the old contract is still callable — stop and fix before going further.**

- [ ] **Step 2: Assert EXECUTE is service-role only**

Run via `execute_sql`:

```sql
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       coalesce(array_to_string(p.proacl, ', '), '(default: PUBLIC)') as acl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('reserve_analysis', 'settle_analysis', 'release_analysis')
order by p.proname;
```

Expected: each `acl` grants `EXECUTE` to `service_role` and to the owner only. It must **not** contain `=X/` (a grant to PUBLIC), nor `anon=X` , nor `authenticated=X`.

A result of `(default: PUBLIC)` is a **failure** — it means the `revoke`/`grant` did not apply to the new signature.

- [ ] **Step 3: Assert the RLS policies**

Run via `execute_sql`:

```sql
select schemaname, tablename, policyname, cmd
from pg_policies
where (schemaname = 'storage' and tablename = 'objects')
   or (schemaname = 'public'  and tablename = 'analyses')
order by schemaname, tablename, cmd;
```

Expected: **exactly two rows**.
- `public / analyses / "Users can view their own analyses" / SELECT`
- `storage / objects / "Users can view their own media objects" / SELECT`

No INSERT, no DELETE, no UPDATE policy on either. If a delete policy for `analyses` or an insert/delete policy on `storage.objects` still appears, the drop failed.

- [ ] **Step 4: Assert RLS is still enabled on analyses**

Dropping every write policy must not be confused with disabling RLS. Run via `execute_sql`:

```sql
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname = 'analyses' and relnamespace = 'public'::regnamespace;
```

Expected: `relrowsecurity = true`.

- [ ] **Step 5: Prove the namespace guard rejects a foreign path**

This is the assertion that closes #8.

The guard runs **before** the `update`, so it can be exercised without any row existing — which
is what makes this probe safe to run against the live database. It writes nothing: a rejected
path returns before the `update`, and an accepted path falls through to an `update` that matches
no row. Use two uuids that belong to nobody.

```sql
-- (a) A path under a DIFFERENT analysis id must be rejected by the guard.
select public.settle_analysis(
  '00000000-0000-0000-0000-000000000001'::uuid,   -- p_user_id
  '00000000-0000-0000-0000-000000000002'::uuid,   -- p_analysis_id
  '{}'::jsonb,
  false,
  array['00000000-0000-0000-0000-000000000001/ffffffff-ffff-ffff-ffff-ffffffffffff/frame-01.jpg']
) as foreign_analysis;

-- (b) A path under a DIFFERENT user id must be rejected too.
select public.settle_analysis(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '{}'::jsonb,
  false,
  array['ffffffff-ffff-ffff-ffff-ffffffffffff/00000000-0000-0000-0000-000000000002/frame-01.jpg']
) as foreign_user;

-- (c) The bare prefix with no filename must be rejected.
select public.settle_analysis(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '{}'::jsonb,
  false,
  array['00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/']
) as bare_prefix;

-- (d) A correctly-namespaced path must PASS the guard — and then fall through to
--     'not_reserved_or_not_found', because no such row exists. That distinct
--     reason is the proof the guard let it through rather than rejecting it.
select public.settle_analysis(
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '{}'::jsonb,
  false,
  array['00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/frame-01.jpg']
) as own_path;
```

Expected:
- `foreign_analysis` → `{"ok": false, "reason": "invalid_media_path"}`
- `foreign_user` → `{"ok": false, "reason": "invalid_media_path"}`
- `bare_prefix` → `{"ok": false, "reason": "invalid_media_path"}`
- `own_path` → `{"ok": false, "reason": "not_reserved_or_not_found"}` ← **this must NOT be `invalid_media_path`**

Case (d) is the one that catches an over-tight guard. If it returns `invalid_media_path`, the
prefix check is rejecting legitimate paths and the frame strip would silently never populate.

- [ ] **Step 6: Check the advisors**

Run the Supabase MCP `get_advisors` tool with `type: "security"`.
Expected: no **new** findings versus before the migration. In particular, no "RLS enabled but no policy" style warning that would indicate RLS got disabled rather than narrowed.

- [ ] **Step 7: Record the results**

No commit — this task produces a verdict, not a diff. Report each of steps 1–6 as pass/fail with the actual output. If any assertion failed, stop and fix the migration before Task 3.

---

### Task 3: Update the docs to encode the new contract

**Files:**
- Modify: `docs/architecture.md` — the analyze-form flow (steps 5 and 9, ~`:373-395`), the media-pipeline section (~`:397-417`), the API table row for `POST /functions/v1/analyze-form` (~`:437`), the RPC family descriptions (~`:514-533`), the RLS paragraph (~`:546-562`)
- Modify: `CLAUDE.md` — the "Uploaded media is sensitive" bullet in § Secrets & env
- Modify: `docs/change_log.md` — a bullet under `## 2026-07-12`

**Interfaces:**
- Consumes: the verified migration from Tasks 1–2.
- Produces: docs that describe the shipped contract. #44's implementer reads these; they must not still say the client uploads.

- [ ] **Step 1: Fix the analyze-form flow, step 5 (inputs)**

In `docs/architecture.md`, the "Inputs" step currently says the frames "were **already** uploaded direct-to-bucket, and their storage paths ride in the request alongside the base64 frame data." Replace that clause so it reads:

```
5. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames with their actual
   sampled timestamps (Android snaps to keyframes, so the actual timestamps are recorded rather
   than assumed to be evenly spaced). The frames ride in the request body as base64 and are
   **not** uploaded by the client — the server writes them to the bucket itself, after the model
   call (#88). Frame count per tier: Free 1 / Pro 5 / Elite 8.
```

- [ ] **Step 2: Fix the analyze-form flow, step 9 (settle) and add the upload step**

Replace the "Settle" step so the upload is visible in the flow:

```
9. **Upload, then settle** — on a success or honest-partial, the function uploads the frames
   itself (service-role) to `{user_id}/{analysis_id}/frame-{NN}.jpg` — the row already exists, so
   no object can ever be orphaned — then marks the reservation delivered, persisting the result
   to `analyses` (`result` JSONB, `media_paths`, `tier_at_run`, `frame_count`, `is_fallback`) and
   returning `{ result, analysisId, isFallback }`. A frame that fails to upload does **not** fail
   the request: settle records only the paths that landed, so `media_paths` never names an object
   that doesn't exist. On a release path nothing is uploaded at all.
```

- [ ] **Step 3: Rewrite the media-pipeline section**

Replace the first bullet ("The client extracts and downscales the analyzed frames, then uploads **only those frames** direct-to-bucket…") and delete the resumable/TUS clause from the backgrounding-recovery bullet:

```
- The client extracts and downscales the analyzed frames and sends them **in the request body as
  base64**. It does not upload them — the `analyze-form` function writes them to the private
  bucket with the service-role key, under `{user_id}/{analysis_id}/frame-{NN}.jpg`, and only
  after the model call has succeeded. Frames were previously specced to be uploaded twice (once
  direct-to-bucket, once in the body); now they cross the wire once.
- `storage.objects` RLS is **select-own only**: the client can read its own frames to mint signed
  URLs, and can no longer insert or delete. `analyses` is likewise select-own only — deleting an
  analysis is the job of `DELETE /functions/v1/analysis/:id` (#57), which removes the row and
  purges the storage prefix together.
- **Purge deletes by prefix** `{user_id}/{analysis_id}/`, never by iterating `media_paths`.
  Reachability comes from the row existing, not from `media_paths` being populated — a crash
  between the upload and the settle leaves objects under a prefix whose row is still `reserved`
  with an empty `media_paths`. `media_paths` is the frame-strip display list, not the deletion
  authority.
```

And in the backgrounding-recovery bullet, drop the final sentence "Frame upload uses the resumable/TUS path for anything large enough to want progress." — there is no client-side upload left to resume.

- [ ] **Step 4: Fix the API table row**

The `POST /functions/v1/analyze-form` row's request column currently reads
`{ mediaType, frames: [base64...], mediaPaths: string[], idempotencyKey }`, and its notes say
"`mediaPaths` are the direct-to-bucket paths of the same frames being analyzed". Replace with:

| Request | Notes |
|---|---|
| `{ mediaType: "photo"\|"video", frames: [base64...], timestamps: number[], idempotencyKey }` | Core call. **No `mediaPaths`** — the client never names a storage path (#88). The server uploads the frames itself, after the model call, and derives their paths. Enforces tier + frame cap + atomic quota reserve, injects certified knowledge, validates, persists. Idempotent on `idempotencyKey`. |

Keep the rest of the row (auth, response, status codes) as it is.

- [ ] **Step 5: Fix the RPC family descriptions**

- Change the `reserve_analysis` signature in the bullet from
  `(p_user_id, p_idempotency_key, p_media_type, p_frame_count, p_media_paths)` to
  `(p_user_id, p_idempotency_key, p_media_type, p_frame_count)`, and append to that bullet:
  "Takes **no media paths** — the row is minted with an empty `media_paths`, and the frames are
  uploaded and recorded later, by `settle_analysis` (#88)."
- Change the `settle_analysis` bullet's signature to
  `(p_user_id, p_analysis_id, p_result, p_is_fallback, p_media_paths)` and append:
  "Records `media_paths` at settle time, and **rejects any path outside
  `{p_user_id}/{p_analysis_id}/`** with `invalid_media_path` — so not even the service role can
  point one user's row at another user's frames (closes #8)."

- [ ] **Step 6: Fix the RLS paragraphs**

In the "RLS, as deployed" paragraph, `analyses` is described as "select-own **and delete-own**
(direct client `DELETE` is allowed by RLS as a fallback path…)". Replace that clause with:

```
`analyses` is **select-own only** — the delete-own policy was removed in #88, because with the
client's storage `DELETE` also gone, a client-side row delete would strand that row's frames
with nothing pointing at them and no way to remove them. Deleting an analysis is now exclusively
the job of the planned `DELETE /functions/v1/analysis/:id` edge function (#57), which removes the
row and purges the storage prefix together — so **#57 is a hard prerequisite for any user-facing
delete**.
```

In the "Media privacy, as deployed" paragraph, replace "has owner-scoped `storage.objects` RLS
for insert/select/delete" with:

```
has owner-scoped `storage.objects` RLS for **select only** — the insert and delete policies were
removed in #88 (the server uploads with service-role; purge belongs to #57/#58) — and
deliberately no UPDATE policy
```

- [ ] **Step 7: Update the CLAUDE.md media bullet**

In § Secrets & env, the "Uploaded media is sensitive" bullet says frames live in "a **private
Storage bucket with owner-scoped RLS**". Append to that bullet:

```
  The **client never writes to the bucket** — it sends frames as base64 in the `analyze-form`
  request body and the edge function uploads them with the service-role key, only after the model
  call succeeds, so a rejected or failed analysis leaves nothing behind (#88). Client RLS on the
  bucket is **select-only** (for signed URLs); purge is server-side and deletes by the
  `{user_id}/{analysis_id}/` prefix, never by the row's `media_paths` list.
```

- [ ] **Step 8: Add the change_log entry**

Under the existing `## 2026-07-12` heading in `docs/change_log.md`, add a bullet at the top of
that day's list:

```markdown
- **Frame uploads move server-side, after the model call (closes #88, #8, #7).** The old contract
  was both unbuildable and leaking: `reserve_analysis` minted the analysis id server-side yet took
  `p_media_paths` as an input, so the client had to name `{user_id}/{analysis_id}/` before that id
  existed — and every rejection branch (402 over-quota, frame cap, anti-farming) returned *before*
  the insert, so a Free user who had spent their one lifetime analysis uploaded frames, got a 402,
  and left images of their body in the bucket with no row pointing at them, undeletable forever.
  - **Changed** `reserve_analysis` to drop `p_media_paths` (now 4 args) and `settle_analysis` to
    take it (now 5 args), guarded so every path must sit under `{p_user_id}/{p_analysis_id}/` —
    which is what permanently closes #8. Old signatures were `drop function`'d, not merely
    replaced, so no overload keeps the old contract callable.
  - **Removed** the client's `INSERT` and `DELETE` policies on `storage.objects` — the server
    uploads with the service-role key, so a bucket-fill by an authenticated client (#7) stops
    being *possible* rather than being budgeted against.
  - **Removed** the client's `DELETE` policy on `analyses`. With the storage `DELETE` gone, a
    client-side row delete would have stranded that row's frames — #88's own bug from the other
    end. Deletion is now exclusively #57's edge function, which makes **#57 a hard prerequisite
    for any user-facing delete**. Nothing regressed: no client code deleted an analysis and the
    M6 delete UI does not exist.
  - **Established** that purge deletes by the `{user_id}/{analysis_id}/` **prefix**, never by
    iterating `media_paths` — reachability comes from the row existing, not from `media_paths`
    being populated. #47/#57/#58 inherit this.
  - **Net effect for the client:** frames now cross the wire **once** (base64 in the body) instead
    of twice (bucket + body), and `lib/frames.ts` (#34) never touches Storage.
```

- [ ] **Step 9: Verify and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all three pass. (Docs-only changes — this is a regression guard, not a proof.)

```bash
git add docs/architecture.md CLAUDE.md docs/change_log.md
git commit -m "docs: the server uploads frames, the client never does (#88)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Reconcile the affected GitHub issues

**Files:** none — GitHub only. Use the `github-ops` subagent per CLAUDE.md § Git etiquette.

**Interfaces:**
- Consumes: the shipped migration and docs from Tasks 1–3.
- Produces: an issue tree where nothing still describes the old contract. #34/#44 must be safe to pick up cold.

The point of #88 was to settle this *once*, before more code encodes the broken ordering. An issue left describing client-side upload is exactly how that happens anyway.

- [ ] **Step 1: Close the issues this change resolves**

- **#8** ("`reserve_analysis` accepts arbitrary `p_media_paths` with no ownership check") — close. The argument no longer exists, and `settle_analysis`'s namespace guard means no caller, service role included, can record a foreign path. Comment with the guard's SQL.
- **#7** ("Private media bucket has no per-user storage budget — any authenticated user can fill it") — close. The client's storage `INSERT` policy is gone; an authenticated client can no longer write any object. The only writer is the edge function, bounded by the per-tier frame cap and quota. A byte budget is no longer needed to make the bucket safe.
- **#35** ("M2: direct-to-bucket frame upload under `{user_id}/{analysis_id}/`") — close as obsolete. There is no direct-to-bucket upload to build; the work it described now lives inside #44. Say so explicitly rather than silently closing.

- [ ] **Step 2: Comment the prefix-delete rule onto the delete issues**

Add to **#3**, **#57**, **#58**:

> Settled by #88: **purge deletes by the `{user_id}/{analysis_id}/` prefix, never by iterating the row's `media_paths`.** Reachability comes from the row existing, not from `media_paths` being populated — a crash between the frame upload and the settle leaves objects under a prefix whose row is still `reserved` with an empty `media_paths`. A prefix-delete finds those; a `media_paths`-driven delete would not, and would recreate the exact orphan #88 removed. `media_paths` is the frame-strip display list, not the deletion authority.

Additionally on **#57**: note that the client's `DELETE` policy on `analyses` was dropped in #88,
so **#57 is now a hard prerequisite for any user-facing delete** — the M6 delete UI cannot ship
without it.

Additionally on **#3**: the orphan class it describes (row deleted, objects remain) can no longer
be *created* by a client, since neither the row nor the objects are client-deletable. It now
scopes to whatever #57/#58 must do server-side.

- [ ] **Step 3: Comment the new contract onto the blocked build issues**

Add to **#44** ("build the analyze-form edge function"):

> Contract settled by #88 — build against this, not against the older description in `docs/architecture.md` history:
> - Request body is `{ mediaType, frames: base64[], timestamps: number[], idempotencyKey }`. **No `mediaPaths`.**
> - `reserve_analysis` is now 4 args (no `p_media_paths`); `settle_analysis` is 5 (it takes them).
> - Order is: reserve → model call → **on success only**, upload frames service-role to `{user_id}/{analysis_id}/frame-{NN}.jpg` → settle with the paths that landed. Never upload before the reserve; a rejection must leave nothing behind.
> - A frame that fails to upload does not fail the request — settle with the paths that did land, so `media_paths` never names a missing object.
> - A failed settle leaves a `reserved` row plus objects; #47's sweep is the backstop and must purge the prefix.

Add to **#34** ("install expo-image-manipulator and build `lib/frames.ts`"):

> Unblocked by #88, with one change: `lib/frames.ts` extracts, downscales, budget-checks and returns base64. It **does not touch Storage** — the client no longer uploads frames at all (it has no `INSERT` on the bucket). The ≤5MB request body is the single bandwidth constraint.

- [ ] **Step 4: Add the prefix-purge requirement to #47**

Add to **#47** ("sweep stale `reserved` analyses rows"):

> #88 adds a requirement: the sweep must **also purge the `{user_id}/{analysis_id}/` storage prefix** when it releases a stale `reserved` row, not just flip the status. A row can be left `reserved` *with frames already uploaded* if `analyze-form` crashes between the upload and the settle — releasing the row without purging the prefix would leave those frames behind with a released row nobody will ever open.

- [ ] **Step 5: Close #88**

Close with a summary comment: the contract that shipped, the four other issues it closed or
re-scoped, and the one new constraint it introduced (#57 gates any user-facing delete).

---

## Notes for the implementer

**The single highest-risk step is the `drop function`.** Postgres will happily let
`create or replace function` with a different argument list create a *second* function rather
than replacing the first. If the drops silently no-op (e.g. a typo in the arg types), the old
5-arg `reserve_analysis` stays callable, still accepts client-supplied paths, and the entire
change is cosmetic. Task 2 Step 1 is the assertion that catches this — do not skip it, and do not
accept "3 rows returned" without reading the actual arg lists.

**Do not touch `release_analysis`.** It is correct as-is. On a release path nothing was ever
uploaded, so it has no storage concern.

**Do not create `supabase/functions/*`.** The upload code described throughout this plan is #44's
to write. This plan lands the contract it will be written against.
