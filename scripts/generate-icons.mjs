#!/usr/bin/env node
/**
 * Generate favicon.ico, PWA icons, and OG image from app/icon.svg
 *
 *   node scripts/generate-icons.mjs
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SVG = join(ROOT, "app", "icon.svg");
const PUBLIC_DIR = join(ROOT, "public");
const ICONS_DIR = join(PUBLIC_DIR, "icons");

mkdirSync(ICONS_DIR, { recursive: true });

const svgBuffer = readFileSync(ICON_SVG);

// Colours from the design system
const BG = "#04050a";
const SIGNAL = "#93b6ff"; // --signal-rgb: 168 200 255

async function generate() {
  console.log("Generating icons from", ICON_SVG);

  // 1. Favicon.ico (multi-size: 16, 32, 48)
  const icoSizes = [16, 32, 48];
  const icoBuffers = await Promise.all(
    icoSizes.map((size) =>
      sharp(svgBuffer, { density: 300 })
        .resize(size, size, { fit: "contain", background: BG })
        .png()
        .toBuffer(),
    ),
  );

  // Create ICO header
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0); // reserved
  icoHeader.writeUInt16LE(1, 2); // type: ICO
  icoHeader.writeUInt16LE(icoSizes.length, 4); // count

  const icoDirEntries = icoSizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt8(0, 2); // color count (0 = 256+)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(icoBuffers[i].length, 8); // size in bytes
    entry.writeUInt32LE(6 + 16 * icoSizes.length + icoBuffers.slice(0, i).reduce((a, b) => a + b.length, 0), 12); // offset
    return entry;
  });

  const icoBuffer = Buffer.concat([icoHeader, ...icoDirEntries, ...icoBuffers]);
  writeFileSync(join(PUBLIC_DIR, "favicon.ico"), icoBuffer);
  console.log(`  ✓ favicon.ico (${icoSizes.join(", ")}px)`);

  // 2. PWA icons (192, 512)
  for (const size of [192, 512]) {
    await sharp(svgBuffer, { density: 300 })
      .resize(size, size, { fit: "contain", background: BG })
      .png()
      .toFile(join(ICONS_DIR, `icon-${size}.png`));
    console.log(`  ✓ icons/icon-${size}.png`);
  }

  // 3. Apple touch icon (180)
  await sharp(svgBuffer, { density: 300 })
    .resize(180, 180, { fit: "contain", background: BG })
    .png()
    .toFile(join(PUBLIC_DIR, "apple-touch-icon.png"));
  console.log(`  ✓ apple-touch-icon.png (180px)`);

  // 4. OG image (1200x630) - branded preview
  // Create a simple branded OG image
  const ogSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
      <rect width="1200" height="630" fill="${BG}"/>
      <!-- Subtle grid pattern -->
      <defs>
        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="${SIGNAL}20" stroke-width="0.5"/>
        </pattern>
      </defs>
      <rect width="1200" height="630" fill="url(#grid)"/>
      
      <!-- Central visual element -->
      <g transform="translate(600, 315)">
        <circle r="120" fill="none" stroke="${SIGNAL}40" stroke-width="2"/>
        <circle r="80" fill="none" stroke="${SIGNAL}60" stroke-width="1.5"/>
        <circle r="45" fill="${SIGNAL}CC"/>
        
        <!-- Wave lines -->
        <g stroke="${SIGNAL}60" stroke-width="2" fill="none" stroke-linecap="round">
          <path d="M -80 0 Q 0 -40 80 0 Q 0 40 -80 0" opacity="0.6"/>
          <path d="M -60 0 Q 0 -25 60 0 Q 0 25 -60 0" opacity="0.8"/>
          <path d="M -40 0 Q 0 -15 40 0 Q 0 15 -40 0" opacity="1"/>
        </g>
      </g>
      
      <!-- Title -->
      <text x="600" y="480" font-family="Georgia, serif" font-size="48" font-weight="400" font-style="italic" fill="#f2f4f8" text-anchor="middle" letter-spacing="0.08em">Wavecore</text>
      <text x="600" y="530" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="400" fill="#9aa1b1" text-anchor="middle" letter-spacing="0.14em" text-transform="uppercase">audio-reactive 3D visualiser</text>
    </svg>
  `;

  await sharp(Buffer.from(ogSvg))
    .png()
    .toFile(join(PUBLIC_DIR, "og-image.png"));
  console.log(`  ✓ og-image.png (1200x630)`);

  console.log("\nAll icons generated successfully!");
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});