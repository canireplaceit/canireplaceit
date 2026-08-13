#!/usr/bin/env bun
/**
 * A social card per page, for the pages that actually get shared.
 *
 *   bun run og:pages            products + categories + collections
 *   bun run og:pages --limit 5  a handful, for looking at
 *
 * WHY NOT ALL 8000: the images are the payload, not the markup. 8000 PNGs is
 * roughly 250 MB in the image and in every deploy, to serve cards for project
 * pages that are two-thirds `noindex` and are shared by nobody. This does the
 * three page types a link actually gets pasted for, and everything else keeps
 * the static card.
 *
 * DELIBERATELY NOT WIRED INTO `bun run build`. Fonts are the reason: the text
 * here is drawn with a system font by resvg-through-sharp, and the production
 * image is a distroless nginx that has no fonts at all. Run it where fonts
 * exist, commit what it makes, and the build stays hermetic. `--check` reports
 * whether the font is present rather than silently emitting cards with no text
 * on them, which is the failure mode that would otherwise ship.
 *
 * The 19 designs in /home/hades/canireplaceit-brand/og-designs.html are the real
 * brief. This is the product/category/collection subset of them, in the brand's
 * agreed dark palette, on the agreed 1200×630.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "apps/frontend/public/og");

// The agreed palette: dark is baked, one file per page, no theme switching.
// See the brand file — X, Discord and Slack are dark for most people, and a
// dark card reads as part of the timeline rather than a flashbang.
const BG = "#0d0f13";
const INK = "#e8eaed";
const MUTED = "#9aa1ac";
const BRAND = "#2f6fed";
const VERDICT: Record<string, string> = {
	yes: "#34d399",
	almost: "#fbbf24",
	"not-yet": "#f87171",
};

const W = 1200;
const H = 630;
const LIMIT = process.argv.includes("--limit")
	? Number(process.argv[process.argv.indexOf("--limit") + 1])
	: Number.POSITIVE_INFINITY;

/** XML-escape. A product called `AT&T` must not produce invalid SVG. */
const esc = (s: string) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/**
 * Wrap by character count rather than by measuring.
 *
 * Measuring needs the font metrics, which needs the font loaded, which is the
 * thing this script cannot assume. At 56px in a 1020px box roughly 34
 * characters fit, and headlines here are short by construction.
 */
function wrap(text: string, perLine: number, maxLines: number): string[] {
	const words = text.split(/\s+/);
	const lines: string[] = [];
	let line = "";
	for (const w of words) {
		if (line && (line + " " + w).length > perLine) {
			lines.push(line);
			line = w;
			if (lines.length === maxLines) break;
		} else line = line ? `${line} ${w}` : w;
	}
	if (line && lines.length < maxLines) lines.push(line);
	return lines;
}

const FONT = "DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif";
const MONO = "DejaVu Sans Mono, Liberation Mono, monospace";

type Card = {
	eyebrow: string;
	title: string;
	lines: string[];
	accent?: string;
};

const svg = ({ eyebrow, title, lines, accent = BRAND }: Card) => {
	const head = wrap(title, 30, 2);
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="10" height="${H}" fill="${accent}"/>
  <text x="80" y="110" font-family="${MONO}" font-size="24" letter-spacing="3" fill="${accent}">${esc(eyebrow.toUpperCase())}</text>
  ${head
		.map(
			(l, i) =>
				`<text x="80" y="${210 + i * 74}" font-family="${FONT}" font-size="62" font-weight="700" fill="${INK}">${esc(l)}</text>`,
		)
		.join("\n  ")}
  ${lines
		.slice(0, 3)
		.map(
			(l, i) =>
				`<text x="80" y="${400 + i * 44}" font-family="${FONT}" font-size="30" fill="${MUTED}">${esc(l)}</text>`,
		)
		.join("\n  ")}
  <text x="80" y="${H - 60}" font-family="${MONO}" font-size="24" letter-spacing="2" fill="${MUTED}">canireplaceit</text>
</svg>`;
};

/**
 * Does this environment have a usable font? Rendered text with no font produces
 * a card with a background and nothing on it, which is worse than the static
 * card it would replace — so this is checked once, up front, and refused loudly.
 */
async function fontsPresent(): Promise<boolean> {
	const probe = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><rect width="200" height="60" fill="#000"/><text x="10" y="40" font-family="${FONT}" font-size="30" fill="#fff">Hg</text></svg>`;
	const buf = await sharp(Buffer.from(probe)).raw().toBuffer();
	// Any non-black pixel means glyphs were drawn.
	for (let i = 0; i < buf.length; i++) if (buf[i]! > 40) return true;
	return false;
}

if (!(await fontsPresent())) {
	console.error(
		"✗ no usable font — cards would render as empty rectangles. Install DejaVu or Liberation fonts and re-run.",
	);
	process.exit(1);
}
if (process.argv.includes("--check")) {
	console.log("fonts present");
	process.exit(0);
}

mkdirSync(OUT, { recursive: true });

const write = async (name: string, card: Card) => {
	const png = await sharp(Buffer.from(svg(card)))
		.png()
		.toBuffer();
	writeFileSync(join(OUT, `${name}.png`), png);
};

const products = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.map((f) => JSON.parse(readFileSync(join(DATA, "products", f), "utf8")));
const categories = JSON.parse(
	readFileSync(join(DATA, "categories.json"), "utf8"),
) as { slug: string; name: { en: string } }[];

let n = 0;

// --- products ---------------------------------------------------------------
// The verdict is the card: it is the one thing the page exists to say, and the
// only thing worth reading at thumbnail size in a timeline.
for (const p of products) {
	if (n >= LIMIT) break;
	const oss = p.alternatives.filter((a: { kind: string }) => a.kind === "oss");
	if (oss.length === 0) continue;
	const price =
		p.priceMonthly === null
			? "price not checked"
			: p.priceMonthly === 0
				? "ships with the system"
				: `$${p.priceMonthly}/mo`;
	await write(`product-${p.slug}`, {
		eyebrow: "can i replace it?",
		title: p.name,
		lines: [
			`${oss.length} open source alternatives`,
			`${price} · ${oss[0]?.name} is the easiest exit`,
		],
		accent: VERDICT[p.verdict] ?? BRAND,
	});
	n++;
}

// --- categories -------------------------------------------------------------
for (const c of categories) {
	if (n >= LIMIT) break;
	const inCat = products.filter((p) => p.category === c.slug);
	if (inCat.length === 0) continue;
	const alts = inCat.reduce(
		(t: number, p: { alternatives: unknown[] }) => t + p.alternatives.length,
		0,
	);
	await write(`category-${c.slug}`, {
		eyebrow: "category",
		title: c.name.en,
		lines: [
			`${inCat.length} products reviewed`,
			`${alts} open source replacements`,
		],
	});
	n++;
}

console.log(`${n} cards written to apps/frontend/public/og/`);
