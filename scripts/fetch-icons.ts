#!/usr/bin/env bun
/**
 * Downloads every icon the site needs into `apps/frontend/public/icons/`, once,
 * at build time. Nothing is fetched from a third party while a visitor is on the
 * page — favicon services are slow, rate-limited, and a privacy leak.
 *
 *   bun run icons          # fetch what's missing
 *   bun run icons --force  # re-fetch everything
 *
 * Sources, in order of preference:
 *   products / cheaper alts  -> the site's own favicon, via Google's s2 service
 *   open source alts         -> the GitHub owner's avatar (higher quality, stable)
 *
 * Everything is re-encoded to WebP before it is written, so the bytes on disk
 * always match the extension. Nothing is trusted as-is: a server that answers a
 * missing favicon with a 200 HTML error page used to leave a 231 KB "PNG" that
 * could never render, so both the content-type and the magic bytes are checked.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Forge, Product } from "core/src/content";
import { altIconKey } from "core/src/content";
import sharp from "sharp";

/** A place an icon might come from: a URL, or a lookup that produces one. */
type IconSource = string | (() => Promise<string | null>);

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data/products");
const OUT = join(ROOT, "apps/frontend/public/icons");
const FORCE = process.argv.includes("--force");

/** What we ask the aggregators for. Bigger than we keep, so downscaling is sharp. */
const SIZE = 128;
/** Some vendors sit behind a WAF that 403s anything without a browser UA. */
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** What we store. Logos render at 16–44 CSS px; 96 covers the largest at 2x. */
const ICON_SIZE = 96;

/**
 * Servers lie in both directions — a 200 `text/html` error page under a
 * `.ico` name, or a real PNG served as `application/octet-stream` — so the
 * bytes decide and the header is only used to reject the obvious.
 */
const looksLikeMarkup = (ct: string) =>
	/^(text\/|application\/(xhtml|json|xml))/.test(ct) &&
	!ct.startsWith("image/");

const starts = (b: Uint8Array, ...sig: number[]) =>
	sig.every((v, i) => b[i] === v);

type Kind = "raster" | "ico" | "svg";

/** Magic-byte sniff. Returns null for anything we cannot hand to an encoder. */
const sniff = (b: Uint8Array): Kind | null => {
	if (starts(b, 0x89, 0x50, 0x4e, 0x47)) return "raster"; // PNG
	if (starts(b, 0xff, 0xd8, 0xff)) return "raster"; // JPEG
	if (starts(b, 0x47, 0x49, 0x46, 0x38)) return "raster"; // GIF8
	if (starts(b, 0x52, 0x49, 0x46, 0x46) && starts(b.subarray(8), 0x57, 0x45))
		return "raster"; // RIFF….WE(BP)
	if (starts(b, 0x00, 0x00, 0x01, 0x00)) return "ico";
	const head = new TextDecoder().decode(b.subarray(0, 512)).toLowerCase();
	if (head.includes("<html") || head.includes("<!doctype html")) return null;
	if (head.includes("<svg")) return "svg";
	return null;
};

/**
 * ICO is a directory of bare Windows DIBs (rarely a whole PNG), and no encoder
 * reads it. Unpack the largest entry to raw RGBA ourselves: the last-resort
 * `/favicon.ico` source hands us these, and 11 of our vendors have nothing else.
 */
const decodeIco = (b: Buffer) => {
	const count = b.readUInt16LE(4);
	let best = -1;
	let bestPx = -1;
	for (let i = 0; i < count; i++) {
		const px = (b[6 + i * 16] || 256) * (b[7 + i * 16] || 256);
		if (px > bestPx) [bestPx, best] = [px, 6 + i * 16];
	}
	if (best < 0) throw new Error("ico has no entries");
	const off = b.readUInt32LE(best + 12);
	// PNG-in-ICO: hand the payload straight to the encoder.
	if (starts(b.subarray(off), 0x89, 0x50, 0x4e, 0x47))
		return sharp(b.subarray(off, off + b.readUInt32LE(best + 8)));

	const w = b.readInt32LE(off + 4);
	const h = Math.abs(b.readInt32LE(off + 8)) / 2; // height counts the AND mask
	const bpp = b.readUInt16LE(off + 14);
	if (b.readUInt32LE(off + 16) !== 0) throw new Error("compressed ico");
	const palN = b.readUInt32LE(off + 32) || (bpp <= 8 ? 1 << bpp : 0);
	const pal = off + 40;
	const px = pal + palN * 4;
	const rowBytes = Math.ceil((w * bpp) / 32) * 4; // rows pad to 4 bytes
	const maskRow = Math.ceil(w / 32) * 4;
	const mask = px + rowBytes * h;

	const out = Buffer.alloc(w * h * 4);
	for (let y = 0; y < h; y++) {
		const row = px + (h - 1 - y) * rowBytes; // DIB rows are bottom-up
		for (let x = 0; x < w; x++) {
			let r: number;
			let g: number;
			let bl: number;
			let a = 255;
			if (bpp === 32) {
				const i = row + x * 4;
				[bl, g, r, a] = [b[i], b[i + 1], b[i + 2], b[i + 3]];
			} else if (bpp === 24) {
				const i = row + x * 3;
				[bl, g, r] = [b[i], b[i + 1], b[i + 2]];
			} else {
				const bit = x * bpp;
				const byte = b[row + (bit >> 3)];
				const idx =
					bpp === 8 ? byte : (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
				const p = pal + idx * 4;
				[bl, g, r] = [b[p], b[p + 1], b[p + 2]];
			}
			// A 32bpp icon with an all-zero alpha channel means "use the AND mask".
			if (bpp !== 32 || a === 0) {
				const m = mask + (h - 1 - y) * maskRow;
				const transparent = (b[m + (x >> 3)] >> (7 - (x & 7))) & 1;
				a = transparent ? 0 : bpp === 32 ? a : 255;
			}
			const o = (y * w + x) * 4;
			[out[o], out[o + 1], out[o + 2], out[o + 3]] = [r, g, bl, a];
		}
	}
	return sharp(out, { raw: { width: w, height: h, channels: 4 } });
};

/**
 * The on-disk format is always what the extension claims, because we re-encode
 * rather than trusting whatever arrived. Logos are flat colour, where lossless
 * WebP often beats lossy outright — so encode both ways and keep the smaller.
 */
const toWebp = async (buf: Uint8Array) => {
	const kind = sniff(buf);
	if (!kind) throw new Error("not an image (html or unknown format)");
	const src = kind === "ico" ? decodeIco(Buffer.from(buf)) : sharp(buf);
	const img = src.resize(ICON_SIZE, ICON_SIZE, {
		fit: "inside",
		withoutEnlargement: true,
	});
	const [lossy, lossless] = await Promise.all([
		img.clone().webp({ quality: 82, effort: 6 }).toBuffer(),
		img.clone().webp({ lossless: true, effort: 6 }).toBuffer(),
	]);
	return lossless.byteLength < lossy.byteLength ? lossless : lossy;
};

/**
 * Plenty of sites have no `/favicon.ico` at all and only declare their mark in
 * the page head, often on a hashed or CDN path nothing can guess — Papeeria and
 * Editorial Manager both do. So the last resort is to read the homepage and
 * take what it points at. Apple-touch first: it is the one that is reliably big.
 */
const declaredIcon =
	(domain: string): IconSource =>
	async () => {
		const res = await fetch(`https://${domain}/`, {
			// The full browser header set, not just the UA: Bitmovin's WAF 403s
			// anything that omits Accept-Language or Sec-Fetch-Mode.
			headers: {
				"user-agent": UA,
				accept:
					"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				"accept-language": "en-US,en;q=0.9",
				"sec-fetch-mode": "navigate",
			},
			signal: AbortSignal.timeout(20_000),
		});
		if (!res.ok) return null;
		const html = await res.text();
		const links = [...html.matchAll(/<link\b[^>]*>/gi)]
			.map((m) => m[0])
			.filter((t) => /rel\s*=\s*["']?[^"'>]*icon/i.test(t));
		const href = (t: string) => t.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
		const px = (t: string) =>
			Number(t.match(/sizes\s*=\s*["']?(\d+)/i)?.[1] ?? 0);
		const best =
			links.find((t) => /apple-touch/i.test(t)) ??
			links.sort((a, b) => px(b) - px(a))[0];
		const found = best && href(best);
		return found ? new URL(found, res.url).href : null;
	};

const faviconUrls = (domain: string): IconSource[] => [
	`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${SIZE}`,
	`https://icons.duckduckgo.com/ip3/${domain}.ico`,
	// Last resort: ask the site itself. Lower quality and sometimes a 16px .ico,
	// but it is the only source for vendors neither aggregator has indexed.
	`https://${domain}/favicon.ico`,
	`https://www.${domain}/favicon.ico`,
	declaredIcon(domain),
	declaredIcon(`www.${domain}`),
];
const githubAvatar = (owner: string) => [
	`https://github.com/${owner}.png?size=${SIZE}`,
];

/**
 * The other forges do have avatars, but at a URL nothing can derive from the
 * repo path — Gitea hashes them, GitLab uploads them. So the source chain gains
 * a step that asks the forge's API first and hands back a URL, or nothing, in
 * which case the favicon chain behind it still runs.
 *
 * Gitea, Forgejo and Codeberg all speak the Gitea API; Codeberg *is* Forgejo.
 */
const forgeAvatar =
	(host: Forge, url: string, path: string): IconSource =>
	async () => {
		const origin = new URL(url).origin;
		const api =
			host === "gitlab"
				? `${origin}/api/v4/projects/${encodeURIComponent(path)}`
				: host === "gitea" || host === "forgejo" || host === "codeberg"
					? `${origin}/api/v1/repos/${path}`
					: null;
		if (!api) return null;
		const res = await fetch(api, { signal: AbortSignal.timeout(15_000) });
		if (!res.ok) return null;
		const json = (await res.json()) as {
			avatar_url?: string | null;
			owner?: { avatar_url?: string | null };
			namespace?: { avatar_url?: string | null };
		};
		// The repo's own avatar if it has one, else the owner's — a group avatar is
		// still that project's mark, where the forge's favicon is nobody's.
		const found =
			json.avatar_url || json.owner?.avatar_url || json.namespace?.avatar_url;
		// GitLab returns some of these relative to the instance.
		return found ? new URL(found, origin).href : null;
	};

const products: Product[] = readdirSync(DATA)
	.filter((f) => f.endsWith(".json"))
	.map((f) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as Product);

type Job = { path: string; urls: IconSource[]; label: string };
const jobs = new Map<string, Job>();

const add = (dir: string, key: string, urls: IconSource[], label: string) => {
	const path = join(OUT, dir, `${key}.webp`);
	if (!FORCE && existsSync(path)) return;
	jobs.set(path, { path, urls, label });
};

for (const p of products) {
	if (p.domain) add("products", p.slug, faviconUrls(p.domain), p.name);

	for (const alt of p.alternatives) {
		if (alt.kind === "oss") {
			// One file per project, never one per forge — see `altIconKey`.
			const key = altIconKey(alt.source);
			if (!key) {
				console.warn(`  ! ${alt.name}: unparseable source url`);
				continue;
			}
			if (alt.source.host === "github") {
				const owner = alt.source.path.split("/")[0];
				add("alts", key, githubAvatar(owner), alt.name);
			} else {
				const host = new URL(alt.source.url).hostname.replace(/^www\./, "");
				add(
					"alts",
					key,
					[
						forgeAvatar(alt.source.host, alt.source.url, alt.source.path),
						// The forge's own favicon last: a shared mark under a per-project
						// name is worse art but a truer link than someone else's logo.
						...faviconUrls(host),
					],
					alt.name,
				);
			}
		} else {
			try {
				const host = new URL(alt.url).hostname.replace(/^www\./, "");
				add("alts", host, faviconUrls(host), alt.name);
			} catch {
				console.warn(`  ! ${alt.name}: unparseable url ${alt.url}`);
			}
		}
	}
}

for (const dir of ["products", "alts"])
	mkdirSync(join(OUT, dir), { recursive: true });

if (jobs.size === 0) {
	console.log("Nothing to fetch — every icon is already on disk.");
	process.exit(0);
}

console.log(`Fetching ${jobs.size} icon(s)…`);

let ok = 0;
const failures: string[] = [];
const list = [...jobs.values()];

// Small concurrency: these are third-party endpoints and we are a guest.
const CONCURRENCY = 6;
for (let i = 0; i < list.length; i += CONCURRENCY) {
	await Promise.all(
		list.slice(i, i + CONCURRENCY).map(async (job) => {
			// Walk the sources in order and keep the first real image. Both
			// services answer 200 with a placeholder rather than 404ing, so the
			// body has to be inspected: Google returns a tiny globe, DuckDuckGo a
			// 1,478-byte "no icon" sprite that is byte-identical every time.
			const DDG_PLACEHOLDER = 1478;
			let last = "no source";
			for (const source of job.urls) {
				try {
					const url = typeof source === "string" ? source : await source();
					if (!url) throw new Error("source produced no url");
					const res = await fetch(url, {
						headers: { "user-agent": UA },
						signal: AbortSignal.timeout(15_000),
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const ct = (res.headers.get("content-type") || "")
						.split(";")[0]
						.trim()
						.toLowerCase();
					if (looksLikeMarkup(ct))
						throw new Error(`served ${ct}, not an image`);
					const buf = new Uint8Array(await res.arrayBuffer());
					// The size floor is an aggregator placeholder guard, so it only
					// applies to aggregators: a site's own mark can legitimately be a
					// 201-byte PNG (Papeeria's is), and rejecting that loses a real icon.
					const aggregator = /google\.com|duckduckgo\.com/.test(url);
					if (
						buf.byteLength < 100 ||
						(aggregator &&
							(buf.byteLength < 300 || buf.byteLength === DDG_PLACEHOLDER))
					)
						throw new Error("placeholder or empty response");
					// `toWebp` sniffs the magic bytes and refuses anything that is not
					// really an image, whatever the header claimed.
					writeFileSync(job.path, await toWebp(buf));
					ok++;
					last = "";
					break;
				} catch (e) {
					last = (e as Error).message;
				}
			}
			if (last) failures.push(`${job.label}: ${last}`);
		}),
	);
}

console.log(`\n${ok} fetched, ${failures.length} failed.`);
if (failures.length) {
	console.log(
		"Failed (the UI falls back to a lettermark, so this is not fatal):",
	);
	for (const f of failures) console.log(`  - ${f}`);
}
