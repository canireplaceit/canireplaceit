#!/usr/bin/env bun
/**
 * data/redirects.json as the nginx map apps/frontend/front.conf includes.
 *
 * Every retired product and tool address, in both languages and with the
 * trailing slash Google also remembers, pointing at the page that replaced it.
 * The frontend Dockerfile writes it to /etc/nginx/redirects.map.
 *
 *   bun scripts/nginx-redirects.ts > redirects.map
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SupportedLangs } from "core/src/index";
import { paths } from "core/src/routes";

const redirects = JSON.parse(
	readFileSync(join(import.meta.dir, "../data/redirects.json"), "utf8"),
) as { products: Record<string, string>; projects: Record<string, string> };

const lines: string[] = [];
for (const lang of SupportedLangs) {
	for (const [kind, toPath] of [
		["products", paths.product],
		["projects", paths.project],
	] as const) {
		for (const [from, to] of Object.entries(redirects[kind])) {
			const target = toPath(lang, to);
			lines.push(`${toPath(lang, from)} ${target};`);
			lines.push(`${toPath(lang, from)}/ ${target};`);
		}
	}
}
console.log(lines.join("\n"));
