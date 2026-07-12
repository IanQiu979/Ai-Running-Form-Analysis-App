/**
 * Client-side mirrors of a server-enforced rule — not the authority. CLAUDE.md's "no business
 * rules in the client" still holds: nothing here changes what Supabase accepts, it only lets a
 * UX pre-check and its copy agree with each other instead of drifting independently.
 */

/**
 * Must match `minimum_password_length` in `supabase/config.toml` (currently 8) — that value is
 * the ONLY real authority on the rule. This constant exists so `app/(auth)/sign-in.tsx`'s
 * sign-up pre-check and `constants/copy.ts`'s `auth.password.rule` / `auth.error.passwordTooShort`
 * strings derive from one number instead of three independently-typed literals (issue #9). If
 * `config.toml`'s value ever changes, treat this constant as changing in the same commit — it
 * will not update itself, and nothing enforces the link except this comment.
 */
export const PASSWORD_MIN_LENGTH = 8;
