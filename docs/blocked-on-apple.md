# Blocked on the Apple Developer Program

Everything in this repo that cannot be built, tested, or shipped until an **Apple Developer
Program** membership exists (US$99/year, [developer.apple.com/programs](https://developer.apple.com/programs/)).

These items **used to be GitHub issues**. They were deleted from the tracker on **2026-07-12** so
that the open-issue list contains only work that is actually actionable today. Nothing was lost —
each deleted issue is reproduced **verbatim** below. Re-file them from this file when the account
exists.

**The rule this file enforces:** no open GitHub issue depends on the Apple Developer Program. If
you are about to file one that does, put it here instead.

---

## What the account actually unlocks

| Unlocked by the account | Already possible without it |
|---|---|
| iOS builds for a **physical device** (ad-hoc provisioning) | iOS builds for the **simulator** (`development` profile, `ios.simulator: true`) |
| `eas submit`, TestFlight, App Store distribution | `eas build` for Android, `eas init`, EAS env vars — all done |
| Sign in with Apple (needs a Services ID + key) | Email + Google sign-in — both shipped in M1 |
| An App Store Connect record (where the privacy policy and privacy labels get attached) | Writing the policy and deciding the label answers — both done, see `docs/privacy-policy.md` and `docs/app-store-privacy-labels.md` |
| Choosing **Individual vs Organization**, which fixes the data-controller legal identity | Everything else in the privacy pack |

**It does not block M2–M6.** Capture, upload, `analyze-form`, tiers, and history can all be built
and tested against the simulator and Android. The Apple account is an **M7 / ship-it** dependency,
not a build dependency. The one thing to respect: **Sign in with Apple must be added before the
first TestFlight submission**, never after (see #67 below).

---

## Order of operations, once the account exists

1. **Pick the account type first — Individual or Organization.** This is upstream of almost
   everything else here, and it is a migration, not a toggle. It sets the data-controller legal
   identity that `docs/privacy-policy.md` is blocked on. Individual publishes Ian's own legal name
   on the App Store listing; Organization requires a registered business entity + a D-U-N-S number.
2. **Add Sign in with Apple** (deleted issue #67). Guideline 4.8 makes it mandatory *because*
   Google sign-in ships. Do it before submission, not after a rejection.
3. **Provision iOS credentials**, then run the `development-device` and `preview` profiles that
   already exist in `eas.json` but have never been usable.
4. **Remove `exp://**` from the Supabase redirect allowlist** — this is still an open GitHub issue
   (#69) and is **not** Apple-blocked; a simulator dev build is enough to retire Expo Go. Do it
   whenever the first dev build lands, whichever kind it is.
5. **Resolve the privacy-policy placeholders** (controller name/country + contact email), publish
   it at a public URL, and attach it to the App Store Connect record.
6. **Enter the App Store privacy labels** from `docs/app-store-privacy-labels.md` — the answers are
   already derived, so this is a lookup, not a re-derivation.
7. ~~**🚨 UNSET `PURCHASE_TIER_DUMMY_ENABLED` BEFORE THE FIRST SUBMISSION**~~ **RESOLVED
   2026-08-06** — both `PURCHASE_TIER_DUMMY_ENABLED` and `PURCHASE_TIER_ALLOWED_USER_IDS` are
   unset on the live project (captain decision `purchase-tier-dummy-flag-now`: the captain is the
   only tester right now, so the allowlist approach was declined rather than adopted — see
   `docs/status.md` Known Issue #21 for the live verification). If a closed tester group ever
   needs dummy purchases again before submission, re-set `PURCHASE_TIER_DUMMY_ENABLED=true`
   deliberately (optionally narrowed with `PURCHASE_TIER_ALLOWED_USER_IDS`) and re-add this item.
8. **`eas submit` → TestFlight.** Beta excludes EU/UK testers (recorded decision — keeps GDPR out
   of scope for the beta and avoids needing an Art. 27 representative).

---

# Deleted issues (verbatim)

## #66 — M7: EAS init, icon, splash, and TestFlight pipeline

> `enhancement`, `M7-polish` · [original](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/66) (deleted)

**Status: the config half is DONE and merged. Only the pipeline half is Apple-blocked.**

What landed (PR #75, merged to `main` 2026-07-12):

- `eas init` — EAS project `@ianbeatingpros/pace-analysis-ai`, with `owner` set explicitly in
  `app.json` so `eas build` resolves the same project on any machine or in CI.
- `eas.json` with four build profiles (`development`, `development-device`, `preview`,
  `production`) plus `submit.production`.
- EAS env vars (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) set in all
  three EAS environments at `sensitive` visibility. `ANTHROPIC_API_KEY` verified **absent**.
- Real icon + splash art ("The Gait Plate"), versioned as SVG source in `assets/source/` and
  rasterized by `npm run assets`. This closed issue #26 outright.

What is still blocked, and is the reason this issue existed:

- No Apple Developer account → no iOS credentials → **no `eas build` for a device or the store, no
  `eas submit`, and no TestFlight pipeline.** `development-device` is written but unusable.
- **Known limitation carried forward (LOW):** all three EAS environments currently point at the
  *same* Supabase project, so development and preview builds talk to the production database.
  Bounded blast radius (same key, same RLS) but test rows land in production tables. Worth
  splitting when a staging project exists.

<details>
<summary>Original issue body, verbatim</summary>

```markdown
## Scope (`docs/status.md` Known Issue #7 — `eas init` has not been run; there is no TestFlight pipeline)
- `eas init`
- Bundle ID `com.ian.paceanalysisai` (already set in `app.json`) and the fixed slug `pace-analysis-ai` (already fixed)
- Real icon + splash art (currently Expo template defaults — see the splash/icon color bug)
- EAS secrets
- Build → TestFlight

## Depends on
An **Apple Developer account** (see the Apple Sign-In issue — same dependency).

## Final gate (M7)
A stranger can go sign-up → analysis → result with **no dead end**. Then run `/full-audit` over the finished codebase and fix the HIGHs **before** inviting testers.

Agent: `mobile-release`.
```

</details>

---

## #67 — M7: add Sign in with Apple

> `M7-polish`, `blocked-on-ian` · [original](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/67) (deleted)

**Status: not started. Zero code was written** — the `worktree-issue67` branch was created but
never received a commit, and has been deleted.

**This is a submission gate, and it is the one item here with a trap in it.** App Store Guideline
4.8 requires an app offering a third-party social sign-in to *also* offer Sign in with Apple.
Google sign-in **ships today**, so the moment the app is submitted, this is mandatory. Add it
**before** the first TestFlight submission — the plan only works because Apple is added ahead of
review, so the gate is never actually hit.

Concretely, when unblocked: install `expo-apple-authentication`, enable the `apple` provider on the
Supabase project (it is currently **off**), create the Services ID + key in the Apple developer
portal, and wire it into `app/(auth)/sign-in.tsx` alongside the existing Google button.

<details>
<summary>Original issue body, verbatim</summary>

```markdown
## Owner: Ian (needs an Apple Developer account)

## Status (`docs/status.md` Known Issue #3)
- `expo-apple-authentication` is **not installed**.
- `apple` is **off** on the live Supabase project's auth settings.
- Decision recorded 2026-07-11: **build email + Google in M1 now; add Apple the moment the account exists, before TestFlight review.**

## Why it is not optional
**App Store Guideline 4.8**: an app that offers a third-party social sign-in (Google, which ships) **must** also offer Sign in with Apple. This is a submission gate.

## The plan works because
Apple is added **ahead of** submission, so the gate is never actually hit — as long as the Apple Developer account exists before M7.

Blocks: TestFlight submission (not the build).
```

</details>

---

# Apple-gated slices lifted out of issues that stay open

Two issues were **mixed** — part Apple-blocked, part buildable now. They were rewritten on GitHub to
keep only their actionable half. The Apple-blocked half was moved here.

## From #68 — privacy policy, App Store record, and the controller identity

Issue [#68](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/68) **stays open** for its
in-app items (the consent checkbox before the first upload, blocked on M2; the "not medical advice"
disclaimer on every result, blocked on M4). These pieces of it are Apple-blocked and were removed
from it:

- **Attach the privacy policy to the App Store Connect record.** External TestFlight will not run
  without a policy at a public URL. The policy is **already written** (`docs/privacy-policy.md`) but
  carries a `DO NOT PUBLISH` guard.
- **Enter the App Store privacy labels.** The answers are already derived and recorded in
  `docs/app-store-privacy-labels.md`, so this is data entry once the record exists.
- **Resolve the data-controller legal identity** — the blocker on publishing the policy at all. It
  is *really* a question about the Apple account type: an **Individual** account publishes Ian's own
  legal name; an **Organization** account uses a registered business entity. The policy's controller
  name, country, and contact email are placeholders until this is decided, and publishing with
  placeholders both fails App Review and makes every rights promise in it unexercisable.
- Policy publication is **additionally** gated on in-app account deletion actually shipping and
  purging (Guideline 5.1.1(v)) — that is M6 work, tracked in issues #57 and #58, and is *not* Apple-blocked.

**Note for counsel (carried over, not Apple-related but easy to lose):** the Australian Privacy
Act's small-business exemption does **not** apply to a business holding health information
(s6D(4)(b)). An app producing injury-risk assessments plausibly qualifies, which would make this a
full APP entity regardless of turnover. Counsel reviews the policy, the consent mechanism, and the
label answers before any public submission. **Analysis, not legal advice.**

## From #69 — nothing, and that is deliberate

Issue [#69](https://github.com/IanQiu979/v2.3_RunningFormAna/issues/69) (remove `exp://**` from the
Supabase redirect allowlist) **stays open and is NOT Apple-blocked.** Its original title said
"before the first EAS build", which read as an Apple dependency — it isn't. `eas.json`'s
`development` profile builds for the **iOS simulator** with no Apple account at all, and that is
enough to retire Expo Go and make the `exp://**` entry unnecessary. The issue was retitled to say so.

It is recorded here only so nobody re-files it as Apple-blocked by mistake.

---

# Resolved / closed

Work that landed on `main` on 2026-07-12, in the same pass that produced this file.

| Issue | What happened |
|---|---|
| **#26** — Splash and Android adaptive-icon colors are Expo template defaults | **CLOSED — fully fixed.** PR #75. Splash is now `#F4F1EA` light / `#1A1712` dark and the Android adaptive-icon background is `#F4F1EA`, exactly the theme tokens the issue asked for. Real "Gait Plate" icon and splash art replaced the Expo defaults, rasterized reproducibly from versioned SVG source. |
| **#66** — EAS init, icon, splash, TestFlight | **DELETED → this file.** Config half done (PR #75); pipeline half Apple-blocked. |
| **#67** — Sign in with Apple | **DELETED → this file.** Never started; wholly Apple-blocked. |
| **#68** — consent, privacy policy, App Store labels | **PARTIALLY RESOLVED, stays open.** PR #72 landed the unblocked slice: the policy is drafted, the label answers are recorded, no analytics/crash SDK is confirmed, and the consent design was upgraded to an Art. 9-grade explicit checkbox. The in-app halves remain, blocked on M2/M4 — not on Apple. |
| **#69** — remove `exp://**` from the redirect allowlist | **STAYS OPEN, retitled.** Not Apple-blocked; a simulator dev build unblocks it. |
| **#70** — server-side HIBP leaked-password protection | **CLOSED 2026-07-12 — genuinely fixed, not just mitigated.** The org (`Echo_Running_Final`) is now on the **Supabase Pro plan**, which removed the blocker; `password_hibp_enabled = true` was applied live and verified (a breached password hard-fails `signUp` with HTTP 422, `reasons: ['pwned']`) and the project's security advisor list is now **completely empty**. This was blocked on **Supabase Pro, not Apple** — it never belonged on this file's actionable list, only on the "still blocked on Ian" one below, and is removed from there too. The client-side check (`lib/hibp.ts`, PR #73) is **kept deliberately** as a UX pre-check and defense-in-depth, not the enforcement point anymore; see `docs/architecture.md`'s "Current — Supabase config" section. |
| **#9** — 8-char password minimum is invisible and maps to the wrong error | **PARTIALLY RESOLVED, stays open.** PR #73 fixed the error half — there is now a real `auth.error.passwordTooShort` message and a client-side pre-check that runs *before* the breach check. **Still open:** the rule is never shown proactively (no helper text under the password field in sign-up mode), and the literal `8` is now duplicated across `sign-in.tsx`, `constants/copy.ts`, and `supabase/config.toml` with nothing keeping them in sync — the issue asked for one shared constant. |

## Still blocked on Ian, but NOT on Apple

Listed so this file is not mistaken for the complete blocked list:

- **GitHub issue #39** — needs **Ian's certification** of the drafted Elasticity content and the pillar refinements. It ships into every analysis prompt under his name.
- **#74** — **partially resolved 2026-07-12.** The endpoint-side half is now covered by a daily
  live-API canary (`.github/workflows/hibp-canary.yml`) that needs no observability stack and
  collects no user data. Only the device-side residue (captive portals, Cloudflare challenging
  React Native's user-agent) still needs an **observability stack**. Note that **Sentry is
  actively contraindicated** for it — its breadcrumbs would fingerprint the very passwords the
  check protects; see the issue.
