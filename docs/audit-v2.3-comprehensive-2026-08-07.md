# V2.3 comprehensive audit and fix pass — 2026-08-07

Scope: Expo/React Native screens and reachable flows, shared client modules, Supabase edge
functions, migrations/RLS/grants, deployment configuration, and the photo/video analysis path.

## Required temporary access override

Implemented `ALL_USERS_UNLIMITED_ACCESS`, a **server-only, strict opt-in** flag.

- `true`: every authenticated account receives Elite analysis depth, Elite's 8-frame video cap,
  and unlimited analysis-count quota. The Free sample short-circuit, count quota, and anti-farm
  refusal are bypassed only through additive service-role wrapper RPCs.
- unset/`false`: the app uses the original `pace_current_tier`, `reserve_analysis`, and
  `pace_quota_status` functions unchanged.
- Purchase/subscription purchase flows are untouched.
- Request validation, per-user advisory locking, idempotency, immutable analysis history,
  soft-delete quota-exploit hardening, the 5MB request ceiling, consent enforcement, auth, AI
  spend kill switch/daily cap/circuit breaker, and the Elite 8-frame ceiling remain enforced.

**Before real users:** unset `ALL_USERS_UNLIMITED_ACCESS` (or set it to `false`) in Supabase Edge
Function secrets and redeploy `analyze-form` + `quota-status` if required by the deployment
workflow. No migration rollback or data rewrite is needed.

## Findings fixed

1. **Required: Free accounts could only receive a canned sample and one video frame.** Added the
   reversible server-side override across tier lookup, reserve enforcement, quota status, Home,
   extraction, Paywall, and Settings display paths.
2. **Settings could disagree with Home/Paywall and temporary server entitlements.** It read
   `subscriptions` directly, so an override intentionally not persisted as a purchase still showed
   Free. Settings now uses the same server-authoritative quota-status endpoint.
3. **Quota wire contracts could not represent truly unlimited access.** Added explicit
   `unlimited: true` with `limit`/`remaining: null`; clients render a stable “Elite access ·
   Unlimited analyses” status instead of inventing an arbitrary fake numeric ceiling.
4. **Compare was implemented but unreachable through normal navigation.** History now exposes a
   “Compare two analyses” action whenever at least two stored analyses exist; Compare still
   performs its own server-authoritative Elite check (satisfied by the temporary override).
5. **Elite users were offered an “Upgrade to Pro” downgrade.** Paywall now hides the lower-tier
   purchase CTA when Elite is the current effective plan; purchase mechanics themselves are
   untouched.
6. **The default parallel Jest run was resource-flaky on the full 1,200+ test suite.** Multiple
   unrelated RNTL suites timed out at Jest's 5-second per-test limit only when run concurrently;
   each passed in isolation. The commit gate now runs Jest in-band for deterministic full-suite
   results instead of turning host contention into false failures.
7. **Regression coverage:** added edge flag parsing, full-flow override routing, quota parsing/UI
   mapping, and migration security/invariant tests.

## Audited and no new code defect found

- Auth resolution and user-id derivation on every edge function.
- Consent ordering and fail-closed behavior.
- Analyze-form request validation, global payload/frame bounds, AI spend gating, reserve → model →
  settle → upload → attach ordering, retries/fallbacks, and release/record `finally` obligations.
- Analysis/history/result/compare/delete-account/delete-analysis/storage purge flows.
- RLS/grant migration intent, media namespace guard, storage object guard/budget, stale reservation
  and orphan-media sweeps.
- Expo route protection/navigation, loading/empty/error states, capture/library/record/extraction,
  analyzing recovery, result display, paywall, settings, password reset, and consent UI.

## Not fixed / external limitations

- **Live Supabase drift/advisor/deployment verification was not available in this worktree:** the
  installed `supabase` shim cannot find its co-located `supabase-go` binary. No live mutation was
  attempted. The new migration and edge functions still need the normal deployment pipeline.
- **Device-level camera/video/OAuth/EAS validation** needs a simulator/device and deployed backend;
  static/unit/edge tests cannot prove native permissions, real decoding, or provider dashboards.
- `npm audit` reports transitive advisories in the Expo SDK 54 toolchain whose offered automated
  fixes require unsupported major downgrades/upgrades (for example Expo 57 or React Native 0.72).
  They were not force-applied because this app is pinned to SDK 54 and such a migration is outside
  a safe audit fix.
