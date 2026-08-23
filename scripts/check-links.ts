#!/usr/bin/env bun
/**
 * Every internal link in the built site resolves to a document we actually
 * wrote. Exits non-zero if one does not.
 *
 *   bun run scripts/check-links.ts        (after `bun run build`)
 *
 * WHY THIS EXISTS: the site shipped 8260 broken links — `/en/estimate/` and
 * `/fr/estimation/`, one on every page of each locale, from the hero button and
 * the footer — and every other check passed the whole time. The links were
 * built from `paths` so they were type-correct; the route parsed; the component
 * rendered; validation only reads `data/`. The fault existed ONLY in the
 * assembled output, which is the one place nothing was looking.
 *
 * That is the class of bug this catches: not "is this link well-formed" but
 * "did anybody build the page at the other end".
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const DIST = join(import.meta.dir, "..", "apps/frontend/dist");

const pages: string[] = [];
(function walk(dir: string) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walk(p);
		else if (e.name.endsWith(".html")) pages.push(p);
	}
})(DIST);

if (pages.length === 0) {
	console.error("✗ no built pages found — run `bun run build` first");
	process.exit(1);
}

/** Every URL the build actually produced, as the path a browser would request. */
const built = new Set<string>();
for (const p of pages) {
	const dir = relative(DIST, join(p, "..")).replaceAll("\\", "/");
	built.add(dir === "" ? "/" : `/${dir}/`);
}

// Assets are served from disk by nginx, not prerendered, so they are not in the
// page set and are not this check's business.
const ASSET = /\.(png|jpe?g|svg|webmanifest|ico|webp|xml|txt|json|js|css|woff2?)$/;

const broken = new Map<string, { count: number; firstSeenOn: string }>();
let checked = 0;

for (const p of pages) {
	const html = readFileSync(p, "utf8");
	for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
		// Fragments and query strings address a page, they do not make a new one.
		const raw = (m[1] ?? "").split("#")[0]?.split("?")[0] ?? "";
		if (raw === "" || ASSET.test(raw)) continue;
		checked++;
		const href = raw.endsWith("/") ? raw : `${raw}/`;
		if (built.has(href)) continue;
		const seen = broken.get(href);
		if (seen) seen.count++;
		else broken.set(href, { count: 1, firstSeenOn: relative(DIST, p) });
	}
}

console.log(
	`${pages.length} pages · ${checked} internal links · ${built.size} URLs built`,
);

if (broken.size === 0) {
	console.log("All internal links resolve.");
	process.exit(0);
}

const rows = [...broken.entries()].sort((a, b) => b[1].count - a[1].count);
const total = rows.reduce((n, [, v]) => n + v.count, 0);
console.error(
	`\n✗ ${total} broken link(s) to ${rows.length} missing URL(s):\n`,
);
for (const [href, v] of rows) {
	console.error(`  ${String(v.count).padStart(6)}  ${href}`);
	console.error(`          first seen on ${v.firstSeenOn}`);
}
console.error(
	"\nEither the page should be prerendered, or nothing should link to it.",
);
process.exit(1);
