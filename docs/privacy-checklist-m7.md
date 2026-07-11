# Privacy & compliance checklist (M7 gate)

> Produced 2026-07-11 by the Phase 0.5 `privacy-compliance` read-only audit
> (`docs/mvp-build-prompt.md` Phase 0.5 step 4). Design-time pass — no privacy code exists yet.
> **Analysis, not legal advice**: counsel reviews the privacy policy, consent mechanism, and
> label answers before any public store submission. Re-audit the moment an analytics or crash
> SDK lands (none exist today — verified no Sentry/Segment/Firebase/RevenueCat/IDFA, so no
> "Tracking" label and no ATT prompt required *today*).

## Data inventory (what leaves the app, per the decided design)

| Data | Where it goes | Classification |
|---|---|---|
| Email + auth identifiers (Google/Apple sub, `auth.uid`) | Supabase Auth | Identifier — linked to identity |
| Analyzed **frames** (images of a body/face) | Supabase private bucket **and** Anthropic API | Sensitive personal data |
| `result` JSONB (scores, injury-risk flags, posture descriptions) | Supabase `analyses` | **Health data (GDPR Art. 9) at rest** — not just the images |
| tier / frame_count / media_type / timestamps | Supabase | Usage/account |
| Subscription tier (dummy, no real payments in v1) | Supabase | Financial-adjacent |
| Caller **IP address + timestamp**, plus a 20-bit (5 hex char) prefix of the candidate password's SHA-1 | HIBP / `api.pwnedpasswords.com` (Cloudflare-fronted) | IP = identifier; the hash prefix is not meaningfully personal on its own |

Running-form footage is **not** Art. 9 *biometric* data (no unique-identification processing) —
don't over-claim — but the injury-risk inferences squarely are Art. 9 health data and need
**explicit consent** (Art. 9(2)(a)). Anthropic = sub-processor: named in the privacy policy
(not the label); default commercial-API terms are no-training + **~30-day ordinary retention**,
with a **trust-and-safety exception that extends beyond it** — flagged inputs/outputs may be
retained for **up to two years**, and that carve-out applies **even under Zero Data
Retention** (verified against Anthropic's live docs, `platform.claude.com/docs/en/manage-claude/api-and-data-retention`,
2026-07-12; corrects the inverted framing that shipped in the first policy draft, see
`docs/privacy-policy.md`'s "Who we share it with" section). That ~30-day ordinary window,
and the up-to-2-year flagged-content exception, are both erasure gaps that must be disclosed.

**HIBP is a new third party as of 2026-07-12** (issue #70's client-side leaked-password check,
`lib/hibp.ts`), added outside this audit's stated re-audit trigger above since it's not an
analytics or crash SDK — recorded here so it isn't missed. It's called at **sign-up only**,
never sign-in. What actually leaves the device: the caller's IP address and a request
timestamp (the real personal data here) plus a 5-hex-character prefix of the candidate
password's SHA-1 hash. The prefix is not meaningfully personal on its own — k-anonymity means
roughly 2^140 candidate passwords share any given prefix and it cannot be reversed to the
password — but the IP address is, so HIBP is a real sub-processor-adjacent disclosure, not a
no-op. No email, no user id, no full hash, and no plaintext password are ever sent. Must be
named alongside Anthropic and Supabase in the privacy policy before public launch (see the MUST
list below). **Standing requirement, easy to forget because nothing enforces it today**: if a
crash or analytics SDK (e.g. Sentry) is ever added to this app, it MUST be configured with
`denyUrls`/`beforeBreadcrumb` to drop `api.pwnedpasswords.com` requests — otherwise every
outbound request URL (which carries the 5-char prefix) becomes a durable, identity-linked
fingerprint of the user's password sitting in crash-report breadcrumbs tied to their account.

## App Store privacy labels (collected, linked to identity, app functionality, no tracking)

- Contact Info → Email address
- User Content → Photos or Videos (the frames)
- User Content → Other User Content (result JSONB descriptions; the note **if** it ships — see conflict #1)
- Health & Fitness → Fitness
- Health & Fitness → Health (injury-risk flags in the `result` JSONB — the policy treats
  these as Art. 9 health data, so this row is required **regardless** of whether the
  pain/injury note ships; see conflict #1 for a second, note-specific Health source if it
  ever does)
- Identifiers → User ID
- Usage Data → Product Interaction (tier, analysis count, media type, timestamps — the
  policy discloses these, so they can't also be declared "not collected")
- Purchases — only once real IAP replaces the dummy (skip for TestFlight)

Google Data Safety form (if Android ships): same mapping + "encrypted in transit" + "users can
request deletion." Don't submit the Play form until the Anthropic DPA is signed — the
"Shared: No" answer depends on it (see `docs/app-store-privacy-labels.md`).

## International transfers and beta geo-scoping (previously missing from this checklist)

Anthropic processes frames and generates results in the **United States**; Supabase stores
account data and frames in **Sydney, Australia**. Both are international transfers under
GDPR. Disclosure is now drafted in `docs/privacy-policy.md`'s "International transfers"
section.

- **EU/UK testers are excluded from the TestFlight beta** (Ian's decision, 2026-07-12).
  This is why no Art. 27 EU/UK representative is needed right now — the beta has no EU/UK
  data subjects to represent. **Admitting a single EU/UK tester reverses this**: it puts
  the international-transfer rules back in scope and reopens the Art. 27 representative
  question.
- If EU/UK testers or users are ever admitted, name and put in place a transfer safeguard
  first — Standard Contractual Clauses (SCCs) under each processor's DPA (Anthropic,
  Supabase) — before any EU/UK data reaches either processor.

## Open question for counsel — Australian Privacy Act applicability

The Privacy Act 1988's **small-business exemption** (generally < AU$3m annual turnover)
does **not** apply to a business that holds health information (s6D(4)(b)). An app that
produces injury-risk assessments plausibly qualifies as holding health information, which
would make Ian a full APP entity **regardless of turnover** — triggering APP 8 (overseas
disclosure, i.e. the Anthropic/Supabase transfers above) and a formal complaints process.
This is the most likely way a solo AU-based developer ends up unexpectedly in scope for a
real privacy regime, not just GDPR-by-analogy. Flag for counsel before public launch.

## MUST — before (external) TestFlight

- [x] `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` strings and the
      expo-camera/expo-image-picker plugins in `app.json` (Ruling 10). **Done** (2026-07-12,
      commit `943d04b`): verified `app.json` — both plugins are present with purpose strings,
      and `microphonePermission: false` correctly matches the muted-recording ruling.
- [ ] **Privacy policy at a public URL** (names Anthropic + Supabase + HIBP/Cloudflare,
      retention, rights, contact) attached to the App Store Connect record — external
      TestFlight requires it.
      **Drafted, but publication is ON HOLD** (2026-07-12): `docs/privacy-policy.md` is
      written, but the data controller's legal name/country and the contact email are still
      placeholders — Ian has not resolved them, and publishing with placeholders fails App
      Review and makes every rights promise unexercisable (see issue #68). Publication is
      also gated on **in-app account deletion actually shipping and purging** (Guideline
      5.1.1(v)) — the policy's rights section currently relies on an email fallback because
      the Past Analyses / Settings screens it describes don't exist yet. Hosting plan (when
      unblocked): a new public GitHub repo serving the policy via Pages — not created yet.
- [ ] **In-app account deletion reachable and actually purging** (Guideline 5.1.1(v)) — and it
      must handle the **nested storage layout**: V1's `delete-user` does a flat
      `storage.list(user_id)` which worked for `{user_id}/{file}` but V2.3 stores
      `{user_id}/{analysis_id}/frame.jpg` — a naive port lists the `analysis_id` prefixes,
      **removes nothing, and orphans every frame**. Recurse per-analysis prefix. Same trap in
      `DELETE analysis/:id`. The M6 test must prove zero orphaned objects.
- [ ] **Sign in with Apple** present (Google is offered → Guideline 4.8) — tracked, status.md #3.
- [ ] Art. 9-grade consent modal (checkbox + names the health processing) renders **before
      first upload** — **BLOCKED ON M2** (capture/upload flow doesn't exist yet). Design is
      now **decided** (Ian, 2026-07-12): a checkbox the user must actively tick, gating the
      primary CTA, not a plain Continue/Cancel notice. Copy drafted at `consent.upload.title`
      / `consent.upload.body` / `consent.upload.checkbox` / `consent.upload.cta.primary` /
      `consent.upload.link.privacy` in `docs/design/copy-deck.md` — M2 must build the
      checkbox variant, not the plain notice variant.
- [ ] "Not medical advice" disclaimer on every result — **BLOCKED ON M4** (result screen
      doesn't exist yet); copy already drafted at `result.disclaimer.footer` in
      `docs/design/copy-deck.md` (sourced from `knowledge/injury_flags.md`).
- [ ] **Resolve the runner's-note conflict** (see below) before M3/M4 — if it ships it's a new
      Health data type needing its own label + explicit consent before any tester submits one.
- [x] Re-confirm no analytics/crash SDK slipped in at build time. Verified 2026-07-12: no
      Sentry, Segment, Firebase, RevenueCat, Amplitude, Mixpanel, PostHog, Bugsnag,
      AppsFlyer, or Facebook SDK in `package.json` — no tracking, no IDFA, no ATT prompt
      needed.

## MUST — before public launch

- [ ] Complete App Store nutrition labels (+ Data Safety if Android) per the mapping above.
- [ ] Build the decided Art. 9-grade consent modal (checkbox, names the health processing and
      Anthropic) for health-data processing + third-party AI transfer — a "by continuing"
      line is a notice, not Art. 9 consent. Design decided 2026-07-12 (see the TestFlight
      consent item above); implementation is **BLOCKED ON M2**.
- [ ] **DPA with Anthropic**; verify current no-training/retention terms; disclose the ~30-day
      processor window; pursue Zero-Data-Retention.
- [ ] **Stated retention limit** for every store: DB rows, bucket frames, edge-function logs
      (ensure `analyze-form` never logs frame bytes or note text), Supabase backups/PITR,
      Anthropic. "Until the user deletes" = indefinite = Art. 5(1)(e) gap.
- [ ] **Third-party/minor subjects**: consent line says "your photo/video" and doesn't cover
      filming a friend, coached athlete, or minor. The privacy policy's minimum-age term
      (16+) is now drafted (`docs/privacy-policy.md`, "Age and other people in your media")
      — still needs an App Store age rating decision and an uploader-attests-consent clause
      (parental for minors; COPPA/under-16 GDPR).
- [ ] Make storage cleanup **blocking** (or reconcile orphans) — V1's best-effort pattern can
      delete the auth user while a failed remove leaves frames un-ownable and un-deletable.
- [ ] Confirm `result` JSONB (health data at rest) is cascade-deleted in both delete paths, with
      a test.
- [ ] Lawful-basis statement per purpose: account → contract (Art. 6(1)(b)); injury inferences →
      explicit consent (Art. 9(2)(a)); Anthropic → Art. 28 processor.

## SHOULD

- [ ] Data export path (Art. 20 portability) — manual/support process acceptable initially.
- [ ] Disclose deletion persistence in backups (+ the paused Echo project's 90-day restore
      window from 2026-07-10).
- [x] ~~Name Anthropic in the consent copy itself (all drafts say "our AI provider")~~ —
      **RESOLVED** 2026-07-12: `consent.upload.body` in `docs/design/copy-deck.md` now names
      Anthropic explicitly, as part of the Art. 9-grade consent redesign (see the consent
      item above).
- [ ] Inactivity auto-purge to give retention a real ceiling.

## Doc conflicts found (for doc-writer / the phase gates)

1. ~~**Runner's note — resolve before M3/M4 (decision for Ian).**~~ — **RESOLVED 2026-07-11:
   dropped for MVP** (`docs/status.md` #10; this checklist was stale). The analysis runs on
   frames alone: no free-text note field ships, and no note enters the `analyze-form` contract.
   The note-handling guidance in `knowledge/injury_flags.md` is **dormant** — M3's prompt
   adaptation must exclude/neutralize the note-dependent instructions (needs Ian's certification
   review, since it's certified content). Revisit post-TestFlight; if it ever ships it becomes a
   free-text **health-data** channel to Anthropic needing its own consent step, retention
   statement, and a guarantee it's never logged in plaintext.
   **This does not change the label answers** — the injury-risk flags in the `result` JSONB are
   health data regardless, so `Health & Fitness → Health` is declared either way.
2. ~~CLAUDE.md §Secrets says stored media is "photos and video"~~ — fixed 2026-07-11 to
   "extracted frames" (frames-only, Ruling 1).
3. ~~`app.json` lacks the permission plugins/strings Ruling 10 promises~~ — **RESOLVED**
   2026-07-12: verified `app.json` has both the `expo-camera` (`cameraPermission`) and
   `expo-image-picker` (`photosPermission`) plugins with purpose strings, and
   `microphonePermission: false` correctly matches the muted-recording ruling.
   Landed in commit `943d04b`.
4. ~~Anthropic retention framing was inverted~~ — **RESOLVED** 2026-07-12: this checklist,
   `docs/privacy-policy.md`, and `docs/app-store-privacy-labels.md` previously called the
   ~30-day window "the trust-and-safety window" and claimed Zero Data Retention would
   "close it entirely." Corrected: 30 days is *ordinary* retention; the trust-and-safety
   exception *extends beyond it* to up to two years for flagged content, and that exception
   survives even under ZDR.
