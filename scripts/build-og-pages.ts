#!/usr/bin/env bun
/**
 * A social card per page, in the approved designs, for the pages that get shared.
 *
 *   bun run og:pages              every card, both languages
 *   bun run og:pages --limit 5    a handful, for looking at
 *   bun run og:pages --check      fonts only, writes nothing
 *
 * The designs are /home/hades/canireplaceit-og-cards.html, which the owner
 * signed off. The toolkit here is that file's toolkit, ported: the same
 * palette, the same type stack, the same 1200x630, the same rules. No coloured
 * bar across the top, no eyebrow except on the card that earns one, no glow, no
 * gradient wash, no watermark numerals, real logos, and colour only where it
 * carries meaning.
 *
 * Every figure on every card is read out of the catalogue at run time, and every
 * French string is `dict.fr` in apps/frontend/src/i18n.ts. Nothing on a card is
 * typed in twice.
 *
 * WHY NOT ALL 8000: the images are the payload, not the markup, and a card for
 * every project page is another 7,196 PNGs at roughly 220 MB in the image and in
 * every deploy. That argument holds for the `noindex` two thirds and only for
 * them. The other third is 1,301 projects — 2,602 cards across both locales —
 * that Google indexes and people paste, and they were unfurling a card naming
 * the site rather than the project. So `thinProject` decides: indexable project
 * pages get a card, the rest keep the static one, which `ogFor()` in
 * scripts/prerender.ts already does for free when the file is not on disk.
 *
 * ALT TEXT SHIPS WITH THE CARDS. Everything on these is pixels — the verdict,
 * the price, what you give up — so `og:image:alt` cannot be composed beside the
 * meta tags without being a second, drifting copy of what was drawn here. Each
 * job carries the sentence its card says, and the set is written to
 * `public/og/alt.json` for prerender.ts to read back.
 *
 * IT ALSO DRAWS THE FAVICONS. Same brand, same `sharp`, same output directory,
 * and the rasters change about as often as the cards do — see the icons section
 * at the bottom.
 *
 * DELIBERATELY NOT WIRED INTO `bun run build`. Fonts are the reason. The cards
 * are drawn in Space Grotesk and IBM Plex Sans/Mono, and the production image is
 * a distroless nginx with no fonts at all, so a card built there would come out
 * as a blank rectangle. Generate where the fonts exist, commit the PNGs, and the
 * build stays hermetic.
 *
 * The fonts are the Google Fonts static TTFs, installed for the current user:
 *
 *   ~/.local/share/fonts/canireplaceit/
 *     SpaceGrotesk-Medium.ttf  SpaceGrotesk-Bold.ttf
 *     IBMPlexSans-Regular.ttf  IBMPlexSans-SemiBold.ttf  IBMPlexSans-Bold.ttf
 *     IBMPlexMono-Regular.ttf  IBMPlexMono-SemiBold.ttf
 *   fc-cache -rf
 *
 * Take them from fonts.googleapis.com/css2, not from a "static" zip off a mirror:
 * some builds of Space Grotesk name their family "Space Grotesk Light", which
 * fontconfig will not match on "Space Grotesk", so every headline silently comes
 * out in DejaVu. That is what the probe below is for. It renders each family
 * beside a family name that cannot exist and refuses to run if they come out the
 * same, because a card that fell back is worse than the static card it replaces.
 *
 * Logos must be converted before they are embedded. librsvg drops
 * `<image href="data:image/webp;...">` without a word, which reads as a card
 * with a hole in it, so each icon is rasterised to PNG with sharp first.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import {
	byWeight,
	COLLECTIONS,
	collectionMembers,
	memberCount,
} from "core/src/collections";
import {
	altIconKey,
	CATEGORY_GROUPS,
	type Category,
	type CategoryGroup,
	categoryStats,
	collectProjects,
	type HealthFile,
	healthKey,
	type OssAlternative,
	type Product,
	type Project,
	type ProjectPageFacts,
	splitGaps,
	thinProject,
} from "core/src/content";
import type { FeatureFile } from "core/src/features";
import { DEFAULT_LANG, type Lang, resolveTranslation } from "core/src/index";
import { alternateUrls, buildProjectSlugs } from "core/src/routes";
import { discountPct, SPONSOR_TERMS } from "core/src/sponsorship";
import sharp from "sharp";

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data");
const FE = join(ROOT, "apps/frontend");
const ICONS = join(FE, "public/icons");
const OUT = join(FE, "public/og");

const { dict } = await import(join(FE, "src/i18n.ts"));
type Dict = Record<string, string>;
const strings: Record<Lang, Dict> = dict;

const LANGS: Lang[] = ["en", "fr"];
const W = 1200;
const H = 630;
const SITE = "canireplaceit.com";

/**
 * Light, because that is the state the designs were reviewed and approved in.
 * The palette is baked into each PNG, so a card cannot follow the reader's
 * theme the way the site does. That is a choice, not an oversight.
 */
const THEME = "light" as const;

const LIMIT = process.argv.includes("--limit")
	? Number(process.argv[process.argv.indexOf("--limit") + 1])
	: Number.POSITIVE_INFINITY;

/* ── palette and type ──────────────────────────────────────────────────────── */

/** Lifted from `apps/frontend/src/index.css`. If one disagrees, the stylesheet wins. */
const PALETTE = {
	light: {
		bg: "#fbfbfd",
		surface: "#ffffff",
		s2: "#f3f5f8",
		line: "#e3e6ec",
		lineS: "#cdd3dd",
		text: "#0f1319",
		muted: "#5d6675",
		brand: "#2f6fed",
		brandT: "#0e64e0",
		yes: "#167a52",
		almost: "#a15a05",
		no: "#c62f2f",
		grey: "#7d8590",
	},
	dark: {
		bg: "#0a0d13",
		surface: "#121722",
		s2: "#19202d",
		line: "#232b39",
		lineS: "#333e50",
		text: "#e7ecf3",
		muted: "#8d99ab",
		brand: "#4c8dff",
		brandT: "#4c8dff",
		yes: "#34d399",
		almost: "#f5a623",
		no: "#ff5c5c",
		grey: "#8d99ab",
	},
};
type Tone = (typeof PALETTE)["light"];
const t: Tone = PALETTE[THEME];

const DISP = "Space Grotesk";
const BODY = "IBM Plex Sans";
const MONO = "IBM Plex Mono";

const VERDICT_COLOUR: Record<string, string> = {
	yes: t.yes,
	almost: t.almost,
	"not-yet": t.no,
};

const esc = (s: string) =>
	String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/* ── fonts ─────────────────────────────────────────────────────────────────── */

const PROBE = "Hamburgefonstiv 0123456789";
const IMPOSSIBLE = "No Such Family 8f2c1e";

const inkOf = async (family: string, weight: number): Promise<string> => {
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="90"><rect width="900" height="90" fill="#fff"/><text x="10" y="62" font-family="${family}" font-size="48" font-weight="${weight}" fill="#000">${PROBE}</text></svg>`;
	const raw = await sharp(Buffer.from(svg)).raw().toBuffer();
	return Bun.hash(raw).toString(16);
};

/**
 * Are the three families we draw with actually installed?
 *
 * Not "is there any font at all". fontconfig answers every request with
 * something, so a missing family renders in DejaVu and the card looks finished
 * while being wrong in the one way nobody checks. Each family is compared
 * against a name that cannot exist: identical output means we got the fallback.
 */
async function fontsPresent(): Promise<string[]> {
	const fallback = await inkOf(IMPOSSIBLE, 700);
	const missing: string[] = [];
	for (const family of [DISP, BODY, MONO]) {
		if ((await inkOf(family, 700)) === fallback) missing.push(family);
	}
	return missing;
}

const missing = await fontsPresent();
if (missing.length > 0) {
	console.error(
		`✗ these families fall back to a default font: ${missing.join(", ")}`,
	);
	console.error("  Cards would render in the wrong face. Install the TTFs:");
	console.error("    mkdir -p ~/.local/share/fonts/canireplaceit");
	console.error(
		"    fetch Space Grotesk 500/700 and IBM Plex Sans 400/600/700 and IBM Plex Mono 400/600",
	);
	console.error(
		"    from https://fonts.googleapis.com/css2, then: fc-cache -rf",
	);
	console.error(
		"  A stale fontconfig cache looks identical to a missing font. If the files are there, run fc-cache -rf again.",
	);
	process.exit(1);
}
if (process.argv.includes("--check")) {
	console.log(`fonts present: ${DISP}, ${BODY}, ${MONO}`);
	process.exit(0);
}

/* ── measuring ─────────────────────────────────────────────────────────────── */

type Face = { family: string; weight: number };
const FACES: Face[] = [
	{ family: DISP, weight: 700 },
	{ family: BODY, weight: 400 },
	{ family: BODY, weight: 600 },
	{ family: BODY, weight: 700 },
	{ family: MONO, weight: 400 },
	{ family: MONO, weight: 600 },
];

/**
 * Every character a card can carry. French copy in this catalogue uses guillemets,
 * curly apostrophes and the ellipsis, and a character with no advance measured for
 * it would make a headline look narrower than it is and let it run off the canvas.
 */
const CHARSET = [
	...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)),
	..."àâäçéèêëîïôöùûüÿœæÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸŒÆ’‘“”«»…–—·×→€£°\u00a0",
];

const REF = 40;
const advances = new Map<string, Map<string, number>>();

/**
 * How wide is one character, in units of 1em?
 *
 * Measured, not guessed. The design file approximated at 0.58em per character
 * because a browser page has no font metrics offline, and that is close enough
 * for a pill but not for deciding whether "Adobe After Effects" fits beside its
 * replacement. Each character is drawn ten times and twenty times in one pass;
 * the difference between the two ink widths is ten advances with the side
 * bearings cancelled out.
 */
async function measureFace(face: Face): Promise<Map<string, number>> {
	const rowH = REF * 2;
	const rows = CHARSET.flatMap((ch, i) =>
		[10, 20].map((reps, j) => {
			// xml:space, or the renderer collapses a run of spaces to one and the
			// space character measures as nothing.
			const body = esc(`|${ch.repeat(reps)}|`);
			return `<text xml:space="preserve" x="10" y="${(i * 2 + j) * rowH + REF * 1.2}" font-family="${face.family}" font-size="${REF}" font-weight="${face.weight}" fill="#000">${body}</text>`;
		}),
	);
	const height = CHARSET.length * 2 * rowH;
	const width = 24 * REF + 80;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rows.join("")}</svg>`;
	const { data, info } = await sharp(Buffer.from(svg))
		.extractChannel("alpha")
		.raw()
		.toBuffer({ resolveWithObject: true });

	const inkWidth = (band: number): number => {
		let right = 0;
		const top = band * rowH;
		for (let y = top; y < top + rowH && y < info.height; y++) {
			const base = y * info.width;
			for (let x = info.width - 1; x > right; x--) {
				if ((data[base + x] as number) > 8) {
					right = x;
					break;
				}
			}
		}
		return right;
	};

	const table = new Map<string, number>();
	CHARSET.forEach((ch, i) => {
		const ten = inkWidth(i * 2);
		const twenty = inkWidth(i * 2 + 1);
		table.set(ch, Math.max(0, (twenty - ten) / 10 / REF));
	});
	return table;
}

const faceKey = (family: string, weight: number) => `${family}/${weight}`;
for (const face of FACES) {
	advances.set(faceKey(face.family, face.weight), await measureFace(face));
}

/** Width of a string at a size, in px. Overestimates slightly: kerning is ignored. */
function wid(s: string, size: number, weight = 400, font = BODY): number {
	const table =
		advances.get(faceKey(font, weight)) ??
		(advances.get(faceKey(font, 400)) as Map<string, number>);
	let total = 0;
	for (const ch of s) total += table.get(ch) ?? 0.55;
	return total * size;
}

/** The largest size at or below `start` that keeps the string inside `max`. */
function fitSize(
	s: string,
	max: number,
	start: number,
	min: number,
	weight = 400,
	font = BODY,
): number {
	let size = start;
	while (size > min && wid(s, size, weight, font) > max) size -= 1;
	return size;
}

/** Cut to fit, with an ellipsis, once shrinking has run out of room. */
function clip(s: string, max: number, size: number, weight = 400, font = BODY) {
	if (wid(s, size, weight, font) <= max) return s;
	let out = s;
	while (out.length > 1 && wid(`${out}…`, size, weight, font) > max) {
		out = out.slice(0, -1);
	}
	return `${out.trimEnd()}…`;
}

/**
 * A headline that shrinks to fit, and only then clips.
 *
 * Clipping at the starting size ellipsises a title that fits perfectly well
 * once the type has been shrunk into the same box, which is how the French
 * submit card lost the end of "Il manque quelque chose ?".
 */
function headline(
	x: number,
	y: number,
	s: string,
	max: number,
	start: number,
	min: number,
): string {
	const size = fitSize(s, max, start, min, 700, DISP);
	return disp(x, y, clip(s, max, size, 700, DISP), { size, fill: t.text });
}

/**
 * Two names sharing one line: the shorter one is kept whole and the longer one
 * takes what is left. Splitting the budget in proportion instead would cut
 * "Kitsu" down to "Kit…" just because it stands beside "Autodesk Flow
 * Production Tracking (ShotGrid)".
 */
function shareLine(
	a: string,
	b: string,
	budget: number,
	size: number,
	weight = 700,
	font = DISP,
): [string, string] {
	const wa = wid(a, size, weight, font);
	const wb = wid(b, size, weight, font);
	if (wa + wb <= budget) return [a, b];
	const keep = Math.min(Math.min(wa, wb), budget * 0.6);
	return wa <= wb
		? [
				clip(a, keep, size, weight, font),
				clip(b, budget - keep, size, weight, font),
			]
		: [
				clip(a, budget - keep, size, weight, font),
				clip(b, keep, size, weight, font),
			];
}

/** Greedy wrap on measured width. Returns at most `maxLines`, last one clipped. */
function wrap(
	s: string,
	max: number,
	size: number,
	maxLines: number,
	weight = 400,
	font = BODY,
): string[] {
	const words = s.split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (line && wid(next, size, weight, font) > max) {
			lines.push(line);
			if (lines.length === maxLines) break;
			line = word;
		} else line = next;
	}
	if (line && lines.length < maxLines) lines.push(line);
	if (lines.length === maxLines) {
		const used = lines.join(" ").split(/\s+/).length;
		if (used < words.length) {
			lines[maxLines - 1] = clip(
				`${lines[maxLines - 1]} ${words[used]}`,
				max,
				size,
				weight,
				font,
			);
		}
	}
	return lines;
}

/**
 * The opening of a blurb, cut at a sentence boundary rather than mid-word.
 *
 * The site's own blurbs run to three hundred characters, which no card has room
 * for. Taking whole sentences until the budget runs out means the card carries
 * the page's real words and stops somewhere a reader would have stopped.
 */
function lead(s: string, max: number, size: number, lines: number): string {
	const budget = max * lines;
	const sentences = s.split(/(?<=[.!?])\s+/);
	let out = "";
	for (const sentence of sentences) {
		const next = out ? `${out} ${sentence}` : sentence;
		if (out && wid(next, size) > budget) break;
		out = next;
	}
	return out || sentences[0] || s;
}

/* ── the toolkit ───────────────────────────────────────────────────────────── */

const tint = (hex: string, a: number) =>
	hex +
	Math.round(a * 255)
		.toString(16)
		.padStart(2, "0");

type TextOpts = {
	size?: number;
	weight?: number;
	fill?: string;
	anchor?: string;
	font?: string;
	ls?: number;
	op?: number;
};

function text(x: number, y: number, s: string, o: TextOpts = {}): string {
	const {
		size = 32,
		weight = 400,
		fill = t.text,
		anchor = "start",
		font = BODY,
		ls = 0,
		op = 1,
	} = o;
	return `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" fill-opacity="${op}" text-anchor="${anchor}" letter-spacing="${ls}">${esc(s)}</text>`;
}

const disp = (x: number, y: number, s: string, o: TextOpts = {}) =>
	text(x, y, s, {
		font: DISP,
		weight: 700,
		ls: -((o.size ?? 32) * 0.022),
		...o,
	});

const eyebrow = (x: number, y: number, s: string, col?: string) =>
	text(x, y, s.toUpperCase(), {
		size: 21,
		weight: 600,
		font: MONO,
		ls: 3.2,
		fill: col ?? t.muted,
	});

/** The mark: the grey arrow leaving, the brand arrow arriving. */
function mark(x: number, y: number, s: number, greyOp = "0.8"): string {
	const k = s / 32;
	const sw = 3.4 * k;
	const p = (d: string, stroke: string, op = "1") =>
		`<path d="${d}" transform="translate(${x} ${y}) scale(${k})" stroke="${stroke}" stroke-opacity="${op}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke-width:${sw}px"/>`;
	return (
		p("M24 10H8M13 5L7 10l6 5", t.grey, greyOp) +
		p("M8 22h16M19 17l6 5-6 5", t.brand)
	);
}

const wordmark = (x: number, y: number, size: number, anchor = "start") =>
	disp(x, y, "canireplaceit", { size, fill: t.text, anchor });

function panel(
	x: number,
	y: number,
	w: number,
	h: number,
	o: { r?: number; fill?: string; stroke?: string; sw?: number } = {},
): string {
	const { r = 16, fill = t.surface, stroke = t.line, sw = 2 } = o;
	return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
}

function pill(
	x: number,
	y: number,
	label: string,
	o: {
		fill: string;
		fg: string;
		size?: number;
		pad?: number;
		h?: number;
		anchor?: string;
		font?: string;
	},
): { svg: string; w: number } {
	const {
		fill,
		fg,
		size = 22,
		pad = 18,
		h = 40,
		anchor = "start",
		font = BODY,
	} = o;
	const w = wid(label, size, 700, font) + pad * 2;
	const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
	return {
		w,
		svg:
			`<rect x="${x0}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>` +
			text(x0 + w / 2, y + h * 0.68, label, {
				size,
				weight: 700,
				fill: fg,
				anchor: "middle",
				ls: 0.3,
				font,
			}),
	};
}

const tick = (x: number, y: number, s: number, col: string) =>
	`<path d="M${x - s} ${y} l${s * 0.75} ${s * 0.8} L${x + s} ${y - s * 0.85}" stroke="${col}" stroke-width="${s * 0.42}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;

const cross = (x: number, y: number, s: number, col: string) =>
	`<path d="M${x - s * 0.8} ${y - s * 0.8} l${s * 1.6} ${s * 1.6} M${x + s * 0.8} ${y - s * 0.8} l${-s * 1.6} ${s * 1.6}" stroke="${col}" stroke-width="${s * 0.42}" fill="none" stroke-linecap="round"/>`;

function featureList(
	x: number,
	y: number,
	title: string,
	items: string[],
	o: { mode?: "lose" | "gain"; size?: number; gap?: number; max?: number } = {},
): string {
	const { mode = "lose", size = 25, gap = 42, max = 480 } = o;
	const col = mode === "lose" ? t.no : t.yes;
	let out = eyebrow(x, y, title);
	items.forEach((s, i) => {
		const yy = y + 46 + i * gap;
		out +=
			mode === "lose"
				? cross(x + 11, yy - 8, 9, col)
				: tick(x + 11, yy - 6, 9, col);
		out += text(x + 38, yy, clip(s, max, size), { size, fill: t.text });
	});
	return out;
}

/** Bottom bar. Every card carries it, so a screenshot of any of them is attributable. */
function footerBar(o: { y?: number; url?: string; brandless?: boolean } = {}) {
	const { y = 572, url = SITE, brandless = false } = o;
	return (
		(brandless ? "" : mark(80, y - 27, 40) + wordmark(136, y, 27)) +
		text(W - 80, y - 2, url, {
			size: 21,
			fill: t.brandT,
			anchor: "end",
			font: MONO,
			weight: 600,
		})
	);
}

/**
 * The page background: a flat surface, nothing else. Colour belongs to elements
 * that mean something, so the frame stays quiet.
 */
const frame = (body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
	<rect width="${W}" height="${H}" fill="${t.bg}"/>
	${body}
</svg>`;

/* ── logos ─────────────────────────────────────────────────────────────────── */

/**
 * librsvg accepts a PNG data URI and silently ignores a WebP one, which is why
 * the first cards came out with holes where the logos should have been. Convert,
 * then embed. AppFlowy alone appears on hundreds of cards, so the converted
 * bytes are cached by file and size.
 */
const logoCache = new Map<string, string | null>();

async function loadLogo(file: string | null, size: number): Promise<void> {
	if (!file) return;
	const key = `${file}@${size}`;
	if (logoCache.has(key)) return;
	if (!existsSync(file)) {
		logoCache.set(key, null);
		return;
	}
	// A project icon that is really the owner's avatar, and that avatar is really
	// a photograph of them. 65 of the 564 product cards drew one before this
	// check: `grep` faced with a man at a desk instead of the ripgrep mark. The
	// walls filter through `pickIcons`, but a card that draws one named project
	// has nothing to fall through to, so the lettermark is the answer.
	//
	// Only under `alts/`. Product icons are brand marks by definition, and the
	// same test flags ten of them (Canva, GeForce NOW and other gradient-heavy
	// logos) which we would rather keep than lose to a false positive.
	if (file.includes(`${sep}alts${sep}`) && (await isPhoto(file))) {
		logoCache.set(key, null);
		return;
	}
	try {
		const png = await sharp(file)
			.resize(size, size, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.png()
			.toBuffer();
		logoCache.set(key, `data:image/png;base64,${png.toString("base64")}`);
	} catch {
		// A corrupt icon is one card wearing a lettermark, not a failed run.
		logoCache.set(key, null);
	}
}

/**
 * A real app icon. Falls back to a lettermark so a design never breaks on a
 * missing asset. 92 of the 592 products and 239 of the 3,479 projects have no
 * icon on disk. No tile, no border: every icon is already a finished mark.
 */
function logo(
	x: number,
	y: number,
	s: number,
	file: string | null,
	label: string,
): string {
	const src = file ? logoCache.get(`${file}@${s}`) : null;
	return src
		? `<image x="${x}" y="${y}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid meet" href="${src}"/>`
		: `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${s * 0.24}" fill="${tint(t.grey, 0.14)}"/>` +
				disp(x + s / 2, y + s * 0.68, (label || "?")[0]?.toUpperCase() ?? "?", {
					size: s * 0.5,
					fill: t.muted,
					anchor: "middle",
				});
}

const productIcon = (p: { slug: string; domain?: string | null }) =>
	p.domain ? join(ICONS, "products", `${p.slug}.webp`) : null;

/** On disk? A lettermark is a fine fallback in a list, but a wall of them is not. */
const hasIcon = (file: string | null) => file !== null && existsSync(file);

/**
 * Is this "icon" a photograph?
 *
 * `altIconKey` keys GitHub projects on the repo OWNER, so a project run by one
 * person wears that person's avatar, and a lot of those are photographs of
 * them. A wall of them puts a stranger's face on a card that says "projects
 * that are done", which is not ours to publish.
 *
 * Two signals, and both have to agree. A logo almost always has an alpha
 * channel with real transparency in it, and a logo is flat: across every icon
 * in this catalogue the busiest real mark uses 632 distinct colours at 6-bit,
 * while the tamest photograph uses 851. The gate sits between them.
 *
 * Known limits, measured against the catalogue rather than guessed: a heavily
 * gradient logo can read as a photo (Caddy and SoftEther are the two in the top
 * 160), and a black-and-white portrait has too few colours to be caught. Losing
 * two marks out of a hundred and sixty is the right side of that trade, because
 * a wall simply takes the next candidate.
 */
const PHOTO_COLOURS = 750;
const photoCache = new Map<string, boolean>();

async function isPhoto(file: string): Promise<boolean> {
	const cached = photoCache.get(file);
	if (cached !== undefined) return cached;
	let verdict = false;
	try {
		const raw = await sharp(file)
			.resize(48, 48, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.ensureAlpha()
			.raw()
			.toBuffer();
		let clear = 0;
		const colours = new Set<number>();
		for (let i = 0; i < raw.length; i += 4) {
			if ((raw[i + 3] as number) < 250) {
				clear += 1;
				continue;
			}
			colours.add(
				(((raw[i] as number) >> 2) << 12) |
					(((raw[i + 1] as number) >> 2) << 6) |
					((raw[i + 2] as number) >> 2),
			);
		}
		const opaque = clear / (raw.length / 4) < 0.1;
		verdict = opaque && colours.size >= PHOTO_COLOURS;
	} catch {
		// Unreadable is not evidence of a face. It falls out at `hasIcon` anyway.
		verdict = false;
	}
	photoCache.set(file, verdict);
	return verdict;
}

/** A mark we are willing to put on a wall: on disk, and not somebody's face. */
const usableIcon = async (file: string | null) =>
	hasIcon(file) && !(await isPhoto(file as string));

/**
 * The first `want` candidates whose icon is usable, in the order given.
 *
 * Falls through to the next candidate rather than leaving a hole, and returns
 * short only when the pool itself runs out, in which case the caller drops the
 * wall. Empty space beats a face.
 */
async function pickIcons<T>(
	candidates: T[],
	iconOf: (row: T) => string | null,
	want: number,
): Promise<T[]> {
	const out: T[] = [];
	for (const row of candidates) {
		if (out.length === want) break;
		if (await usableIcon(iconOf(row))) out.push(row);
	}
	return out;
}

const projectIcon = (source: Project["source"]) => {
	const key = altIconKey(source);
	return key ? join(ICONS, "alts", `${key}.webp`) : null;
};

/* ── the catalogue ─────────────────────────────────────────────────────────── */

const products: Product[] = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.sort()
	.map((f) => JSON.parse(readFileSync(join(DATA, "products", f), "utf8")));
const categories: Category[] = JSON.parse(
	readFileSync(join(DATA, "categories.json"), "utf8"),
);
const projects = collectProjects(products);

/**
 * The project pages that are worth a card of their own: the ones a search engine
 * is allowed to index.
 *
 * Same rule, same function, as the `robots` tag in scripts/prerender.ts — see
 * `thinProject`. And the same URL slug, off the same builder, because the card's
 * filename is what `ogFor()` looks up: `og/project-{slug}-{lang}.png`, where
 * `{slug}` is the one in `/en/tools/{slug}/` and NOT the forge-path id.
 */
const projectUrlSlug = buildProjectSlugs(
	projects,
	products.map((p) => p.slug),
);

/** The products a project's `replaces` cites, for its own card. */
const productBySlug = new Map(products.map((p) => [p.slug, p]));

/**
 * The catalogue ordered by how many products cite each project, so a wall of
 * icons shows what the site is actually about rather than whatever sorted first.
 */
const mostCited = [...projects]
	.filter((p) => hasIcon(projectIcon(p.source)))
	.sort(
		(a, b) =>
			b.replaces.length - a.replaces.length || a.name.localeCompare(b.name),
	);
/**
 * The 29 marks the two big walls draw from, photo-filtered once and shared so
 * the alternatives hub and the submit card cannot show the same nine icons.
 */
let wallPoolCache: Project[] | null = null;
const wallPool = async (): Promise<Project[]> => {
	wallPoolCache ??= await pickIcons(
		mostCited,
		(p) => projectIcon(p.source),
		29,
	);
	return wallPoolCache;
};

const stats = categoryStats(products);
const liveCategories = categories.filter((c) => stats.has(c.slug));
const slots: { placement: string; priceCents: number }[] = JSON.parse(
	readFileSync(join(DATA, "sponsors", "slots.json"), "utf8"),
);
const features: FeatureFile = JSON.parse(
	readFileSync(join(DATA, "features.json"), "utf8"),
);

/**
 * `thinProject` now scores what a project page actually renders, which is a
 * join across the products, the feature matrix and the repo readings — so this
 * script has to make the same join the prerenderer does, or the two would
 * disagree about which pages get a card. Absent health is not fatal: a project
 * with no reading simply scores nothing for it, exactly as its page prints
 * nothing for it.
 */
const health: HealthFile = (() => {
	try {
		return JSON.parse(readFileSync(join(DATA, "health.json"), "utf8"));
	} catch {
		return { fetchedAt: "", repos: {} };
	}
})();

const featureLabel = new Map(
	features.domains.flatMap((d) => d.features.map((f) => [f.key, f.name])),
);

/**
 * The same 30-day gate `healthOf` in apps/frontend/src/api.ts and `healthFresh`
 * in scripts/prerender.ts apply: past it, `lastPush` and `archived` are withheld
 * from the page, so they must be withheld from the score too or this script and
 * the prerenderer would disagree about which pages are indexable.
 */
const healthFresh = (() => {
	const at = Date.parse(`${health.fetchedAt}T00:00:00Z`);
	return Number.isFinite(at) && Date.now() - at < 30 * 86_400_000;
})();

const pageFactsFor = (project: Project): ProjectPageFacts => {
	const key = healthKey(project.source);
	const reading = health.repos[key] ?? null;
	return {
		whatYouLose: project.replaces.flatMap((r) =>
			(productBySlug.get(r.slug)?.whatYouLose ?? []).map((b) =>
				resolveTranslation(b, DEFAULT_LANG),
			),
		),
		featureLabels: Object.entries(features.projects[key] ?? {})
			.filter(([, v]) => v !== "unknown")
			.map(([k]) => {
				const name = featureLabel.get(k);
				return name ? resolveTranslation(name, DEFAULT_LANG) : "";
			}),
		health: reading
			? healthFresh
				? reading
				: { ...reading, lastPush: undefined, archived: undefined }
			: null,
	};
};

const cardProjects = projects.filter((p) => !thinProject(p, pageFactsFor(p)));

const totalAlternatives = products.reduce(
	(n, p) => n + p.alternatives.length,
	0,
);
const verdictTotals = { yes: 0, almost: 0, "not-yet": 0 } as Record<
	string,
	number
>;
for (const p of products)
	verdictTotals[p.verdict] = (verdictTotals[p.verdict] ?? 0) + 1;

const collectionSizes = new Map(
	COLLECTIONS.map((def) => [
		def.slug,
		memberCount(collectionMembers(def.slug, products, projects)),
	]),
);
const biggestCollection = Math.max(...collectionSizes.values());

const topOss = (p: Product): OssAlternative | null =>
	(p.alternatives.find((a) => a.kind === "oss") as OssAlternative) ?? null;

const byCategory = new Map<string, Product[]>();
for (const p of products) {
	const list = byCategory.get(p.category) ?? [];
	list.push(p);
	byCategory.set(p.category, list);
}

/* ── locale helpers ────────────────────────────────────────────────────────── */

const T = (lang: Lang, key: string): string =>
	strings[lang][key] ?? strings.en[key] ?? key;

/**
 * French groups thousands with a narrow no-break space, which Space Grotesk has
 * no glyph for: "1 200" came out as "1200" at display size. The ordinary
 * no-break space is in every face we draw with and reads the same.
 */
const group = (s: string) => s.replace(/\u202f/g, "\u00a0");

const num = (v: number, lang: Lang) =>
	group(v.toLocaleString(lang === "fr" ? "fr-FR" : "en-US"));

const money = (usd: number, lang: Lang) => {
	const body = usd.toLocaleString(lang === "fr" ? "fr-FR" : "en-US", {
		minimumFractionDigits: usd % 1 === 0 ? 0 : 2,
		maximumFractionDigits: 2,
	});
	return group(lang === "fr" ? `${body} $` : `$${body}`);
};

/** Per-month price, in the shape each language writes it. */
const perMonth = (usd: number, lang: Lang) =>
	lang === "fr" ? `${money(usd, lang)}/mois` : `${money(usd, lang)}/mo`;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `592 products reviewed · 85 categories · 13 collections`, in the site's words. */
const catalogueLine = (lang: Lang) =>
	[
		`${num(products.length, lang)} ${T(lang, "stats.products")}`,
		`${num(liveCategories.length, lang)} ${T(lang, "cats.inGroup")}`,
		`${num(COLLECTIONS.length, lang)} ${T(lang, "collections.title").toLowerCase()}`,
	].join(" · ");

/**
 * What a switch buys you, taken off the alternative's own facts.
 *
 * The design's "what you gain" column had to come from somewhere real. These are
 * the same chips the product page prints beside the alternative, so the card and
 * the page cannot say different things.
 */
function gains(alt: OssAlternative, lang: Lang): string[] {
	const out: string[] = [];
	const facts = alt.facts ?? {};
	if (facts.openCore === "none") out.push(T(lang, "facts.openCore.none"));
	else if (facts.openCore === "minor")
		out.push(T(lang, "facts.openCore.minor"));
	if (facts.selfHostable !== false) out.push(T(lang, "facts.selfHost"));
	out.push(T(lang, `effort.${alt.effort}`));
	if (facts.ssoInFree === true) out.push(T(lang, "facts.sso"));
	if (facts.dataResidency === "self") out.push(T(lang, "facts.residency.self"));
	return out.slice(0, 3).map(cap);
}

/* ── cards ─────────────────────────────────────────────────────────────────── */

/**
 * A drawing and the sentence that describes it.
 *
 * The two come out of one function on purpose. `og:image:alt` is the only thing
 * a screen reader gets from a card, and everything these carry — the verdict,
 * the price, the count, what you give up — exists nowhere but the pixels. A
 * description assembled anywhere else would be a second copy of the same figures
 * and would drift the first time a card was redesigned, which is worse than no
 * alt at all. The cards that draw nothing but the page's own title and blurb
 * return a bare string and let prerender.ts fall back to that title.
 *
 * Fact lists, not prose: it should read out in the order the card sets it.
 */
type Card = { svg: string; alt: string };

/** The one connective the alt sentences need that the dictionary has no key for. */
const VS: Record<Lang, string> = { en: "versus", fr: "contre" };

/** The verdict card: the swap as the headline. */
async function productCard(p: Product, lang: Lang): Promise<Card | null> {
	const alt = topOss(p);
	if (!alt) return null;
	const iconA = productIcon(p);
	const iconB = projectIcon(alt.source);
	await loadLogo(iconA, 86);
	await loadLogo(iconB, 86);

	// The row is laid out from the two measured names, not from a fixed split: a
	// design drawn around "Notion" falls off the canvas at "Adobe After Effects".
	const budget = 706;
	let size = 62;
	while (
		size > 30 &&
		wid(p.name, size, 700, DISP) + wid(alt.name, size, 700, DISP) > budget
	) {
		size -= 1;
	}
	const [nameA, nameB] = shareLine(p.name, alt.name, budget, size);
	const wA = wid(nameA, size, 700, DISP);
	const markX = 190 + wA + 30;
	const logoBX = markX + 84;
	const nameBX = logoBX + 110;
	const baseline = 153 + size * 0.37;

	const lose = (p.whatYouLose ?? [])
		.slice(0, 3)
		.map((v) => v[lang] ?? v.en)
		.filter(Boolean);
	const gain = gains(alt, lang);

	const verdict = T(lang, `verdict.${p.verdict}`).toUpperCase();
	const colour = VERDICT_COLOUR[p.verdict] ?? t.brand;
	const badge = pill(80, 464, verdict, {
		fill: tint(colour, 0.16),
		fg: colour,
		size: 22,
		h: 44,
		font: MONO,
	});

	const ossCount = p.alternatives.filter((a) => a.kind === "oss").length;
	const price =
		p.priceMonthly === null || p.priceMonthly === 0
			? null
			: perMonth(p.priceMonthly, lang);
	const easiest =
		lang === "fr"
			? `${alt.name} est ${T(lang, "cats.cheapest")}`
			: `${alt.name} is the ${T(lang, "cats.cheapest")}`;
	const facts = [
		price,
		`${num(ossCount, lang)} ${T(lang, "stats.alternatives")}`,
		easiest,
	].filter(Boolean);
	const meta = facts.join(" · ");
	const metaX = 80 + badge.w + 24;
	const metaSize = fitSize(meta, W - 80 - metaX, 24, 17);

	return {
		svg: frame(`
	${logo(80, 110, 86, iconA, p.name)}
	${disp(190, baseline, nameA, { size, fill: t.text })}
	${mark(markX, 128, 54)}
	${logo(logoBX, 110, 86, iconB, alt.name)}
	${disp(nameBX, baseline, nameB, { size, fill: t.brand })}
	<path d="M80 234 H${W - 80}" stroke="${t.line}" stroke-width="2"/>
	${lose.length > 0 ? featureList(80, 288, T(lang, "row.whatYouLose"), lose, { mode: "lose", size: 24, gap: 40, max: 470 }) : ""}
	${featureList(lose.length > 0 ? 640 : 80, 288, T(lang, "facts.heading"), gain, { mode: "gain", size: 24, gap: 40, max: 470 })}
	${lose.length > 0 ? `<path d="M604 268 V436" stroke="${t.line}" stroke-width="2"/>` : ""}
	${badge.svg}
	${text(metaX, 494, clip(meta, W - 80 - metaX, metaSize), { size: metaSize, fill: t.muted })}
	${footerBar()}`),
		// The badge and the line under it, in the order they are drawn. The card
		// separates those facts with a middot, which a screen reader reads out.
		alt: `${p.name} ${VS[lang]} ${alt.name}. ${cap(`verdict ${T(lang, `verdict.${p.verdict}`).toLowerCase()}`)}, ${facts.join(", ")}.`,
	};
}

/**
 * The project card: the paid products this one project gets you out of.
 *
 * The mirror image of the product card, which is the page's own frame — the
 * product page asks "what replaces Notion?", the project page asks "what does
 * AppFlowy get me out of?". Only the indexable ones are drawn, see the header.
 *
 * Four products, not six. Two thirds of the 1,301 pages that get a card cite
 * exactly two, so a 3x2 board would be two thirds empty on most of the set; two
 * wide rows fill at two and stay honest at six, and the eyebrow carries the real
 * total so nothing is hidden by the cut.
 */
async function projectCard(p: Project, lang: Lang): Promise<Card> {
	const icon = projectIcon(p.source);
	await loadLogo(icon, 88);

	const cited = p.replaces
		.map((r) => productBySlug.get(r.slug))
		.filter((r): r is Product => r !== undefined);
	// `replaces` arrives in the order the product files were read, which put
	// Brandfolder ahead of Dropbox on the Nextcloud card. The four that get drawn
	// are the four worth naming, so they come off editorial weight like every
	// other list on the site.
	const rows = byWeight(cited).slice(0, 4);
	for (const r of rows) await loadLogo(productIcon(r), 48);

	const size = fitSize(p.name, 900, 68, 34, 700, DISP);
	const facts = [p.license, T(lang, `effort.${p.effort}`), p.language].filter(
		Boolean,
	);
	const meta = facts.join(" · ");

	// Centred between the rule and the footer rather than hung off the rule: half
	// the set is two products and one row, and pinned to the top that reads as a
	// card whose bottom half failed to render.
	const boardH = Math.ceil(rows.length / 2) * 104 - 12;
	const top = 246 + Math.round((284 - (boardH + 40)) / 2);

	let board = "";
	rows.forEach((r, i) => {
		const x = 80 + (i % 2) * 534;
		const y = top + 32 + Math.floor(i / 2) * 104;
		const col = VERDICT_COLOUR[r.verdict] ?? t.brand;
		const price =
			r.priceMonthly === null || r.priceMonthly === 0
				? null
				: perMonth(r.priceMonthly, lang);
		const under = [price, T(lang, `verdict.${r.verdict}`)]
			.filter(Boolean)
			.join(" · ");
		board += panel(x, y, 506, 92, { r: 14 });
		board += logo(x + 18, y + 22, 48, productIcon(r), r.name);
		board += disp(x + 80, y + 44, clip(r.name, 330, 26, 700, DISP), {
			size: 26,
			fill: t.text,
		});
		board += text(x + 80, y + 72, clip(under, 330, 19), {
			size: 19,
			fill: t.muted,
		});
		board += `<circle cx="${x + 466}" cy="${y + 46}" r="15" fill="${tint(col, 0.16)}"/>`;
		board +=
			r.verdict === "not-yet"
				? cross(x + 466, y + 46, 7, col)
				: tick(x + 466, y + 48, 7, col);
	});

	return {
		svg: frame(`
	${logo(80, 92, 88, icon, p.name)}
	${disp(196, 152, clip(p.name, 900, size, 700, DISP), { size, fill: t.brand })}
	${text(196, 206, clip(meta, 924, 25), { size: 25, fill: t.muted })}
	<path d="M80 246 H${W - 80}" stroke="${t.line}" stroke-width="2"/>
	${eyebrow(80, top + 14, `${T(lang, "page.replaces")} ${num(cited.length, lang)}`)}
	${board}
	${footerBar()}`),
		alt: `${p.name} ${T(lang, "page.replaces").toLowerCase()} ${rows.map((r) => r.name).join(", ")}. ${facts.join(", ")}.`,
	};
}

/** The category card: a board of real swaps, each with its verdict. */
async function categoryCard(c: Category, lang: Lang): Promise<Card | null> {
	const stat = stats.get(c.slug);
	const inCat = byWeight(byCategory.get(c.slug) ?? []);
	if (!stat || inCat.length === 0) return null;

	const rows = inCat
		.map((p) => ({ p, alt: topOss(p) }))
		.filter((r): r is { p: Product; alt: OssAlternative } => r.alt !== null)
		.slice(0, 6);
	for (const r of rows) {
		await loadLogo(productIcon(r.p), 52);
	}

	const altsHere = (byCategory.get(c.slug) ?? []).reduce(
		(n, p) => n + p.alternatives.length,
		0,
	);
	const facts = [
		`${num(stat.products, lang)} ${T(lang, "stats.products")}`,
		`${num(altsHere, lang)} ${T(lang, "stats.alternatives")}`,
		stat.medianPrice === null
			? T(lang, "cats.noMedian")
			: `${T(lang, "cats.medianPrice")} ${perMonth(stat.medianPrice, lang)}`,
	];
	const meta = facts.join(" · ");

	const title = c.name[lang] ?? c.name.en;
	const titleSize = fitSize(title, 1040, 64, 34, 700, DISP);

	let board = "";
	rows.forEach((r, i) => {
		const x = 80 + (i % 3) * 354;
		const y = 248 + Math.floor(i / 3) * 126;
		const col = VERDICT_COLOUR[r.p.verdict] ?? t.brand;
		board += panel(x, y, 330, 108, { r: 14 });
		board += logo(x + 18, y + 28, 52, productIcon(r.p), r.p.name);
		board += text(x + 86, y + 44, `${clip(r.p.name, 170, 20)}  →`, {
			size: 20,
			fill: t.muted,
		});
		board += disp(x + 86, y + 82, clip(r.alt.name, 190, 28, 700, DISP), {
			size: 28,
			fill: t.text,
		});
		board += `<circle cx="${x + 296}" cy="${y + 54}" r="15" fill="${tint(col, 0.16)}"/>`;
		board +=
			r.p.verdict === "not-yet"
				? cross(x + 296, y + 54, 7, col)
				: tick(x + 296, y + 56, 7, col);
	});

	return {
		svg: frame(`
	${disp(80, 160, title, { size: titleSize, fill: t.text })}
	${text(80, 206, clip(meta, 1040, 25), { size: 25, fill: t.muted })}
	${board}
	${footerBar()}`),
		alt: `${title}. ${facts.join(", ")}. ${rows.map((r) => `${r.p.name} ${VS[lang]} ${r.alt.name}`).join(", ")}.`,
	};
}

/** The theme card: the shape of one hub, with two swaps out of it. */
async function themeCard(
	group: CategoryGroup,
	lang: Lang,
): Promise<Card | null> {
	const cats = liveCategories.filter((c) => c.group === group);
	if (cats.length === 0) return null;
	const slugs = new Set(cats.map((c) => c.slug));
	const inGroup = byWeight(products.filter((p) => slugs.has(p.category)));
	const alts = inGroup.reduce((n, p) => n + p.alternatives.length, 0);
	const counts = { yes: 0, almost: 0, "not-yet": 0 } as Record<string, number>;
	for (const p of inGroup) counts[p.verdict] = (counts[p.verdict] ?? 0) + 1;

	const candidates = inGroup
		.map((p) => ({ p, alt: topOss(p) }))
		.filter((r): r is { p: Product; alt: OssAlternative } => r.alt !== null);
	// Both marks real and neither one a face, or the pair drops to a lettermark.
	const usable: typeof candidates = [];
	for (const r of candidates) {
		if (usable.length === 2) break;
		if (
			(await usableIcon(productIcon(r.p))) &&
			(await usableIcon(projectIcon(r.alt.source)))
		) {
			usable.push(r);
		}
	}
	const swaps = [...usable, ...candidates].slice(0, 2);
	for (const r of swaps) {
		await loadLogo(productIcon(r.p), 52);
		await loadLogo(projectIcon(r.alt.source), 52);
	}

	const title = T(lang, `catGroup.${group}`);
	const titleSize = fitSize(title, 1040, 62, 34, 700, DISP);

	const figures: [string, string, number][] = [
		[num(cats.length, lang), T(lang, "cats.inGroup"), 80],
		[num(inGroup.length, lang), T(lang, "stats.products"), 300],
		[num(alts, lang), T(lang, "stats.alternatives"), 580],
	];
	const figureSvg = figures
		.map(([v, label, x], i) => {
			const size = fitSize(label, i === 2 ? 540 : 210, 22, 15);
			return (
				disp(x, 286, v, { size: 74, fill: i === 2 ? t.brand : t.text }) +
				text(x, 322, label, { size, fill: t.muted })
			);
		})
		.join("");

	let bar = "";
	let x = 80;
	const segments: [string, number, string][] = [
		[T(lang, "verdict.yes").toLowerCase(), counts.yes ?? 0, t.yes],
		[T(lang, "verdict.almost").toLowerCase(), counts.almost ?? 0, t.almost],
		[T(lang, "verdict.not-yet").toLowerCase(), counts["not-yet"] ?? 0, t.no],
	];
	segments.forEach(([label, v, col], i) => {
		const w = Math.max(4, (v / inGroup.length) * 1040 - 8);
		const last = i === 2;
		bar += `<rect x="${x}" y="356" width="${w}" height="16" rx="8" fill="${col}"/>`;
		bar += text(last ? x + w : x, 406, `${num(v, lang)} ${label}`, {
			size: 20,
			fill: t.muted,
			font: MONO,
			anchor: last ? "end" : "start",
		});
		x += w + 8;
	});

	// Each swap is laid out from its own measured names. Half the themes lead with
	// something like "Unity Personal", which a fixed grid would cut in half.
	let row = "";
	swaps.forEach((r, i) => {
		const ox = i * 540;
		const fixed = 52 + 14 + 20 + 34 + 22 + 52 + 14;
		const names = 500 - fixed;
		let size = 28;
		while (
			size > 17 &&
			wid(r.p.name, size, 700, DISP) + wid(r.alt.name, size, 700, DISP) > names
		) {
			size -= 1;
		}
		const [nameA, nameB] = shareLine(r.p.name, r.alt.name, names, size);
		const baseline = 468 + size * 0.37;

		let x = 80 + ox;
		row += logo(x, 442, 52, productIcon(r.p), r.p.name);
		x += 66;
		row += disp(x, baseline, nameA, { size, fill: t.text });
		x += wid(nameA, size, 700, DISP) + 20;
		row += mark(x, 452, 34);
		x += 56;
		row += logo(x, 442, 52, projectIcon(r.alt.source), r.alt.name);
		x += 66;
		row += disp(x, baseline, nameB, { size, fill: t.brand });
	});

	return {
		svg: frame(`
	${disp(80, 158, title, { size: titleSize, fill: t.text })}
	${figureSvg}
	${bar}
	${row}
	${footerBar()}`),
		alt: `${title}. ${figures.map(([v, label]) => `${v} ${label}`).join(", ")}. ${segments
			.map(([label, v]) => `${num(v, lang)} ${label}`)
			.join(", ")}.`,
	};
}

/**
 * The collection card: the count set enormous, the catalogue itself as artwork.
 *
 * The graveyard gets its own treatment further down. A muted wall is what says
 * "this is over" without a word of extra copy.
 */
async function collectionCard(slug: string, lang: Lang): Promise<Card> {
	const members = collectionMembers(slug, products, projects);
	const count = memberCount(members);
	const title = T(lang, `collection.${slug}.title`);
	const blurb = T(lang, `collection.${slug}.blurb`);

	const rank = new Map(mostCited.map((p, i) => [p.slug, i]));
	const candidates: [string | null, string][] =
		members.of === "product"
			? byWeight(members.products).map((p) => [productIcon(p), p.name])
			: [...members.projects]
					.sort(
						(a, b) =>
							(rank.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
							(rank.get(b.slug) ?? Number.MAX_SAFE_INTEGER),
					)
					.map((p) => [projectIcon(p.source), p.name]);
	const wallFiles = await pickIcons(candidates, ([file]) => file, 12);

	// The graveyard carries no icons, by design. Dead projects have the worst
	// iconography of anything in the catalogue, so the approved card fades a row
	// of rules out to the right instead and lets the count do the talking.
	if (slug === "archived") {
		let rules = "";
		for (let i = 0; i < 11; i++) {
			rules += `<rect x="${80 + i * 96}" y="466" width="72" height="6" rx="3" fill="${t.muted}" fill-opacity="${(0.55 - i * 0.045).toFixed(3)}"/>`;
		}
		return {
			svg: frame(`
	${disp(80, 290, num(count, lang), { size: 190, fill: t.muted })}
	${disp(80, 370, clip(title, 1040, 48, 700, DISP), { size: 48, fill: t.text })}
	${wrap(lead(blurb, 1040, 26, 2), 1040, 26, 2)
		.map((l, i) => text(80, 426 + i * 36, l, { size: 26, fill: t.muted }))
		.join("\n\t")}
	${rules}
	${footerBar()}`),
			alt: `${num(count, lang)}. ${title}. ${blurb}`,
		};
	}

	// A part-filled wall still reads as a wall. An empty one does not, so a
	// collection with nothing usable to show simply shows nothing.
	for (const [file] of wallFiles) await loadLogo(file, 72);
	let wall = "";
	wallFiles.forEach(([file, label], i) => {
		wall += `<g opacity="0.92">${logo(850 + (i % 3) * 94, 88 + Math.floor(i / 3) * 94, 72, file, label)}</g>`;
	});

	const unit = T(
		lang,
		members.of === "product" ? "stats.products" : "cats.projects",
	);
	const lines = wrap(lead(blurb, 720, 25, 3), 720, 25, 3);

	return {
		svg: frame(`
	${disp(80, 300, num(count, lang), { size: 200, fill: t.brand })}
	${disp(80, 376, clip(unit, 720, 52, 700, DISP), { size: 52, fill: t.text })}
	${lines.map((l, i) => text(80, 430 + i * 36, l, { size: 25, fill: t.muted })).join("\n\t")}
	${wall}
	${footerBar()}`),
		// The wall is decoration; the count, the unit and the blurb are the card.
		alt: `${num(count, lang)} ${unit}. ${title}. ${blurb}`,
	};
}

/** The collections index: six real slices, each panel a bar as well as a number. */
function collectionsCard(lang: Lang): string {
	const top = [...collectionSizes.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 6);
	const title = T(lang, "collections.title");
	let out = "";
	top.forEach(([slug, count], i) => {
		const x = 80 + (i % 3) * (1040 / 3);
		const y = 222 + Math.floor(i / 3) * 136;
		const pw = 1040 / 3 - 20;
		const name = T(lang, `collection.${slug}.title`);
		const size = fitSize(name, pw - 44, 22, 15);
		out +=
			panel(x, y, pw, 116, { fill: t.s2, r: 14 }) +
			disp(x + 22, y + 58, num(count, lang), { size: 44, fill: t.brand }) +
			text(x + 22, y + 88, clip(name, pw - 44, size), { size, fill: t.text }) +
			`<rect x="${x + 22}" y="${y + 100}" width="${Math.max(8, (count / biggestCollection) * (pw - 44))}" height="6" rx="3" fill="${tint(t.brand, 0.55)}"/>`;
	});
	const foot = lead(T(lang, "collections.blurb"), 1040, 24, 1);
	return frame(`
	${disp(80, 168, clip(title, 1040, 56, 700, DISP), { size: 56, fill: t.text })}
	${out}
	${text(80, 528, clip(foot, 1040, 24), { size: 24, fill: t.muted })}
	${footerBar({ y: 596 })}`);
}

/** The categories index: ten themes, each with the weight it actually carries. */
function categoriesCard(lang: Lang): string {
	let out = "";
	const themes = CATEGORY_GROUPS.map((group) => {
		const cats = liveCategories.filter((c) => c.group === group);
		const slugs = new Set(cats.map((c) => c.slug));
		return {
			group,
			cats: cats.length,
			prods: products.filter((p) => slugs.has(p.category)).length,
		};
	}).filter((row) => row.cats > 0);

	themes.forEach((row, i) => {
		const x = 80 + (i % 5) * 208;
		const y = 228 + Math.floor(i / 5) * 138;
		const name = T(lang, `catGroup.${row.group}`);
		out +=
			panel(x, y, 188, 118, { fill: t.s2, r: 14 }) +
			`<rect x="${x}" y="${y}" width="188" height="5" rx="2.5" fill="${tint(t.brand, 0.5)}"/>` +
			disp(x + 18, y + 56, num(row.prods, lang), { size: 38, fill: t.brand }) +
			text(x + 18, y + 84, clip(name, 152, fitSize(name, 152, 18, 13)), {
				size: fitSize(name, 152, 18, 13),
				fill: t.text,
			}) +
			text(
				x + 18,
				y + 106,
				`${num(row.cats, lang)} ${T(lang, "cats.inGroup")}`,
				{
					size: 16,
					fill: t.muted,
					font: MONO,
				},
			);
	});

	const title = T(lang, "page.categories");
	return frame(`
	${headline(80, 178, title, 1040, 62, 36)}
	${out}
	${footerBar({ y: 588 })}`);
}

/** The alternatives hub: the catalogue as a wall, the count underneath. */
async function projectsCard(lang: Lang): Promise<string> {
	const wall = (await wallPool()).slice(0, 20);
	for (const p of wall) await loadLogo(projectIcon(p.source), 76);

	let art = "";
	wall.forEach((p, i) => {
		const row = Math.floor(i / 10);
		art += `<g opacity="${row === 0 ? "0.95" : "0.55"}">${logo(78 + (i % 10) * 108, row === 0 ? 64 : 168, 76, projectIcon(p.source), p.name)}</g>`;
	});

	const sub = T(lang, "cats.projects");
	return frame(`
	${art}
	${disp(80, 438, num(projects.length, lang), { size: 160, fill: t.brand })}
	${text(80, 492, clip(sub, 1040, 30, 600), { size: 30, fill: t.text, weight: 600 })}
	${text(80, 532, clip(catalogueLine(lang), 1040, 23), { size: 23, fill: t.muted })}
	${footerBar({ y: 596 })}`);
}

/** The home card: the verdict split, and six swaps drawn icon to icon. */
async function homeCard(lang: Lang): Promise<string> {
	// Six real marks, all different. Deduplicated on the rendered icon rather than
	// on its path: Docker Desktop and Docker Hub are two files carrying one whale,
	// and two whales in a row of six reads as a bug rather than as a catalogue.
	const seen = new Set<string>();
	const pairs: { p: Product; alt: OssAlternative }[] = [];
	for (const p of byWeight(products)) {
		if (pairs.length === 6) break;
		const alt = topOss(p);
		if (!alt) continue;
		const from = productIcon(p);
		const to = projectIcon(alt.source);
		if (!(await usableIcon(from)) || !(await usableIcon(to))) continue;
		await loadLogo(from, 46);
		await loadLogo(to, 46);
		const a = logoCache.get(`${from}@46`);
		const b = logoCache.get(`${to}@46`);
		if (!a || !b || a === b || seen.has(a) || seen.has(b)) continue;
		seen.add(a);
		seen.add(b);
		pairs.push({ p, alt });
	}

	// The site sets its own question in two halves: the wordmark is the question.
	const title =
		lang === "fr"
			? `${T(lang, "hero.title")} ?`
			: `${T(lang, "hero.title")} it?`;
	const sub = `${num(products.length, lang)} ${T(lang, "stats.products")}, ${num(totalAlternatives, lang)} ${T(lang, "stats.alternatives")}.`;

	let bar = "";
	let x = 80;
	const segments: [string, number, string][] = [
		[T(lang, "verdict.yes").toLowerCase(), verdictTotals.yes ?? 0, t.yes],
		[
			T(lang, "verdict.almost").toLowerCase(),
			verdictTotals.almost ?? 0,
			t.almost,
		],
		[
			T(lang, "verdict.not-yet").toLowerCase(),
			verdictTotals["not-yet"] ?? 0,
			t.no,
		],
	];
	segments.forEach(([label, v, col], i) => {
		const w = (v / products.length) * (W - 160) - 8;
		const last = i === 2;
		bar +=
			`<rect x="${x}" y="306" width="${w}" height="24" rx="12" fill="${col}"/>` +
			disp(last ? x + w : x, 394, num(v, lang), {
				size: 52,
				fill: col,
				anchor: last ? "end" : "start",
			}) +
			text(last ? x + w : x, 426, label, {
				size: 21,
				fill: t.muted,
				font: MONO,
				anchor: last ? "end" : "start",
			});
		x += w + 8;
	});

	let strip = "";
	pairs.forEach((r, i) => {
		const px = 80 + i * 176;
		strip +=
			logo(px, 464, 46, productIcon(r.p), r.p.name) +
			mark(px + 56, 476, 26) +
			logo(px + 94, 464, 46, projectIcon(r.alt.source), r.alt.name);
	});

	return frame(`
	${mark(80, 74, 44)}
	${wordmark(140, 108, 36)}
	${disp(80, 212, title, { size: fitSize(title, 1040, 80, 48, 700, DISP), fill: t.text })}
	${text(80, 262, clip(sub, 1040, 28), { size: 28, fill: t.muted })}
	${bar}
	${strip}
	${footerBar({ brandless: true })}`);
}

/** The feature matrix. The grid is texture: naming rows would mean inventing cells. */
function featuresCard(lang: Lang): string {
	let grid = "";
	for (let r = 0; r < 5; r++) {
		for (let col = 0; col < 8; col++) {
			const x = 80 + col * 78;
			const y = 222 + r * 56;
			const on = (r * 7 + col * 3) % 5 !== 0;
			grid += `<rect x="${x}" y="${y}" width="62" height="40" rx="8" fill="${on ? tint(t.yes, 0.16) : t.s2}" stroke="${t.line}" stroke-width="1.5"/>`;
			grid += on
				? tick(x + 31, y + 22, 9, t.yes)
				: cross(x + 31, y + 20, 7, tint(t.muted, 0.7));
		}
	}
	const title = T(lang, "features.title");
	const covered = Object.keys(features.projects ?? {}).length;
	const label = T(lang, "cats.projects");
	// The domains by name, as many as fit. "12 domains" would need a word for
	// "domain" that i18n does not carry, and inventing one is how copy drifts.
	const names = (features.domains as { name: Record<string, string> }[]).map(
		(d) => d.name[lang] ?? d.name.en,
	);
	let domains = "";
	for (const name of names) {
		const next = domains ? `${domains} · ${name}` : name;
		if (wid(`${next} …`, 21, 400, MONO) > 420) break;
		domains = next;
	}
	if (domains.split(" · ").length < names.length) domains += " …";
	return frame(`
	${headline(80, 172, title, 1040, 56, 38)}
	${grid}
	${disp(1120, 330, num(covered, lang), { size: 100, fill: t.brand, anchor: "end" })}
	${text(1120, 372, clip(label, 420, 24), { size: 24, fill: t.text, anchor: "end" })}
	${text(1120, 406, domains, { size: 21, fill: t.muted, anchor: "end", font: MONO })}
	${footerBar({ y: 596 })}`);
}

/**
 * The gaps card: the count in verdict red, and the products it names.
 *
 * The PAID half only, and headed with that list's own heading rather than the
 * page title. The card is the unfurl for a `<title>` that says "31 paid tools",
 * so drawing 43 and six logos that include Pandoc would put the contradiction
 * the page was split to remove straight into the share preview.
 */
async function gapsCard(lang: Lang): Promise<string> {
	const notYet = byWeight(splitGaps(products).paid);
	const shown = notYet.slice(0, 6);
	for (const p of shown) await loadLogo(productIcon(p), 60);

	let row = "";
	shown.forEach((p, i) => {
		const x = 80 + i * 150;
		row +=
			logo(x, 412, 60, productIcon(p), p.name) +
			`<circle cx="${x + 56}" cy="418" r="14" fill="${t.no}" stroke="${t.bg}" stroke-width="3"/>` +
			cross(x + 56, 418, 6, "#ffffff") +
			text(x + 30, 506, clip(p.name, 140, 16, 400, MONO), {
				size: 16,
				fill: t.muted,
				anchor: "middle",
				font: MONO,
			});
	});

	const head = wrap(T(lang, "gaps.paidHeading"), 690, 50, 2, 700, DISP);
	const sub = lead(T(lang, "gaps.blurb"), 690, 24, 2);
	return frame(`
	${disp(80, 340, num(notYet.length, lang), { size: 250, fill: t.no })}
	${head.map((l, i) => disp(430, 212 + i * 62, l, { size: 50, fill: i === 0 ? t.text : t.no })).join("\n\t")}
	${wrap(sub, 690, 24, 2)
		.map((l, i) => text(430, 330 + i * 32, l, { size: 24, fill: t.muted }))
		.join("\n\t")}
	${row}
	${footerBar()}`);
}

/**
 * The stats card.
 *
 * The design set four figures across it, one of them the number of pages the
 * site builds. That count belongs to scripts/prerender.ts and is not knowable
 * from the catalogue alone, and a figure on a card that nothing can check is the
 * thing this whole set exists to avoid. So the card carries the page's own
 * headline, blurb and method note instead, and no invented number.
 */
function statsCard(lang: Lang): string {
	const title = T(lang, "sitestats.title");
	const blurb = wrap(T(lang, "sitestats.blurb"), 1040, 27, 3);
	const method = wrap(T(lang, "sitestats.method"), 1040, 20, 2, 400, MONO);
	return frame(`
	${headline(80, 180, title, 1040, 56, 38)}
	${blurb.map((l, i) => text(80, 260 + i * 42, l, { size: 27, fill: t.text })).join("\n\t")}
	<path d="M80 412 H${W - 80}" stroke="${t.line}" stroke-width="2"/>
	${method.map((l, i) => text(80, 456 + i * 30, l, { size: 20, fill: t.muted, font: MONO })).join("\n\t")}
	${footerBar()}`);
}

/**
 * The glossary card: one term, one rule, set large.
 *
 * The shareable unit here is the sentence, not the page. The design's mono line
 * counted the terms; the count lives in the blurb the page already prints, so
 * the blurb carries it instead of a second figure that could drift from it.
 */
function glossaryCard(lang: Lang): string {
	const term = cap(T(lang, "facts.openCore"));
	const rule = wrap(T(lang, "def.facts.openCore.major"), 1040, 34, 2);
	const body = wrap(lead(T(lang, "glossary.blurb"), 1040, 26, 2), 1040, 26, 2);
	const size = fitSize(term, 700, 92, 48, 700, DISP);
	return frame(`
	${disp(80, 214, term, { size, fill: t.brand })}
	<path d="M80 244 H${80 + Math.min(1040, wid(term, size, 700, DISP))}" stroke="${t.brand}" stroke-width="6" stroke-linecap="round"/>
	${rule.map((l, i) => text(80, 316 + i * 48, l, { size: 34, fill: t.text })).join("\n\t")}
	${body.map((l, i) => text(80, 430 + i * 38, l, { size: 26, fill: t.muted })).join("\n\t")}
	${footerBar()}`);
}

/** The submit card: one page with one job, so the call to action is the headline. */
async function submitCard(lang: Lang): Promise<string> {
	const wall = (await wallPool())
		.slice(20, 29)
		.map((p) => [projectIcon(p.source), p.name] as [string | null, string]);
	for (const [file] of wall) await loadLogo(file, 64);
	let art = "";
	wall.forEach(([file, label], i) => {
		art += `<g opacity="0.8">${logo(886 + (i % 3) * 86, 92 + Math.floor(i / 3) * 86, 64, file, label)}</g>`;
	});

	const title = T(lang, "submit.title");
	// Three lines, because the French blurb runs one line longer than the English
	// and losing its last clause loses the point: no form, no account, open a
	// pull request. The third baseline sits 16px clear of the button below it.
	const blurb = wrap(T(lang, "submit.blurb"), 760, 25, 3);
	const url = `${SITE}${alternateUrls({ name: "submit", lang })[lang]}`;
	const cta = pill(80, 344, url, {
		fill: t.brand,
		fg: "#ffffff",
		size: 24,
		h: 56,
		pad: 26,
		font: MONO,
	});
	return frame(`
	${art}
	${headline(80, 196, title, 760, 64, 40)}
	${blurb.map((l, i) => text(80, 256 + i * 36, l, { size: 25, fill: t.muted })).join("\n\t")}
	${cta.svg}
	${text(80, 478, clip(catalogueLine(lang), 760, 25), { size: 25, fill: t.muted })}
	${footerBar()}`);
}

/** The sponsor card. Everything on it is a figure from slots.json or sponsorship.ts. */
function sponsorCard(lang: Lang): string {
	const priced = (placement: string) => {
		const cents = slots
			.filter((s) => s.placement === placement)
			.map((s) => s.priceCents);
		return {
			count: cents.length,
			low: Math.min(...cents) / 100,
			high: Math.max(...cents) / 100,
		};
	};
	const blocks: [string, ReturnType<typeof priced>, number][] = [
		[T(lang, "ads.chipHero"), priced("hero"), 80],
		[T(lang, "ads.tabRail"), priced("rail"), 610],
	];

	let panels = "";
	for (const [label, p, x] of blocks) {
		// The word, never a dash. The approved card reads "$300 to $1,200".
		const range = `${money(p.low, lang)} ${lang === "fr" ? "à" : "to"} ${money(p.high, lang)}`;
		panels +=
			panel(x, 216, 510, 150, { fill: t.s2, r: 14 }) +
			text(x + 28, 262, clip(label, 340, 24, 600), {
				size: 24,
				fill: t.text,
				weight: 600,
			}) +
			text(x + 482, 262, `× ${num(p.count, lang)}`, {
				size: 20,
				fill: t.muted,
				anchor: "end",
				font: MONO,
			}) +
			disp(x + 28, 324, range, {
				size: fitSize(range, 454, 40, 24, 700, DISP),
				fill: t.brand,
			});
	}

	// Every figure derived from SPONSOR_TERMS, worded the way the approved card
	// words it. French puts a space before the percent sign; English does not.
	const months = SPONSOR_TERMS.map((term) => num(term.months, lang)).join(", ");
	const unit = T(lang, "ads.months");
	const pct = (off: number) =>
		lang === "fr" ? `${off} % de moins` : `${off}% off`;
	const terms = [
		`${months} ${unit}`,
		...SPONSOR_TERMS.filter((term) => discountPct(term) > 0).map((term) =>
			lang === "fr"
				? `${pct(discountPct(term))} à ${num(term.months, lang)}`
				: `${pct(discountPct(term))} at ${num(term.months, lang)}`,
		),
	].join("  ·  ");

	const promise = wrap(T(lang, "footer.policy"), 1040, 26, 2);
	const blurb = lead(T(lang, "ads.blurb"), 1040, 23, 1);
	const title = T(lang, "ads.title");
	return frame(`
	${headline(80, 152, title, 1040, 64, 40)}
	${text(80, 190, clip(blurb, 1040, 23), { size: 23, fill: t.muted })}
	${panels}
	${text(80, 414, clip(terms, 1040, 23, 400, MONO), { size: 23, fill: t.muted, font: MONO })}
	${promise.map((l, i) => text(80, 476 + i * 36, l, { size: 26, fill: t.text })).join("\n\t")}
	${footerBar()}`);
}

/** The contact card: the page's own three channels, including the honest one. */
function contactCard(lang: Lang): string {
	const rows: [string, string][] = [
		[T(lang, "contact.wrong.title"), T(lang, "contact.wrong.body")],
		[T(lang, "contact.sponsor.title"), T(lang, "contact.sponsor.body")],
		[T(lang, "contact.email.title"), T(lang, "contact.email.none")],
	];
	let out = "";
	rows.forEach(([head, body], i) => {
		const y = 252 + i * 96;
		out +=
			`<path d="M80 ${y - 38} H${W - 80}" stroke="${t.line}" stroke-width="${i ? 2 : 0}"/>` +
			disp(80, y, clip(head, 1040, 29, 700, DISP), { size: 29, fill: t.text }) +
			text(80, y + 34, clip(lead(body, 1040, 22, 1), 1040, 22), {
				size: 22,
				fill: t.muted,
			});
	});
	const title = T(lang, "contact.title");
	return frame(`
	${headline(80, 158, title, 1040, 64, 40)}
	${out}
	${footerBar()}`);
}

/** The 404 card. Dead links get shared too, usually as a screenshot. */
function notFoundCard(lang: Lang): string {
	// The site's sentence is two clauses, and the card sets one per line. It used
	// to join them with an em dash and now uses a full stop, so the split accepts
	// either. A dash is consumed as the join; a full stop is kept, because it
	// ends the first line's sentence.
	const [first, second] = T(lang, "error.noSuchPage").split(
		/\s*[—–-]\s+|(?<=\.)\s+/,
	);
	const l1 = (first ?? "").trim();
	const l2 = cap((second ?? "").trim());
	const size = Math.min(
		fitSize(l1, 900, 82, 44, 700, DISP),
		fitSize(l2, 900, 82, 44, 700, DISP),
	);
	return frame(`
	${disp(1120, 430, "404", { size: 330, fill: t.brand, anchor: "end", op: 0.1 })}
	${disp(80, 232, l1, { size, fill: t.text })}
	${disp(80, 318, l2, { size, fill: t.brand })}
	${text(80, 392, clip(catalogueLine(lang), 1000, 29), { size: 29, fill: t.muted })}
	${footerBar()}`);
}

/**
 * The static site card, the one every page without a card of its own unfurls
 * with. Still the most served image on the site by a distance, but it is now the
 * card for the `noindex` project pages, the legal pages, the session-gated ones
 * and the paginated tails rather than for 2,602 indexable project pages too.
 *
 * It lives here rather than in scripts/build-og.ts because it has to be drawn
 * by the same toolkit as everything else. The committed og.png was the old dark
 * card in a hand-plotted pixel face, carrying a tagline the site no longer uses,
 * and it stayed that way precisely because it was generated somewhere else.
 *
 * English only, deliberately. There is one file at one URL, `OG_IMAGE` in
 * seo.ts, and both languages fall back to it. A French static card would need a
 * second URL and a language branch in the fallback, which is more wiring than a
 * card nobody looks at twice deserves.
 */
function siteCard(): string {
	const oss = products.reduce(
		(n, p) => n + p.alternatives.filter((a) => a.kind === "oss").length,
		0,
	);
	return frame(`
	${mark(80, 104, 56)}
	${wordmark(80, 252, 80)}
	${text(80, 324, "Opensource, free or cheaper", { size: 34, fill: t.muted })}
	${text(80, 370, "alternatives to apps you pay for.", { size: 34, fill: t.muted })}
	${text(80, 462, `${num(products.length, "en")} products · ${num(projects.length, "en")} projects · ${num(oss, "en")} swaps checked`, { size: 26, font: MONO, fill: t.muted })}
	${footerBar({ brandless: true })}`);
}

/* ── render ────────────────────────────────────────────────────────────────── */

mkdirSync(OUT, { recursive: true });

let written = 0;
let bytes = 0;

/**
 * The alt sentences, keyed by the filename stem the card was written under, so
 * `ogFor()` in scripts/prerender.ts can look one up with the name it already
 * built. Only cards that carry one appear; the rest fall back to the page title.
 */
const alts: Record<string, string> = {};

async function write(kind: string, slug: string, card: Card | string | null) {
	if (card === null) return;
	const svg = typeof card === "string" ? card : card.svg;
	// Palette PNG: these are flat colour with a handful of logos on them, and a
	// 256-colour quantisation is a third of the bytes with no visible change.
	// The whole set ships in the image and in every deploy.
	const png = await sharp(Buffer.from(svg))
		.png({ compressionLevel: 9, palette: true, quality: 90, effort: 7 })
		.toBuffer();
	const name = slug ? `${kind}-${slug}` : kind;
	writeFileSync(join(OUT, `${name}.png`), png);
	if (typeof card !== "string") alts[name] = card.alt;
	written += 1;
	bytes += png.length;
}

/**
 * Every card, both languages, named for the route that unfurls it.
 *
 * `kind` is the route name in packages/core/src/routes.ts, so `ogFor()` in
 * scripts/prerender.ts can look a file up without a translation table between
 * the two. Project cards cover the indexable pages only, see the header.
 */
type Job = {
	kind: string;
	slug: string;
	make: () => Promise<Card | string | null>;
};

const jobs: Job[] = [];
for (const lang of LANGS) {
	for (const p of products) {
		jobs.push({
			kind: "product",
			slug: `${p.slug}-${lang}`,
			make: () => productCard(p, lang),
		});
	}
	for (const c of liveCategories) {
		jobs.push({
			kind: "category",
			slug: `${c.slug}-${lang}`,
			make: () => categoryCard(c, lang),
		});
	}
	for (const group of CATEGORY_GROUPS) {
		jobs.push({
			kind: "group",
			slug: `${group}-${lang}`,
			make: () => themeCard(group, lang),
		});
	}
	for (const def of COLLECTIONS) {
		jobs.push({
			kind: "collection",
			slug: `${def.slug}-${lang}`,
			make: () => collectionCard(def.slug, lang),
		});
	}
	// The slug is the one in the URL, not the forge-path id `Project.slug`
	// carries: `ogFor()` is handed whatever is in `/en/tools/<here>/`.
	for (const p of cardProjects) {
		jobs.push({
			kind: "project",
			slug: `${projectUrlSlug.get(p.slug) as string}-${lang}`,
			make: () => projectCard(p, lang),
		});
	}
	const singles: [string, () => Promise<string | Card> | string | Card][] = [
		["home", () => homeCard(lang)],
		["categories", () => categoriesCard(lang)],
		["collections", () => collectionsCard(lang)],
		["projects", () => projectsCard(lang)],
		["features", () => featuresCard(lang)],
		["glossary", () => glossaryCard(lang)],
		["gaps", () => gapsCard(lang)],
		["stats", () => statsCard(lang)],
		["submit", () => submitCard(lang)],
		["sponsor", () => sponsorCard(lang)],
		["contact", () => contactCard(lang)],
	];
	// English only. prerender.ts writes ONE /404.html, in DEFAULT_LANG, because
	// nginx serves it under every URL that does not exist and a 404 has no locale
	// to pick from. `notfound-fr.png` was drawn anyway and was the only file in
	// the set that nothing on the site referenced.
	if (lang === DEFAULT_LANG) {
		singles.push(["notfound", () => notFoundCard(lang)]);
	}
	for (const [kind, make] of singles) {
		jobs.push({ kind, slug: lang, make: async () => make() });
	}
}

for (const job of jobs) {
	if (written >= LIMIT) break;
	await write(job.kind, job.slug, await job.make());
}

// The static card is not one of the jobs: it is one file, it is not per route,
// and it lands beside the og/ directory rather than inside it.
if (written < LIMIT) {
	const png = await sharp(Buffer.from(siteCard()))
		.png({ compressionLevel: 9, palette: true, quality: 90, effort: 7 })
		.toBuffer();
	writeFileSync(join(FE, "public/og.png"), png);
	written += 1;
	bytes += png.length;
}

/**
 * The manifest and the icons land on a full run only. `--limit` draws a handful
 * for looking at, and writing `alt.json` from that would strip the alt text off
 * every card the run never reached.
 */
const FULL = !Number.isFinite(LIMIT);

if (FULL) {
	writeFileSync(
		join(OUT, "alt.json"),
		`${JSON.stringify(alts, Object.keys(alts).sort(), "\t")}\n`,
	);
}

/* ── icons ─────────────────────────────────────────────────────────────────── */

/**
 * The rasters, from the same SVG the browser tab uses.
 *
 * `favicon.svg` was the only icon the site had, and Google's favicon
 * documentation lists every other format and never names SVG — so the entry in
 * search results may have been a blank globe. iOS ignores an SVG icon outright.
 *
 * Drawn here rather than in a script of their own because they are the same
 * brand, the same `sharp`, and the same output directory as the cards, and they
 * change on the same occasions: when the mark does.
 */
const ICON_SVG = readFileSync(join(FE, "public/favicon.svg"));

/** librsvg rasterises off the density, so ask for the size rather than scaling up. */
const raster = (size: number) =>
	sharp(ICON_SVG, { density: (72 * size) / 32 })
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toBuffer();

/**
 * The mark on an opaque tile, inset.
 *
 * `favicon.svg` deliberately has no background — a tile eats a 16x16 tab icon.
 * Two places need one anyway: iOS composites a transparent apple-touch-icon onto
 * BLACK, which turns the grey arrow invisible, and a knowledge-panel logo is
 * shown on white.
 */
async function tile(size: number, pad: number): Promise<Buffer> {
	const inner = Math.round(size * (1 - pad * 2));
	const mark = await raster(inner);
	return sharp({
		create: {
			width: size,
			height: size,
			channels: 4,
			background: t.bg,
		},
	})
		.composite([
			{
				input: mark,
				top: Math.round((size - inner) / 2),
				left: Math.round((size - inner) / 2),
			},
		])
		.png({ compressionLevel: 9 })
		.toBuffer();
}

if (FULL) {
	const pub = (name: string) => join(FE, "public", name);
	const icons: [string, Buffer][] = [
		// Google's rule is square, at least 8x8, larger than 48x48 preferred.
		["favicon-96x96.png", await raster(96)],
		["icon-192.png", await raster(192)],
		["icon-512.png", await raster(512)],
		["apple-touch-icon.png", await tile(180, 0.16)],
		// The square brand mark, for `Organization.logo` in
		// apps/frontend/src/seo.ts. That property pointed at og.png, which is a
		// 1200x630 share card and not a logo at all.
		["logo-512.png", await tile(512, 0.16)],
	];
	for (const [name, buf] of icons) writeFileSync(pub(name), buf);

	writeFileSync(
		pub("site.webmanifest"),
		`${JSON.stringify(
			{
				name: "canireplaceit",
				short_name: "canireplaceit",
				start_url: "/",
				display: "browser",
				background_color: t.bg,
				theme_color: t.bg,
				icons: [
					{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
					{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
				],
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(
		`${icons.length} icons + site.webmanifest · apps/frontend/public`,
	);
}

console.log(
	`${written} cards · ${(bytes / 1024 / 1024).toFixed(1)} MB · ${THEME} · ${OUT.replace(`${ROOT}/`, "")}`,
);
