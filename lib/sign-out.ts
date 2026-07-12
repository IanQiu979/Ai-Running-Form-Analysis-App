/**
 * Sign-out (issue #27) — the fix for `supabase.auth.signOut()` being fire-and-forget, and
 * (2026-07-13, a security-audit finding on PR #122, F3) the fix for a second bug the first fix
 * introduced by ruling out a state that turns out to be real.
 *
 * THE ORIGINAL BUG: `app/(tabs)/index.tsx` called `supabase.auth.signOut()` with no `await` and no
 * `.catch`, discarding the returned `{ error }`. A failed **global** token revoke therefore left
 * server-side refresh tokens alive while the user was shown a clean, successful sign-out.
 *
 * ⚠️ WHAT THIS FILE ORIGINALLY GOT WRONG, AND WHAT'S FIXED NOW: the first version of this fix
 * assumed exactly two outcomes — full success, or "the local session cleared but the global revoke
 * failed" — on the theory that auth-js clears the local session unconditionally. That is FALSE.
 * Verified against the installed `@supabase/auth-js` source (`GoTrueClient.js`'s `_signOut`,
 * ~line 3360):
 *
 * ```js
 * const { data, error: sessionError } = result;
 * if (sessionError && !isAuthSessionMissingError(sessionError)) {
 *     return this._returnResult({ error: sessionError });   // <- local session NOT cleared
 * }
 * ```
 *
 * `_useSession` (which `_signOut` calls first, to get the access token it needs for the server
 * revoke) takes this early return whenever the STORED session needs a refresh and that refresh
 * itself fails — concretely: an expired access token plus no connectivity, or an expired refresh
 * token. That is not a contrived edge case; it is what "the app has been backgrounded for a while,
 * you get on the subway, and then open Settings → Sign out" looks like. In that state, `signOut()`
 * returns an error and the LOCAL SESSION IS STILL FULLY INTACT — no `onAuthStateChange`, no
 * `Stack.Protected` redirect, nothing. The original version of this file reported that as "signed
 * out here, maybe not everywhere," which is a lie in exactly the scenario (a shared or stolen
 * device) this whole fix exists to get right: the user is not signed out ANYWHERE, and the app
 * would have said otherwise.
 *
 * So there are genuinely THREE outcomes, not two, and `signOut()` below re-checks
 * `supabase.auth.getSession()` after any failure to tell them apart, rather than assuming the local
 * session is gone just because the call didn't succeed:
 *
 *   1. Success — server revoke landed, local session cleared.
 *   2. `globalRevokeFailed` — the LOCAL session IS cleared (the common case: signOut() reached the
 *      server, which said no, and auth-js still tore down the local session per its normal path).
 *      The user is signed out on this device; other sessions may still be active. Retrying here
 *      would be theatre — there is no local session left to authenticate a second attempt with.
 *   3. `stillSignedIn` — the early-return case above. NOTHING happened: the user is still fully
 *      authenticated, here and everywhere. Retrying here is NOT theatre — the session that a retry
 *      would authenticate with is still sitting right there.
 *
 * This lives in `lib/` rather than in the screen so it can be unit-tested (screens are not, per
 * CLAUDE.md § Testing) — the silent-failure regression this exists to prevent, and the false
 * "you're safe" regression the first version of this fix nearly shipped, are exactly the kind that
 * stay green in a happy-path test.
 */
import { supabase } from './supabase';

/**
 * `ok: true`             — fully signed out: local session cleared AND the server revoked tokens.
 * `globalRevokeFailed`   — signed out on THIS device; other sessions may still be live. Not
 *                          retryable from here (no local session survives to retry with).
 * `stillSignedIn`        — NOT signed out anywhere. The attempt did not go through at all. A real
 *                          retry is available (the session it would authenticate with still exists).
 */
export type SignOutResult =
  | { ok: true }
  | { ok: false; reason: 'globalRevokeFailed' }
  | { ok: false; reason: 'stillSignedIn' };

/**
 * Signs out, awaiting the call and reporting exactly which of the three states above resulted.
 *
 * NEVER REJECTS. A thrown exception (offline, DNS failure, an auth-js internal throw) is folded
 * into the same disambiguation as a returned `{ error }` — both go through `hasLocalSession()`
 * below to find out which real state they left the user in. Callers do not need a try/catch, and
 * must not treat this as a promise that can fail.
 */
export async function signOut(): Promise<SignOutResult> {
  const succeeded = await attemptSignOut();
  if (succeeded) {
    return { ok: true };
  }

  // signOut() did not succeed (returned an error, or threw). That alone does not tell us whether
  // the local session survived — see this file's header — so ask, rather than assume.
  const stillSignedIn = await hasLocalSession();
  return stillSignedIn ? { ok: false, reason: 'stillSignedIn' } : { ok: false, reason: 'globalRevokeFailed' };
}

async function attemptSignOut(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.signOut();
    return !error;
  } catch {
    return false;
  }
}

/**
 * True if a local session still exists.
 *
 * Fails "true" (assume STILL signed in) on its own read error — the same fail-closed direction
 * `lib/consent.ts`'s `hasConsented` takes: when we cannot verify the dangerous claim, we must not
 * make it. Reporting "you're signed out" when we could not confirm it would be the exact false
 * all-clear this fix exists to prevent. Reporting "you might still be signed in" when the user
 * actually isn't costs them ten seconds of checking; the asymmetry is deliberate.
 */
async function hasLocalSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session !== null;
  } catch {
    return true;
  }
}
