/**
 * Sign-out (issue #27) — the fix for `supabase.auth.signOut()` being fire-and-forget.
 *
 * THE BUG: `app/(tabs)/index.tsx` called `supabase.auth.signOut()` with no `await` and no `.catch`,
 * discarding the returned `{ error }`. A failed **global** token revoke therefore left server-side
 * refresh tokens alive while the user was shown a clean, successful sign-out. On a shared or stolen
 * device, "signed out" is the one claim that has to be true.
 *
 * THE CONSTRAINT THAT SHAPES THE FIX: auth-js clears the LOCAL session regardless of whether the
 * server call succeeded (verified against `@supabase/auth-js`'s `_signOut`). So there is no
 * "cancel the sign-out and keep the user here" branch available to us — by the time this function
 * returns, the local session is gone either way, `onAuthStateChange` has fired, and
 * `app/_layout.tsx`'s `Stack.Protected` guard has already begun routing back to `(auth)`.
 *
 * That rules out two tempting designs:
 *   - "Show an inline error on the Settings screen." The screen is being unmounted by the route
 *     guard at that exact moment; an inline error would render into a dying tree and never be
 *     read. This is why `app/settings.tsx` surfaces the failure through a native `Alert`, which
 *     outlives the screen.
 *   - "Offer Retry." There is no local session left to authenticate a second revoke attempt with,
 *     so a retry from this device would be theatre. The honest recovery is to sign in again — which
 *     mints a fresh session and lets a subsequent sign-out revoke cleanly — and the copy says so.
 *
 * So what remains is to tell the truth: you ARE signed out on this device, and your other sessions
 * may still be live. That is what `ok: false` means here.
 *
 * This lives in `lib/` rather than in the screen so it can be unit-tested (screens are not, per
 * CLAUDE.md § Testing) — the silent-failure regression this exists to prevent is exactly the kind
 * that stays green in a happy-path test.
 */
import { supabase } from './supabase';

/**
 * The outcome of a sign-out attempt.
 *
 * `ok: true`  — the local session is cleared AND the server revoked the tokens. Fully signed out.
 * `ok: false` — the local session is cleared (auth-js does this unconditionally) but the global
 *               revoke did NOT land. Other sessions may still be active. The user is signed out on
 *               THIS device and must be told the rest of the truth.
 *
 * Note there is deliberately no third "not signed out at all" state: it does not exist. Any path
 * through `supabase.auth.signOut()` — success, returned error, or thrown exception — ends with the
 * local session cleared, and modelling a state the system cannot actually be in would invite a
 * caller to write a branch that never runs.
 */
export type SignOutResult = { ok: true } | { ok: false; reason: 'globalRevokeFailed' };

/**
 * Signs out, awaiting the call and reporting whether the global revoke actually succeeded.
 *
 * NEVER REJECTS. A thrown exception (offline, DNS failure, an auth-js internal throw) is folded
 * into the same `{ ok: false }` as a returned `{ error }`, because the user-facing truth is
 * identical in both cases — local session gone, server-side tokens possibly alive — and because
 * an unhandled rejection is one of the two defects issue #27 filed. Callers do not need a
 * try/catch, and must not treat this as a promise that can fail.
 */
export async function signOut(): Promise<SignOutResult> {
  try {
    const { error } = await supabase.auth.signOut();

    if (error) {
      return { ok: false, reason: 'globalRevokeFailed' };
    }

    return { ok: true };
  } catch {
    // Reached when the call throws rather than resolving with an `{ error }` — e.g. no
    // connectivity. auth-js has still cleared the local session by this point, so this is the
    // same user-facing state as the `error` branch above, not a distinct one.
    return { ok: false, reason: 'globalRevokeFailed' };
  }
}
