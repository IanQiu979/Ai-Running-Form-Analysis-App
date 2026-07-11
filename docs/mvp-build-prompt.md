# V2.3 MVP Build Prompt

> **How to use:** open a Claude Code session in this repo and say:
> *"Read `docs/mvp-build-prompt.md` and execute it. Start with Phase 0."*
> Produced 2026-07-10 after a full three-lens audit (spec consistency vs Echo V1 ground truth,
> UX/media feasibility, live DB state). Findings are baked in below as **Rulings** (apply,
> don't re-litigate) and a **Decision gate** (ask Ian, don't invent). Do NOT re-run the audit.
>
> **Update 2026-07-10 (same day): Ian had the knowledge layer and design layer built up front.**
> The three certified knowledge files now exist at `knowledge/` (`pace_framework.md`,
> `injury_flags.md`, `drills.md`) — Posture/Arm-swing/Cadence adapted from the ECHO library and
> refined against cited literature, **Elasticity authored from peer-reviewed sources** (citations
> in `pace_framework.md` for coach sign-off). The design layer now exists as a single basic-MVP
> brief at `docs/design/frontend-design-brief.md`. Four design/product decisions are **locked**
> (see the updated Decision gate): visual direction = **distinct-but-related** to V2.2; score
> display = **0–100 + band per pillar**; Past Analyses stores **frames only**; Elite comparison =
> **minimal client-side**. Phase 0.5 is now mostly done — what remains there is the copy deck, a
> privacy pass, and Ian's certification review of the drafted Elasticity content.

---

## Mission

Build the V2.3 MVP — Photo/Video Running Analysis — end to end: milestones M1–M7 in
`planning/02-product-requirements.md`. The product does one thing: submit a running photo or
video → get certified, PACE-grounded form feedback, tiered Free/Pro/Elite.
**The analysis engine (M3 grounding + M4 vision call) is the core. Nothing else matters until
a side-on clip returns an honest, certified, well-parsed result.**

Multi-session work: update `docs/status.md` and `docs/change_log.md` at the end of every
session (use `session-handoff` if available).

## Read first, in this order

1. `CLAUDE.md` + `AGENTS.md` — standing rules
2. `docs/status.md` — where the project actually is (its Known Issues list is accurate)
3. `planning/02-product-requirements.md` + `planning/03-engineering-requirements.md` — the spec
4. `docs/architecture.md` — route tree, API, schema draft
5. Echo V1 ground truth (frozen repo, read-only):
   `react-native-supabase-practice/app/form-analysis.tsx`,
   `supabase/functions/anthropic-coach/index.ts`, `supabase/functions/delete-user/index.ts`,
   `echo-knowledge/ECHO_Framework_CORRECTED.md`
6. V2.2's design docs (the family reference for what "designed" means):
   `v2.2-workout-plan-generator/docs/design/frontend-design-brief.md` + `mvp-blueprint.md`

## Standing rules (non-negotiable, all phases)

- **Never invent biomechanics.** Every score rubric, cue, drill, and injury flag comes from
  Ian's certified content (`echo-knowledge/` → adapted `knowledge/`). If the source doesn't
  cover something, it goes to Ian — see Decision gate #1, which is exactly this problem.
- **The vision prompt lives server-side.** Echo V1 built its form prompt client-side and sent
  it through a pass-through proxy — any authenticated caller could run arbitrary prompts on
  the project's API key. Reuse V1's base64 image-block *pattern*, never its client-side-prompt
  *architecture*.
- **No fabricated results, ever.** V1's "tolerant parser" fabricates score 75 + "No feedback
  available" for missing pillars. That is banned here: a pillar the model didn't return is
  shown as not assessed, never as an invented certified-looking number.
- **No business rules in the client.** Tier, quota, frame caps: server-side only.
- **Secrets:** `ANTHROPIC_API_KEY` never gets `EXPO_PUBLIC_`, never enters the bundle.
- **Media is sensitive.** Videos of people's bodies. Private bucket, owner-scoped RLS, signed
  URLs only, deletion really deletes (row AND object), consent copy before first upload.
- **Verification:** `npm run typecheck && npm test` (and lint once configured) clean before
  every commit; `verifier` subagent at every phase gate.
- **Git:** branch per milestone; auth/RLS/storage/edge-function work goes through a PR via
  `github-ops`.
- **Docs:** `doc-writer` syncs `docs/status.md`, `docs/change_log.md`, `docs/architecture.md`
  after every milestone or decision.
- **Dependencies:** `npx expo install` only.
- **Subagent discipline:** planners plan, builders build, reviewers review; `scope-guard`
  wraps planner→builder handoffs; dispatch independent agents in parallel.

## Owner design directions

- **Visual direction: distinct-but-related to V2.2 (decided).** The full system is in
  `docs/design/frontend-design-brief.md` — the "Gait Plate" concept: same honesty discipline and
  banned list as V2.2 (no glow, glassmorphism, ambient motion, fake AI theatre — and these matter
  *double* in an app that measures a human body), but a warm-neutral base tuned to real photo/video,
  a **score-scale** palette (warm "needs work" → cool "strong"), and the runner's own annotated
  frame as the hero motif. Score display is **0–100 + band** per pillar.
- Family direction from V2.2: screens composed as long, website-like scrolling surfaces;
  website-style scroll-driven animations are a post-MVP phase — build nothing that precludes them.
- **The main goal, in Ian's words: get the input (uploaded photo / uploaded video / freshly
  recorded video) and return a detailed analysis. As long as it does that, it's good.** Keep the
  media and storage machinery as simple as that goal allows — do not over-engineer it.

---

## Subagent roster & orchestration (the full cast — details live in each phase)

This build is subagent-driven. Every phase is planned, built, and reviewed by *different* agents —
never one agent doing all three — and independent agents run in **parallel** (∥). This table is the
map; the authoritative instructions are inline in each phase below. If a phase's work fits an agent
not listed here, use it — this roster is the floor, not the ceiling.

| Phase (milestone) | Subagents (in order; ∥ = parallel) |
|---|---|
| **0 — Reconcile** | `doc-writer` (sync every doc the rulings touch), `scope-guard` (arm handoffs) |
| **0.5 — Design layer remainder** | `ux-copywriter` ∥ `design-system` ∥ `motion-animation` ∥ `privacy-compliance` |
| **1 — Spine (M1)** | `env-config-manager` → `database-engineer` → `supabase-auth` → `security-auditor` |
| **2 — Capture (M2)** | `feature-planner` → `implementer` (wrapped by `scope-guard`) ∥ `test-writer`; then `frontend-builder` |
| **3 — Knowledge grounding (M3)** | `prompt-engineer` → `llm-eval` (knowledge files already written; adapt + Ian certifies) |
| **4 — analyze-form (M4, the core)** | `api-designer` → `prompt-engineer` ∥ `jobs-queues-edge` → `llm-eval` ∥ `test-writer` ∥ `mocks-testdata` → `security-auditor` ∥ `ai-cost-optimizer` |
| **5 — Tiers/quota/paywall (M5)** | `frontend-builder` ∥ `ux-copywriter` |
| **6 — Past Analyses (M6)** | `frontend-builder` ∥ `implementer` ∥ `test-writer` |
| **7 — Polish & TestFlight (M7)** | `motion-animation` ∥ (`accessibility-reviewer` → `accessibility-implementer`) ∥ `responsive-crossdevice` ∥ `ux-copywriter`; then the `frontend-audit` skill → `fix-batch`; then `mobile-release` ∥ `privacy-compliance` |
| **Every phase gate** | `verifier` → `code-reviewer` → `doc-writer` → `github-ops` (PR) |

Skills used alongside the agents: `full-audit` / `frontend-audit` (review sweeps), `fix-batch`
(batch the findings), `session-handoff` (end of each session). Ian is a named reviewer at two
points: certifying the Elasticity content (Phase 0.5 / 3) and skimming the design direction.

---

# Phase 0 — Reconcile before building anything

## 0-A. Repo hygiene (immediately)

1. `git status` — commit anything uncommitted; verify `docs/` is tracked.
2. Note: `.superpowers/sdd/` diff artifacts are session droppings — gitignore or remove.

## 0-B. Rulings — apply as fact, then `doc-writer` syncs every doc that disagrees

1. **The media pipeline — decided: frames only.** As specced it was self-contradictory (the edge
   function was told to "upload the media" it never receives; `media_path` singular vs N frames).
   Resolved to the simplest shape that serves the goal (input → analysis, keep a visual record):
   - The client extracts + downscales the analyzed frames (Ruling 4) and uploads **only those
     frames** **direct-to-bucket** via supabase-js Storage under `{user_id}/{analysis_id}/…`, with
     owner-scoped `storage.objects` RLS policies (insert/select/delete where the path's first
     segment = `auth.uid()`). **The original full-resolution video is never uploaded or stored** —
     it stays on the device. This keeps the free-plan 1 GB bucket viable (a few hundred KB per
     analysis instead of 60–130 MB) and needs no video player.
   - `analyze-form` receives `{ mediaType, frames: [base64…], mediaPaths: string[],
     idempotencyKey }` — it analyzes the frames and records the paths; nothing large rides the JSON.
   - Past Analyses shows the stored frames as a **frame strip / gait-plate thumbnail** via short-TTL
     signed URLs (~1h, regenerate on open). Update the API tables in `planning/03` +
     `docs/architecture.md`, and change `media_path text` → `media_paths text[]`.
2. **Atomic quota gate, reserve-then-deliver.** Count-then-insert has a TOCTOU race with a
   20–60s window (the vision call). Port Echo V1's atomic SECURITY DEFINER RPC
   (`try_record_form_analysis` in `anthropic-coach/index.ts:148-170`) but fix V1's known flaw
   (it burned quota *before* the model call, so failures still charged): reserve atomically →
   run the analysis → mark delivered on success / compensating-release on failure (V1's
   `plan-regen-gate` consume-token + refund pattern is the reference).
3. **Idempotency key** — same design as V2.2: client mints it when the capture flow commits;
   UNIQUE `(user_id, idempotency_key)` on `analyses`; a retried request returns the existing
   row instead of double-charging quota and Anthropic.
4. **Frame spec (numbers the docs never had):** sample timestamps evenly in the 5%–95% window
   (never t=0/end — extractor edge failures; Android snaps to keyframes, so record actual
   timestamps and pass them to the prompt rather than claiming perfect spacing); downscale to
   ≤1568px long edge (Anthropic's optimum) at JPEG q≈0.7 via `expo-image-manipulator`
   (**install it** — `expo-video-thumbnails` has no resize option); target ~150–350KB/frame,
   total request body ≤5MB, enforced client-side and re-checked server-side.
   `expo-video-thumbnails` returns one frame per call — N frames is N sequential calls; show
   progress.
5. **Quota-period arithmetic — port V2.2's ruling verbatim:** purchase-day-anchored periods,
   month-end clamped (Jan 31 → Feb 28 → Mar 31), computed at read time by one pure, unit-tested
   `currentPeriod(anchorDate, now)`; no cron, no rollover writes. **Free is lifetime, not
   per-period**: `free → count(analyses) total`, `pro|elite → count in current period`. A user
   with no `subscriptions` row is `free`. Write both branches into `planning/03`.
6. **`delete-account` edge function is in scope** (the docs promise "account deletion purges
   all media" but the API table has no route). Port V1's `delete-user/` — it exists precisely
   because `storage.objects` has no FK to `auth.users` and orphans every object otherwise.
   Delete order: storage objects → rows → auth user. `DELETE analysis/:id` likewise deletes
   object(s) then row, and a test proves both purges.
7. **Model config:** `claude-sonnet-5` is verified real — but do not copy V1's call shape.
   On Sonnet 5, adaptive thinking is ON by default and thinking tokens count against
   `max_tokens`; V1's 1024/1500 ceilings would truncate to a mostly-thinking partial response.
   Spec: explicit thinking config (off, or adaptive with headroom), `max_tokens` 4–8k, forced
   tool call for structured output.
8. **Error contract:** structured `{ error, code }` on non-2xx like V2.2 — but note
   `supabase.functions.invoke` wraps non-2xx in a generic `FunctionsHttpError`; the client gets
   one shared wrapper that parses the response body out of it. Document once in `planning/03`.
9. **Knowledge-file corrections:** it's **4 source files → 3 targets** (fix the "copy the 4
   knowledge files" wording in planning/README, 01, 02-M3, status.md). And `drills.md`'s
   claimed sources are wrong: `training_zones.md` + `workout_library.md` contain **zero
   drills** — the only certified drills/cues are in `ECHO_Framework_CORRECTED.md` (five
   cadence drills, lines ~153–229; posture/arm-swing cues ~453–478). Point the mapping there.
10. **Permissions & app config:** add camera/image-picker config plugins and
    `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription` strings to `app.json`.
    **Record muted** — form analysis needs no audio, skipping the mic permission entirely is
    a better privacy story. Fix the illegal slug (dots) the moment the name lands (gate #7);
    add `ios.bundleIdentifier` then too.
11. **Install list** (all `npx expo install`): `expo-image-manipulator` (frame resize),
    `expo-apple-authentication` (when gate #8 unblocks). Already present: image-picker, camera,
    video-thumbnails, file-system. **`expo-video` is NOT needed** — frames-only storage means
    Past Analyses shows a frame strip, never a video player.
12. **Backgrounding recovery:** the server persists the result and settles quota even if the
    suspended client never receives the response. On next launch, an analysis that finished
    while away is surfaced ("Your analysis finished — see Past Analyses"), so no one reports a
    stolen credit. Upload uses the resumable/TUS path for anything big enough to want progress.
13. **Elite comparison — decided: keep, minimal.** A **client-side view of two stored results**
    side by side with per-pillar deltas — no new AI call, no quota burn, no extra storage. Specced
    in the design brief (§4, screen 9). It is Elite's cheap, real differentiator.
14. **V1 ground truth corrections for the docs:** V1's real server enforcement lives in
    `anthropic-coach` (atomic RPC, purpose allowlist, tier via service role, over-quota as
    `200 {rate_limited:true}`) — not in `lib/subscription.ts` as `planning/01` claims. V1 video
    "analysis" is one thumbnail at t=1s; client caps were 15s / 8MB (the 15s cap is the
    starting point for gate #5). V1 never persisted results — Past Analyses is entirely new.

## 0-C. Decision gate

**Decided this session (2026-07-10) — apply as fact:**
- **#1 Elasticity content: authored, pending Ian's certification.** The pillar had zero certified
  source coverage; rather than defer, Ian directed it be researched and drafted. `pace_framework.md`
  now defines Elasticity (SSC, ground-contact, vertical oscillation, leg stiffness, reactive
  strength) and `drills.md` gives a safe plyometric ladder — **all traceable to the peer-reviewed
  citations listed in `pace_framework.md`.** Posture/Arm-swing/Cadence were also refined against
  current literature. **Action, not a blocker: Ian reviews and certifies the drafted Elasticity +
  refinements** (it carries his name); the build proceeds in parallel and M3 is now buildable.
- **#2 Past Analyses storage: frames only** (Ruling 1). No video stored, no player.
- **#3 Elite comparison: keep, minimal client-side** (Ruling 13).
- **#10 Visual direction: distinct-but-related** — the design brief is written
  (`docs/design/frontend-design-brief.md`), score display = 0–100 + band.
- **#6 Disclaimer: handled** — the "not medical advice" line + stop-running language live in
  `pace_framework.md`/`injury_flags.md` and render on every result + a first-analysis line
  (design brief §5). ux-copywriter finalizes exact wording; no decision left.

**Still needs Ian before the phases they block — do not invent answers:**

4. **Does a fallback analysis burn quota?** Undefined here, and as written it silently burns
   one — the opposite of V2.2's ruling. Also define what a fallback IS for vision (there's no
   "template analysis"): *recommended: a clearly-labelled partial result only when ≥2 pillars
   parsed, else a clean failure; failures and fallbacks don't burn quota (the reserve is
   released), capped at 3 free retries per period against prompt-injection farming.*
5. **The numbers:** max clip length (*rec: 15s, V1's precedent — also caps latency and cost*),
   frames per tier (*rec: Free 1 / Pro 5 / Elite 8*), max upload size (*rec: 50MB pre-compress
   gate*).
6. **App name** — blocks the slug fix, bundle ID, EAS, store listing (status.md #1/#2).
7. **Apple Developer account timing** — Apple Sign-In is an App Store gate once Google ships
   (status.md #3). *Rec: build email+Google now, add Apple the moment the account exists,
   before TestFlight review.*
8. **Consent & privacy package:** one-line consent copy before first upload ("your photo/video is
   stored privately until you delete it; frames are sent to our AI provider for analysis"), plus
   privacy-policy + App Store privacy-label plan (camera, photos, user content, possibly minors in
   frame). *Rec: consent line + settings disclosure in v1; full policy before public launch —
   tracked, not dropped.*

After the gate: `doc-writer` records every ruling + answer in `docs/change_log.md` and syncs
`planning/*` (Ian-authorized spec changes), `docs/architecture.md`, and `docs/status.md`.

---

# Phase 0.5 — The design layer (mostly done — finish the remainder)

**Already produced this session:** `docs/design/frontend-design-brief.md` — the single basic-MVP
design brief (the "Gait Plate" concept; warm-neutral tokens + score scale; the PACE-readout
component; all 11 screens with their states; light honest motion; the a11y floor). **Build UI from
it; do not re-invent the direction.** The knowledge layer (`knowledge/*.md`) is also done.

**What remains in Phase 0.5 (do before/while the UI phases run):**
1. `ux-copywriter`: the copy deck the brief calls for but doesn't fully write out — permission
   rationales, the consent line, error/empty/offline strings, framing guidance, quota captions
   (Free is lifetime — never "this month"), and the final wording of the disclaimer + stop-running
   language (content already fixed in `pace_framework.md`/`injury_flags.md`).
2. `design-system`: turn the brief's §2 tokens into `constants/theme.ts` (light+dark) and **verify
   every pair against WCAG AA** — the brief lists intent values and explicitly says to prove
   contrast, as V2.2 did. Install the three font families via `npx expo install`.
3. `motion-animation` (consulting): confirm the reveal/wait motion + reduced-motion variants match
   the brief §6 before frontend-builder wires them.
4. `privacy-compliance` (read-only): sanity-check consent/retention/deletion vs App Store privacy
   labels and GDPR-style deletion rights; output → the M7 checklist.
5. **Ian's certification review** of the drafted Elasticity content + pillar refinements
   (gate #1) — parallel to the build, not a blocker.

Gate: copy deck covers every screen state; tokens are in `theme.ts` and pass AA. Then `doc-writer`
links the brief from `docs/architecture.md`.

---

# How the analysis engine must work (ground truth — read twice)

Digest of Echo V1's real shipped behavior + this build's corrected design:

1. **Auth** — verify JWT, reject anon.
2. **Idempotency** — existing `(user_id, idempotency_key)` row → return it. Done.
3. **Atomic reserve** — SECURITY DEFINER RPC: tier limits (Free 1 lifetime / Pro 10 / Elite 30
   per purchase-anchored period), frame-count cap for the tier, reserve atomically. Over quota
   → structured `402`.
4. **Inputs** — photo: one frame. Video: client-extracted, downscaled frames (Ruling 4), with
   their actual timestamps; those same frames were uploaded direct-to-bucket (frames-only, Ruling
   1) and their paths ride in the request.
5. **Grounded prompt, server-side only** — system message = the certified `knowledge/` files
   (`pace_framework.md` + `injury_flags.md` + `drills.md`, bundled into the function; the 0–100 +
   band rubric and the four hard analyzer rules live in `pace_framework.md`), then image blocks
   (+ timestamps), then the scoring instruction. **Tier = a verbosity dial on one prompt**
   (Free: scores + a line per pillar, no drills; Pro: full feedback + injury flags + 1–2
   drills per issue; Elite: Pro + a small depth bump). The Pro→Elite gap is deliberately tiny
   — same analysis, richer wording, never a different call.
6. **One vision call** — `claude-sonnet-5`, explicit thinking config, 4–8k `max_tokens`,
   forced tool call returning structured JSON (pillar → score, feedback, flags, drills). No
   client-side prompts, no regex parsing of prose as the primary path.
7. **Validate structurally, loosely** — the expected shape exists; never judge content.
   Fail → retry once. Fail again → per gate #4: honest partial (≥2 pillars, clearly labelled,
   never fabricated numbers) or clean failure; reserve released either way.
8. **Settle** — mark the reservation delivered, insert the `analyses` row (result JSONB,
   `media_paths`, `tier_at_run`, `frame_count`, `is_fallback`), return
   `{ result, analysisId, isFallback }`.

**V1 lessons not to re-learn:** quota burned before the model call charged users for failures
(fixed by reserve/settle); the tolerant parser fabricated scores (banned); the client-side
prompt made the key a public prompt proxy (banned); limits hand-duplicated across files
drifted (one shared constants module imported by app + functions).

---

# Build phases — the subagent orchestration

Every phase ends: `verifier` → `code-reviewer` on the diff → `doc-writer` → `github-ops` PR.
Dispatch ∥-marked agents in parallel.

## Phase 1 — The spine (M1)

1. `env-config-manager`: `supabase login`/`init`/link (`vputdomdlknvthnzritt`),
   `supabase secrets set ANTHROPIC_API_KEY` (currently set nowhere — blocks M4), create the
   **private media bucket** (doesn't exist yet — 0 buckets live) with owner-scoped policies,
   verify deep-link redirect allowlist, app.json permission plugins/strings (Ruling 10).
2. `database-engineer`: migrations — `profiles` (+ trigger), `subscriptions`, `analyses`
   (with `idempotency_key` UNIQUE + `media_paths text[]`), the reserve/settle quota RPC,
   `storage.objects` RLS policies; then run the security advisors clean.
3. `supabase-auth`: sign-in/up (Google + email now; Apple per gate #8), session routing.
4. `security-auditor` (read pass): RLS, storage policies, quota shape.
5. Gate (M1): new user → account → empty Home.

## Phase 2 — Capture (M2)

1. `feature-planner` → `implementer` (+ `scope-guard`): `lib/frames.ts` — extraction pipeline
   (N sequential thumbnail calls at 5–95% timestamps, manipulator downscale/compress, payload
   budget check) + the upload path (direct-to-bucket, resumable for big files).
   `test-writer`: timestamp spacing, per-tier caps, size budget — this is exactly the pure-lib
   logic the repo's rules say gets tested.
2. `frontend-builder` ∥: capture/pick screens per the Phase 0.5 brief — camera (muted),
   framing-guide overlay, permission-denied states, progress UI.
3. Gate (M2): both sources hand a valid, budget-compliant frame set to the analysis step on iOS.

## Phase 3 — Knowledge grounding (M3)

1. Adapt `echo-knowledge/` → `knowledge/` per gate #1's Elasticity outcome and Ruling 9's
   corrected source map (framework → `pace_framework.md` rewritten around the final pillar set;
   `injury_flags.md` carried; drills/cues extracted from the framework file into `drills.md`).
   **Ian reviews the adapted files before they're committed** — they carry his certification.
2. `prompt-engineer`: the grounded system prompt + verbosity dial + structured-output contract.
3. `llm-eval`: the grounding proof harness — fixture photos/clips; assertions: output
   references PACE pillars (not generic advice), respects tier verbosity, never emits a pillar
   the input can't support, never fabricates scores. Run on every prompt or knowledge change.
4. Gate (M3): the prompt provably includes the PACE framework text; eval passes.

## Phase 4 — `analyze-form` (the heart; M4)

1. `api-designer`: final contract (Rulings 1, 3, 8) — body, error taxonomy, frame caps.
2. `jobs-queues-edge`: the function per "How the analysis engine must work" above.
3. `test-writer` ∥ `mocks-testdata`: reserve/settle RPC under concurrency, idempotent replay,
   period arithmetic (month-end clamps), parser/validator (never fabricates).
4. `security-auditor`: prompt injection via media/sourceMeta, quota bypass, key exposure,
   signed-URL scope. `ai-cost-optimizer` (read pass): per-analysis token cost per tier
   (~1.6k tokens/frame; sanity-check the Elite frame count).
5. Gate (M4): side-on photo AND side-on clip each return a complete, valid, grounded PACE
   result; a broken model response never reaches the user; a retried request doesn't
   double-charge.

## Phase 5 — Tiers, quota, paywall (M5)

1. `frontend-builder` ∥ `ux-copywriter`: Home quota display (Free = lifetime copy), dummy
   paywall + settings (sign-out, delete-account entry), `purchase-tier`/`quota-status` wiring —
   port V2.2's patterns; the contracts are deliberately identical.
2. Gate (M5): quota unbypassable from the client; paywall shows at the right moments.

## Phase 6 — Past Analyses (M6)

1. `frontend-builder`: history list per gate #2 (frame strip or player via signed URLs),
   result re-open, delete with confirmation.
2. `implementer`: `DELETE analysis/:id` + `delete-account` functions (Ruling 6);
   `test-writer`: a test that proves delete purges row AND object(s), and account deletion
   leaves zero orphaned storage objects.
3. Gate (M6): every analysis retrievable after restart; deletion purges both halves.

## Phase 7 — Polish & TestFlight (M7)

1. `motion-animation`: wait-state + result-reveal per the Phase 0.5 motion spec, reduced-motion.
2. `responsive-crossdevice` ∥ `accessibility-reviewer` → `accessibility-implementer`.
3. `ux-copywriter`: every remaining empty/error/offline state; backgrounding-recovery toast
   (Ruling 12).
4. Run the `frontend-audit` skill → `fix-batch`.
5. `mobile-release`: `eas init`, bundle ID + fixed slug (needs the name), icon/splash,
   TestFlight. `privacy-compliance` checklist from Phase 0.5 gets resolved or explicitly
   deferred with Ian's sign-off.
6. Final gate (M7): a stranger goes sign-up → analysis → result with no dead end. Then run
   `full-audit` over the finished codebase and fix HIGHs before inviting testers.

---

## Cherry-pick map (copy from Echo V1, never into it)

| V1 source | Take |
|---|---|
| `app/form-analysis.tsx` | base64 image-block construction, thumbnail extraction call shape, 15s/8MB client-cap precedent. **Not** its client-side prompt, **not** its fabricating parser |
| `supabase/functions/anthropic-coach/index.ts` | the atomic `try_record_form_analysis` RPC pattern, purpose/tier verification shape |
| `supabase/functions/plan-regen-gate/` | reserve → consume-token → compensating-refund pattern (fixes V1's charge-before-call flaw) |
| `supabase/functions/delete-user/index.ts` | full account-deletion incl. storage-orphan cleanup |
| `echo-knowledge/*.md` | the certified content, adapted per gate #1 and Ruling 9 |
| `lib/subscription.ts` | tier read + dummy-purchase shape (V2.3 version is server-authoritative) |
| V2.2 `docs/mvp-build-prompt.md` + design docs | period arithmetic, idempotency design, paywall/settings patterns, design-doc structure |

## What NOT to do

- Don't invent Elasticity (or any) biomechanics content — gate #1 exists because the source
  has none.
- Don't fabricate pillar scores or "No feedback available" filler — show "not assessed."
- Don't put the prompt (or any tier/quota logic) in the client.
- Don't ship count-then-insert quota, or charge quota before the model call succeeds.
- Don't ferry video through JSON bodies, and don't store unbounded media on a 1GB bucket —
  gate #2 and Ruling 4 have the numbers.
- Don't tighten validation into content-checking (the Echo V1 lesson, again).
- Don't skip Phase 0.5 and improvise screens — the missing design layer is a known gap, not
  an invitation.
- Don't start any build phase before the decision gate is answered.
