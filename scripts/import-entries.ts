#!/usr/bin/env bun
/**
 * One-way importer: legacy `entries[]` modules -> data/products/<slug>.json.
 *
 * Used to migrate the original seed file and to land research batches without
 * hand-writing 130 files. Existing files are overwritten, so re-running is safe.
 *
 *   bun scripts/import-entries.ts <module.ts> [more.ts …]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Alternative, Category, Product } from "core/src/content";

type LegacyAlt = {
	kind?: "oss" | "cheaper";
	name: string;
	repo?: string;
	url?: string;
	license?: string;
	effort?: "managed" | "docker" | "ops";
	price?: number;
	priceMonthly?: number;
	note: string;
	noteFr?: string;
};

type LegacyEntry = {
	slug: string;
	name: string;
	domain?: string;
	category: string;
	price: number;
	verdict: "yes" | "almost" | "not-yet";
	why: string;
	whyFr?: string;
	whatYouLose?: { en: string; fr?: string }[] | string[];
	alts: LegacyAlt[];
};

const ROOT = join(import.meta.dir, "..");
const DATA = join(ROOT, "data");
const OUT = join(DATA, "products");

const slugify = (s: string) =>
	s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

const tr = (en: string, fr?: string) => (fr ? { en, fr } : { en });

/** Best-guess icon per category; a human can improve these in the JSON later. */
const ICONS: Record<string, string> = {
	analytics: "chart-line",
	ai: "sparkles",
	auth: "key-round",
	automation: "workflow",
	backend: "server",
	cms: "layout-template",
	comms: "message-square",
	crm: "contact",
	design: "pen-tool",
	"dev-tools": "terminal",
	documents: "file-text",
	"e-commerce": "shopping-cart",
	forms: "clipboard-list",
	"internal-tools": "wrench",
	marketing: "megaphone",
	"notes-docs": "notebook-pen",
	observability: "activity",
	payments: "credit-card",
	productivity: "check-check",
	"project-mgmt": "kanban",
	scheduling: "calendar",
	search: "search",
	security: "shield",
	storage: "hard-drive",
	support: "life-buoy",
	video: "video",
	"website-builders": "globe",
};

const categories: Map<string, Category> = new Map();
if (existsSync(join(DATA, "categories.json"))) {
	for (const c of JSON.parse(
		readFileSync(join(DATA, "categories.json"), "utf8"),
	) as Category[]) {
		categories.set(c.slug, c);
	}
}

mkdirSync(OUT, { recursive: true });

let written = 0;
const files = process.argv.slice(2);
if (files.length === 0) {
	console.error("usage: bun scripts/import-entries.ts <module.ts> […]");
	process.exit(1);
}

for (const file of files) {
	const mod = (await import(join(process.cwd(), file))) as {
		entries: LegacyEntry[];
	};
	for (const e of mod.entries) {
		const catSlug = slugify(e.category);
		if (!categories.has(catSlug)) {
			categories.set(catSlug, {
				slug: catSlug,
				name: { en: e.category },
				icon: ICONS[catSlug] ?? "box",
				position: categories.size,
			});
		}

		const alternatives: Alternative[] = e.alts.map((a) => {
			const kind = a.kind ?? (a.repo ? "oss" : "cheaper");
			if (kind === "cheaper") {
				return {
					kind: "cheaper",
					name: a.name,
					url: a.url ?? "",
					priceMonthly: a.priceMonthly ?? a.price ?? 0,
					note: tr(a.note, a.noteFr),
				};
			}
			return {
				kind: "oss",
				name: a.name,
				repo: a.repo ?? "",
				license: a.license ?? "Unknown",
				effort: a.effort ?? "docker",
				note: tr(a.note, a.noteFr),
			};
		});

		const whatYouLose = (e.whatYouLose ?? []).map((b) =>
			typeof b === "string" ? { en: b } : b,
		);

		const product: Product = {
			slug: e.slug,
			name: e.name,
			domain: e.domain ?? null,
			category: catSlug,
			priceMonthly: e.price || null,
			pricing: null,
			verdict: e.verdict,
			why: tr(e.why, e.whyFr),
			// The legacy shape had no downsides list; seed it from the argument so the
			// file is valid, and let PRs split it into real bullets.
			whatYouLose: whatYouLose.length > 0 ? whatYouLose : [tr(e.why, e.whyFr)],
			alternatives,
			priority: 3,
		};

		writeFileSync(
			join(OUT, `${e.slug}.json`),
			`${JSON.stringify(product, null, "\t")}\n`,
		);
		written++;
	}
}

const sorted = [...categories.values()]
	.sort((a, b) => a.slug.localeCompare(b.slug))
	.map((c, i) => ({ ...c, position: i }));
writeFileSync(
	join(DATA, "categories.json"),
	`${JSON.stringify(sorted, null, "\t")}\n`,
);

console.log(`wrote ${written} products, ${sorted.length} categories`);
