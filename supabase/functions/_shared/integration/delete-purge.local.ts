/**
 * Issue #59 — proof, against a REAL local Postgres AND real Storage (issue #92's local Docker
 * stack), that deleting an analysis or an account leaves ZERO orphaned objects in the `media`
 * bucket. `_shared/__tests__/delete-account.deno.test.ts` already proves the CONTRACT (ordering,
 * idempotency, recursion, failure atomicity) against fakes — its own header says the real-Postgres
 * half is "deliberately still open" and points here. The property these fakes cannot prove: that
 * two different systems (Postgres rows and Storage objects) actually agree once bytes are really
 * written and really removed.
 *
 * THE ASSERTION IS FROM THE STORAGE SIDE, PER ISSUE #59: "list the bucket prefix after the delete
 * and assert it is empty" — never "assert the row is gone", which is the tempting test that passes
 * even while #3 (or V1's flat `delete-user`) is fully present. Every assertion below calls
 * `storage.list()` again, independently, after each delete — never trusting the deleted function's
 * own return value as the proof.
 *
 * Uses the SAME production client factories the real edge functions call
 * (`createDeleteAnalysisDeps`/`createDeleteAccountDeps`), pointed at the local stack via
 * `SUPABASE_URL`/`SUPABASE_SECRET_KEYS` — so this exercises the actual purge code, not a
 * reimplementation of it.
 *
 * Run via `npm run test:edge:local` (issue #92's local stack must be up — see this directory's
 * README). Not run by `npm test`/`deno test`'s default discovery — see quota-rpc.local.ts's header
 * for the naming convention this follows.
 */
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { createTestUser, deleteTestUser, FAKE_JPEG_BYTES, serviceRoleClient } from './client.ts';
import { deleteAnalysis } from '../delete-analysis.ts';
import { createDeleteAnalysisDeps } from '../delete-analysis-client.ts';
import { deleteAccount } from '../delete-account.ts';
import { createDeleteAccountDeps } from '../delete-account-client.ts';

const MEDIA_BUCKET = 'media';

async function reserve(userId: string, idempotencyKey: string) {
  const client = serviceRoleClient();
  const { data, error } = await client.rpc('reserve_analysis', {
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_media_type: 'photo',
    p_frame_count: 1,
  });
  if (error) throw new Error(`reserve_analysis failed: ${error.message}`);
  return data as { id: string };
}

/** Uploads `count` real JPEG objects under `{userId}/{analysisId}/`, mirroring the production
 * `{user_id}/{analysis_id}/frame-NN.jpg` layout — deliberately at least 2 objects per analysis, so
 * a flat (non-recursive) `list()` would already fail to account for them (the exact trap
 * `docs/privacy-checklist-m7.md` names). */
async function uploadFrames(userId: string, analysisId: string, count: number): Promise<string[]> {
  const client = serviceRoleClient();
  const paths: string[] = [];
  for (let i = 1; i <= count; i += 1) {
    const path = `${userId}/${analysisId}/frame-${i}.jpg`;
    const { error } = await client.storage.from(MEDIA_BUCKET).upload(path, FAKE_JPEG_BYTES, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (error) throw new Error(`Failed to upload test frame "${path}": ${error.message}`);
    paths.push(path);
  }
  return paths;
}

async function listPrefix(prefix: string): Promise<string[]> {
  const client = serviceRoleClient();
  const { data, error } = await client.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Failed to list prefix "${prefix}": ${error.message}`);
  return (data ?? []).map((entry) => entry.name);
}

async function rowExists(table: 'analyses' | 'profiles' | 'subscriptions' | 'consents', userId: string): Promise<boolean> {
  const client = serviceRoleClient();
  const column = table === 'profiles' ? 'id' : 'user_id';
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true }).eq(column, userId);
  if (error) throw new Error(`Failed to query "${table}": ${error.message}`);
  return (count ?? 0) > 0;
}

Deno.test('DELETE analysis: purges every frame under {user}/{analysis}/, independently verified from the Storage side', async () => {
  const admin = serviceRoleClient();
  const userId = await createTestUser(admin, 'delete-analysis');
  try {
    const { id: analysisId } = await reserve(userId, `delete-analysis-${crypto.randomUUID()}`);
    const uploaded = await uploadFrames(userId, analysisId, 2);
    assertEquals((await listPrefix(`${userId}/${analysisId}/`)).length, 2, 'setup: frames should exist before delete');

    const { analyses, storage } = createDeleteAnalysisDeps();
    const result = await deleteAnalysis(analyses, storage, { analysisId, callerUserId: userId });

    assertEquals(result.outcome, 'deleted');
    // Re-list independently — never trust deleteAnalysis's own purgedObjectCount as the proof.
    const remaining = await listPrefix(`${userId}/${analysisId}/`);
    assertEquals(remaining, [], `expected zero objects after delete, found: ${JSON.stringify(remaining)}`);
    assert(uploaded.length === 2, 'sanity: two frames were actually uploaded pre-delete');
  } finally {
    await deleteTestUser(admin, userId);
  }
});

Deno.test('DELETE analysis: retrying a delete on an already-deleted analysis is a safe no-op, not an error', async () => {
  const admin = serviceRoleClient();
  const userId = await createTestUser(admin, 'delete-analysis-retry');
  try {
    const { id: analysisId } = await reserve(userId, `delete-analysis-retry-${crypto.randomUUID()}`);
    await uploadFrames(userId, analysisId, 1);

    const { analyses, storage } = createDeleteAnalysisDeps();
    const first = await deleteAnalysis(analyses, storage, { analysisId, callerUserId: userId });
    assertEquals(first.outcome, 'deleted');
    assertEquals((first as { alreadyDeleted: boolean }).alreadyDeleted, false);

    const retry = await deleteAnalysis(analyses, storage, { analysisId, callerUserId: userId });
    assertEquals(retry.outcome, 'deleted');
    assertEquals((retry as { alreadyDeleted: boolean }).alreadyDeleted, true);
    assertEquals(await listPrefix(`${userId}/${analysisId}/`), []);
  } finally {
    await deleteTestUser(admin, userId);
  }
});

Deno.test('DELETE account: purges every prefix under {user}/, across MULTIPLE analyses, verified from the Storage side', async () => {
  const admin = serviceRoleClient();
  const userId = await createTestUser(admin, 'delete-account');
  try {
    // A pro subscription (limit 10, not free's lifetime limit of 1) so both reserves below succeed
    // as real rows — what this test needs is real Storage objects under two distinct
    // {analysis_id}/ sub-prefixes of the SAME account, the exact nested layout a flat,
    // non-recursive list cannot see.
    const { error: subError } = await admin
      .from('subscriptions')
      .insert({ user_id: userId, tier: 'pro', status: 'active', purchased_at: new Date().toISOString() });
    if (subError) throw new Error(`failed to seed subscription: ${subError.message}`);

    const { id: analysisA } = await reserve(userId, `delete-account-a-${crypto.randomUUID()}`);
    const { id: analysisB } = await reserve(userId, `delete-account-b-${crypto.randomUUID()}`);
    await uploadFrames(userId, analysisA, 2);
    await uploadFrames(userId, analysisB, 2);
    assertEquals((await listPrefix(`${userId}/`)).length >= 2, true, 'setup: at least two sub-prefixes should exist');

    // Also prove the consent-trail purge decision (delete-account.ts's header) with a real row.
    const { error: consentError } = await admin
      .from('consents')
      .insert({ user_id: userId, consent_key: 'upload.health.v1', granted: true });
    if (consentError) throw new Error(`failed to seed consent: ${consentError.message}`);
    assertEquals(await rowExists('consents', userId), true, 'setup: consent row should exist before delete');

    const { rows, storage, auth } = createDeleteAccountDeps();
    const result = await deleteAccount(rows, storage, auth, { userId });

    assertEquals(result.outcome, 'deleted');
    assert('purgedObjectCount' in result && result.purgedObjectCount >= 4, `expected >=4 purged objects, got: ${JSON.stringify(result)}`);

    // Independent re-verification from the Storage side — the whole point of #59.
    const remaining = await listPrefix(`${userId}/`);
    assertEquals(remaining, [], `expected zero objects under the account prefix, found: ${JSON.stringify(remaining)}`);

    // Rows: profile (and its cascade to analyses/subscriptions) and the explicit consent purge.
    assertEquals(await rowExists('profiles', userId), false);
    assertEquals(await rowExists('analyses', userId), false);
    assertEquals(await rowExists('consents', userId), false);

    // The auth user itself is gone.
    const { data: userLookup } = await admin.auth.admin.getUserById(userId);
    assertEquals(userLookup?.user ?? null, null);
  } finally {
    // Best-effort: if the test failed before the account was actually deleted, still clean up.
    await deleteTestUser(admin, userId);
  }
});

Deno.test('DELETE account: retrying on an already-deleted account converges instead of erroring', async () => {
  const admin = serviceRoleClient();
  const userId = await createTestUser(admin, 'delete-account-retry');

  const { rows, storage, auth } = createDeleteAccountDeps();
  const first = await deleteAccount(rows, storage, auth, { userId });
  assertEquals(first.outcome, 'deleted');

  // The account (and its auth.users row) is now genuinely gone. A retry with the same userId must
  // still converge safely — every step (list-and-remove on an already-empty prefix, deleting
  // already-absent rows, deleting an already-absent auth user) is documented as idempotent.
  const retry = await deleteAccount(rows, storage, auth, { userId });
  assertEquals(retry.outcome, 'deleted');
  assertEquals((retry as { purgedObjectCount: number }).purgedObjectCount, 0);
  assertEquals((retry as { profileExisted: boolean }).profileExisted, false);
});
