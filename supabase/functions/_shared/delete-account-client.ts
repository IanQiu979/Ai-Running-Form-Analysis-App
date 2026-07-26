// Deno-only Supabase client factory for `POST /functions/v1/delete-account` (issue #58).
// Imported only by `supabase/functions/delete-account/index.ts` — never by `delete-account.ts` or
// its tests, which is what keeps that orchestration logic Deno/Jest-portable. Same split, and same
// reason, as `ai-guard.ts`/`ai-guard-client.ts` and `delete-analysis.ts`/`delete-analysis-client.ts`:
// a thin factory over `Deno.env`/`npm:` globals that only exist at edge-function runtime, with
// nothing pure left in it to unit-test. NOT typechecked by `npm run typecheck` (see `tsconfig.json`'s
// `exclude` for the whole `supabase/functions` tree); IS checked by `deno check`
// (`npm run typecheck:edge`).
//
// SERVICE-ROLE KEY, NON-NEGOTIABLE. Two of the three things this endpoint does are unreachable
// without it: removing objects from the private `media` bucket (`storage.objects` grants the client
// SELECT only — issue #88) and removing the `auth.users` row (only the Auth **admin** API can, and
// it authenticates with the secret key). `authenticated` also holds no DELETE grant on
// `public.analyses` (#2) or `public.consents` (#68's grant hardening). None of this can be a client
// operation; all of it must be a server one.
//
// CLAUDE.md: "Supabase auto-injects SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, and
// SUPABASE_SECRET_KEYS into edge functions at runtime. Never set these by hand." The secret-key env
// var is plural (key-rotation-safe) — getSecretKey() accepts either a bare key string or a JSON
// array and always uses the first entry, mirroring `ai-guard-client.ts`/`delete-analysis-client.ts`
// (kept as a separate copy here, as those two already do to each other, to keep this file's blast
// radius — and any merge collision with the parallel work also touching `_shared/` — limited to
// this one file).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.2';
import type { AccountRows, AuthAdmin } from './delete-account.ts';
import type { StorageBucket } from './delete-analysis.ts';
import { getSecretKey } from './supabase-keys.ts';

const MEDIA_BUCKET = 'media';

/** True for the "that user doesn't exist" response — an already-deleted account, i.e. a converged retry. */
function isUserNotFound(error: { status?: number; message: string }): boolean {
  return error.status === 404 || /user not found/i.test(error.message);
}

export function createDeleteAccountDeps(): { rows: AccountRows; storage: StorageBucket; auth: AuthAdmin } {
  const url = Deno.env.get('SUPABASE_URL');
  if (!url) {
    throw new Error('SUPABASE_URL is not set in the edge function environment');
  }
  const client: SupabaseClient = createClient(url, getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows: AccountRows = {
    async deleteConsents(userId) {
      // `.select('id')` is what makes the count real rather than assumed: PostgREST returns the
      // deleted rows, so `consentEventsPurged` in the response and the logs is the number of Art. 9
      // consent events actually destroyed — the observable half of this function's purge-the-consent-
      // trail decision (see `delete-account.ts`'s header). Zero rows is a success, not an error: an
      // account that never consented, or a converging retry, both land here.
      const { data, error } = await client.from('consents').delete().eq('user_id', userId).select('id');
      if (error) {
        throw new Error(`Failed to delete consent records: ${error.message}`);
      }
      return { deletedCount: data?.length ?? 0 };
    },

    async deleteProfile(userId) {
      // Cascades to `subscriptions` and `analyses` (both `references profiles(id) on delete
      // cascade`). `ai_call_log` is deliberately `on delete set null` on both FKs — the spend ledger
      // survives, stripped of every column that could identify anyone
      // (`20260712210000_ai_spend_guardrails.sql`). Do not "fix" that.
      const { data, error } = await client.from('profiles').delete().eq('id', userId).select('id');
      if (error) {
        throw new Error(`Failed to delete profile: ${error.message}`);
      }
      return { deleted: (data?.length ?? 0) > 0 };
    },
  };

  const storage: StorageBucket = {
    async list(prefix, { limit, offset }) {
      const { data, error } = await client.storage.from(MEDIA_BUCKET).list(prefix, {
        limit,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) {
        throw new Error(`Failed to list storage prefix "${prefix}": ${error.message}`);
      }
      // Supabase Storage represents a pseudo-directory as an entry with `id: null` — the exact
      // signal `delete-analysis.ts`'s `purgePrefix` recursion depends on to avoid the nested-prefix
      // trap. Getting this mapping wrong is how a purge reports success while deleting nothing.
      return (data ?? []).map((entry) => ({ name: entry.name, isFolder: entry.id === null }));
    },

    async remove(paths) {
      const { error } = await client.storage.from(MEDIA_BUCKET).remove(paths);
      return { error: error ? error.message : null };
    },
  };

  const auth: AuthAdmin = {
    async deleteUser(userId) {
      // Hard delete (`shouldSoftDelete` defaults to false). A soft delete would leave the row in
      // `auth.users` with the email still on it — which is not deletion, and would fail both App
      // Store Guideline 5.1.1(v) and the privacy policy's "removes everything".
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error && !isUserNotFound(error)) {
        throw new Error(`Failed to delete the auth user: ${error.message}`);
      }
      // An already-absent user is a converged retry, not a failure — swallowed on purpose.
    },
  };

  return { rows, storage, auth };
}
