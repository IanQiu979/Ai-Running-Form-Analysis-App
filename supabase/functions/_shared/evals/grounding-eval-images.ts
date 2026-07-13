/**
 * FIXTURE IMAGES for the #42 grounding harness — generated, not committed as binaries.
 *
 * WHY SYNTHETIC, AND WHAT THAT DOES AND DOES NOT BUY (read this before trusting a green run):
 *
 * This project has no consented, licensable photo or video of a real runner in the repo, and an
 * eval fixture set is exactly the wrong place to acquire one casually — uploaded media is Art. 9
 * health data here (CLAUDE.md), and a stock photo of a stranger's body committed to a public repo
 * is a licensing and privacy problem, not a test fixture. So the fixtures are drawn: a side-on
 * human figure rasterised from explicit joint coordinates, and a featureless field with nothing
 * in it at all.
 *
 * WHAT A DRAWN FIGURE CAN PROVE — and it is precisely what issue #42's gate asks for:
 *   - the assembled prompt carries the certified knowledge (no image needed at all);
 *   - the model returns the PACE contract: four pillars, parseable, scored or honestly null;
 *   - it NEVER emits a pillar the input cannot support (Cadence from one still — the input's
 *     frame count is what makes that true, not the pixels);
 *   - it NEVER fabricates a score for an input with nothing in it (the blank field);
 *   - it never invents a flag or drill outside the certified corpus;
 *   - the tier dial moves depth and only depth.
 * None of those depend on photorealism. They depend on the STRUCTURE of the input (one frame vs
 * five; a figure vs an empty field), which is exactly what these fixtures control.
 *
 * WHAT IT CANNOT PROVE: that the coaching JUDGEMENT is any good on a real human body — whether a
 * 72 for posture is the right 72. That needs real, consented clips with a coach's ground-truth
 * label, and it is a different (and much more expensive) eval than this one. Do not read a green
 * run here as "the analysis is accurate." Read it as "the analysis is grounded, structured, and
 * honest." See the report in `grounding-eval.results.json`.
 *
 * ZERO DEPENDENCIES, BY CONSTRUCTION. PNG is encoded here by hand (CRC32 + `CompressionStream`,
 * both of which Deno has natively) rather than by pulling an image library into
 * `supabase/functions/deno.json` — that file is shared with the deployed edge functions, and an
 * eval fixture has no business adding a dependency to the production deploy bundle.
 */

// -------------------------------------------------------------------------------------------
// PNG encoding — hand-rolled, no deps. Anthropic's vision API accepts image/png.
// -------------------------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG's IDAT wants zlib-wrapped deflate (RFC 1950) — which is what `CompressionStream('deflate')`
 * emits (`'deflate-raw'` would be the un-wrapped one, and would produce a corrupt PNG).
 *
 * The parameter is `Uint8Array<ArrayBuffer>`, not a bare `Uint8Array`: under `strict`, a bare
 * `Uint8Array` is `Uint8Array<ArrayBufferLike>`, which could be backed by a `SharedArrayBuffer` and
 * therefore does not satisfy `BufferSource`. Narrowing here (rather than copying the buffer at the
 * call site) keeps the encoder allocation-free. */
async function zlibDeflate(raw: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  void writer.write(raw);
  void writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  // The CRC covers the type AND the data, but not the length prefix.
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/** 8-bit truecolour RGB, no interlacing, one filter byte (0 = None) per scanline. */
export async function encodePng(width: number, height: number, rgb: Uint8Array): Promise<Uint8Array> {
  const stride = width * 3;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + stride)] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  // 10, 11, 12 = compression 0, filter 0, interlace 0 — all already zero.

  const idat = await zlibDeflate(raw);
  const chunks = [
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

/** Raw base64, NO `data:` prefix — `analyze-form-prompt.ts`'s frame guard rejects the prefix, and
 * so does the API. Chunked because spreading a 100KB array into `String.fromCharCode` blows the
 * call stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// -------------------------------------------------------------------------------------------
// A tiny rasteriser — discs and capsules, 2x supersampled so edges are not a staircase
// -------------------------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** All fixture geometry is in UNIT coordinates (0..1 of the canvas, y growing downward), so the
 * poses below read as anatomy rather than as pixel offsets and stay correct at any resolution. */
interface Point {
  x: number;
  y: number;
}

const SUPERSAMPLE = 2;

class Raster {
  private readonly w: number;
  private readonly h: number;
  private readonly px: Uint8Array;

  constructor(private readonly outW: number, private readonly outH: number, bg: Rgb) {
    this.w = outW * SUPERSAMPLE;
    this.h = outH * SUPERSAMPLE;
    this.px = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < this.w * this.h; i += 1) {
      this.px[i * 3] = bg.r;
      this.px[i * 3 + 1] = bg.g;
      this.px[i * 3 + 2] = bg.b;
    }
  }

  private plot(x: number, y: number, color: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.px[i] = color.r;
    this.px[i + 1] = color.g;
    this.px[i + 2] = color.b;
  }

  /** Filled circle, unit coords. Radius is expressed as a fraction of canvas WIDTH so a limb does
   * not go oval on a non-square canvas. */
  disc(center: Point, radius: number, color: Rgb): void {
    const cx = center.x * this.w;
    const cy = center.y * this.h;
    const r = radius * this.w;
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.plot(x, y, color);
      }
    }
  }

  /** A thick line segment with round caps — one limb bone. */
  capsule(a: Point, b: Point, radius: number, color: Rgb): void {
    const ax = a.x * this.w;
    const ay = a.y * this.h;
    const bx = b.x * this.w;
    const by = b.y * this.h;
    const r = radius * this.w;
    const r2 = r * r;

    const minX = Math.floor(Math.min(ax, bx) - r);
    const maxX = Math.ceil(Math.max(ax, bx) + r);
    const minY = Math.floor(Math.min(ay, by) - r);
    const maxY = Math.ceil(Math.max(ay, by) + r);

    const vx = bx - ax;
    const vy = by - ay;
    const lenSq = vx * vx + vy * vy || 1;

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        // Distance from the pixel to the segment: project, clamp to [0,1], measure.
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / lenSq));
        const dx = x - (ax + t * vx);
        const dy = y - (ay + t * vy);
        if (dx * dx + dy * dy <= r2) this.plot(x, y, color);
      }
    }
  }

  /**
   * A capsule drawn with a background-coloured halo around it, so a limb that crosses the torso
   * still reads as a separate limb instead of melting into one silhouette. Without this the NEAR
   * ARM — which swings directly across the trunk — is invisible, and Arm swing (a whole PACE
   * pillar) would be unassessable for a reason that is an artefact of the drawing rather than a
   * property of the fixture.
   */
  outlinedCapsule(a: Point, b: Point, radius: number, color: Rgb, halo: Rgb): void {
    this.capsule(a, b, radius * 1.45, halo);
    this.capsule(a, b, radius, color);
  }

  /** A horizontal band — the ground. */
  band(yTop: number, yBottom: number, color: Rgb): void {
    for (let y = Math.floor(yTop * this.h); y < Math.ceil(yBottom * this.h); y += 1) {
      for (let x = 0; x < this.w; x += 1) this.plot(x, y, color);
    }
  }

  /** Box-filter the supersampled buffer down to the output size. */
  downsample(): Uint8Array {
    const out = new Uint8Array(this.outW * this.outH * 3);
    const n = SUPERSAMPLE * SUPERSAMPLE;
    for (let y = 0; y < this.outH; y += 1) {
      for (let x = 0; x < this.outW; x += 1) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
          for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
            const i = ((y * SUPERSAMPLE + sy) * this.w + (x * SUPERSAMPLE + sx)) * 3;
            r += this.px[i];
            g += this.px[i + 1];
            b += this.px[i + 2];
          }
        }
        const o = (y * this.outW + x) * 3;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
      }
    }
    return out;
  }
}

// -------------------------------------------------------------------------------------------
// The figure
// -------------------------------------------------------------------------------------------

/**
 * A side-on running pose, as joint coordinates. The runner faces RIGHT (+x is the direction of
 * travel), so "the foot is ahead of the centre of mass" means `ankle.x > hip.x` — which is
 * literally the overstriding signature `pace_framework.md` calls the most important thing you can
 * see, and which the `overstride` pose below is built to show.
 *
 * `far*` limbs are the ones on the camera's far side; they are drawn in a lighter shade before the
 * near limbs, which gives the figure enough depth to read as a body rather than as a glyph.
 */
export interface Pose {
  hip: Point;
  neck: Point;
  head: Point;
  farElbow: Point;
  farHand: Point;
  farKnee: Point;
  farAnkle: Point;
  farToe: Point;
  nearElbow: Point;
  nearHand: Point;
  nearKnee: Point;
  nearAnkle: Point;
  nearToe: Point;
}

const BG: Rgb = { r: 236, g: 238, b: 240 };
const GROUND: Rgb = { r: 176, g: 180, b: 186 };
const NEAR: Rgb = { r: 38, g: 40, b: 46 };
const FAR: Rgb = { r: 118, g: 122, b: 132 };

const GROUND_Y = 0.9;
const LIMB = 0.028;
const TORSO = 0.05;
const HEAD_R = 0.042;

export const FIXTURE_WIDTH = 768;
export const FIXTURE_HEIGHT = 1024;

/**
 * THE OVERSTRIDE STILL. Every fault here is deliberate and is one the certified corpus names:
 *   - the foot lands FAR ahead of the hip (ankle.x 0.75 vs hip.x 0.47) with a near-straight knee
 *     and a dorsiflexed, heel-first foot — `injury_flags.md`'s "Overstriding" and "Heavy heel
 *     strike with an extended knee";
 *   - the trunk is bolt upright, no lean from the ankles — `drills.md`'s "Upright or waist-bent
 *     posture" row.
 * A model that is actually reading the geometry has something true to say about this figure. A
 * model that is pattern-matching "running photo -> generic advice" will say the same thing here as
 * it says about a blank screen, and the graders will see the difference.
 */
export const POSE_OVERSTRIDE: Pose = {
  hip: { x: 0.47, y: 0.545 },
  neck: { x: 0.472, y: 0.335 },
  head: { x: 0.482, y: 0.272 },
  // Far arm: driven forward and high (tense, hiked shoulder).
  farElbow: { x: 0.55, y: 0.43 },
  farHand: { x: 0.60, y: 0.35 },
  // Far leg: trailing, behind the body.
  farKnee: { x: 0.39, y: 0.68 },
  farAnkle: { x: 0.325, y: 0.845 },
  farToe: { x: 0.265, y: 0.875 },
  // Near arm: swung back, elbow bent.
  nearElbow: { x: 0.395, y: 0.45 },
  nearHand: { x: 0.435, y: 0.53 },
  // Near leg: THE OVERSTRIDE — reaching out in front, knee nearly locked, heel down first.
  nearKnee: { x: 0.63, y: 0.665 },
  nearAnkle: { x: 0.755, y: 0.845 },
  nearToe: { x: 0.825, y: 0.815 }, // toe ABOVE the ankle => dorsiflexed => heel strikes first
};

/**
 * A STRIDE CYCLE — five frames of a better (not perfect) runner, for the video fixture.
 *
 * The point of this fixture is the COMPLEMENT of the free-tier finding (#89): with motion across
 * frames, Cadence and Elasticity become assessable at all. `hip.y` deliberately rises and falls
 * across the sequence (0.545 -> 0.500 at flight), because vertical oscillation between frames is
 * exactly the timestamp-INDEPENDENT evidence `analyze-form-prompt.ts` steers Elasticity onto.
 */
export const POSES_STRIDE: readonly Pose[] = [
  // 1. Near foot lands, under the hip, knee bent. Slight forward lean from the ankles.
  {
    hip: { x: 0.47, y: 0.545 },
    neck: { x: 0.495, y: 0.335 },
    head: { x: 0.515, y: 0.272 },
    farElbow: { x: 0.40, y: 0.46 },
    farHand: { x: 0.445, y: 0.535 },
    farKnee: { x: 0.395, y: 0.70 },
    farAnkle: { x: 0.33, y: 0.86 },
    farToe: { x: 0.275, y: 0.885 },
    nearElbow: { x: 0.555, y: 0.44 },
    nearHand: { x: 0.585, y: 0.355 },
    nearKnee: { x: 0.515, y: 0.70 },
    nearAnkle: { x: 0.495, y: 0.865 },
    nearToe: { x: 0.565, y: 0.885 },
  },
  // 2. Mid-stance / drive: the body passes over the planted foot, trail leg folding up behind.
  {
    hip: { x: 0.47, y: 0.525 },
    neck: { x: 0.50, y: 0.315 },
    head: { x: 0.52, y: 0.252 },
    farElbow: { x: 0.425, y: 0.44 },
    farHand: { x: 0.475, y: 0.50 },
    farKnee: { x: 0.375, y: 0.63 },
    farAnkle: { x: 0.315, y: 0.70 },
    farToe: { x: 0.255, y: 0.735 },
    nearElbow: { x: 0.545, y: 0.42 },
    nearHand: { x: 0.565, y: 0.34 },
    nearKnee: { x: 0.485, y: 0.695 },
    nearAnkle: { x: 0.475, y: 0.865 },
    nearToe: { x: 0.545, y: 0.885 },
  },
  // 3. FLIGHT: both feet off the ground, torso at its highest — the vertical oscillation frame.
  {
    hip: { x: 0.47, y: 0.50 },
    neck: { x: 0.50, y: 0.29 },
    head: { x: 0.52, y: 0.227 },
    farElbow: { x: 0.545, y: 0.40 },
    farHand: { x: 0.575, y: 0.315 },
    farKnee: { x: 0.565, y: 0.615 },
    farAnkle: { x: 0.545, y: 0.775 },
    farToe: { x: 0.615, y: 0.795 },
    nearElbow: { x: 0.40, y: 0.415 },
    nearHand: { x: 0.44, y: 0.495 },
    nearKnee: { x: 0.395, y: 0.60 },
    nearAnkle: { x: 0.345, y: 0.615 },
    nearToe: { x: 0.285, y: 0.655 },
  },
  // 4. Far foot lands, under the hip. Mirror of frame 1 — this is what makes it a CYCLE.
  {
    hip: { x: 0.47, y: 0.545 },
    neck: { x: 0.495, y: 0.335 },
    head: { x: 0.515, y: 0.272 },
    farElbow: { x: 0.555, y: 0.44 },
    farHand: { x: 0.585, y: 0.355 },
    farKnee: { x: 0.50, y: 0.70 },
    farAnkle: { x: 0.485, y: 0.865 },
    farToe: { x: 0.555, y: 0.885 },
    nearElbow: { x: 0.40, y: 0.46 },
    nearHand: { x: 0.445, y: 0.535 },
    nearKnee: { x: 0.40, y: 0.70 },
    nearAnkle: { x: 0.335, y: 0.86 },
    nearToe: { x: 0.28, y: 0.885 },
  },
  // 5. FLIGHT again, legs swapped — the second half of the cycle.
  {
    hip: { x: 0.47, y: 0.505 },
    neck: { x: 0.50, y: 0.295 },
    head: { x: 0.52, y: 0.232 },
    farElbow: { x: 0.40, y: 0.42 },
    farHand: { x: 0.44, y: 0.50 },
    farKnee: { x: 0.39, y: 0.605 },
    farAnkle: { x: 0.34, y: 0.62 },
    farToe: { x: 0.28, y: 0.66 },
    nearElbow: { x: 0.545, y: 0.405 },
    nearHand: { x: 0.575, y: 0.32 },
    nearKnee: { x: 0.56, y: 0.62 },
    nearAnkle: { x: 0.54, y: 0.78 },
    nearToe: { x: 0.61, y: 0.80 },
  },
];

function drawPose(raster: Raster, pose: Pose): void {
  // Far limbs first, in a lighter shade, so the near limbs overdraw them and the figure reads
  // three-dimensionally.
  raster.capsule(pose.neck, pose.farElbow, LIMB * 0.85, FAR);
  raster.capsule(pose.farElbow, pose.farHand, LIMB * 0.75, FAR);
  raster.capsule(pose.hip, pose.farKnee, LIMB * 1.1, FAR);
  raster.capsule(pose.farKnee, pose.farAnkle, LIMB * 0.85, FAR);
  raster.capsule(pose.farAnkle, pose.farToe, LIMB * 0.6, FAR);

  // Torso: hip to neck, thick.
  raster.capsule(pose.hip, pose.neck, TORSO, NEAR);
  raster.disc(pose.head, HEAD_R, NEAR);

  // The near arm swings ACROSS the trunk, so it is haloed — see `outlinedCapsule`. Without the
  // halo it fuses into the torso and the Arm-swing pillar becomes unassessable for a reason that
  // is an artefact of the renderer, not a property of the runner.
  raster.outlinedCapsule(pose.neck, pose.nearElbow, LIMB * 0.85, NEAR, BG);
  raster.outlinedCapsule(pose.nearElbow, pose.nearHand, LIMB * 0.75, NEAR, BG);
  raster.capsule(pose.hip, pose.nearKnee, LIMB * 1.1, NEAR);
  raster.capsule(pose.nearKnee, pose.nearAnkle, LIMB * 0.85, NEAR);
  raster.capsule(pose.nearAnkle, pose.nearToe, LIMB * 0.6, NEAR);
}

/** One frame of the runner, as PNG bytes. */
export async function renderRunnerPng(pose: Pose): Promise<Uint8Array> {
  const raster = new Raster(FIXTURE_WIDTH, FIXTURE_HEIGHT, BG);
  raster.band(GROUND_Y, GROUND_Y + 0.008, GROUND);
  drawPose(raster, pose);
  return encodePng(FIXTURE_WIDTH, FIXTURE_HEIGHT, raster.downsample());
}

/**
 * THE UNSUPPORTABLE INPUT. A featureless field with a horizon line and no runner in it — the
 * "deliberately bad input" of issue #42's assertion 3.
 *
 * There is NOTHING here to score. The only honest answers are four null pillars (with feedback
 * saying what shot would fix it) or a clean refusal. Any number this fixture comes back with is a
 * fabricated number, which is the Echo V1 mistake the whole product is built to not repeat — and
 * it is the single most valuable assertion in this harness, because it is the one whose failure
 * mode is invisible to a user.
 */
export async function renderBlankPng(): Promise<Uint8Array> {
  const raster = new Raster(FIXTURE_WIDTH, FIXTURE_HEIGHT, BG);
  raster.band(GROUND_Y, GROUND_Y + 0.008, GROUND);
  return encodePng(FIXTURE_WIDTH, FIXTURE_HEIGHT, raster.downsample());
}
