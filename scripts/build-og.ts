#!/usr/bin/env bun
/**
 * SUPERSEDED. Do not run this. `scripts/build-og-pages.ts` now draws og.png,
 * in the site's real type and the site's palette, alongside the 1,424 per page
 * cards. Running this script overwrites that with the older dark card below,
 * which uses a hand-plotted pixel face and a tagline the site dropped.
 *
 * Kept only so the reasoning survives, and because deleting a script is the
 * owner's call. Delete it once he says so.
 *
 * The original header follows.
 *
 * The site's social card, built rather than hand-maintained.
 *
 *   bun run scripts/build-og.ts
 *
 * One image is served for every URL on the site, see OG_IMAGE in seo.ts, so
 * getting it wrong is wrong four thousand times. The committed PNG was green
 * while the brand is blue (`--brand: #2f6fed`), which nobody would have caught
 * by reading CSS.
 *
 * Generated from an SVG so the colour comes from the same constant the site
 * uses instead of being baked into pixels somebody has to open an editor to
 * change. Rendered with sharp, which is already a dependency.
 *
 * DELIBERATELY the single static card, not per-page images. Nineteen per-page
 * designs are specified in /home/hades/canireplaceit-brand/og-designs.html and
 * that is a bigger piece of work with a renderer decision attached; this is the
 * stopgap that stops the one card we do ship contradicting the brand.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/** Must track `--brand` in index.css. The whole point of generating this. */
const BRAND = "#2f6fed";
const INK = "#e8eaed";
const MUTED = "#9aa1ac";
const BG = "#0d0f13";

const W = 1200;
const H = 630;

/**
 * A blocky slab face drawn as rectangles, so the card needs no font file and
 * renders identically wherever it is built. Each glyph is a 5x7 grid.
 */
const GLYPHS: Record<string, string[]> = {
	C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
	A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
	N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
	I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
	R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
	E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
	P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
	L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
	T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
	" ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

/** One word as `<rect>`s. Returns the markup and the width it consumed. */
function word(
	text: string,
	x: number,
	y: number,
	cell: number,
	fill: string,
): { svg: string; width: number } {
	const gap = cell;
	let cursor = x;
	const parts: string[] = [];
	for (const ch of text.toUpperCase()) {
		const rows = GLYPHS[ch];
		if (!rows) {
			cursor += cell * 5 + gap;
			continue;
		}
		rows.forEach((row, r) => {
			[...row].forEach((on, c) => {
				if (on === "1") {
					parts.push(
						`<rect x="${cursor + c * cell}" y="${y + r * cell}" width="${cell}" height="${cell}" fill="${fill}"/>`,
					);
				}
			});
		});
		cursor += cell * 5 + gap;
	}
	return { svg: parts.join(""), width: cursor - x - gap };
}

// 13 glyphs at 6 cells each, plus two inter-word gaps, inside a 1020px live
// area: 82 cells across, so 12 is the largest that fits with the 90px margin.
const cell = 12;
// "CAN" and "REPLACE IT" in ink, the "I" between them in brand, the wordmark's
// own device, where the I of "can I" is the pivot.
const can = word("CAN", 90, 190, cell, INK);
const i = word("I", 90 + can.width + cell * 2, 190, cell, BRAND);
const rest = word(
	"REPLACE IT",
	90 + can.width + cell * 2 + i.width + cell * 2,
	190,
	cell,
	INK,
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="90" y="140" width="120" height="14" fill="${BRAND}"/>
  ${can.svg}${i.svg}${rest.svg}
  <text x="90" y="400" font-family="DejaVu Sans Mono, monospace" font-size="34" letter-spacing="2" fill="${MUTED}">OPEN SOURCE ALTERNATIVES</text>
  <text x="90" y="452" font-family="DejaVu Sans Mono, monospace" font-size="34" letter-spacing="2" fill="${MUTED}">TO THE SAAS YOU PAY FOR.</text>
  <rect x="90" y="520" width="${W - 180}" height="2" fill="#262b33"/>
</svg>`;

const out = join(import.meta.dir, "..", "apps/frontend/public/og.png");
const png = await sharp(Buffer.from(svg)).png().toBuffer();
writeFileSync(out, png);
console.log(`og.png ${png.length} bytes · brand ${BRAND} · ${W}x${H}`);
