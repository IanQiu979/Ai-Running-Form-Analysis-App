// Shared setup for the local-Postgres/Storage integration tests in this directory (issues #49,
// #59, #92). NOT imported by anything under `_shared/__tests__/` — those are fast, mock-backed
// unit tests that run in the normal commit gate. Everything in `_shared/integration/` requires a
// real running local Supabase stack (`supabase start`, issue #92) and is deliberately excluded
// from both `deno test`'s default discovery and Jest's — see this directory's README for why and
// how to run these.
//
// SUPABASE_URL / SUPABASE_SECRET_KEYS here are the same two env vars
// `delete-account-client.ts`/`delete-analysis-client.ts` read in production (CLAUDE.md: "Supabase
// auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and SUPABASE_SECRET_KEYS into edge
// functions at runtime"). Locally, `npm run test:edge:local` sets them from `supabase status -o
// env` before invoking `deno test`, so this file — and the production client factories it shares
// with the app — never hardcodes a local URL or key.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(
      `${name} is not set. Run these tests via "npm run test:edge:local" (issue #92's local ` +
        `stack must be up: "supabase start"), not "deno test" directly.`
    );
  }
  return value;
}

/** A fresh service-role client per call — mirrors how each production edge-function invocation
 * builds its own (`createDeleteAccountDeps`/`createDeleteAnalysisDeps`), and keeps one test's
 * client from leaking auth state into another's. */
export function serviceRoleClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SECRET_KEYS');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

let counter = 0;

/** A syntactically-valid, collision-resistant email for a throwaway test user. */
export function testEmail(label: string): string {
  counter += 1;
  return `pace-integration-${label}-${Date.now()}-${counter}@example.test`;
}

/** Creates a real `auth.users` row via the admin API — the `on_auth_user_created` trigger
 * (`20260711150000_profiles.sql`) fires for real and creates the matching `profiles` row, exactly
 * as it does for a real signup. Returns the new user's id. */
export async function createTestUser(client: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await client.auth.admin.createUser({
    email: testEmail(label),
    password: 'Sup3rSecret!1',
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create test user "${label}": ${error?.message ?? 'no user returned'}`);
  }
  return data.user.id;
}

/** Best-effort teardown — swallows errors so one test's cleanup failure doesn't mask another
 * test's assertion failure. Deleting the auth user cascades profiles -> subscriptions/analyses
 * (see `20260711150000_profiles.sql` / `20260711150200_analyses.sql`), so this alone reclaims
 * every row a test created; any Storage objects a test uploaded directly (bypassing
 * reserve_analysis) must still be removed by the test itself before calling this. */
export async function deleteTestUser(client: SupabaseClient, userId: string): Promise<void> {
  try {
    await client.auth.admin.deleteUser(userId);
  } catch {
    // Best-effort cleanup only; the assertions above already ran.
  }
}

/** Tiny valid JPEG payload (1x1 pixel) — small enough to stay well under the 'media' bucket's
 * 5MB per-object limit and its 'image/jpeg'-only allowed_mime_types
 * (`20260711150500_media_storage_bucket.sql`). */
export const FAKE_JPEG_BYTES = Uint8Array.from(
  atob(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFQABAQAAAAAA' +
      'AAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/' +
      'xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
  ),
  (c) => c.charCodeAt(0)
);
