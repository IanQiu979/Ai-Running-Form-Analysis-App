/**
 * Auth constants that are neither theme tokens (`constants/theme.ts`) nor copy-deck strings
 * (`constants/copy.ts`), but are consumed by both — split out rather than jammed into either.
 *
 * `PASSWORD_MIN_LENGTH` is the single source for the "8" that used to be typed three times
 * (issue #9): `supabase/config.toml`'s `minimum_password_length`, the sign-up pre-check in
 * `app/(auth)/sign-in.tsx`, and the "at least 8 characters" copy in `constants/copy.ts`. This
 * constant CANNOT bind config.toml — a client bundle has no way to read, let alone enforce,
 * server config — so `minimum_password_length` remains the sole authority on the real rule.
 * If that value ever changes, this constant must change with it in the same commit, or the
 * client's pre-check and copy will silently drift from what the server actually enforces.
 */
export const PASSWORD_MIN_LENGTH = 8;
