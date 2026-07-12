# Consent record, consent gate, and result disclaimer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the half of issue #68 that no screen blocks — a durable, append-only consent record, the code that reads and writes it fail-closed, and the two drop-in components M2 and M4 will host.

**Architecture:** A new `public.consents` table is an append-only event log (owner-scoped `SELECT`/`INSERT`, deliberately **no** `UPDATE`/`DELETE` policy, so RLS default-denies rewrites). `lib/consent.ts` reads the newest row per `(user, consent_key)` and throws on any query error. Two presentational components — `ConsentGate` and `ResultDisclaimer` — render copy-deck strings; they own no routing, because M2 and M4 own where they appear.

**Tech Stack:** Expo SDK 54, TypeScript strict, Supabase (Postgres + RLS), Jest via `jest-expo`, `@testing-library/react-native` (added in Task 5).

**Spec:** `docs/superpowers/specs/2026-07-12-consent-record-and-disclaimer-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **Expo SDK 54.** Read the versioned docs at https://docs.expo.dev/versions/v54.0.0/ before writing code. Docs for a newer SDK describe APIs this project does not have.
- **TypeScript strict.** Already on in `tsconfig.json`.
- **Theme tokens only.** No hardcoded colors or spacing in components — use `constants/theme.ts`. This is a CLAUDE.md rule.
- **Copy comes from `constants/copy.ts`,** lifted verbatim by key from `docs/design/copy-deck.md`. Never hand-write a string in a component when a deck key exists. If no key exists, add it to **both** the deck and `constants/copy.ts` — do not inline it.
- **RLS policies use `(select auth.uid())`, never a bare `auth.uid()`.** The planner then evaluates it once per statement rather than once per row; a bare call re-triggers the `auth_rls_initplan` performance advisor. See `supabase/migrations/20260711150600_rls_initplan_fix.sql`.
- **Fail closed.** Every consent read or write throws on error. It never returns a default that lets an upload proceed. This is the direct inverse of open issue #74, where `lib/hibp.ts` fails open and silently.
- **`npm run typecheck && npm run lint && npm test` must pass clean before every commit.** CLAUDE.md rule.
- **Branch, don't commit to `main`.** This touches RLS and security-sensitive code, so it goes on `feat/consent-record` and lands via PR. Work happens in the existing `worktree-issue68` worktree.

---

### Task 1: The `consents` table and its RLS

**Files:**
- Create: `supabase/migrations/20260712120000_consents.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.consents (id uuid, user_id uuid, consent_key text, granted boolean, created_at timestamptz)`. `user_id` defaults to `auth.uid()`, so inserting clients omit it entirely. Task 3's `lib/consent.ts` reads and writes this table.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260712120000_consents.sql`:

```sql
-- consents: an append-only log of consent events — one immutable row per grant
-- or withdrawal.
--
-- This table is the record that lets us DEMONSTRATE consent (GDPR Art. 7(1)).
-- The checkbox in the app only COLLECTS consent; a checkbox that ticks, enables
-- a button and then evaporates proves nothing. The injury-risk inferences in
-- analyses.result are Art. 9 health data at rest, so the upload consent must be
-- explicit, affirmative and unbundled — a "by continuing" line is a notice, not
-- consent. See docs/privacy-checklist-m7.md and issue #68.
--
-- APPEND-ONLY BY CONSTRUCTION, not by convention. This table has owner-scoped
-- SELECT and INSERT policies and deliberately NO update or delete policy at all.
-- RLS default-denies anything it has no policy for, so no client can rewrite or
-- erase a consent event. A withdrawal (Art. 7(3) — withdrawing consent must be
-- as easy as giving it) is a NEW row with granted = false, never a mutation of
-- the original grant.

create table public.consents (
  id          uuid primary key default gen_random_uuid(),

  -- Defaulted from the JWT so the client never names a user at all; the INSERT
  -- policy's with-check re-verifies it regardless. References profiles(id) to
  -- match the house pattern (subscriptions, analyses), which cascades from
  -- auth.users — so delete-account (#58) purges consent rows without needing to
  -- know this table exists.
  user_id     uuid not null default auth.uid()
              references public.profiles(id) on delete cascade,

  -- Versioned in the key itself ('upload.health.v1'), NOT in a separate column.
  -- Consent to one wording is not consent to a later one, so rewording the deck
  -- mints a new key and hasConsented('...v2') is automatically false for every
  -- existing user until they re-tick. A version column would have to be
  -- remembered and compared at every call site; a versioned key cannot be
  -- forgotten.
  consent_key text not null,

  granted     boolean not null,   -- false = withdrawal
  created_at  timestamptz not null default now()
);

-- The only read this table serves: "latest row for this user and key".
create index consents_user_key_created_idx
  on public.consents (user_id, consent_key, created_at desc);

alter table public.consents enable row level security;

-- (select auth.uid()) rather than a bare auth.uid(): the planner evaluates it
-- once per statement instead of once per row. See 20260711150600_rls_initplan_fix.
create policy "Users can view their own consents"
  on public.consents for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can record their own consents"
  on public.consents for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- No UPDATE policy. No DELETE policy. For anyone. This absence is what makes the
-- log append-only and the consent record admissible. Do not add one.
```

- [ ] **Step 2: Apply the migration to the live project**

The Supabase project is `v2.3Analysis` (ref `vputdomdlknvthnzritt`). Apply via the Supabase MCP `apply_migration` tool with name `consents`, or `supabase db push` if the CLI is linked.

Expected: migration applies with no error. `list_migrations` then shows 8 migrations, ending in `consents`.

- [ ] **Step 3: Verify the advisors are clean**

Run the Supabase MCP `get_advisors` for both `security` and `performance`.

Expected: **no new findings.** Specifically, no `rls_disabled_in_public` for `public.consents` (RLS is enabled) and no `auth_rls_initplan` for either new policy (both wrap `auth.uid()` in a `select`). If `auth_rls_initplan` fires, a policy used a bare `auth.uid()` — fix it and re-apply.

- [ ] **Step 4: Prove the log is actually append-only**

This is the assertion the whole table depends on and it **cannot** be tested from Jest — it lives in Postgres. Verify it against the real database, as an **authenticated non-service user** (the `service_role` key bypasses RLS entirely and will happily update the row, which proves nothing).

Insert one row, then attempt to change it:

```sql
-- As an authenticated user (anon key + a real JWT), NOT service_role:
update public.consents set granted = true where consent_key = 'upload.health.v1';
delete from public.consents where consent_key = 'upload.health.v1';
```

Expected: **both affect 0 rows.** RLS has no policy for `UPDATE` or `DELETE`, so it default-denies; PostgREST reports this as zero rows matched rather than as an error. If either mutates a row, an `UPDATE`/`DELETE` policy leaked in — remove it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712120000_consents.sql
git commit -m "feat(db): append-only consents table with owner-scoped RLS (refs #68)"
```

---

### Task 2: Copy keys

**Files:**
- Modify: `docs/design/copy-deck.md` (add one new key to the Consent section, ~line 329)
- Modify: `constants/copy.ts` (add `consent` and `result` groups)

**Interfaces:**
- Consumes: nothing.
- Produces: `Copy.consent.upload.{title,body,checkbox,link.privacy,cta.primary,cta.secondary,error.record}` and `Copy.result.disclaimer.footer`. Tasks 5 and 6 render these.

Every string below except `error.record` already exists in the deck and is lifted **verbatim** — do not paraphrase, reflow, or "improve" them. The consent wording *is* the consent; changing it changes what the user agreed to.

- [ ] **Step 1: Add the one missing deck key**

The deck has no string for "we could not record your consent." Add `consent.upload.error.record` to the Consent table in `docs/design/copy-deck.md`, after the `consent.upload.cta.secondary` row:

```markdown
| `consent.upload.error.record` | "We couldn't record your consent, so nothing has been uploaded. Check your connection and try again." | NEW key. The consent write to `public.consents` failed. States plainly that nothing was sent — matching `offline.blocked.body`'s "nothing has been sent yet" rule (brief §5: never claim a state that isn't true). The gate stays up and the primary CTA stays available for a retry; the user is never advanced into the upload flow on a failed consent write. |
```

- [ ] **Step 2: Add the keys to `constants/copy.ts`**

Insert a `consent` group and a `result` group into the `Copy` object, keeping the deck's screen order (consent is cross-cutting, so place it after `home` and before `settings`):

```ts
  consent: {
    upload: {
      title: 'Before you upload',
      body: 'Your frames are stored privately until you delete them. We send them to Anthropic, our AI provider, to analyse your form. The analysis produces health-related feedback about you, including injury-risk flags.',
      checkbox:
        'I consent to my images being analysed to produce health-related feedback, and to Anthropic processing them to do so.',
      link: {
        privacy: 'Privacy details in Settings',
      },
      cta: {
        primary: 'I consent — continue',
        secondary: 'Cancel',
      },
      error: {
        record:
          "We couldn't record your consent, so nothing has been uploaded. Check your connection and try again.",
      },
    },
  },
  result: {
    disclaimer: {
      footer:
        'This is not medical advice. PACE analyzes visible running form and flags movement patterns that research associates with elevated injury risk — it does not diagnose injuries or conditions. Form assessment from a photo or short video is an estimate, not a lab measurement. If you have pain, swelling, or a persistent problem, or before making a big change to how you run, consult a doctor or a qualified sports physiotherapist.',
    },
  },
```

Note the em-dash in `cta.primary` ("I consent — continue") and in `disclaimer.footer` — both are in the deck. Keep them.

**The disclaimer string above is from the copy deck (`result.disclaimer.footer`), NOT from `knowledge/injury_flags.md`.** Issue #68 points at `injury_flags.md`, and that is wrong: that file is prompt content fed to the model, its wording differs, and the deck calls its own version "its final, shipped form." Do not source it from the knowledge file.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/design/copy-deck.md constants/copy.ts
git commit -m "feat(copy): consent + result-disclaimer keys, and a new consent.upload.error.record (refs #68)"
```

---

### Task 3: `lib/consent.ts` — the record, fail-closed (TDD)

**Files:**
- Create: `lib/consent.ts`
- Test: `lib/__tests__/consent.test.ts`

**Interfaces:**
- Consumes: `supabase` from `lib/supabase.ts`; the `public.consents` table from Task 1.
- Produces:
  - `UPLOAD_HEALTH_CONSENT: 'upload.health.v1'`
  - `type ConsentKey = typeof UPLOAD_HEALTH_CONSENT`
  - `hasConsented(key: ConsentKey): Promise<boolean>` — **throws** on query error
  - `grantConsent(key: ConsentKey): Promise<void>` — **throws** on insert error
  - `withdrawConsent(key: ConsentKey): Promise<void>` — **throws** on insert error

  Task 5's `ConsentGate` calls `grantConsent`. M2 will call `hasConsented`. `withdrawConsent` is unused until #53.

- [ ] **Step 1: Write the failing test**

Create `lib/__tests__/consent.test.ts`. This follows the regression-lock style of `lib/__tests__/hibp.test.ts` — each case pins one specific way this control could ship "passing but inert."

```ts
/**
 * Regression locks for `lib/consent.ts` (issue #68).
 *
 * This module is a compliance control, and compliance controls fail quietly. Issue #74 is open
 * in this repo right now because `lib/hibp.ts` fails OPEN — it silently reports every password
 * as safe when the network is down, and every lint/typecheck/happy-path test stays green while
 * it does. A consent check that failed the same way would be worse: it would let Art. 9 health
 * data be processed with no legal basis and no signal that anything had gone wrong.
 *
 * So the load-bearing case here is case 5 — an error THROWS. Without it, `hasConsented` can
 * regress to `return false` on error (or, worse, `return true`) and every other test in this
 * file still passes.
 *
 * WHAT THIS SUITE CANNOT PROVE: "the latest row wins" is enforced by Postgres, not by JS — the
 * ordering happens in the database. A unit test with a mocked client can only prove that the
 * query ASKS for `created_at desc, limit 1` (case 4). That the database honors it is verified
 * against the real project in Task 1 of the plan, not here.
 */
import { grantConsent, hasConsented, UPLOAD_HEALTH_CONSENT, withdrawConsent } from '../consent';
import { supabase } from '../supabase';

jest.mock('../supabase', () => ({
  supabase: { from: jest.fn() },
}));

const mockFrom = supabase.from as jest.MockedFunction<typeof supabase.from>;

type Row = { granted: boolean };
type QueryError = { message: string };

/** Mocks `.from('consents').select(..).eq(..).order(..).limit(..).maybeSingle()`. */
function mockSelectChain(result: { data: Row | null; error: QueryError | null }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const limit = jest.fn().mockReturnValue({ maybeSingle });
  const order = jest.fn().mockReturnValue({ limit });
  const eq = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ eq });
  mockFrom.mockReturnValue({ select } as never);
  return { select, eq, order, limit, maybeSingle };
}

/** Mocks `.from('consents').insert(..)`. */
function mockInsertChain(result: { error: QueryError | null }) {
  const insert = jest.fn().mockResolvedValue(result);
  mockFrom.mockReturnValue({ insert } as never);
  return { insert };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('hasConsented', () => {
  // Case 1: a user who never consented has no rows at all.
  it('returns false when the user has no consent rows', async () => {
    mockSelectChain({ data: null, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(false);
  });

  // Case 2: the newest row is a grant.
  it('returns true when the newest row is a grant', async () => {
    mockSelectChain({ data: { granted: true }, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(true);
  });

  // Case 3: the newest row is a withdrawal, which supersedes any earlier grant purely by
  // being newer — there is no special case for it in the code, and there should not be.
  it('returns false when the newest row is a withdrawal', async () => {
    mockSelectChain({ data: { granted: false }, error: null });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).resolves.toBe(false);
  });

  // Case 4: THE query lock. Cases 1-3 would all still pass if the query forgot to sort, and
  // would then return whichever row Postgres happened to hand back first — which, after a
  // withdrawal, could be the stale grant. This is the only test that catches that.
  it('asks for the newest row: created_at descending, limit 1, scoped to the key', async () => {
    const chain = mockSelectChain({ data: { granted: true }, error: null });

    await hasConsented(UPLOAD_HEALTH_CONSENT);

    expect(mockFrom).toHaveBeenCalledWith('consents');
    expect(chain.select).toHaveBeenCalledWith('granted');
    expect(chain.eq).toHaveBeenCalledWith('consent_key', 'upload.health.v1');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  // Case 5: FAIL CLOSED. The load-bearing case — see the suite docblock.
  it('throws when the query fails, rather than defaulting to consented or not-consented', async () => {
    mockSelectChain({ data: null, error: { message: 'network unreachable' } });

    await expect(hasConsented(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('network unreachable');
  });
});

describe('grantConsent', () => {
  it('appends a row with granted = true', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(UPLOAD_HEALTH_CONSENT);

    expect(mockFrom).toHaveBeenCalledWith('consents');
    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.health.v1',
      granted: true,
    });
  });

  // Case 7: the insert must NOT name a user. user_id defaults to auth.uid() in the database,
  // so a client that supplies its own user_id is a client that could supply someone else's.
  // (The INSERT policy's with-check would reject it — but the right fix is not to send it.)
  it('never sends a user_id — the column defaults to auth.uid() from the JWT', async () => {
    const chain = mockInsertChain({ error: null });

    await grantConsent(UPLOAD_HEALTH_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith(expect.not.objectContaining({ user_id: expect.anything() }));
  });

  // Case 8: fail closed on write, too. A grant that silently didn't persist is worse than no
  // grant at all — the user believes they consented, and no record exists to prove it.
  it('throws when the insert fails', async () => {
    mockInsertChain({ error: { message: 'permission denied' } });

    await expect(grantConsent(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('permission denied');
  });
});

describe('withdrawConsent', () => {
  // Art. 7(3): withdrawing consent must be as easy as giving it. Unused until Settings (#53)
  // exists, but the record supports it now because the table shape is the hard part to change.
  it('appends a row with granted = false', async () => {
    const chain = mockInsertChain({ error: null });

    await withdrawConsent(UPLOAD_HEALTH_CONSENT);

    expect(chain.insert).toHaveBeenCalledWith({
      consent_key: 'upload.health.v1',
      granted: false,
    });
  });

  it('throws when the insert fails', async () => {
    mockInsertChain({ error: { message: 'permission denied' } });

    await expect(withdrawConsent(UPLOAD_HEALTH_CONSENT)).rejects.toThrow('permission denied');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest lib/__tests__/consent.test.ts`
Expected: FAIL — `Cannot find module '../consent'`.

- [ ] **Step 3: Write `lib/consent.ts`**

```ts
/**
 * The consent record (issue #68).
 *
 * A checkbox is not consent — it COLLECTS consent. GDPR Art. 7(1) requires the controller to be
 * able to DEMONSTRATE that consent was given, and the injury-risk inferences this app produces
 * are Art. 9 health data at rest (see docs/privacy-checklist-m7.md). This module is the record:
 * an append-only log in public.consents, one immutable row per grant or withdrawal.
 *
 * Everything here FAILS CLOSED — see hasConsented().
 */
import { supabase } from './supabase';

/**
 * Consent to the upload → Anthropic → health-feedback processing chain, at the exact wording
 * shipped in `Copy.consent.upload` (copy-deck.md § Consent).
 *
 * The version lives in the key on purpose. Consent to one wording is not consent to a later one,
 * so rewording the deck means minting `upload.health.v2` here — at which point hasConsented() is
 * false for every existing user until they re-tick, automatically and without a migration. A
 * separate `version` column would have to be remembered and compared at every call site.
 */
export const UPLOAD_HEALTH_CONSENT = 'upload.health.v1';

export type ConsentKey = typeof UPLOAD_HEALTH_CONSENT;

/**
 * True if the newest consent event for this key is a grant.
 *
 * Withdrawal needs no special case: it is simply a newer row with granted = false, so reading
 * the latest row returns it. The ordering is done by Postgres, not here.
 *
 * THROWS on any query failure — offline, RLS misconfigured, network flake. It deliberately does
 * NOT return `false` dressed up as "probably fine", and it does NOT return `true` to avoid
 * inconveniencing the user. Returning true would process Art. 9 health data with no legal basis.
 * Returning false silently would be indistinguishable from a user who genuinely never consented,
 * which hides the outage — that is exactly the bug open at #74, where lib/hibp.ts fails open and
 * nothing says so. The caller must treat a throw as "cannot upload" and surface it.
 */
export async function hasConsented(key: ConsentKey): Promise<boolean> {
  // No user_id filter: RLS scopes SELECT to the owner, so this can only ever see our own rows.
  const { data, error } = await supabase
    .from('consents')
    .select('granted')
    .eq('consent_key', key)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read consent "${key}": ${error.message}`);
  }

  return data?.granted ?? false;
}

/** Record an explicit grant. Appends a row; never updates one. */
export async function grantConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, true);
}

/**
 * Record a withdrawal (Art. 7(3): withdrawing consent must be as easy as giving it). Appends a
 * row with granted = false, which supersedes the earlier grant by being newer.
 *
 * Unused until the Settings screen exists (#53). The record supports withdrawal before there is
 * any UI to trigger it because the table shape is the expensive thing to change later, not the
 * button.
 */
export async function withdrawConsent(key: ConsentKey): Promise<void> {
  await recordConsent(key, false);
}

async function recordConsent(key: ConsentKey, granted: boolean): Promise<void> {
  // user_id is omitted on purpose: the column defaults to auth.uid() from the verified JWT, so
  // the client never names a user at all. The INSERT policy's with-check re-verifies it anyway.
  const { error } = await supabase.from('consents').insert({ consent_key: key, granted });

  if (error) {
    throw new Error(`Could not record consent "${key}" (granted: ${granted}): ${error.message}`);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest lib/__tests__/consent.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add lib/consent.ts lib/__tests__/consent.test.ts
git commit -m "feat(consent): lib/consent.ts — fail-closed read/write of the consent record (refs #68)"
```

---

### Task 4: Add `@testing-library/react-native`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `render`, `screen`, `fireEvent`, `waitFor` from `@testing-library/react-native`, available to Task 5's and Task 6's tests.

This is its own task because it is a dependency and convention change (CLAUDE.md currently says "Screens are not unit-tested for now") and a reviewer could reasonably reject it while approving everything else. Approved by Ian 2026-07-12: the consent gate's "CTA disabled until ticked" is the assertion that makes the consent Art. 9-valid, and it must not be able to regress silently.

- [ ] **Step 1: Install**

Run: `npx expo install --dev @testing-library/react-native`

It is a Jest-based renderer, not a new test framework — `jest-expo` remains the preset and no `jest.config.js` change is needed.

- [ ] **Step 2: Verify the existing suite still passes**

Run: `npm test`
Expected: PASS — the existing `hibp` and `consent` suites, unaffected.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "test: add @testing-library/react-native for the consent-gate compliance locks (refs #68)"
```

---

### Task 5: `components/consent-gate.tsx` (TDD)

**Files:**
- Create: `components/consent-gate.tsx`
- Modify: `constants/theme.ts` (add a `CheckboxSize` token — see Step 3)
- Test: `components/__tests__/consent-gate.test.tsx`

**Interfaces:**
- Consumes: `Copy.consent.upload.*` (Task 2); `grantConsent`, `UPLOAD_HEALTH_CONSENT` from `lib/consent.ts` (Task 3); `@testing-library/react-native` (Task 4).
- Also produces: `CheckboxSize` in `constants/theme.ts`.
- Produces: `export function ConsentGate(props: { onConsented: () => void; onCancel: () => void }): JSX.Element`. M2 renders this before handing off to capture/upload.

**This is a component, not a route.** M2 decides whether it is a modal or a screen and where it intercepts the source-picker handoff. Do not add it to `app/`, do not add navigation, do not guess at presentation.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/consent-gate.test.tsx`:

```tsx
/**
 * Compliance locks for <ConsentGate /> (issue #68).
 *
 * One assertion in this file matters more than the rest: the primary CTA is DISABLED until the
 * checkbox is ticked (case 1), and grantConsent is not called before then (case 2). That gate is
 * what makes the consent affirmative and unbundled — i.e. Art. 9 explicit consent rather than a
 * "by continuing" notice, which is what the copy deck was upgraded away from in PR #72. If a
 * refactor ever enables that button by default, the consent silently stops being valid and
 * nothing else in the suite notices.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ConsentGate } from '../consent-gate';
import { Copy } from '@/constants/copy';
import { grantConsent, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';

jest.mock('@/lib/consent', () => ({
  UPLOAD_HEALTH_CONSENT: 'upload.health.v1',
  grantConsent: jest.fn(),
}));

const mockGrantConsent = grantConsent as jest.MockedFunction<typeof grantConsent>;

function renderGate() {
  const onConsented = jest.fn();
  const onCancel = jest.fn();
  render(<ConsentGate onConsented={onConsented} onCancel={onCancel} />);
  return { onConsented, onCancel };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrantConsent.mockResolvedValue(undefined);
});

// Case 1: THE lock. The consent is only explicit because this button starts unusable.
it('disables the primary CTA until the checkbox is ticked', () => {
  renderGate();

  // Re-query after the press rather than holding the element reference across the re-render —
  // a held reference can be stale and would silently assert against the pre-toggle tree.
  expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(true);

  fireEvent.press(screen.getByTestId('consent-checkbox'));

  expect(screen.getByTestId('consent-cta-primary').props.accessibilityState.disabled).toBe(false);
});

// Case 2: and the disabled button must be inert, not merely styled as disabled.
it('does not record consent when the CTA is pressed before the checkbox is ticked', () => {
  renderGate();

  fireEvent.press(screen.getByTestId('consent-cta-primary'));

  expect(mockGrantConsent).not.toHaveBeenCalled();
});

it('records the consent and advances once the checkbox is ticked and the CTA pressed', async () => {
  const { onConsented } = renderGate();

  fireEvent.press(screen.getByTestId('consent-checkbox'));
  fireEvent.press(screen.getByTestId('consent-cta-primary'));

  await waitFor(() => expect(onConsented).toHaveBeenCalledTimes(1));
  expect(mockGrantConsent).toHaveBeenCalledWith(UPLOAD_HEALTH_CONSENT);
});

// Case 4: fail closed. If the record did not persist, the user has NOT consented as far as we
// can prove — so they must not be advanced into the upload flow.
it('does not advance when recording the consent fails, and says so', async () => {
  mockGrantConsent.mockRejectedValue(new Error('network unreachable'));
  const { onConsented } = renderGate();

  fireEvent.press(screen.getByTestId('consent-checkbox'));
  fireEvent.press(screen.getByTestId('consent-cta-primary'));

  await waitFor(() => expect(screen.getByText(Copy.consent.upload.error.record)).toBeTruthy());
  expect(onConsented).not.toHaveBeenCalled();
});

it('cancels without recording anything', () => {
  const { onCancel } = renderGate();

  fireEvent.press(screen.getByTestId('consent-cta-secondary'));

  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(mockGrantConsent).not.toHaveBeenCalled();
});

// The checkbox label names the health processing and Anthropic by name. That naming is what
// carries Art. 9 — a generic "I agree to the terms" would not.
it('renders the deck consent copy verbatim', () => {
  renderGate();

  expect(screen.getByText(Copy.consent.upload.title)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.body)).toBeTruthy();
  expect(screen.getByText(Copy.consent.upload.checkbox)).toBeTruthy();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest components/__tests__/consent-gate.test.tsx`
Expected: FAIL — `Cannot find module '../consent-gate'`.

- [ ] **Step 3: Add the checkbox token to `constants/theme.ts`**

The gate needs a checkbox box size and border width, and CLAUDE.md forbids hardcoding either in a component. `theme.ts` already has a "Control sizing / opacity" section for exactly this case ("these exact dimensions repeat verbatim across screens... name them once here instead of hardcoding the literal at each call site"). Add, next to `HitTarget`:

```ts
export const CheckboxSize = {
  /** The drawn box. The tappable row around it is `HitTarget.min` — the box itself is smaller
   *  than 44pt on purpose; it is the ROW that must meet the target, not the glyph. */
  box: 24,
  border: 2,
} as const;
```

- [ ] **Step 4: Write `components/consent-gate.tsx`**

```tsx
/**
 * The Art. 9 consent gate (issue #68) — shown once, before a user's first upload.
 *
 * The primary CTA is disabled until the checkbox is ticked, and that is the entire point: an
 * affirmative, unbundled opt-in is what separates explicit consent from a "by continuing" notice.
 * The deck's copy names the health processing and Anthropic by name for the same reason. Do not
 * soften either.
 *
 * This is a component, not a route. M2 owns whether it presents as a modal or a screen, and where
 * it intercepts the source-picker → capture handoff.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Accent,
  CheckboxSize,
  Colors,
  ControlHeight,
  FontFamily,
  FontSize,
  HitTarget,
  Opacity,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { grantConsent, UPLOAD_HEALTH_CONSENT } from '@/lib/consent';

type Props = {
  /** Consent is recorded and the caller may proceed into capture/upload. */
  onConsented: () => void;
  /** Dismissed without consenting. Nothing was recorded and nothing may be uploaded. */
  onCancel: () => void;
};

export function ConsentGate({ onConsented, onCancel }: Props) {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canProceed = checked && !pending;

  async function handleConsent() {
    if (!canProceed) return;

    setPending(true);
    setError(null);

    try {
      await grantConsent(UPLOAD_HEALTH_CONSENT);
      onConsented();
    } catch {
      // Fail closed: the gate stays up, nothing is uploaded, and we say so plainly. We do not
      // advance on the assumption the write probably worked — an unprovable consent is no consent.
      setError(Copy.consent.upload.error.record);
      setPending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{Copy.consent.upload.title}</Text>
      <Text style={styles.body}>{Copy.consent.upload.body}</Text>

      <Pressable
        testID="consent-checkbox"
        onPress={() => setChecked((value) => !value)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={Copy.consent.upload.checkbox}
        style={styles.checkboxRow}
        hitSlop={Spacing.sm}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>{Copy.consent.upload.checkbox}</Text>
      </Pressable>

      <Text style={styles.privacyLink}>{Copy.consent.upload.link.privacy}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        testID="consent-cta-primary"
        onPress={handleConsent}
        disabled={!canProceed}
        accessibilityRole="button"
        accessibilityState={{ disabled: !canProceed }}
        style={[styles.primaryCta, !canProceed && styles.primaryCtaDisabled]}
      >
        {pending ? (
          <ActivityIndicator color={Accent.onAccent} />
        ) : (
          <Text style={styles.primaryCtaLabel}>{Copy.consent.upload.cta.primary}</Text>
        )}
      </Pressable>

      <Pressable
        testID="consent-cta-secondary"
        onPress={onCancel}
        accessibilityRole="button"
        style={styles.secondaryCta}
      >
        <Text style={styles.secondaryCtaLabel}>{Copy.consent.upload.cta.secondary}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.sheet,
      gap: Spacing.lg,
      padding: Spacing.xl,
    },
    title: {
      color: colors.text.primary,
      fontFamily: FontFamily.display.semiBold,
      fontSize: FontSize.xl,
    },
    body: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    checkboxRow: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: Spacing.md,
      minHeight: HitTarget.min,
    },
    checkbox: {
      alignItems: 'center',
      borderColor: colors.hairline,
      borderRadius: Radius.card,
      borderWidth: CheckboxSize.border,
      height: CheckboxSize.box,
      justifyContent: 'center',
      width: CheckboxSize.box,
    },
    checkboxChecked: {
      backgroundColor: Accent.value,
      borderColor: Accent.value,
    },
    checkboxMark: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.bold,
      fontSize: FontSize.xs,
    },
    checkboxLabel: {
      color: colors.text.primary,
      flex: 1,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.sm,
    },
    privacyLink: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.xs,
    },
    error: {
      color: colors.text.primary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
    primaryCta: {
      alignItems: 'center',
      backgroundColor: Accent.value,
      borderRadius: Radius.card,
      height: ControlHeight.standard,
      justifyContent: 'center',
    },
    primaryCtaDisabled: {
      opacity: Opacity.disabled,
    },
    primaryCtaLabel: {
      color: Accent.onAccent,
      fontFamily: FontFamily.body.semiBold,
      fontSize: FontSize.md,
    },
    secondaryCta: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: HitTarget.min,
    },
    secondaryCtaLabel: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.medium,
      fontSize: FontSize.sm,
    },
  });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest components/__tests__/consent-gate.test.tsx`
Expected: PASS — 6 tests.

If the error-state test fails to find the string, check that `error` is rendered as its own `<Text>` and not merged into another node.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add components/consent-gate.tsx components/__tests__/consent-gate.test.tsx constants/theme.ts
git commit -m "feat(consent): ConsentGate — checkbox-gated Art. 9 consent, fail-closed (refs #68)"
```

---

### Task 6: `components/result-disclaimer.tsx` (TDD)

**Files:**
- Create: `components/result-disclaimer.tsx`
- Test: `components/__tests__/result-disclaimer.test.tsx`

**Interfaces:**
- Consumes: `Copy.result.disclaimer.footer` (Task 2).
- Produces: `export function ResultDisclaimer(): JSX.Element`. No props. M4's result screen (#56) renders it on every result, every tier, no exceptions.

- [ ] **Step 1: Write the failing test**

Create `components/__tests__/result-disclaimer.test.tsx`:

```tsx
/**
 * Regression lock for <ResultDisclaimer /> (issue #68).
 *
 * This looks like a snapshot of a static string, and it is — deliberately. Issue #68 tells you to
 * source this text from `knowledge/injury_flags.md`, and that is WRONG: that file is prompt
 * content fed to the model, and its wording is not the shipped wording. The deck's
 * `result.disclaimer.footer` is, and it calls itself "its final, shipped form". This test pins the
 * component to the deck so the next person to follow the issue's instructions gets a red test
 * instead of a legally weaker disclaimer.
 */
import { render, screen } from '@testing-library/react-native';

import { ResultDisclaimer } from '../result-disclaimer';
import { Copy } from '@/constants/copy';

it('renders the copy deck disclaimer verbatim', () => {
  render(<ResultDisclaimer />);

  expect(screen.getByText(Copy.result.disclaimer.footer)).toBeTruthy();
});

// The disclaimer must LEAD with the disavowal, not bury it — a reader who stops after one
// sentence must still have been told this is not medical advice. Asserts against the rendered
// node, not against the Copy constant (which would only be testing that a string is itself).
it('leads with the disavowal rather than burying it', () => {
  render(<ResultDisclaimer />);

  const rendered = screen.getByTestId('result-disclaimer-text');
  expect(rendered.props.children).toEqual(expect.stringMatching(/^This is not medical advice\./));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest components/__tests__/result-disclaimer.test.tsx`
Expected: FAIL — `Cannot find module '../result-disclaimer'`.

- [ ] **Step 3: Write `components/result-disclaimer.tsx`**

```tsx
/**
 * The "not medical advice" disclaimer (issue #68) — rendered on EVERY result, every tier, no
 * exceptions (copy-deck.md § Disclaimer).
 *
 * The string is `Copy.result.disclaimer.footer`, from the copy deck — NOT the differently-worded
 * version in `knowledge/injury_flags.md`, which is prompt content for the model. Issue #68 points
 * at the knowledge file; it is wrong.
 *
 * This is a component, not a route. M4 owns where it sits on the result screen.
 */
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Copy } from '@/constants/copy';
import {
  Colors,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  type ColorScheme,
  type ThemeColors,
} from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function ResultDisclaimer() {
  const scheme: ColorScheme = useColorScheme() ?? 'light';
  const colors = Colors[scheme];
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.container}>
      <Text testID="result-disclaimer-text" style={styles.text}>
        {Copy.result.disclaimer.footer}
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.surface.base,
      borderRadius: Radius.card,
      padding: Spacing.lg,
    },
    text: {
      color: colors.text.secondary,
      fontFamily: FontFamily.body.regular,
      fontSize: FontSize.xs,
      lineHeight: FontSize.xs * 1.5,
    },
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest components/__tests__/result-disclaimer.test.tsx`
Expected: PASS — 2 tests.

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add components/result-disclaimer.tsx components/__tests__/result-disclaimer.test.tsx
git commit -m "feat(consent): ResultDisclaimer — the deck's 'not medical advice' footer (refs #68)"
```

---

### Task 7: Record the server-side enforcement requirement, and the docs

**Files:**
- Modify: `docs/status.md` (Known Issue #14 — the M4 contract notes; and the M7 milestone row)
- Modify: `docs/architecture.md` (move `consents` + `lib/consent.ts` from planned to current)
- Modify: `docs/privacy-checklist-m7.md` (tick what landed; restate what is still blocked)
- Modify: `docs/change_log.md` (dated entry)
- GitHub: comment on #44 and #68 (via `github-ops`)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

**This task is the one that keeps the rest from being decorative.** The client gate is UX — anyone can talk to the API directly and skip it. The control that actually enforces consent is `analyze-form` (M4, #44) refusing to run without a recorded one. That function does not exist yet, so the requirement has to be written where M4's builder will find it, or it will be lost.

- [ ] **Step 1: Add the enforcement requirement to `status.md`'s Known Issue #14**

Known Issue #14 already holds the binding `analyze-form` contract notes carried forward from the M1 review. Append a fourth bullet, in the same voice:

```markdown
    - MUST refuse to run for a user with no recorded consent. `public.consents` (added 2026-07-12,
      issue #68) is the record; the check is `select granted from public.consents where user_id =
      <jwt uid> and consent_key = 'upload.health.v1' order by created_at desc limit 1`, and a
      missing row, a `granted = false` row, or a query error all mean **refuse**. The
      `<ConsentGate />` in the client is UX only — it can be bypassed by anyone calling the
      function directly, so it is not the control. If this check is skipped, the app processes
      Art. 9 health data with no legal basis and the entire consent record becomes decorative.
```

- [ ] **Step 2: Update the M7 row in `status.md`'s milestone table**

Replace the M7 status cell's trailing sentence ("The consent line and result disclaimer remain blocked on M2/M4.") with:

```markdown
The consent **record** (`public.consents`, `lib/consent.ts`) and the `<ConsentGate />` / `<ResultDisclaimer />` components landed 2026-07-12; the three #68 checkboxes remain blocked on their host screens (M2/M4/M5), which now inherit drop-ins rather than re-deriving Art. 9 consent under deadline. Server-side enforcement is a binding M4 requirement — see Known Issue #14.
```

- [ ] **Step 3: Update `docs/architecture.md`**

Add `public.consents` to the DB schema section (append-only, owner-scoped SELECT/INSERT, no UPDATE/DELETE policy, `user_id` defaults to `auth.uid()`), and add `lib/consent.ts` to the `lib/` layout as **current** rather than planned. Note that `analyze-form` must check it server-side.

- [ ] **Step 4: Update `docs/privacy-checklist-m7.md`**

The three checklist items at lines ~117-137 stay **unticked** — they are UI and still blocked. Add a note under them recording that the record, the copy bindings, and both components now exist, and that what remains is purely hosting them on M2/M4/M5 screens plus the M4 server-side check.

- [ ] **Step 5: Append to `docs/change_log.md`**

A dated `2026-07-12` entry covering: the `consents` table and why it is append-only; `lib/consent.ts` and the fail-closed policy (and its relationship to #74); the two components; the new `consent.upload.error.record` deck key; `@testing-library/react-native`; and the correction to #68's disclaimer source.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add docs/status.md docs/architecture.md docs/privacy-checklist-m7.md docs/change_log.md
git commit -m "docs: record the consent substrate + the binding analyze-form consent check (refs #68, #44)"
```

- [ ] **Step 8: Comment on the GitHub issues (via `github-ops`)**

On **#44** (build the analyze-form edge function): a comment stating the consent check as an acceptance criterion, with the SQL from Step 1 and the reason the client gate does not count.

On **#68**: a comment recording that the consent record and both components landed, that the three checkboxes remain blocked on M2/M4/M5, and — importantly — **correcting the issue body's claim that the disclaimer content lives in `knowledge/injury_flags.md`**. It does not; the shipped string is `result.disclaimer.footer` in the copy deck, and the two differ.

Do **not** close #68.

---

### Task 8: Review, and open the PR

**Files:** none — this is the HIGH/CRITICAL review chain `AGENTS.md` mandates for schema + RLS + security-sensitive work.

- [ ] **Step 1: `security-auditor`** — mandatory, this is on the project's hot list (RLS, uploaded media, consent). Focus it on the RLS policies and the fail-closed paths.
- [ ] **Step 2: `code-reviewer`** — the full diff.
- [ ] **Step 3: `verifier`** — `npm run typecheck && npm run lint && npm test` clean on the final tree.
- [ ] **Step 4: `scope-guard`** — audit the diff against this plan's declared file list.
- [ ] **Step 5: Open the PR via `github-ops`** — base `main`, head `feat/consent-record`, referencing #68 and #44. It must **not** close #68.
