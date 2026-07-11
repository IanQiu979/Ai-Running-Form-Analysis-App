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
(not the label); default commercial-API terms are no-training + ~30-day trust-&-safety
retention (verify current terms; Zero-Data-Retention available on request) — that 30-day window
is an erasure gap that must be disclosed.

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
- Health & Fitness → Fitness (add → Health if a pain/injury note ships)
- Identifiers → User ID
- Purchases — only once real IAP replaces the dummy (skip for TestFlight)

Google Data Safety form (if Android ships): same mapping + "encrypted in transit" + "users can
request deletion."

## MUST — before (external) TestFlight

- [ ] `NSCameraUsageDescription` + `NSPhotoLibraryUsageDescription` strings and the
      expo-camera/expo-image-picker plugins in `app.json` (Ruling 10 — not yet applied; Beta App
      Review rejects without them). Muted recording correctly avoids the mic permission — keep it.
- [ ] **Privacy policy at a public URL** (names Anthropic + Supabase + HIBP/Cloudflare,
      retention, rights, contact) attached to the App Store Connect record — external
      TestFlight requires it.
- [ ] **In-app account deletion reachable and actually purging** (Guideline 5.1.1(v)) — and it
      must handle the **nested storage layout**: V1's `delete-user` does a flat
      `storage.list(user_id)` which worked for `{user_id}/{file}` but V2.3 stores
      `{user_id}/{analysis_id}/frame.jpg` — a naive port lists the `analysis_id` prefixes,
      **removes nothing, and orphans every frame**. Recurse per-analysis prefix. Same trap in
      `DELETE analysis/:id`. The M6 test must prove zero orphaned objects.
- [ ] **Sign in with Apple** present (Google is offered → Guideline 4.8) — tracked, status.md #3.
- [ ] Consent line renders **before first upload**; "not medical advice" disclaimer on every
      result (content in `knowledge/injury_flags.md`).
- [ ] **Resolve the runner's-note conflict** (see below) before M3/M4 — if it ships it's a new
      Health data type needing its own label + explicit consent before any tester submits one.
- [ ] Re-confirm no analytics/crash SDK slipped in at build time.

## MUST — before public launch

- [ ] Complete App Store nutrition labels (+ Data Safety if Android) per the mapping above.
- [ ] Upgrade the consent notice to **explicit, affirmative, unbundled opt-in** for health-data
      processing + third-party AI transfer (a "by continuing" line is a notice, not Art. 9
      consent — tolerable for closed beta only).
- [ ] **DPA with Anthropic**; verify current no-training/retention terms; disclose the ~30-day
      processor window; pursue Zero-Data-Retention.
- [ ] **Stated retention limit** for every store: DB rows, bucket frames, edge-function logs
      (ensure `analyze-form` never logs frame bytes or note text), Supabase backups/PITR,
      Anthropic. "Until the user deletes" = indefinite = Art. 5(1)(e) gap.
- [ ] **Third-party/minor subjects**: consent line says "your photo/video" and doesn't cover
      filming a friend, coached athlete, or minor. Needs an age rating decision, minimum-age
      term, and an uploader-attests-consent clause (parental for minors; COPPA/under-16 GDPR).
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
- [ ] Name Anthropic in the consent copy itself (all drafts say "our AI provider").
- [ ] Inactivity auto-purge to give retention a real ceiling.

## Doc conflicts found (for doc-writer / the phase gates)

1. **Runner's note — resolve before M3/M4 (decision for Ian).** `knowledge/injury_flags.md`
   (lines ~25, 88–98, 106–108) is written around a user-supplied free-text note (pain, Achilles,
   age 50+, return-from-injury) and weights safety on it — but the `analyze-form` contract has no
   note field, planning/02 has no note input, and the design brief has no note-entry screen.
   Either drop it (injury_flags.md is stale) or ship it (an intended free-text **health-data**
   channel to Anthropic: new label + explicit consent + retention statement + never logged).
2. ~~CLAUDE.md §Secrets says stored media is "photos and video"~~ — fixed 2026-07-11 to
   "extracted frames" (frames-only, Ruling 1).
3. `app.json` lacks the permission plugins/strings Ruling 10 promises (Phase 1
   `env-config-manager` owns this).
