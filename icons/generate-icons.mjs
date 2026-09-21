// Generate PNG icons for the manifest from icon.svg.
// The SVG has transparent padding around the artwork, so we trim it,
// resize to full width, and center on a transparent square canvas.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const SIZES = [16, 32, 48, 96, 128];

for (const size of SIZES) {
  const trimmed = await sharp(join(here, "icon.svg"))
    .resize({ width: size * 4 }) // render at 4x, then downscale — crisper
    .trim() // strip transparent padding around the artwork
    .toBuffer();

  const meta = await sharp(trimmed).metadata();
  const scaledH = Math.max(1, Math.round((size * meta.height) / meta.width));
  const art = await sharp(trimmed).resize({ width: size }).toBuffer();

  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: "rgba(0,0,0,0)",
    },
  })
    .composite([{ input: art, left: 0, top: Math.round((size - scaledH) / 2) }])
    .png()
    .toFile(join(here, `icon-${size}.png`));

  console.log(`icon-${size}.png`);
}
