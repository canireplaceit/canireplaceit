#!/usr/bin/env bun
/**
 * Gives every new tool its address, once, in data/project-slugs.json.
 *
 * A tool's URL used to be recomputed from its name on every build, so a product
 * file spelling the name differently, or a second project with the same name,
 * silently moved a page Google had already indexed. The file holds every
 * address ever published and this only adds to it: an existing entry is never
 * rewritten, and a tool that leaves the catalogue keeps its entry, so nothing
 * else can take its address.
 *
 * Moving an address on purpose is a hand edit to that file plus a line in
 * data/redirects.json. `bun run validate` checks both.
 *
 *   bun run slugs
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectProjects, type Product } from "core/src/content";
import { buildProjectSlugs } from "core/src/routes";

const DATA = join(import.meta.dir, "../data");
const FILE = join(DATA, "project-slugs.json");

const lock = JSON.parse(readFileSync(FILE, "utf8")) as {
	$comment: string;
	slugs: Record<string, string>;
};
const products: Product[] = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.sort()
	.map((f) => JSON.parse(readFileSync(join(DATA, "products", f), "utf8")));

const added: string[] = [];
for (const [id, slug] of buildProjectSlugs(
	collectProjects(products),
	lock.slugs,
)) {
	if (lock.slugs[id]) continue;
	lock.slugs[id] = slug;
	added.push(`${id} -> ${slug}`);
}

lock.slugs = Object.fromEntries(
	Object.entries(lock.slugs).sort(([a], [b]) => (a < b ? -1 : 1)),
);
writeFileSync(FILE, `${JSON.stringify(lock, null, "\t")}\n`);
console.log(
	added.length
		? `added ${added.length}:\n  ${added.join("\n  ")}`
		: "every tool already has an address",
);
