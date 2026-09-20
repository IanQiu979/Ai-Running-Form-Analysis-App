// `POST /functions/v1/record-age-band` (2026-09-20) — the one-time age choice for an account an
// OAuth provider created; see `_shared/record-age-band.ts`'s header for the contract and why it
// exists. This file is the HTTP/env glue only: JWT → caller id (same fail-closed
// `resolveCallerUserId` shape as `quota-status/index.ts`), then the portable handler with the
// secret-key recorder injected.
import { createClient } from 'npm:@supabase/supabase-js@2.110.2';
import { createAgeBandRpc } from '../_shared/age-band-recorder-client.ts';
import { createAgeBandRecorder } from '../_shared/age-band-recorder.ts';
import { errorClassOf, hashUserId, logEvent, newRequestId } from '../_shared/log.ts';
import { handleRecordAgeBand } from '../_shared/record-age-band.ts';
import { getPublishableKey, getSupabaseUrl } from '../_shared/supabase-keys.ts';

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Verifies the caller's JWT and returns their user id; throws on anything but a valid session. */
async function resolveCallerUserId(authHeader: string): Promise<string> {
  const authClient = createClient(getSupabaseUrl(), getPublishableKey(), {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await authClient.auth.getUser();
  if (error || !data.user) {
    throw new Error('Invalid or expired session');
  }
  return data.user.id;
}

Deno.serve(async (req) => {
  const requestId = newRequestId();
  const startedAt = Date.now();

  if (req.method !== 'POST') {
    return jsonResponse(405, { error: 'Only POST is supported on this route.', code: 'method_not_allowed' });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse(401, { error: 'Missing Authorization header.', code: 'unauthorized' });
  }

  let callerUserId: string;
  try {
    callerUserId = await resolveCallerUserId(authHeader);
  } catch {
    return jsonResponse(401, { error: 'Invalid or expired session.', code: 'unauthorized' });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return jsonResponse(400, { error: 'Request body must be { ageBand, guardianConsent? }.', code: 'invalid_body' });
  }

  try {
    const result = await handleRecordAgeBand(
      { ageBandRecorder: createAgeBandRecorder(createAgeBandRpc()) },
      callerUserId,
      rawBody,
    );
    logEvent({
      level: result.status === 200 ? 'info' : result.status >= 500 ? 'error' : 'warn',
      fn: 'record-age-band',
      event: result.status === 200 ? 'age_band_recorded' : 'age_band_rejected',
      requestId,
      userId: await hashUserId(callerUserId),
      code: result.status === 200 ? undefined : result.body.code,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(result.status, { ...result.body });
  } catch (err) {
    logEvent({
      level: 'error',
      fn: 'record-age-band',
      event: 'age_band_failed',
      requestId,
      userId: await hashUserId(callerUserId),
      errorClass: errorClassOf(err),
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(500, { error: 'Your age choice could not be saved. Please try again.', code: 'age_band_unavailable' });
  }
});
