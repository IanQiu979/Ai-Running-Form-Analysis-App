/**
 * Resolves the private frames stored for one delivered analysis into short-lived display URLs.
 * Stored paths are treated as untrusted row data: only the exact owner/analysis namespace and
 * server-generated `frame-NN.jpg` names are ever handed to Storage.
 */
import { PACE_FRAME_CAP } from '@shared/pace';

import { FRAME_STRIP_SIGNED_URL_TTL_SECONDS, MEDIA_BUCKET } from './history';
import { supabase } from './supabase';

/** No tier may send more frames than Elite, so no row can name more than this many. */
const MAX_ANALYSIS_FRAMES = PACE_FRAME_CAP.elite;

export type AnalysisFrameSlot =
  | { path: string; uri: null; status: 'loading' }
  | { path: string; uri: string; status: 'ready' }
  | { path: string; uri: null; status: 'unavailable' };

function canonicalFramePaths(userId: string, analysisId: string): Set<string> {
  // Postgres renders uuids lower-case in the stored paths; the route id is matched
  // case-insensitively, so an upper-case link must not fail every frame closed.
  const owner = userId.toLowerCase();
  const analysis = analysisId.toLowerCase();
  return new Set(
    Array.from(
      { length: MAX_ANALYSIS_FRAMES },
      (_, index) => `${owner}/${analysis}/frame-${String(index + 1).padStart(2, '0')}.jpg`
    )
  );
}

/** Builds the immediate strip state without contacting Storage. */
export function buildPendingAnalysisFrameSlots(
  mediaPaths: readonly string[],
  userId: string,
  analysisId: string
): AnalysisFrameSlot[] {
  const allowedPaths = canonicalFramePaths(userId, analysisId);
  return mediaPaths.slice(0, MAX_ANALYSIS_FRAMES).map((path) =>
    allowedPaths.has(path)
      ? { path, uri: null, status: 'loading' }
      : { path, uri: null, status: 'unavailable' }
  );
}

/**
 * Signs the canonical stored paths in one batch and returns slots in their original row order.
 * A missing object, partial response, batch error, or thrown network failure affects only the
 * corresponding display state; private-media resolution never rejects.
 */
export async function signAnalysisFrames(
  mediaPaths: readonly string[],
  userId: string,
  analysisId: string
): Promise<AnalysisFrameSlot[]> {
  const pendingSlots = buildPendingAnalysisFrameSlots(mediaPaths, userId, analysisId);
  const validPaths = pendingSlots
    .filter((slot): slot is Extract<AnalysisFrameSlot, { status: 'loading' }> => slot.status === 'loading')
    .map((slot) => slot.path);

  if (validPaths.length === 0) return pendingSlots;

  try {
    const { data, error } = await supabase.storage
      .from(MEDIA_BUCKET)
      .createSignedUrls(validPaths, FRAME_STRIP_SIGNED_URL_TTL_SECONDS);

    if (error || !data) {
      return pendingSlots.map((slot) =>
        slot.status === 'loading' ? { path: slot.path, uri: null, status: 'unavailable' } : slot
      );
    }

    const signedUrlsByPath = new Map<string, string>();
    for (const entry of data) {
      if (!entry.error && entry.path && entry.signedUrl) {
        signedUrlsByPath.set(entry.path, entry.signedUrl);
      }
    }

    return pendingSlots.map((slot) => {
      if (slot.status === 'unavailable') return slot;
      const uri = signedUrlsByPath.get(slot.path);
      return uri
        ? { path: slot.path, uri, status: 'ready' }
        : { path: slot.path, uri: null, status: 'unavailable' };
    });
  } catch {
    return pendingSlots.map((slot) =>
      slot.status === 'loading' ? { path: slot.path, uri: null, status: 'unavailable' } : slot
    );
  }
}
