# Client-side HaveIBeenPwned password check (issue #70)

**Date:** 2026-07-12
**Issue:** [#70](https://github.com/IanQiu979/v2.3-photo-video-analysis/issues/70)
**Status:** approved, ready to implement

## Problem

Supabase's built-in leaked-password protection (HaveIBeenPwned) is **Pro-plan-gated**. Enabling
it on this project was attempted during the M1 security audit and rejected with HTTP 402:
"available on Pro Plans and up." The org (`Echo_Running_Final`) is on the free plan, and
`auth_leaked_password_protection` remains the **only** security advisor finding on the project.

This matters more here than it would elsewhere, because the other levers are also unavailable:
signup rate limiting has no field at all on the hosted API (Known Issue #12), and
`mailer_autoconfirm = true`. Password quality is close to the only account-security lever left.
`minimum_password_length` was already raised 6→8 as the available mitigation.

## Decision

Implement the leaked-password check **ourselves**, client-side, using HIBP's Pwned Passwords
**range API** — which is free, keyless, and built on k-anonymity. This gets real users the same
protection Supabase Pro would give them, on the free plan.

It is **not** a replacement for server-side enforcement. See "Limits" below. Issue #70 stays
open for the Pro-plan fix.

## Design

### `lib/hibp.ts` (new)

```ts
export type BreachCheck =
  | { status: 'safe' }
  | { status: 'breached'; count: number }
  | { status: 'unavailable' };

export function checkPasswordBreached(password: string): Promise<BreachCheck>;
```

Pure and dependency-injectable enough to test with a mocked `fetch`. Algorithm:

1. SHA-1 the plaintext password on-device via `expo-crypto` (already a dependency;
   `lib/crypto-polyfill.ts` establishes the SHA-1 usage pattern). Produces 40 uppercase hex chars.
2. Split: `prefix = hash.slice(0, 5)`, `suffix = hash.slice(5)` (35 chars).
3. `GET https://api.pwnedpasswords.com/range/{prefix}` with header `Add-Padding: true`.
   **Only the 5-char prefix leaves the device.** The password and the full hash never do.
4. Response body is newline-delimited `SUFFIX:COUNT`. Match `suffix` against each row.
5. Return `breached` with the count on a match, `safe` on no match.

**Correctness traps to pin with tests** — each of these would silently turn the check into a
no-op that always returns `safe`, which is the worst possible failure because it looks like it
works:

- Padding rows (from `Add-Padding: true`) come back with **`COUNT` 0 and must never count as a
  match**.
- Suffix comparison must be **case-insensitive** (`\r\n` line endings must be trimmed too).
- The hash must be uppercase hex before slicing.

### Failure policy

- **`breached` → hard block.** Return *before* `supabase.auth.signUp` is called, so no account
  is ever created with a breached password. This mirrors exactly what Supabase Pro's
  server-side feature does, so if the project later upgrades, behavior is identical and this
  code is simply deleted.
- **`unavailable` → fail open.** A 5s `AbortController` timeout; any non-2xx, network error, or
  parse error yields `unavailable` and the signup proceeds. A third-party outage must never
  block account creation, and since the check is client-side and therefore bypassable anyway,
  failing closed would buy almost nothing while costing real signups.

### `app/(auth)/sign-in.tsx`

A single `await` in the `mode === 'signUp'` branch of `handleEmailSubmit`, before
`supabase.auth.signUp`. `breached` sets the error message and returns; `safe` and `unavailable`
proceed. The Google OAuth path is untouched — it has no password to check.

### Copy

Two new keys, added to `docs/design/copy-deck.md` **first**, then lifted verbatim into
`constants/copy.ts` (the deck's rule: never hand-write copy in JSX when a deck key exists):

- `auth.error.passwordBreached` — the password appeared in a breach; choose another.
- `auth.error.passwordTooShort` — see below.

### Adjacent fix (in scope, approved)

`mapAuthError` in `app/(auth)/sign-in.tsx` currently swallows Supabase's "Password should be at
least 8 characters" into the generic `"Sign-in didn't go through. Try again."`, so a user whose
password is too short is told nothing useful. Since #70's entire premise is that password
quality is the last remaining lever, and this is the same surface, it is fixed here: add a
`passwordTooShort` mapping and copy key.

## Testing

`lib/__tests__/hibp.test.ts`, mocking `fetch` and `expo-crypto`:

- known suffix present in the response → `breached`, with the right count
- suffix absent → `safe`
- **padding rows (`COUNT` 0) never match** → `safe`
- suffix match is case-insensitive; `\r\n` line endings are handled
- non-2xx → `unavailable`
- network throw → `unavailable`
- timeout / abort → `unavailable`
- **privacy assertion: the request URL contains only the 5-char prefix** — the full hash never
  appears in any outbound request

## Limits (documented, not hidden)

1. **Bypassable.** The client talks to the Supabase Auth API directly, so anyone can skip this
   check and set a breached password on their own account. It protects real users from their
   own reused passwords; it does not stop a determined attacker.
2. **Signup only.** There is no password-reset or change-password flow in the app yet. When one
   is built, it must call `checkPasswordBreached` too.
3. **Not OAuth.** Google sign-in has no password.

Because of (1), **issue #70 stays open** — server-side enforcement still requires Supabase Pro.
The issue is retitled to record that the client-side mitigation has landed.

## Privacy note

This adds an outbound request to a third party (Cloudflare-fronted `api.pwnedpasswords.com`) at
signup. Under k-anonymity only 5 hex characters of a SHA-1 hash are sent — not the password, not
the full hash, and no user identifier or email. `Add-Padding: true` defeats response-size
traffic analysis. To be recorded in `docs/privacy-checklist-m7.md`.
