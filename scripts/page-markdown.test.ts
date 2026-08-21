/**
 * The Markdown twins, checked against the real catalogue.
 *
 * The twin is what an AI crawler reads instead of the page, so the failures
 * that matter are the quiet ones: a link that resolves to nothing, a sentence
 * with a hole in it, or a missing footer, which would leave a model with the
 * facts and no URL to credit them to.
 *
 *   bun test scripts/page-markdown.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, HealthFile, Product } from "core/src/content";
import { collectProjects, projectSlug } from "core/src/content";
import { buildProjectSlugs } from "core/src/routes";
import { type MdBoot, markdownFor, mdFor } from "./page-markdown";

const DATA = join(import.meta.dir, "../data");
const SITE = "https://canireplaceit.com";

const read = <T>(p: string): T =>
	JSON.parse(readFileSync(join(DATA, p), "utf8")) as T;

const products = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.map((f) => read<Product>(`products/${f}`))
	.map((p) => ({ ...p, switchedCount: 0 }));

const categories = read<Category[]>("categories.json");
const health = read<HealthFile>("health.json");
const allProjects = collectProjects(products);
const prettySlug = buildProjectSlugs(
	allProjects,
	products.map((p) => p.slug),
);

/** The same payload scripts/prerender.ts builds for a page. */
const bootFor = (subset: typeof products): MdBoot => ({
	products: subset,
	categories,
	projectSlugs: collectProjects(subset).map((p) => [
		p.slug,
		prettySlug.get(p.slug) as string,
	]),
	health,
});

const notion = products.find((p) => p.slug === "notion") as Product & {
	switchedCount: number;
};

const productDoc = (p: typeof notion, lang: "en" | "fr" = "en") =>
	markdownFor({
		route: { name: "product", lang, slug: p.slug },
		url: `/${lang}/alternatives/${p.slug}`,
		lang,
		title: `${p.name} alternatives`,
		description: "test",
		boot: bootFor([p]),
		site: SITE,
		lastmod: "2026-08-21",
	}) as string;

describe("file paths", () => {
	test("appending .md to a page URL is the whole rule", () => {
		expect(mdFor("/en/alternatives/notion")).toEqual([
			"en/alternatives/notion.md",
		]);
	});

	test("an index URL gets both spellings", () => {
		expect(mdFor("/en/")).toEqual(["en/index.md", "en.md"]);
	});
});

describe("a product twin", () => {
	test("leads with the answer, then the price with its receipt", () => {
		const md = productDoc(notion);
		const opening = md.slice(0, 400);
		expect(opening).toContain("# ");
		// The verdict is in the first paragraph, not buried under a table.
		expect(opening.toLowerCase()).toMatch(/yes|almost|not yet/);
		expect(opening).toContain(notion.pricing?.checkedOn as string);
		expect(opening).toContain(notion.pricing?.url as string);
	});

	test("always ends with the URL to cite", () => {
		const md = productDoc(notion);
		expect(md).toContain(`Source: ${SITE}/en/alternatives/notion`);
		expect(md).toContain("CC-BY-4.0");
		expect(md).toContain(`${SITE}/api/v1/products/notion`);
	});

	test("links every alternative to the slug the site publishes", () => {
		const md = productDoc(notion);
		const published = new Set(prettySlug.values());
		const linked = [...md.matchAll(/\/en\/tools\/([a-z0-9-]+)\)/g)].map(
			(m) => m[1],
		);
		expect(linked.length).toBeGreaterThan(0);
		for (const slug of linked) expect(published.has(slug)).toBe(true);
	});

	test("never publishes a hole in a sentence, in either language", () => {
		// Sampled across the catalogue rather than one product, because the holes
		// appear where a field is absent, and notion has most of them filled.
		const sample = [
			notion,
			...products.filter((p) => p.priceMonthly === null).slice(0, 5),
			...products.filter((p) => p.verdict === "not-yet").slice(0, 5),
		];
		for (const p of sample) {
			for (const lang of ["en", "fr"] as const) {
				const md = productDoc(p, lang);
				expect(md).not.toContain("undefined");
				expect(md).not.toContain("NaN");
				expect(md).not.toContain("[object Object]");
			}
		}
	});

	test("a table cell can never break its row", () => {
		// A cell holding free text is one pipe away from splitting its row into an
		// extra column and silently corrupting the rest of the table. The project
		// twin puts a citation note in a cell, so that is where this is tested.
		const project = allProjects.find(
			(p) => p.replaces.length > 0,
		) as (typeof allProjects)[number];
		const slug = prettySlug.get(project.slug) as string;
		const citing = products.filter((p) =>
			p.alternatives.some(
				(a) => a.kind === "oss" && projectSlug(a.source) === project.slug,
			),
		);
		const piped = citing.map((p) => ({
			...p,
			alternatives: p.alternatives.map((a) =>
				a.kind === "oss" && projectSlug(a.source) === project.slug
					? { ...a, note: { en: "a | b", fr: "a | b" } }
					: a,
			),
		})) as typeof products;

		const md = markdownFor({
			route: { name: "project", lang: "en", slug },
			url: `/en/tools/${slug}`,
			lang: "en",
			title: project.name,
			description: "test",
			boot: bootFor(piped),
			site: SITE,
			lastmod: "2026-08-21",
		}) as string;

		expect(md).toContain("a \\| b");
		// Every row in the table has the same number of columns.
		const rows = md
			.split("\n")
			.filter((l) => l.startsWith("| ") && !l.startsWith("|---"));
		const widths = new Set(rows.map((r) => r.split(/(?<!\\)\|/).length));
		expect(widths.size).toBe(1);
	});
});

describe("a project twin", () => {
	const project = allProjects.find(
		(p) => p.replaces.length > 3 && !p.archived,
	) as (typeof allProjects)[number];
	const slug = prettySlug.get(project.slug) as string;

	const doc = markdownFor({
		route: { name: "project", lang: "en", slug },
		url: `/en/tools/${slug}`,
		lang: "en",
		title: project.name,
		description: "test",
		boot: bootFor(
			products.filter((p) =>
				p.alternatives.some(
					(a) => a.kind === "oss" && projectSlug(a.source) === project.slug,
				),
			),
		),
		site: SITE,
		lastmod: "2026-08-21",
	}) as string;

	test("is rebuilt from the products that cite it", () => {
		expect(doc).toBeTruthy();
		expect(doc).toContain(`# ${project.name}`);
		expect(doc).toContain(project.license);
		expect(doc).toContain(project.source.url);
	});

	test("lists what it replaces, with links back to those products", () => {
		expect(doc).toContain("## Replaces");
		expect(doc).toContain(`${SITE}/en/alternatives/`);
	});

	test("carries its own citation footer", () => {
		expect(doc).toContain(`Source: ${SITE}/en/tools/${slug}`);
	});
});

describe("the gaps page", () => {
	const gaps = products.filter((p) => p.verdict === "not-yet");

	const doc = markdownFor({
		route: { name: "gaps", lang: "en" },
		url: "/en/gaps",
		lang: "en",
		title: "What open source still cannot do",
		description: "test",
		boot: bootFor(gaps),
		site: SITE,
		lastmod: "2026-08-22",
	}) as string;

	test("gets a twin, since it is the page most worth quoting", () => {
		expect(doc).toBeTruthy();
		expect(gaps.length).toBeGreaterThan(0);
	});

	test("names every product it says has no replacement", () => {
		for (const p of gaps) expect(doc).toContain(p.name);
	});

	test("points at the route that serves the same list", () => {
		expect(doc).toContain(`${SITE}/api/v1/gaps`);
		expect(doc).toContain(`Source: ${SITE}/en/gaps`);
	});
});

describe("pages with nothing to say", () => {
	test("get no twin rather than a stub", () => {
		// These must keep returning null. features fetches a code-split dataset,
		// stats reads live figures from Umami, and the legal copy lives in the
		// React tree. Gaps is the only standing page with a payload to serve.
		for (const name of [
			"legal",
			"signin",
			"dashboard",
			"admin",
			"features",
			"stats",
			"glossary",
		] as const) {
			const md = markdownFor({
				route: { name, lang: "en" },
				url: `/en/${name}`,
				lang: "en",
				title: name,
				description: "test",
				boot: bootFor([]),
				site: SITE,
				lastmod: "2026-08-21",
			});
			expect(md).toBeNull();
		}
	});
});
