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
import { COLLECTIONS, collectionMembers } from "core/src/collections";
import type {
	Category,
	CategoryStat,
	HealthFile,
	Product,
} from "core/src/content";
import { categoryStats, collectProjects, projectSlug } from "core/src/content";
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

/** Whole-catalogue figures, which scripts/prerender.ts puts on every page. */
const allCategoryStats: [string, CategoryStat][] = [...categoryStats(products)];
const collectionCounts: [string, number][] = COLLECTIONS.map((def) => {
	const members = collectionMembers(def.slug, products, allProjects);
	return [
		def.slug,
		def.of === "product" ? members.products.length : members.projects.length,
	];
});

/** The same payload scripts/prerender.ts builds for a page. */
const bootFor = (
	subset: typeof products,
	extra: Partial<MdBoot> = {},
): MdBoot => ({
	products: subset,
	categories,
	projectSlugs: collectProjects(subset).map((p) => [
		p.slug,
		prettySlug.get(p.slug) as string,
	]),
	health,
	categoryStats: allCategoryStats,
	...extra,
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
		const opening = md.slice(0, 700);
		expect(opening).toContain("# ");
		// The verdict is in the first paragraph, not buried under a table.
		expect(opening.toLowerCase()).toMatch(/can be replaced|almost|nothing in/);
		expect(opening).toContain(notion.pricing?.checkedOn as string);
		expect(opening).toContain(notion.pricing?.url as string);
	});

	/**
	 * The failure this guards is a verdict with no subject.
	 *
	 * "Almost. The replacements are close, with a real gap." was true, and useless
	 * to anything retrieving it: no product, no winner, no number, so there is no
	 * sentence in the document a model can lift into an answer. Every assertion
	 * below is a thing that has to survive in the first paragraph.
	 */
	test("names the product, the winner and a number in the first sentence", () => {
		const [, first] = productDoc(notion).split("**");
		expect(first).toContain("Notion");
		// The same pick `byExitQuality` hands the page itself.
		expect(first).toContain("Joplin");
		expect(first).toContain("AGPL-3.0");
		// 10 USD a month, said as the yearly figure somebody would quote.
		expect(first).toContain("$120 a year");
		// The date, spelled for a sentence rather than for a field.
		expect(first).toContain("2 August 2026");
		expect(first).toContain("What you give up:");
	});

	test("says how many alternatives there are and what they cost you", () => {
		const md = productDoc(notion);
		const oss = notion.alternatives.filter((a) => a.kind === "oss");
		const open = oss.filter(
			(a) => a.kind === "oss" && a.facts.openCore === "none",
		).length;
		expect(md).toContain(`${oss.length} open source alternatives are tracked`);
		expect(md).toContain(`${open} with nothing held back behind a paid tier`);
	});

	test("the French lede is French, not a template with English in it", () => {
		const [, first] = productDoc(notion, "fr").split("**");
		expect(first).toContain("Au 2 août 2026");
		expect(first).toContain("peut presque être remplacé");
		expect(first).toContain("Ce que vous perdez :");
		expect(first).not.toMatch(/As of|can be replaced|What you give up/);
	});

	test("falls back to the subjectless verdict when there is no winner to name", () => {
		// A `yes` or an `almost` with no living alternative has no product to put
		// in the sentence, and inventing one is the one failure worse than a vague
		// verdict.
		const orphan = { ...notion, alternatives: [] } as typeof notion;
		const md = productDoc(orphan);
		expect(md).toContain("Almost. The replacements are close");
		expect(md).not.toContain("undefined");
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

	test("writes the corpus down as a sentence somebody can quote", () => {
		// The figure existed only as JSON on /api/v1/stats, so the single most
		// citable claim this catalogue owns appeared on no page in either format.
		expect(doc).toContain(
			`${gaps.length} of the ${products.length} paid products in this catalogue have no credible open source replacement, as of `,
		);
	});

	test("does not open on a clipped meta description", () => {
		// seo.ts clamps descriptions to fit a SERP and marks the cut with an
		// ellipsis, which is right in a <meta> tag and wrong in a document: this
		// twin used to open on "...a catalogue of alternat…".
		expect(doc).not.toContain("…");
	});
});

describe("the hub twins", () => {
	const hub = (
		name: "categories" | "collections",
		description: string,
		extra: Partial<MdBoot> = {},
	) =>
		markdownFor({
			route: { name, lang: "en" },
			url: `/en/${name}/`,
			lang: "en",
			title: name,
			description,
			boot: bootFor([], extra),
			site: SITE,
			lastmod: "2026-08-22",
		}) as string;

	/**
	 * These are the pages an agent crawls to reach everything else, and both were
	 * 336 and 386 byte shells: a title, a description and a footer. `listMarkdown`
	 * only draws a table when the payload holds rows, and the hubs carry counts.
	 */
	test("the category index links every category", () => {
		const doc = hub("categories", "test");
		for (const c of categories) {
			expect(doc).toContain(`${SITE}/en/categories/${c.slug})`);
		}
	});

	test("the collection index links every collection and states its rule", () => {
		const doc = hub("collections", "test", { collectionCounts });
		for (const def of COLLECTIONS) {
			expect(doc).toContain(`${SITE}/en/collections/${def.slug})`);
		}
		// The derivation is the useful half: what "fully open" was made to mean.
		expect(doc).toContain("Derived from the licence string");
		expect(doc).not.toContain("collection.foss.title");
	});

	test("neither is a shell any more", () => {
		expect(hub("categories", "test").length).toBeGreaterThan(4000);
		expect(
			hub("collections", "test", { collectionCounts }).length,
		).toBeGreaterThan(2000);
	});
});

describe("the theme hubs", () => {
	const group = categories[0]?.group as string;
	const slugs = new Set(
		categories.filter((c) => c.group === group).map((c) => c.slug),
	);
	const inGroup = products.filter((p) => slugs.has(p.category));

	const doc = markdownFor({
		route: { name: "group", lang: "en", slug: group },
		url: `/en/themes/${group}`,
		lang: "en",
		title: group,
		description: "test",
		boot: bootFor(inGroup),
		site: SITE,
		lastmod: "2026-08-22",
	}) as string;

	// Twenty pages of real content that had no twin at all, on the one route that
	// makes 50 thin categories reachable in two clicks.
	test("gets a twin listing the products under it", () => {
		expect(doc).toBeTruthy();
		expect(inGroup.length).toBeGreaterThan(0);
		for (const p of inGroup.slice(0, 10)) expect(doc).toContain(p.name);
	});
});

describe("the glossary twin", () => {
	const doc = (lang: "en" | "fr") =>
		markdownFor({
			route: { name: "glossary", lang },
			url: `/${lang}/glossary`,
			lang,
			title: "What the words mean",
			description: "test",
			boot: bootFor([]),
			site: SITE,
			lastmod: "2026-08-22",
		}) as string;

	// Pure text with no payload behind it, which is why it had no twin — and the
	// sixteen words every other twin uses, which is why it needed one.
	test("defines every term, in both languages", () => {
		for (const lang of ["en", "fr"] as const) {
			const md = doc(lang);
			expect(md).toBeTruthy();
			// One heading per term, read off the `def.` keys in the dictionary.
			expect(md.split("\n## ").length - 1).toBeGreaterThanOrEqual(16);
			// A missing dictionary entry would leave the raw key in the document.
			expect(md).not.toContain("def.");
			expect(md).not.toContain("undefined");
		}
		expect(doc("fr")).not.toBe(doc("en"));
	});

	test("carries its citation footer like every other twin", () => {
		expect(doc("en")).toContain(`Source: ${SITE}/en/glossary`);
		expect(doc("en")).toContain("CC-BY-4.0");
	});
});

describe("the home twin", () => {
	const stats = {
		products: products.length,
		categories: categories.length,
		alternatives: products.reduce((n, p) => n + p.alternatives.length, 0),
		ossAlternatives: products.reduce(
			(n, p) => n + p.alternatives.filter((a) => a.kind === "oss").length,
			0,
		),
		notYet: products.filter((p) => p.verdict === "not-yet").length,
		monthlySpendCents: 0,
		switches: 0,
	};

	const doc = markdownFor({
		route: { name: "home", lang: "en" },
		url: "/en/",
		lang: "en",
		title: "Can I replace it?",
		description: "test",
		boot: bootFor(products.slice(0, 3), { stats }),
		site: SITE,
		lastmod: "2026-08-22",
	}) as string;

	test("opens on the corpus, in numbers, as prose", () => {
		expect(doc).toContain(`${products.length} paid products are tracked here`);
		expect(doc).toContain(`${stats.notYet} of those`);
		expect(doc).toContain("no credible open source replacement, as of ");
	});
});

describe("pages with nothing to say", () => {
	test("get no twin rather than a stub", () => {
		// These must keep returning null. features fetches a code-split dataset,
		// stats reads live figures from Umami, and the legal copy lives in the
		// React tree, so a twin could only ever say "look at the HTML instead".
		for (const name of [
			"legal",
			"signin",
			"dashboard",
			"admin",
			"features",
			"stats",
			"contact",
			"submit",
			"sponsor",
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
