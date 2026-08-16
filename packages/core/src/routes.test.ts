/**
 * `paths` and `parseRoute` are inverses, and slugs are unique. Both are the
 * kind of thing that only breaks in production — a drifted segment table means
 * every French link 404s, a duplicate slug means two projects share one page —
 * so they are checked here against the real dataset, not fixtures alone.
 *
 *   bun test packages/core
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { collectProjects, type Product, type Project } from "./content";
import { SupportedLangs } from "./index";
import {
	alternateUrls,
	buildProjectSlugs,
	kebab,
	parseRoute,
	paths,
	SEGMENTS,
} from "./routes";

const at = (path: string) => parseRoute(new URL(path, "https://x.test"));

test("every builder round-trips through parseRoute in every language", () => {
	for (const lang of SupportedLangs) {
		expect(at(paths.home(lang))).toEqual({ name: "home", lang });
		expect(at(paths.product(lang, "notion"))).toEqual({
			name: "product",
			lang,
			slug: "notion",
		});
		expect(at(paths.project(lang, "appflowy"))).toEqual({
			name: "project",
			lang,
			slug: "appflowy",
		});
		expect(at(paths.category(lang, "notes-docs"))).toEqual({
			name: "category",
			lang,
			slug: "notes-docs",
		});
	}
});

test("the standing pages round-trip, and take nothing after the segment", () => {
	for (const lang of SupportedLangs) {
		for (const name of ["submit", "contact", "features"] as const) {
			expect(at(paths[name](lang))).toEqual({ name, lang });
			expect(at(`${paths[name](lang)}/extra`)).toEqual({
				name: "unknown",
				lang,
			});
		}
	}
	// Unaccented in French, like every other segment.
	expect(paths.contact("fr")).toBe("/fr/contact");
});

test("the feature explorer is one URL per language, and filters never mint more", () => {
	expect(paths.features("en")).toBe("/en/features");
	expect(paths.features("fr")).toBe("/fr/fonctionnalites");
	// Filter state lives in the query string on purpose: 137 feature keys would
	// otherwise generate a combinatorial space of near-duplicate indexable URLs.
	// parseRoute must ignore the query entirely and resolve to the same route.
	expect(at("/en/features?need=auth.sso.oidc&license=permissive")).toEqual({
		name: "features",
		lang: "en",
	});
	// A segment from the other locale still resolves, like every other route.
	expect(at("/fr/features")).toEqual({ name: "features", lang: "fr" });
	expect(at("/en/fonctionnalites")).toEqual({ name: "features", lang: "en" });
});

test("the French URLs are the ones the brief asked for", () => {
	expect(paths.home("fr")).toBe("/fr/");
	expect(paths.product("fr", "notion")).toBe("/fr/alternatives/notion");
	expect(paths.project("fr", "appflowy")).toBe("/fr/outils/appflowy");
	expect(paths.category("fr", "notes-docs")).toBe("/fr/categories/notes-docs");
});

test("French segments parse as their own route kinds", () => {
	expect(at("/fr/outils/appflowy")).toEqual({
		name: "project",
		lang: "fr",
		slug: "appflowy",
	});
});

test("a segment from the other locale still resolves", () => {
	// A shared or bookmarked link must not 404 because the reader switched
	// language; the caller can canonicalize with `paths` afterwards.
	expect(at("/fr/tools/x")).toEqual({ name: "project", lang: "fr", slug: "x" });
	expect(at("/en/outils/x")).toEqual({
		name: "project",
		lang: "en",
		slug: "x",
	});
});

test("no locale prefix, or an unknown one, is unknown", () => {
	expect(at("/").name).toBe("unknown");
	expect(at("/alternatives/notion").name).toBe("unknown");
	expect(at("/de/alternatives/notion").name).toBe("unknown");
	expect(at("/tools/appflowy").name).toBe("unknown");
});

test("a locale with a segment we do not serve is unknown", () => {
	expect(at("/en/blog/hello")).toEqual({ name: "unknown", lang: "en" });
	expect(at("/en/alternatives")).toEqual({ name: "unknown", lang: "en" });
	expect(at("/en/alternatives/notion/extra")).toEqual({
		name: "unknown",
		lang: "en",
	});
});

test("the slug-less categories URL is the index, not an unknown route", () => {
	for (const lang of SupportedLangs) {
		expect(at(paths.categories(lang))).toEqual({ name: "categories", lang });
	}
	// With and without the trailing slash, since both get typed and linked.
	expect(at("/en/categories")).toEqual({ name: "categories", lang: "en" });
	expect(at("/fr/categories/")).toEqual({ name: "categories", lang: "fr" });
});

test("a category slug still wins over the index", () => {
	// The index must not swallow `/en/categories/ai`; only the empty tail is it.
	expect(at(paths.category("en", "ai"))).toEqual({
		name: "category",
		lang: "en",
		slug: "ai",
	});
	expect(at("/en/categories/ai/extra")).toEqual({
		name: "unknown",
		lang: "en",
	});
});

test("page 1 is the bare URL and /page/1 is not a URL at all", () => {
	for (const lang of SupportedLangs) {
		// Two addresses for one slice of one list is the duplicate the whole
		// paginated spine exists to avoid.
		expect(paths.home(lang, 1)).toBe(paths.home(lang));
		expect(paths.projects(lang, 1)).toBe(paths.projects(lang));
		expect(paths.collection(lang, "cheaper", 1)).toBe(
			paths.collection(lang, "cheaper"),
		);
		expect(at(`/${lang}/page/1`).name).toBe("unknown");
		expect(at(`/${lang}/${SEGMENTS[lang].tools}/page/1`).name).toBe("unknown");
	}
});

test("paginated URLs round-trip in both languages", () => {
	for (const lang of SupportedLangs) {
		expect(at(paths.home(lang, 4))).toEqual({ name: "home", lang, page: 4 });
		expect(at(paths.projects(lang))).toEqual({ name: "projects", lang });
		expect(at(paths.projects(lang, 12))).toEqual({
			name: "projects",
			lang,
			page: 12,
		});
		expect(at(paths.collections(lang))).toEqual({ name: "collections", lang });
		expect(at(paths.collection(lang, "open-core"))).toEqual({
			name: "collection",
			lang,
			slug: "open-core",
		});
		expect(at(paths.collection(lang, "open-core", 3))).toEqual({
			name: "collection",
			lang,
			slug: "open-core",
			page: 3,
		});
	}
});

test("the French paginated segments stay unaccented", () => {
	expect(paths.home("fr", 3)).toBe("/fr/page/3");
	expect(paths.projects("fr")).toBe("/fr/outils/");
	expect(paths.projects("fr", 3)).toBe("/fr/outils/page/3");
	expect(paths.collections("fr")).toBe("/fr/collections/");
	expect(paths.collection("fr", "cheaper", 2)).toBe(
		"/fr/collections/cheaper/page/2",
	);
});

test("a malformed page number is unknown, not page 1", () => {
	// Otherwise `/en/page/03`, `/en/page/3.0` and `/en/page/3x` would all be a
	// third URL for page 3 — an unbounded family of duplicates.
	for (const bad of ["0", "01", "03", "3.0", "3x", "-2", "x", ""]) {
		expect(at(`/en/page/${bad}`).name).toBe("unknown");
	}
	expect(at("/en/page/2/3").name).toBe("unknown");
	expect(at("/en/collections/cheaper/page").name).toBe("unknown");
	expect(at("/en/collections/cheaper/nope/2").name).toBe("unknown");
});

test("the slug-less tools URL is the project index, and a project still wins", () => {
	for (const lang of SupportedLangs) {
		expect(at(paths.projects(lang))).toEqual({ name: "projects", lang });
	}
	expect(at("/en/tools")).toEqual({ name: "projects", lang: "en" });
	expect(at(paths.project("en", "appflowy"))).toEqual({
		name: "project",
		lang: "en",
		slug: "appflowy",
	});
});

test("no project slug can shadow a route segment", () => {
	// `/en/tools/page` must be the paginator and never a project called Page.
	const reserved = SupportedLangs.flatMap((l) => Object.values(SEGMENTS[l]));
	const map = buildProjectSlugs(
		[project("Page", "o/page"), project("Compare", "o/compare")],
		[],
	);
	for (const slug of map.values()) expect(reserved).not.toContain(slug);
});

test("alternateUrls is an exact inverse of paths for every route", () => {
	const routes = [
		paths.home("en"),
		paths.product("en", "notion"),
		paths.project("fr", "appflowy"),
		paths.category("fr", "notes-docs"),
		paths.categories("en"),
		paths.categories("fr"),
		// The paginated spine has to be reciprocal too, or the hreflang set on nine
		// home pages, eighteen index pages and ten collection pages is ignored.
		paths.home("en", 7),
		paths.home("fr", 7),
		paths.projects("en"),
		paths.projects("fr", 12),
		paths.collections("en"),
		paths.collection("fr", "open-core"),
		paths.collection("en", "cheaper", 3),
		paths.submit("fr"),
		paths.contact("en"),
		paths.contact("fr"),
	];
	for (const path of routes) {
		const route = at(path);
		const alts = alternateUrls(route);
		expect(Object.keys(alts).sort()).toEqual([...SupportedLangs].sort());
		for (const lang of SupportedLangs) {
			// Same page, other language: parsing it back must give the same route
			// with only the lang changed.
			expect(at(alts[lang])).toEqual({ ...route, lang });
		}
		// And the route's own language reproduces the URL we started from.
		expect(alts[route.lang]).toBe(path);
	}
});

test("an unknown route points hreflang at each home page", () => {
	expect(alternateUrls(at("/nope"))).toEqual({
		en: paths.home("en"),
		fr: paths.home("fr"),
	});
});

test("the segment table covers every supported language", () => {
	for (const lang of SupportedLangs) {
		expect(Object.values(SEGMENTS[lang]).every(Boolean)).toBe(true);
	}
});

const project = (name: string, path: string): Project => ({
	slug: `github-${path.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`,
	name,
	source: { host: "github", path, url: `https://github.com/${path}` },
	license: "MIT",
	effort: "docker",
	factsVary: [],
	fossVary: false,
	facts: {
		selfHostable: true,
		openCore: "none",
		ssoInFree: true,
		dataResidency: "self",
	},
	replaces: [],
});

test("a unique name becomes the bare name", () => {
	const map = buildProjectSlugs([project("AppFlowy", "AppFlowy-IO/AppFlowy")]);
	expect([...map.values()]).toEqual(["appflowy"]);
});

test("accents and punctuation are stripped, not encoded", () => {
	const map = buildProjectSlugs([project("Café Décor!", "o/cafe")]);
	expect([...map.values()]).toEqual(["cafe-decor"]);
});

test("two projects with the same name both get the owner", () => {
	// The bare slug must not exist at all: handing it to whichever project was
	// added first means its meaning silently changes when the second arrives.
	const map = buildProjectSlugs([
		project("Goose", "block/goose"),
		project("goose", "pressly/goose"),
	]);
	const slugs = [...map.values()].sort();
	expect(slugs).toEqual(["goose-block", "goose-pressly"]);
	expect(slugs).not.toContain("goose");
});

test("a project colliding with a product yields the bare name to the product", () => {
	const map = buildProjectSlugs(
		[project("Sentry", "getsentry/sentry")],
		["sentry"],
	);
	expect([...map.values()]).toEqual(["sentry-getsentry"]);
});

test("the same name and owner on two forges still gets two slugs", () => {
	const a = project("Cal.com", "calcom/cal.com");
	const b = {
		...project("Cal.com", "calcom/cal.diy"),
		slug: "github-calcom-cal-diy",
	};
	const slugs = [...buildProjectSlugs([a, b]).values()];
	expect(new Set(slugs).size).toBe(2);
});

test("slug assignment does not depend on input order", () => {
	const input = [
		project("Goose", "block/goose"),
		project("goose", "pressly/goose"),
		project("Tabby", "TabbyML/tabby"),
	];
	const forward = buildProjectSlugs(input, ["tabby"]);
	const backward = buildProjectSlugs([...input].reverse(), ["tabby"]);
	expect([...backward]).toEqual([...forward]);
});

const DATA = join(import.meta.dir, "../../../data/products");
const products: Product[] = readdirSync(DATA)
	.filter((f) => f.endsWith(".json"))
	.map((f) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as Product);
const projects = collectProjects(products);
const productSlugs = products.map((p) => p.slug);

test("every real project gets a non-empty, unique slug", () => {
	const map = buildProjectSlugs(projects, productSlugs);
	const slugs = [...map.values()];
	expect(map.size).toBe(projects.length);
	expect(slugs.every((s) => s.length > 0)).toBe(true);
	expect(new Set(slugs).size).toBe(slugs.length);
	expect(slugs.every((s) => kebab(s) === s)).toBe(true);
});

test("no real project slug shadows a product slug", () => {
	const taken = new Set(productSlugs);
	for (const slug of buildProjectSlugs(projects, productSlugs).values()) {
		expect(taken.has(slug)).toBe(false);
	}
});

test("two runs over the real data agree exactly", () => {
	const a = buildProjectSlugs(projects, productSlugs);
	const b = buildProjectSlugs([...projects].reverse(), productSlugs);
	expect([...b].sort()).toEqual([...a].sort());
});

test("real project URLs round-trip", () => {
	for (const [, slug] of buildProjectSlugs(projects, productSlugs)) {
		expect(at(paths.project("fr", slug))).toEqual({
			name: "project",
			lang: "fr",
			slug,
		});
	}
});
