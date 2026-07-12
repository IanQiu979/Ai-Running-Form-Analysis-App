/**
 * Maps a caught sign-in/sign-up error to the copy deck's fixed strings (screen 1).
 *
 * Extracted out of `app/(auth)/sign-in.tsx` (issue #70 follow-up) purely so this
 * security-relevant mapping gets real unit-test coverage — screens themselves are not
 * unit-tested by convention (CLAUDE.md § Testing). Every branch that existed before the
 * extraction behaves identically; the only new branch is the leaked-password one below.
 *
 * Takes the raw caught value (`unknown`), not just its `.message` string, because the
 * leaked-password branch needs supabase-js's typed `AuthWeakPasswordError.reasons` array, not a
 * pattern-match over text. Supabase's server now enforces HaveIBeenPwned itself (issue #70: the
 * org moved to Pro; `password_hibp_enabled = true` was applied to the hosted project on
 * 2026-07-12 — see `lib/hibp.ts`'s header for the full story) and rejects a breached password
 * with HTTP 422, `error_code: 'weak_password'`, `reasons: ['pwned']`. That is exactly the case
 * `lib/hibp.ts`'s client-side pre-check exists to catch before the round-trip even happens, and
 * exactly the case it can miss on its own — it fails open on a HIBP timeout/outage by design
 * (issue #74). Without the branch below, a breached password that slips past the client
 * pre-check surfaced only the generic "Sign-in didn't go through" message: true, but useless —
 * it gave the user no hint of what was actually wrong or how to fix it.
 *
 * IMPORTANT: Supabase returns the same `weak_password` / `AuthWeakPasswordError` for a too-short
 * password as for a breached one — the ONLY thing that separates them is the `reasons` array, not
 * the error class and not reliably the message. And `reasons` is a set, not a tag: GoTrue
 * accumulates it, so a password that is both too short and breached returns `['length', 'pwned']`
 * (verified against the live project on 2026-07-12). Two consequences, both load-bearing:
 *   1. Treating every `AuthWeakPasswordError` as a breach would tell a user with an ordinary
 *      too-short password that it "showed up in a data breach" — confusing and simply false.
 *   2. Checking `pwned` before `length` would do the same thing to the `['length', 'pwned']` case,
 *      which is why `length` is tested first below. It is the more actionable of the two: a user
 *      told only "breached" picks another short password and never learns the rule that would let
 *      them through.
 * `sign-in.tsx` also runs a client-side length pre-check before `signUp`, which masks case 2 on
 * that screen today — but this is a shared `lib/` module (a password-reset flow is the obvious
 * next caller), so the guarantee has to live here, not in one screen's call ordering.
 */
import { isAuthWeakPasswordError } from '@supabase/supabase-js';

import { Copy } from '@/constants/copy';

export function mapAuthError(error: unknown): string {
  // Typed check first — see header. `reasons` is a set, not a tag: GoTrue ACCUMULATES it, so a
  // password that is both too short and breached comes back as `['length', 'pwned']` with both
  // sentences joined into one message (verified live, 2026-07-12: "abc123" → exactly that).
  // Length is therefore tested first, and deliberately so — it is the more actionable of the
  // two. Told only "breached", a user with a short breached password picks another short
  // password, hits "breached" again, and is never told the one rule that would actually let
  // them through. Order here is the whole guarantee: reverse these two and that regression is
  // silent, since every single-reason case still passes.
  if (isAuthWeakPasswordError(error)) {
    if (error.reasons.includes('length')) {
      return Copy.auth.error.passwordTooShort;
    }
    if (error.reasons.includes('pwned')) {
      return Copy.auth.error.passwordBreached;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return Copy.auth.error.invalidCredentials;
  }
  if (m.includes('already registered') || m.includes('already exists') || m.includes('user already')) {
    return Copy.auth.error.emailInUse;
  }
  if (m.includes('password should be at least')) {
    return Copy.auth.error.passwordTooShort;
  }
  return Copy.auth.error.generic;
}
