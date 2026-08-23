/**
 * The structured data, and the rules it is not allowed to break.
 *
 * Two of those rules are what the tests below actually defend, because breaking
 * either costs rich-result eligibility across the whole site rather than on one
 * page: never mark up a string the page does not render, and never assert a
 * number nobody measured. Everything else here is shape.
 *
 *   bun test apps/frontend/src/seo.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, Product, Project } from "core/src/content";
import { collectProjects } from "core/src/content";
import { buildProjectSlugs } from "core/src/routes";
import { dict } from "./i18n";
import {
	categoryApplication,
	collectionMeta,
	distinctNames,
	GLOSSARY_GROUPS,
	glossaryAnchor,
	homeMeta,
	legalMeta,
	productMeta,
	projectMeta,
	standingMeta,
} from "./seo";

const DATA = join(import.meta.dir, "../../../data");
const read = <T>(path: string): T =>
	JSON.parse(readFileSync(join(DATA, path), "utf8")) as T;

const categories = read<Category[]>("categories.json");
const notion = read<Product>("products/notion.json");
const categoryOf = (p: Product) =>
	categories.find((c) => c.slug === p.category);

type Node = Record<string, unknown>;

const nodes = (blocks: string[] | undefined): Node[] =>
	(blocks ?? []).flatMap(
		(raw) => (JSON.parse(raw) as { "@graph": Node[] })["@graph"],
	);

const typed = (list: Node[], type: string): Node | undefined =>
	list.find((n) => n["@type"] === type);

const productNodes = (p: Product, lang: "en" | "fr") =>
	nodes(productMeta(p, lang, categoryOf(p)).jsonLd);

describe("the graph", () => {
	test("is one block per document, with an @id on every node", () => {
		for (const lang of ["en", "fr"] as const) {
			const blocks = productMeta(notion, lang, categoryOf(notion)).jsonLd ?? [];
			expect(blocks.length).toBe(1);
			const parsed = JSON.parse(blocks[0]) as Record<string, unknown>;
			expect(parsed["@context"]).toBe("https://schema.org");
			for (const node of parsed["@graph"] as Node[]) {
				expect(typeof node["@id"]).toBe("string");
			}
		}
	});

	test("never publishes a hole in a sentence", () => {
		for (const product of ["notion", "figma", "zoominfo"]) {
			const p = read<Product>(`products/${product}.json`);
			for (const lang of ["en", "fr"] as const) {
				for (const raw of productMeta(p, lang, categoryOf(p)).jsonLd ?? []) {
					expect(raw).not.toContain("undefined");
					expect(raw).not.toContain("NaN");
					expect(raw).not.toContain('"null"');
				}
			}
		}
	});
});

describe("FAQPage", () => {
	/**
	 * Deleted on purpose. Google removed the FAQ rich result on 7 May 2026, and
	 * the questions this file used to generate appeared nowhere in the rendered
	 * body — which is the "structured data found on hidden content" manual
	 * action, on 1,184 pages, for nothing.
	 */
	test("is gone from every page type", () => {
		const everything = [
			...(productMeta(notion, "en", categoryOf(notion)).jsonLd ?? []),
			...(homeMeta("en", 592).jsonLd ?? []),
			...(standingMeta("glossary", "en").jsonLd ?? []),
			...(legalMeta("terms", "en").jsonLd ?? []),
		].join("\n");
		expect(everything).not.toContain("FAQPage");
		expect(everything).not.toContain("acceptedAnswer");
	});
});

describe("Product", () => {
	test("points at our page and moves the vendor to sameAs", () => {
		const product = typed(productNodes(notion, "en"), "Product");
		expect(product?.url).toBe(
			"https://canireplaceit.com/en/alternatives/notion",
		);
		expect(product?.sameAs).toEqual([`https://${notion.domain}`]);
	});

	test("states the price per month, and nothing about buying it", () => {
		const product = typed(productNodes(notion, "en"), "Product") as unknown as {
			offers: {
				price: number;
				url: string;
				priceSpecification: { unitCode: string };
			};
		};
		expect(product.offers.price).toBe(notion.priceMonthly as number);
		expect(product.offers.url).toBe(notion.pricing?.url as string);
		expect(product.offers.priceSpecification.unitCode).toBe("MON");
		// Nothing on this site is for sale, and "InStock" on 692 pages where
		// nothing can be bought is the "non-product labeled as product" action.
		expect(JSON.stringify(product)).not.toContain("availability");
		// A backward-looking receipt is not a forward-looking guarantee.
		expect(JSON.stringify(product)).not.toContain("priceValidUntil");
	});

	test("is still emitted when there is no price", () => {
		const unpriced: Product = { ...notion, priceMonthly: null, pricing: null };
		const product = typed(
			nodes(productMeta(unpriced, "en", categoryOf(unpriced)).jsonLd),
			"Product",
		);
		expect(product).toBeDefined();
		expect(product?.offers).toBeUndefined();
	});
});

describe("Review", () => {
	test("asserts no score", () => {
		for (const lang of ["en", "fr"] as const) {
			const raw = (productMeta(notion, lang, categoryOf(notion)).jsonLd ??
				[])[0];
			// The verdict is a three-point replaceability scale, not a quality
			// score. Two stars out of three under a product name says the opposite
			// of what the page says.
			expect(raw).not.toContain("reviewRating");
			expect(raw).not.toContain("ratingValue");
			expect(raw).not.toContain("aggregateRating");
		}
	});

	test("reads correctly as pros and cons of the product", () => {
		for (const lang of ["en", "fr"] as const) {
			const product = typed(productNodes(notion, lang), "Product") as unknown as
				| {
						review: {
							negativeNotes: { itemListElement: { name: string }[] };
							positiveNotes: { itemListElement: { name: string }[] };
						};
				  }
				| undefined;

			// Google shows these as bare "Pros" and "Cons" under the product's name
			// and never shows `reviewAspect`, so what you lose by leaving — which is
			// what the product is genuinely good at — is the PRO.
			const pros = product?.review.positiveNotes.itemListElement.map(
				(i) => i.name,
			);
			expect(pros).toEqual(
				notion.whatYouLose.map((v) => v[lang] ?? v.en) as string[],
			);

			// The cons are the case against staying, and both lines are printed on
			// the page: the exit ladder's price rung and the verdict sentence.
			const cons =
				product?.review.negativeNotes.itemListElement.map((i) => i.name) ?? [];
			expect(cons.length).toBe(2);
			expect(cons[0]).toContain(String(notion.priceMonthly));
			expect(cons[1]).toContain(notion.name);
		}
	});

	test("never files 'you cannot replace this yet' under Cons", () => {
		// On a not-yet product that sentence argues FOR staying.
		const notYet = { ...notion, verdict: "not-yet" as const };
		const product = typed(
			nodes(productMeta(notYet, "en", categoryOf(notYet)).jsonLd),
			"Product",
		) as unknown as {
			review: { negativeNotes: { itemListElement: { name: string }[] } };
		};
		const cons = product.review.negativeNotes.itemListElement.map(
			(i) => i.name,
		);
		expect(cons.length).toBe(1);
		expect(cons[0]).toContain(String(notion.priceMonthly));
	});
});

describe("identity", () => {
	test("declares the site and the publisher on page one only", () => {
		const first = nodes(homeMeta("en", 592).jsonLd);
		expect(typed(first, "WebSite")?.["@id"]).toBe(
			"https://canireplaceit.com/#website",
		);
		expect(typed(first, "Organization")?.["@id"]).toBe(
			"https://canireplaceit.com/#organization",
		);
		const second = nodes(homeMeta("en", 592, 2).jsonLd);
		expect(typed(second, "WebSite")).toBeUndefined();
		expect(typed(second, "Organization")).toBeUndefined();
	});

	test("describes one entity, not one per locale", () => {
		const en = typed(nodes(homeMeta("en", 592).jsonLd), "Organization");
		const fr = typed(nodes(homeMeta("fr", 592).jsonLd), "Organization");
		expect(JSON.stringify(fr)).toBe(JSON.stringify(en));
	});

	test("keeps no dead SearchAction", () => {
		// The sitelinks searchbox was removed on 21 Nov 2024, and the target was a
		// JSON endpoint nobody could have been sent to.
		expect((homeMeta("en", 592).jsonLd ?? [])[0]).not.toContain("SearchAction");
	});

	test("is what every page's author and publisher points at", () => {
		const raw = (productMeta(notion, "en", categoryOf(notion)).jsonLd ?? [])[0];
		expect(raw).toContain("https://canireplaceit.com/#organization");
	});
});

describe("breadcrumbs", () => {
	const trail = (blocks: string[] | undefined) =>
		(
			typed(nodes(blocks), "BreadcrumbList") as unknown as
				| { itemListElement: { name: string; item: string }[] }
				| undefined
		)?.itemListElement;

	test("walk the three rungs a project page renders", () => {
		const products = ["notion", "figma"].map((s) =>
			read<Product>(`products/${s}.json`),
		);
		const projects: Project[] = collectProjects(products);
		const slugs = buildProjectSlugs(
			projects,
			products.map((p) => p.slug),
		);
		const project = projects[0];
		const slug = slugs.get(project.slug) as string;
		const rungs = trail(projectMeta(project, "en", slug).jsonLd);
		expect(rungs?.map((r) => r.name)).toEqual([
			"All products",
			"All open source projects",
			project.name,
		]);
		expect(rungs?.at(-1)?.item).toBe(
			`https://canireplaceit.com/en/tools/${slug}`,
		);
	});

	test("start where the legal pages actually start", () => {
		// `LegalPage` heads its trail "Home", not "All products".
		expect(trail(legalMeta("terms", "en").jsonLd)?.[0].name).toBe("Home");
		expect(trail(legalMeta("terms", "fr").jsonLd)?.[0].name).toBe("Accueil");
	});

	test("are absent from the pages that render none", () => {
		for (const page of ["contact", "signin", "dashboard", "admin"] as const) {
			expect(trail(standingMeta(page, "en").jsonLd)).toBeUndefined();
		}
		for (const page of ["sponsor", "glossary", "gaps"] as const) {
			expect(trail(standingMeta(page, "en").jsonLd)?.length).toBe(2);
		}
	});

	test("name the crumb the page shows, not the search title", () => {
		expect(trail(standingMeta("sponsor", "en").jsonLd)?.[1].name).toBe(
			"Sponsor",
		);
		expect(trail(standingMeta("stats", "fr").jsonLd)?.[1].name).toBe("Trafic");
	});
});

describe("applicationCategory", () => {
	test("is one of the values Google publishes, for all 85 slugs", () => {
		// Read off developers.google.com/search/docs/appearance/structured-data/
		// software-app on 2026-08-23.
		const allowed = new Set([
			"BrowserApplication",
			"BusinessApplication",
			"CommunicationApplication",
			"DesignApplication",
			"DesktopEnhancementApplication",
			"DeveloperApplication",
			"DriverApplication",
			"EducationalApplication",
			"EntertainmentApplication",
			"FinanceApplication",
			"GameApplication",
			"HealthApplication",
			"HomeApplication",
			"LifestyleApplication",
			"MultimediaApplication",
			"ReferenceApplication",
			"SecurityApplication",
			"ShoppingApplication",
			"SocialNetworkingApplication",
			"SportsApplication",
			"TravelApplication",
			"UtilitiesApplication",
		]);
		for (const category of categories) {
			expect(allowed.has(categoryApplication(category.slug))).toBe(true);
		}
		// An unmapped slug falls back to what the project pages already said.
		expect(categoryApplication("brand-new-category")).toBe(
			"BusinessApplication",
		);
	});
});

describe("licence", () => {
	test("is a URL or a CreativeWork, never a bare string", () => {
		const products = [read<Product>("products/notion.json")];
		const projects = collectProjects(products);
		const slugs = buildProjectSlugs(projects, ["notion"]);
		for (const project of projects) {
			const app = typed(
				nodes(
					projectMeta(project, "en", slugs.get(project.slug) as string).jsonLd,
				),
				"SoftwareApplication",
			);
			const licence = app?.license;
			if (typeof licence === "string") {
				expect(licence.startsWith("https://spdx.org/licenses/")).toBe(true);
			} else {
				expect((licence as Node)["@type"]).toBe("CreativeWork");
				expect(typeof (licence as Node).name).toBe("string");
			}
		}
	});
});

describe("glossary", () => {
	test("names the anchors the page renders", () => {
		const set = nodes(standingMeta("glossary", "en").jsonLd).find(
			(n) => n["@type"] === "DefinedTermSet",
		) as unknown as { hasDefinedTerm: { "@id": string; name: string }[] };
		const flat = GLOSSARY_GROUPS.flatMap((g) => g.terms);
		expect(set.hasDefinedTerm.length).toBe(flat.length);
		for (const [i, term] of flat.entries()) {
			expect(set.hasDefinedTerm[i]["@id"]).toBe(
				`https://canireplaceit.com/en/glossary#${glossaryAnchor(term.label)}`,
			);
		}
	});
});

describe("dateModified", () => {
	test("is the date the price was read, on a product page", () => {
		const raw = (productMeta(notion, "en", categoryOf(notion)).jsonLd ?? [])[0];
		expect(raw).toContain(notion.pricing?.checkedOn as string);
	});
});

/**
 * Everything below defends a line in a search result rather than a node in the
 * graph: the words a searcher reads before deciding whether to click, and the
 * three ways those lines were previously wrong — a modifier the data supports
 * and no title said, a description cut mid-word, and 287 pages sharing 16
 * titles because the page number was appended and then truncated away.
 */
const allProducts = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.map((f) => read<Product>(`products/${f}`));

const ossOf = (p: Product) =>
	p.alternatives.filter(
		(a): a is Extract<Product["alternatives"][number], { kind: "oss" }> =>
			a.kind === "oss",
	);

describe("titles", () => {
	test("fit the 60 characters a search result shows, everywhere", () => {
		for (const lang of ["en", "fr"] as const) {
			for (const product of allProducts) {
				const { title } = productMeta(product, lang, categoryOf(product));
				expect(title.length).toBeLessThanOrEqual(60);
				// A title cut with an ellipsis is a title that lost its tail.
				expect(title.endsWith("…")).toBe(false);
			}
		}
	});

	test("claim self-hosted and free only where the data says both", () => {
		for (const product of allProducts) {
			const { title } = productMeta(product, "en", categoryOf(product));
			const free = ossOf(product).filter(
				(a) => a.facts.selfHostable && a.facts.openCore === "none",
			);
			if (!title.includes("free, self-hosted")) continue;
			// The count in the title is the count of alternatives that are BOTH
			// self-hostable and hold nothing back — never the total.
			expect(title.startsWith(`${free.length} free, self-hosted`)).toBe(true);
			for (const alt of free) {
				expect(alt.facts.selfHostable).toBe(true);
				expect(alt.facts.openCore).toBe("none");
			}
		}
	});

	test("keep the page number instead of truncating it away", () => {
		// /page/15 and /page/42 of the same collection were byte-identical: the
		// suffix was appended to a 60-character title and then cut off it.
		const seen = new Set<string>();
		for (const lang of ["en", "fr"] as const) {
			for (const page of [1, 2, 15, 42]) {
				const { title } = collectionMeta("foss", lang, 3056, page);
				expect(title.length).toBeLessThanOrEqual(60);
				if (page > 1) expect(title).toContain(`page ${page}`);
				expect(seen.has(title)).toBe(false);
				seen.add(title);
			}
		}
	});

	test("name a replaced product once, and at most two of them", () => {
		expect(
			distinctNames([
				"Autodesk Flow Production Tracking (ShotGrid)",
				"Autodesk Flow Production Tracking",
				"Frame.io",
			]),
		).toEqual(["Autodesk Flow Production Tracking (ShotGrid)", "Frame.io"]);

		const projects = collectProjects(allProducts);
		const slugs = buildProjectSlugs(
			projects,
			allProducts.map((p) => p.slug),
		);
		for (const project of projects) {
			for (const lang of ["en", "fr"] as const) {
				const { title } = projectMeta(
					project,
					lang,
					slugs.get(project.slug) as string,
				);
				expect(title.length).toBeLessThanOrEqual(60);
				const named = distinctNames(project.replaces.map((r) => r.name)).filter(
					(name) => title.includes(name),
				);
				expect(named.length).toBeLessThanOrEqual(2);
			}
		}
	});
});

describe("descriptions", () => {
	test("stop on a sentence, never mid-word", () => {
		for (const lang of ["en", "fr"] as const) {
			for (const product of allProducts) {
				const { description } = productMeta(product, lang, categoryOf(product));
				expect(description.length).toBeLessThanOrEqual(155);
				expect(description.endsWith("…")).toBe(false);
				expect(/[.!?]$/.test(description)).toBe(true);
			}
		}
	});

	test("open by naming the top three, as a sentence", () => {
		const { description } = productMeta(notion, "en", categoryOf(notion));
		const top = ossOf(notion)
			.slice(0, 3)
			.map((a) => a.name);
		expect(
			description.startsWith("The best open source Notion alternatives are"),
		).toBe(true);
		for (const name of top) expect(description).toContain(name);
	});
});

describe("the page's own heading", () => {
	test("is the phrase the title and the graph both name", () => {
		for (const lang of ["en", "fr"] as const) {
			const meta = productMeta(notion, lang, categoryOf(notion));
			const page = typed(nodes(meta.jsonLd), "WebPage");
			// The graph must name the page whatever the <title> says, or the two
			// documents describe two different things.
			expect(page?.name).toBe(meta.title);
			// And the <h1> the page renders is built from this key.
			expect(dict[lang]["product.h1"]).toContain("{name}");
		}
	});

	test("carries the gaps count the page itself lists", () => {
		const gaps = allProducts.filter((p) => p.verdict === "not-yet").length;
		for (const lang of ["en", "fr"] as const) {
			const { title } = standingMeta("gaps", lang, { gaps });
			expect(title).toContain(String(gaps));
			// The same string the page heads itself with, so they cannot drift.
			expect(title.toLowerCase()).toContain(
				dict[lang]["gaps.h1"].replace("{n} ", "").slice(0, 20).toLowerCase(),
			);
			expect(title.length).toBeLessThanOrEqual(60);
		}
	});
});

describe("the about page", () => {
	test("exists in both locales, with its own canonical", () => {
		expect(standingMeta("about", "en").canonical).toBe(
			"https://canireplaceit.com/en/about",
		);
		expect(standingMeta("about", "fr").canonical).toBe(
			"https://canireplaceit.com/fr/a-propos",
		);
		for (const lang of ["en", "fr"] as const) {
			const meta = standingMeta("about", lang);
			expect(meta.noindex).not.toBe(true);
			// The conflict-of-interest line is the reason the page exists.
			expect(meta.description.toLowerCase()).toContain(
				lang === "fr" ? "affilié" : "affiliate",
			);
		}
	});
});
