/**
 * Server-only content identity for pinning one analyze-form verdict to one accepted input.
 *
 * This value is persistent media-equality metadata. It may be passed only to the service-role
 * reservation RPC and stored in its service-only canonical-result claim table. Never put it in a
 * response, owner-readable analysis row, Storage path, analytics event, or log line.
 */
import type { PaceFrame, PaceFrameMediaType, PaceMediaKind } from './analyze-form-prompt.ts';

/**
 * Compatibility boundary for a reusable verdict.
 *
 * BUMP THIS before changing anything that can change the runner-visible analysis: model ID,
 * effort, thinking configuration, prompt assembly or wording, certified knowledge, output schema,
 * validation/normalization, fallback behavior, or safety policy. A bump deliberately permits a
 * fresh verdict; failing to bump would silently reuse a result produced under obsolete semantics.
 */
// 2026-09-16 (#212): the stop-running note is no longer composed into `feedback`; it travels only
// on `safety` and the prompt tells the model so. Same verdict content, different wire shape — a
// pinned verdict from before this date would replay the composed string, so it may not be reused.
export const ANALYZE_FORM_ANALYZER_REVISION = 'analyze-form/2026-09-16-v1' as const;

export interface AnalyzeFormIdentity {
  input_fingerprint: string;
  analyzer_revision: typeof ANALYZE_FORM_ANALYZER_REVISION;
}

export interface AnalyzeFormIdentityEvidence {
  /** Must be the subject of the verified JWT, never a client body field. */
  authenticatedUserId: string;
  media: PaceMediaKind;
  /** Frames in accepted capture order. */
  frames: readonly PaceFrame[];
}

const FINGERPRINT_DOMAIN = 'pace/analyze-form/input-fingerprint/v1';
const TEXT_ENCODER = new TextEncoder();
const ACCEPTED_FRAME_MEDIA_TYPES: readonly PaceFrameMediaType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Derives the exact JSON object accepted by `reserve_analysis`'s `p_analysis_identity` argument.
 * Tier and client idempotency are intentionally absent: the database adds its current,
 * server-derived tier to the reuse key, while idempotency identifies a transport attempt rather
 * than the submitted evidence.
 */
export async function deriveAnalyzeFormIdentity(
  evidence: AnalyzeFormIdentityEvidence
): Promise<AnalyzeFormIdentity> {
  if (typeof evidence.authenticatedUserId !== 'string' || evidence.authenticatedUserId.length === 0) {
    throw new Error('authenticatedUserId must be a non-empty server-authenticated user ID');
  }
  if (evidence.media !== 'photo' && evidence.media !== 'video') {
    throw new Error('media must be photo or video');
  }
  if (!Array.isArray(evidence.frames) || evidence.frames.length === 0) {
    throw new Error('frames must be a non-empty ordered array');
  }

  const canonical = new CanonicalFields();
  canonical.text('domain', FINGERPRINT_DOMAIN);
  canonical.text('analyzer-revision', ANALYZE_FORM_ANALYZER_REVISION);
  // Including the authenticated subject makes equal media unlinkable across users even if the
  // database value is exposed. The DB also scopes reuse by user as a separate authorization wall.
  canonical.text('authenticated-user', evidence.authenticatedUserId);
  canonical.text('media-kind', evidence.media);
  canonical.uint32('ordered-frame-count', evidence.frames.length);

  for (let index = 0; index < evidence.frames.length; index += 1) {
    const frame = evidence.frames[index];
    if (!ACCEPTED_FRAME_MEDIA_TYPES.includes(frame.mediaType)) {
      throw new Error(`frame ${index} has an unsupported media type`);
    }
    if (
      typeof frame.requestedTimestampMs !== 'number' ||
      !Number.isFinite(frame.requestedTimestampMs) ||
      frame.requestedTimestampMs < 0
    ) {
      throw new Error(`frame ${index} has an invalid timestamp`);
    }

    canonical.uint32('frame-index', index);
    canonical.text('frame-media-type', frame.mediaType);
    canonical.float64('frame-requested-timestamp-ms', frame.requestedTimestampMs);
    canonical.bytes('frame-decoded-bytes', decodeCanonicalBase64(frame.base64, index));
  }

  const canonicalBytes = canonical.finish();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', canonicalBytes.buffer));
  return {
    input_fingerprint: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    analyzer_revision: ANALYZE_FORM_ANALYZER_REVISION,
  };
}

/** Every field carries its own domain label and byte length, so no concatenation ambiguity can
 * turn two different semantic inputs into the same preimage. */
class CanonicalFields {
  readonly #chunks: Uint8Array[] = [];
  #byteLength = 0;

  text(label: string, value: string): void {
    this.bytes(label, TEXT_ENCODER.encode(value));
  }

  uint32(label: string, value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error(`${label} is outside the canonical uint32 range`);
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, false);
    this.bytes(label, bytes);
  }

  float64(label: string, value: number): void {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, false);
    this.bytes(label, bytes);
  }

  bytes(label: string, value: Uint8Array): void {
    const labelBytes = TEXT_ENCODER.encode(label);
    this.push(uint32Bytes(labelBytes.length), labelBytes, uint32Bytes(value.length), value);
  }

  finish(): Uint8Array<ArrayBuffer> {
    const joined = new Uint8Array(new ArrayBuffer(this.#byteLength));
    let offset = 0;
    for (const chunk of this.#chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }

  private push(...chunks: Uint8Array[]): void {
    for (const chunk of chunks) {
      this.#chunks.push(chunk);
      this.#byteLength += chunk.length;
    }
  }
}

function uint32Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('canonical field length exceeds uint32');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/** Decode before hashing. Padding and ASCII wrapping are representation details; invalid length,
 * alphabet, padding, or non-zero trailing pad bits are malformed and fail closed. */
function decodeCanonicalBase64(base64: string, frameIndex: number): Uint8Array {
  const malformed = (): Error => new Error(`frame ${frameIndex} contains malformed base64`);
  if (typeof base64 !== 'string') throw malformed();
  const compact = base64.replace(/[\t\n\f\r ]/g, '');
  if (compact.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) throw malformed();

  const paddingLength = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  const core = paddingLength === 0 ? compact : compact.slice(0, -paddingLength);
  const remainder = core.length % 4;
  if (remainder === 1) throw malformed();
  const expectedPadding = remainder === 2 ? 2 : remainder === 3 ? 1 : 0;
  if (paddingLength !== 0 && paddingLength !== expectedPadding) throw malformed();

  // `atob` accepts aliases with non-zero unused bits (for example `Zh==` for byte `f`). Treat
  // those as malformed rather than creating multiple accepted spellings beyond padding/wrapping.
  const finalValue = BASE64_ALPHABET.indexOf(core[core.length - 1]);
  if (
    finalValue < 0 ||
    (remainder === 2 && (finalValue & 0x0f) !== 0) ||
    (remainder === 3 && (finalValue & 0x03) !== 0)
  ) {
    throw malformed();
  }

  const normalized = core + '='.repeat(expectedPadding);
  let binary: string;
  try {
    binary = atob(normalized);
  } catch {
    throw malformed();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
