/**
 * Temporary, server-side all-users access override for the captain's comprehensive test pass.
 *
 * Set the edge-function secret `ALL_USERS_UNLIMITED_ACCESS=true` to make every authenticated
 * account behave as Elite with unlimited analysis-count quota. Leave it unset (or set it to any
 * value other than the exact word `true`, case-insensitive) to use the normal subscription,
 * quota, anti-farm, and frame-cap rules.
 *
 * This is deliberately a flag ON TOP of the hardened entitlement system. The normal
 * `reserve_analysis` and `pace_quota_status` RPCs remain unchanged; when enabled, the edge
 * functions explicitly select narrowly-scoped wrapper RPCs added by
 * `20260807090000_all_users_unlimited_access_override.sql`. Turning this flag off therefore
 * restores the original enforcement path without a rollback or data rewrite.
 *
 * Server-only: never expose this as `EXPO_PUBLIC_*` or read it in the Expo client.
 */
export const ALL_USERS_UNLIMITED_ACCESS_ENV = 'ALL_USERS_UNLIMITED_ACCESS';

/** Strict opt-in: accidental values such as `1`, `yes`, or a typo must fail closed. */
export function isAllUsersUnlimitedAccess(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}
