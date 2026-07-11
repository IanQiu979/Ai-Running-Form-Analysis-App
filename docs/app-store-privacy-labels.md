# App Store & Google Play privacy label answers (M7)

> **Analysis, not legal advice.** These are the mechanical answers to enter into App Store
> Connect / Google Play Console, derived from `docs/privacy-checklist-m7.md`'s data inventory.
> Counsel reviews the privacy policy, consent mechanism, and these label answers before any
> public store submission. Re-derive this table if the data inventory changes (e.g. if the
> runner's note — dropped for MVP, see the last section — is ever revived).

This table exists so filling out the privacy questionnaire at submission time is a lookup,
not a re-derivation of the data inventory from scratch. It describes the **designed** data
flows (what the app will do once M2–M6 are built), not what exists in the repo today — see
`docs/status.md` for build status. Do not submit these answers for a build that doesn't yet
collect the data they describe.

---

## Apple App Store Connect — App Privacy questionnaire

For every data type below: **Collected = Yes**, **Linked to the user's identity = Yes**,
**Used for tracking = No**. Purpose is **App Functionality** in every row — none of this
data is used for third-party advertising, analytics, or building a profile across other
apps.

| App Store data type | Maps to | Collected | Linked to identity | Purpose | Used for tracking |
|---|---|---|---|---|---|
| Contact Info → Email Address | Account email | Yes | Yes | App Functionality | No |
| User Content → Photos or Videos | Extracted frames (never the original video) | Yes | Yes | App Functionality | No |
| User Content → Other User Content | `result` JSONB — scores, injury-risk flags, posture descriptions | Yes | Yes | App Functionality | No |
| Health & Fitness → Fitness | Running-form scores and feedback | Yes | Yes | App Functionality | No |
| Health & Fitness → Health | Injury-risk flags in the `result` JSONB — the privacy policy treats these as GDPR Art. 9 health data, so Apple's label has to say the same thing | Yes | Yes | App Functionality | No |
| Identifiers → User ID | `auth.uid` / account identifier | Yes | Yes | App Functionality | No |
| Usage Data → Product Interaction | Subscription tier, analysis count, media type, timestamps | Yes | Yes | App Functionality | No |

**Purchases:** skip this section for the TestFlight submission — the paywall is a dummy
tier with no real In-App Purchase wired up yet. Revisit once real IAP replaces it.

**Tracking:** answer "No, we do not track users" — there is no analytics, advertising, or
crash-reporting SDK in the app (verified in `package.json`: no Sentry, Segment, Firebase,
RevenueCat, Amplitude, Mixpanel, PostHog, Bugsnag, AppsFlyer, or Facebook SDK), so no IDFA
is collected and no App Tracking Transparency prompt is needed.

### Not yet applicable

- **Precise/Coarse Location, Contacts, Browsing History, Search History, Financial Info,
  Diagnostics, Sensitive Info, Other Data** — none of these are collected by the app;
  leave unchecked.

**The Health & Fitness → Health row above would need to describe a second source** if the
runner's free-text note (pain, Achilles, age 50+, return-from-injury) ships as an input
channel to the AI — see "Dependency: the runner's-note conflict" below. That question is
independent of the row added above: the injury-risk flags already in the `result` JSONB
are health data whether or not the note ever ships, so the Health row above is not
deferred on that decision.

---

## Google Play Console — Data Safety form

Same underlying data types as the Apple mapping above, expressed in Play's form:

| Play Data Safety category | Maps to | Collected | Shared | Purpose | Ephemeral |
|---|---|---|---|---|---|
| Personal info → Email address | Account email | Yes | No (only with Anthropic/Supabase as processors, not "shared" in Play's third-party sense) | App functionality, account management | No |
| Photos or videos → Photos | Extracted frames | Yes | No | App functionality | No |
| Health and fitness → Fitness info | PACE scores, injury-risk flags, posture descriptions | Yes | No | App functionality | No |
| App activity → Other user-generated content | `result` JSONB descriptions | Yes | No | App functionality | No |
| App info and performance | Not collected (no crash/analytics SDK) | No | — | — | — |

Additional declarations required by the Play form:

- **"Is data encrypted in transit?"** — Yes.
- **"Do you provide a way for users to request that data be deleted?"** — Yes; in-app
  account deletion (Settings → Delete account) removes every analysis and stored frame,
  and per-analysis deletion is also available (Past Analyses → swipe/long-press delete).
- **"Is data collection required or optional?"** — account email and the frames needed to
  run an analysis are required (the app cannot function without them); nothing else is
  collected.

Only fill in the Play Data Safety form when/if the app ships on Android — it isn't a
gating requirement for the iOS-only TestFlight submission.

**Do not submit the Play form until the Anthropic DPA is signed.** The "Shared: No"
answer above depends on Anthropic and Supabase both being contracted processors rather
than third parties Play would count as "shared" — that's true of Supabase today, but the
Anthropic DPA is **not yet signed** (see `docs/privacy-checklist-m7.md`). Submitting "No"
before it's signed misrepresents Anthropic's status.

---

## Action items

- **TestFlight tester group must be restricted to non-EU/UK testers** (Ian's decision,
  2026-07-12). This keeps the beta out of GDPR scope; it must be re-checked before any
  EU/UK tester is ever added to the group.

---

## The runner's note — decided, and it does NOT affect these answers

**RESOLVED 2026-07-11: dropped for MVP** (`docs/status.md` #10). The analysis runs on frames
alone. No free-text note field ships, and no note enters the `analyze-form` contract, so there
is **no user-supplied free-text health channel** in the system these labels describe.

The **Health & Fitness → Health** row above stands regardless: the injury-risk flags in the
`result` JSONB are health data because Anthropic *infers* them from the frames, not because a
user typed them. That row is not contingent on the note.

The note-handling guidance in `knowledge/injury_flags.md` is **dormant**, not deleted — M3's
prompt adaptation must exclude/neutralize the note-dependent instructions (needs Ian's
certification review, since it's certified content).

**If it is ever revived post-TestFlight**, it adds a second, distinct source to the Health row
(free-text health data collected *directly from the user*, rather than inferred from images),
and needs its own consent step, its own retention statement, and a guarantee the edge function
never logs it in plaintext. Until then, do not describe the note in either store form — that
would declare collection that isn't happening.
