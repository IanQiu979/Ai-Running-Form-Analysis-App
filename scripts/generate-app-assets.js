#!/usr/bin/env node

/**
 * Rasterizes the app icon / splash / favicon art in `assets/source/*.svg` into the PNGs that
 * `app.json` points at. Run with `npm run assets` after editing any source SVG — the PNGs in
 * `assets/images/` are build outputs, not hand-edited files.
 *
 * Every color here comes from the Gait Plate tokens in `constants/theme.ts`; the SVGs hold the
 * geometry, this file holds the per-target raster rules (size, alpha, background).
 *
 * The one rule that is not obvious: `icon.png` MUST NOT have an alpha channel. iOS applies its
 * own corner mask, and App Store Connect rejects an icon containing transparency — so it is
 * flattened onto the background field here rather than in the SVG, which lets the same source render
 * transparent for the splash and the Android adaptive foreground.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "assets", "source");
const outDir = path.join(root, "assets", "images");

// Manual mirror of constants/theme.ts -> Colors.light.background / Colors.dark.background.
// A .js build script cannot import the TS token, so these must be re-synced by hand on any
// future palette change.
const LIGHT_BACKGROUND = "#E9EFFA";
const DARK_BACKGROUND = "#0F1324";

// Each source SVG carries two layers: an opaque `#field` rect and the `#mark` annotation group.
// `keepField: false` drops the rect before rasterizing, leaving a transparent surround — that is
// what the Android adaptive foreground and both splash images need, since the system supplies
// their background and then masks the result. Baking the field into those would show up as an
// unmasked background square on the launcher.
const targets = [
  {
    source: "mark-light.svg",
    out: "icon.png",
    size: 1024,
    keepField: true,
    // No alpha: iOS masks the corners itself and App Store Connect rejects a transparent icon.
    flattenOn: LIGHT_BACKGROUND,
  },
  {
    source: "mark-light.svg",
    out: "android-icon-foreground.png",
    size: 1024,
    keepField: false,
    flattenOn: null,
  },
  {
    source: "mark-mono.svg",
    out: "android-icon-monochrome.png",
    size: 1024,
    // mark-mono has no field to begin with — the OS discards its color and tints the alpha.
    keepField: false,
    flattenOn: null,
  },
  {
    source: "mark-light.svg",
    out: "splash-icon.png",
    size: 1024,
    keepField: false,
    flattenOn: null,
  },
  {
    source: "mark-dark.svg",
    out: "splash-icon-dark.png",
    size: 1024,
    keepField: false,
    flattenOn: null,
  },
  {
    source: "mark-favicon.svg",
    out: "favicon.png",
    size: 48,
    // A browser tab bar supplies no background, so the favicon keeps its background field.
    keepField: true,
    flattenOn: LIGHT_BACKGROUND,
  },
];

const FIELD_RECT = /<rect\s+id="field"[^>]*\/>\s*/;

async function render({ source, out, size, keepField, flattenOn }) {
  const sourcePath = path.join(sourceDir, source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing source art: ${path.relative(root, sourcePath)}`);
  }

  let svg = fs.readFileSync(sourcePath, "utf8");
  if (!keepField) {
    svg = svg.replace(FIELD_RECT, "");
  }

  // The sources are drawn on a 1024 viewBox, so librsvg rasterizes them at 1024 natively. The
  // 48px favicon is rendered at full size and then downsampled, which supersamples the strokes
  // rather than asking the rasterizer to resolve them at 48px directly.
  let pipeline = sharp(Buffer.from(svg)).resize(size, size);

  if (flattenOn) {
    pipeline = pipeline.flatten({ background: flattenOn });
  }

  // Render to a buffer and check it BEFORE writing, so a failed assertion can never leave a bad
  // asset on disk for someone to commit.
  const buffer = await pipeline.png().toBuffer();
  const { hasAlpha, width, height } = await sharp(buffer).metadata();
  const { isOpaque } = await sharp(buffer).stats();

  // Assert the outcome rather than trusting FIELD_RECT to have matched. The regex only recognizes
  // one attribute order, so a reformatted SVG (an `id` written last, as most vector editors
  // export it) would silently skip the strip and bake the opaque field in — and a full-bleed
  // opaque alpha channel renders the Android themed icon as a solid tinted square with no mark.
  // Checking the pixels closes that hole no matter how the SVG is written.
  if (keepField && !isOpaque) {
    throw new Error(`${out} must be fully opaque, but it has transparent pixels.`);
  }
  if (!keepField && isOpaque) {
    throw new Error(
      `${out} came out fully opaque — the #field rect was not stripped from ${source}.`
    );
  }
  if (out === "icon.png" && hasAlpha) {
    throw new Error("icon.png has an alpha channel — App Store Connect will reject it.");
  }

  fs.writeFileSync(path.join(outDir, out), buffer);
  console.log(`  ${out.padEnd(30)} ${width}x${height}  ${hasAlpha ? "alpha" : "no alpha"}`);
}

async function main() {
  console.log("Generating app assets from assets/source/*.svg\n");
  for (const target of targets) {
    await render(target);
  }
  console.log("\nDone. These PNGs are build outputs — edit the SVGs, not them.");
}

main().catch((error) => {
  console.error(`\nAsset generation failed: ${error.message}`);
  process.exit(1);
});
