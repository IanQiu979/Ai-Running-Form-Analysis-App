# Consent record, consent gate, and result disclaimer (issue #68)

**Status:** approved 2026-07-12. Supersedes the framing in issue #68, which treats consent as a
UI-only concern.

## Problem

Issue #68 lists three remaining items and marks all three blocked:

1. Art. 9-grade consent checkbox before the first upload — blocked on M2 (no capture screen).
2. "Not medical advice" disclaimer on every result — blocked on M4 (no result screen).
3. Repeat the privacy disclosure in Settings — blocked on M5 (#53).

The blocks are real. `app/` contains only `(auth)/sign-in.tsx` and `(tabs)/index.tsx`; there is
no source picker, no result screen, no Settings.

**But the issue mislocates the work.** It frames consent as a checkbox, and a checkbox is not
consent — it is the *collection* of consent. GDPR Art. 7(1) requires the controller to be able to
**demonstrate** that the data subject consented, and Art. 9 is the standard #68 is explicitly
reaching for. A checkbox that ticks, enables a button, and then evaporates demonstrates nothing:
no record, no timestamp, no indication of which wording was agreed to.

There is no consent record anywhere in this project. Seven migrations exist and none of them
mentions consent; `public.profiles` is `id`, `display_name`, `created_at`. **That record is the
load-bearing half of #68, and it is not blocked on any screen.**

Two smaller corrections fall out of the same review:

- **#68 points at the wrong source for the disclaimer.** It says the content "is already in
  `knowledge/injury_flags.md`". That file is *prompt* content fed to the model. The shipped UI
  string is `result.disclaimer.footer` in `docs/design/copy-deck.md:217`, whose wording differs
  and which the deck itself calls "its final, shipped form." Building from `injury_flags.md`
  would ship the wrong text.
- The consent copy (`consent.upload.*`, `copy-deck.md:324-329`) is already written and is already
  Art. 9-grade — checkbox naming the health processing and Anthropic, primary CTA disabled until
  ticked. It needs no rewrite, only a renderer.

## Decision

Build the part of #68 that no screen blocks: the durable consent record, the code that reads and
writes it, and the two presentational components that M2 and M4 will drop in. Leave presentation
and routing to the milestones that own them.

## Design

### `supabase/migrations/20260712120000_consents.sql` (new)

```sql
create table public.consents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  consent_key text not null,      -- e.g. 'upload.health.v1'
  granted     boolean not null,   -- false = withdrawal
  created_at  timestamptz not null default now()
);
```

**Append-only by construction, not by convention.** RLS is enabled with owner-scoped `SELECT` and
`INSERT` policies and **no `UPDATE` or `DELETE` policy at all** — RLS default-denies what it has no
policy for, so no client can rewrite or erase a consent event. A withdrawal is a new row with
`granted = false`, not a mutation of the grant. This is what makes the log admissible as evidence
of what was agreed and when.

Policies use `(select auth.uid())`, not bare `auth.uid()`, matching the pattern the existing
policies were already migrated to in `20260711150600_rls_initplan_fix.sql` (the planner evaluates
it once per statement instead of once per row; a bare call re-triggers the `auth_rls_initplan`
performance advisor).

`on delete cascade` on `user_id` means the delete-account function (#58) purges consent rows
without needing to know they exist.

Index on `(user_id, consent_key, created_at desc)` — the only read this table serves is
"latest row for this user and key", and this makes it a single index hit.

### `lib/consent.ts` (new)

```ts
export const UPLOAD_HEALTH_CONSENT = 'upload.health.v1';

hasConsented(key): Promise<boolean>   // latest row wins
grantConsent(key): Promise<void>      // inserts granted = true
withdrawConsent(key): Promise<void>   // inserts granted = false
```

`hasConsented` reads the newest row for `(user, key)` and returns its `granted` value; no rows
means never consented, so `false`. A withdrawal supersedes an earlier grant purely by being
newer — the read needs no special case for it.

**Versioning is carried in the key, not a column.** The consent wording will change (it already
changed once, in PR #72). Consent to the old wording is not consent to the new wording. A rewrite
of the copy means a new key — `upload.health.v2` — and `hasConsented('upload.health.v2')` is
`false` for every existing user until they re-tick, which is the correct and automatic behavior. A
separate `version` column would require remembering to compare it; a versioned key makes forgetting
impossible.

### Failure policy: fail closed

If the query errors — offline, RLS misconfigured, network flake — `hasConsented` **throws**. It
does not return `false` dressed up as "probably fine", and it does not return `true` to avoid
inconveniencing the user. The caller must not proceed to upload.

This is deliberate and it is the direct lesson of an open bug in this repo. Issue #74 exists
because `lib/hibp.ts` fails *open* and does so invisibly — the control silently stops working and
nothing says so. A consent check that failed open would be strictly worse than that: it would
process Art. 9 health data with no legal basis and no signal that it had. So the failure is loud,
the gate stays up, and the user sees an error state.

### `components/consent-gate.tsx` (new)

Renders `consent.upload.title` / `.body` / `.checkbox` / `.link.privacy` / `.cta.primary` /
`.cta.secondary` from the copy deck. Checkbox unticked by default. Primary CTA disabled until it is
ticked — that disabled-until-ticked gate is the entire point, it is what makes the consent
affirmative and unbundled rather than implied by tapping through. On confirm it calls
`grantConsent(UPLOAD_HEALTH_CONSENT)`; on failure it surfaces the error and stays up.

Props: `onConsented()`, `onCancel()`.

### `components/result-disclaimer.tsx` (new)

Renders `result.disclaimer.footer` verbatim. No props, no variants.

### Components, not routes

Both are presentational components, deliberately. **M2 decides** whether the gate is a modal or a
screen and where exactly it intercepts the source-picker handoff; **M4 decides** where the footer
sits on the result. Inventing that navigation now is the one thing that would make this work
speculative and likely wrong — the milestone that owns the screen owns its presentation. What
those milestones get is a drop-in with the legal requirements already satisfied.

Theme tokens only (`constants/theme.ts`), no hardcoded colors or spacing. Accessibility is built
in, not retrofitted (`accessibilityRole="checkbox"`, `accessibilityState` for checked and disabled,
44pt minimum hit targets) — #62 is an open a11y pass and this should not add to its backlog.

## Testing

`lib/__tests__/consent.test.ts`, following the regression-lock style of `lib/__tests__/hibp.test.ts`
(each case pins one specific way the control could ship "passing but inert"):

- No rows → `false`.
- Latest row `granted: true` → `true`.
- Grant, then withdrawal → `false`. Withdrawal supersedes the earlier grant.
- Withdrawal, then re-grant → `true`. The log is not one-way.
- Ordering is by `created_at desc` — a test where insertion order and timestamp order disagree, so
  a query that forgot to sort would return the wrong answer instead of accidentally the right one.
- **Query error throws.** The fail-closed lock. Without this test the function can regress to
  returning `false` on error and every other test still passes.
- `grantConsent` / `withdrawConsent` insert the correct `consent_key` and `granted` boolean.

RLS's append-only property cannot be asserted from Jest. It is verified after the migration is
applied, via the Supabase advisors and an explicit attempt to `update` and `delete` a consent row
as an authenticated non-service user — both must be denied.

## Out of scope, deliberately

- **The stop-running banner** (`result.stopRunning.*`) sits in the same copy-deck section as the
  disclaimer but is injury-triage behavior belonging to the result screen (#56), not #68. Its
  `.reported` variant is dead regardless — Known Issue #10 dropped the runner's note for MVP.
- **The Settings privacy disclosure** stays blocked on #53. `withdrawConsent` is the hook waiting
  for it, and Art. 7(3) — withdrawal must be as easy as giving — is why the record supports
  withdrawal before there is any UI to trigger it.
- **Server-side enforcement.** The client gate is UX. The actual control is `analyze-form` (M4,
  #44) refusing to run without a recorded consent, because a client can always be bypassed. That
  requirement gets written into #44 and into `status.md`'s Known Issue #14, where the other binding
  M4 contract notes already live. It cannot be built here — the edge function does not exist.

## What this does not close

Issue #68 stays open. Its three checkboxes are UI, and all three still need their host screens.
What changes is that the legal substrate beneath them exists, the copy is bound to real components,
and M2/M4/M5 inherit a drop-in instead of re-deriving Art. 9 consent from scratch under deadline.

**Analysis, not legal advice** — counsel reviews before any public submission.
