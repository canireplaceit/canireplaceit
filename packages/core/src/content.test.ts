/**
 * The rung derivation is the one piece of real logic in the content layer —
 * everything the site claims hangs off it. One runnable check, no framework.
 *
 *   bun test packages/core
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, Effort } from "./content";

const DATA = join(import.meta.dir, "../../../data/products");

import {
	altIconKey,
	byGroup,
	CATEGORY_GROUPS,
	type CategoryStat,
	categoryStats,
	classifyLicense,
	collectProjects,
	type Facts,
	type Issue,
	isArchived,
	type Product,
	type Project,
	priceFreshness,
	priceState,
	RUNGS,
	rungOf,
	stackCover,
	validateCategory,
	validateProduct,
} from "./content";

/** The real file, so the theme checks below are about the shipped taxonomy. */
const realCategories: Category[] = JSON.parse(
	readFileSync(join(import.meta.dir, "../../../data/categories.json"), "utf8"),
);

const facts = (over: Partial<Facts> = {}): Facts => ({
	selfHostable: true,
	openCore: "none",
	ssoInFree: true,
	dataResidency: "self",
	...over,
});

const product = (over: Partial<Product> = {}): Product => ({
	slug: "x",
	name: "X",
	domain: null,
	category: "c",
	priceMonthly: 10,
	pricing: null,
	verdict: "yes",
	why: { en: "w" },
	whatYouLose: [{ en: "l" }, { en: "m" }],
	alternatives: [
		{
			kind: "oss",
			name: "A",
			source: {
				host: "github",
				path: "o/a",
				url: "https://github.com/o/a",
			},
			license: "MIT",
			effort: "docker",
			note: { en: "n" },
			facts: facts(),
		},
	],
	priority: 3,
	...over,
});

test("no credible alternative is locked-in", () => {
	expect(rungOf(product({ verdict: "not-yet" }))).toBe("locked-in");
});

test("a product with only cheaper commercial options is locked-in", () => {
	expect(
		rungOf(
			product({
				alternatives: [
					{
						kind: "cheaper",
						name: "C",
						url: "https://c.example",
						priceMonthly: 3,
						note: { en: "n" },
					},
				],
			}),
		),
	).toBe("locked-in");
});

test("partial parity is partial regardless of effort", () => {
	expect(rungOf(product({ verdict: "almost" }))).toBe("partial");
});

test("full parity you must operate yourself is self-hostable", () => {
	expect(rungOf(product())).toBe("self-hostable");
});

test("full parity with a managed option is drop-in", () => {
	const p = product();
	(p.alternatives[0] as { effort: string }).effort = "managed";
	expect(rungOf(p)).toBe("drop-in");
});

test("open source in name only does not count as an exit", () => {
	// Open client, proprietary server: selfHostable false means it frees nobody.
	const p = product();
	(p.alternatives[0] as { facts: Facts }).facts = facts({
		selfHostable: false,
	});
	expect(rungOf(p)).toBe("locked-in");
});

const ossAlt = (
	name: string,
	path: string,
	effort: "managed" | "docker" | "ops",
) => ({
	kind: "oss" as const,
	name,
	source: { host: "github" as const, path, url: `https://github.com/${path}` },
	license: "AGPL-3.0",
	effort,
	note: { en: `${name} note` },
	facts: facts(),
});

test("a project cited by several products is collected once, with all of them", () => {
	const projects = collectProjects([
		product({
			slug: "dropbox",
			name: "Dropbox",
			alternatives: [ossAlt("Nextcloud", "nextcloud/server", "ops")],
		}),
		product({
			slug: "google-photos",
			name: "Google Photos",
			alternatives: [ossAlt("Nextcloud", "nextcloud/server", "docker")],
		}),
	]);

	expect(projects).toHaveLength(1);
	expect(projects[0].name).toBe("Nextcloud");
	expect(projects[0].replaces.map((r) => r.slug)).toEqual([
		"dropbox",
		"google-photos",
	]);
});

test("the easiest way to run a project wins across citations", () => {
	// One product says it needs real ops, another knows a managed tier exists.
	// A reader can act on the managed claim, so that is the one to keep.
	const projects = collectProjects([
		product({ slug: "a", alternatives: [ossAlt("Thing", "o/thing", "ops")] }),
		product({
			slug: "b",
			alternatives: [ossAlt("Thing", "o/thing", "managed")],
		}),
	]);
	expect(projects[0].effort).toBe("managed");
});

test("projects are ranked by how much they get you out of", () => {
	const projects = collectProjects([
		product({
			slug: "a",
			alternatives: [ossAlt("Narrow", "o/narrow", "docker")],
		}),
		product({
			slug: "b",
			alternatives: [ossAlt("Broad", "o/broad", "docker")],
		}),
		product({
			slug: "c",
			alternatives: [ossAlt("Broad", "o/broad", "docker")],
		}),
	]);
	expect(projects[0].name).toBe("Broad");
});

/**
 * The licence classifier, case by case, against the shapes the catalogue really
 * contains. Every string below is copied from `data/products`, so this is a test
 * about the data rather than about a regex somebody imagined.
 */
test("a plain OSI licence is FOSS", () => {
	for (const l of [
		"MIT",
		"Apache-2.0",
		"AGPL-3.0",
		"GPL-3.0",
		"GPL-2.0",
		"BSD-3-Clause",
		"MPL-2.0",
		"LGPL-2.1",
		"ISC",
		"EPL-1.0",
		"CDDL-1.0",
		"Zlib",
		"Unlicense",
		"OSL-3.0",
		"EUPL-1.2",
		"CPAL-1.0",
		"OFL-1.1",
		"PostgreSQL License",
		"MPL-1.1",
	]) {
		expect(classifyLicense(l)).toBe("foss");
	}
});

test("a licence family named inside a longer phrase still counts", () => {
	// Both are genuinely free licences that spell out their ancestry.
	expect(classifyLicense("Biopython License (MIT-style)")).toBe("foss");
	expect(classifyLicense("PSF-based BSD")).toBe("foss");
	expect(classifyLicense("GPL-2.0 (with linking exception)")).toBe("foss");
	expect(
		classifyLicense("GPL-2.0 (with some non-GPL bundled components)"),
	).toBe("foss");
});

test("a dual OSI licence is FOSS on either side", () => {
	for (const l of [
		"Apache-2.0 / MIT",
		"MIT/GPL",
		"LGPL-2.1 / GPL-2.0",
		"BSD-3-Clause/AGPL-3.0",
		"GPL-3.0 (Apache-2.0 for gpui)",
		"GPL-2.0 (LGPL-2.1 for libs)",
	]) {
		expect(classifyLicense(l)).toBe("foss");
	}
});

/**
 * The judgement call, pinned. An OSI core with an enterprise edition beside it
 * is FOSS: that is one question about the licence and a different question about
 * what is withheld, and `facts.openCore` answers the second one. Were this to
 * flip, `open-core` and this classifier would be publishing the same fact twice
 * under two names, and GitLab CE would stop being free software on this site.
 */
test("an OSI core with an enterprise edition beside it is still FOSS", () => {
	for (const l of [
		"MIT core with an ee/ directory",
		"MIT core with an enterprise/ directory",
		"MIT core with an enterprise licence over packages/*/enterprise",
		"MIT + proprietary ee/",
		"MIT outside the ee/ directory",
		"MIT/Ent",
		"MIT/EE",
		"AGPL-3.0/EE",
		"Apache-2.0/EE",
		"Apache-2.0 with proprietary ee/ directory",
		"Apache-2.0 (Community Edition only)",
		"Apache-2.0 / AGPL-3.0 with proprietary enterprise features",
		"AGPL-3.0 core with a large ee/ directory",
		"AGPL-3.0 core, partner program under a commercial ee licence",
		"AGPL-3.0 with @license Enterprise files",
		"AGPL-3.0 or commercial",
		"GPL-2.0 (dual-licensed, commercial option available)",
		"BSD-3-Clause (management/ under AGPL-3.0)",
	]) {
		expect(classifyLicense(l)).toBe("foss");
	}
});

test("one project's two licence strings cannot classify differently", () => {
	// Stalwart, written both ways by the products that cite it. The old
	// source-available regex matched LicenseRef-SEL and not the spelt-out name,
	// so the same project sat at two points on the openness scale.
	expect(classifyLicense("AGPL-3.0 / LicenseRef-SEL")).toBe("foss");
	expect(classifyLicense("AGPL-3.0 + Stalwart Enterprise Licence")).toBe(
		"foss",
	);
});

test("a named non-open licence is not FOSS, whatever sits beside it", () => {
	for (const l of [
		"BSL",
		"BSL-1.1",
		"BUSL-1.1",
		"BSL 1.1 (converts to Apache-2.0 after 4 years)",
		"SSPL-1.0",
		"Elastic-2.0",
		"ELv2/MIT",
		"AGPL/Elastic",
		"FSL-1.1-MIT (converts to MIT after 2 years)",
		"FSL-1.1-Apache-2.0 (source-available, not open source)",
		"Sustainable Use",
		"Sustainable Use Licence (not OSI-approved)",
		"Any Source Available Licence 1.0",
		"OpenFaaS CE EULA",
		"MRPL-1.2",
		"Anti-Capitalist SL",
		"tldraw license",
		"Zrythm License",
		"Defold License 1.0",
	]) {
		expect(classifyLicense(l)).toBe("not-foss");
	}
});

/**
 * The case that rules out every "the first licence named wins" shortcut.
 * Commons Clause does not carve out a subdirectory — it removes the right to
 * sell from the whole work — so an AGPL string carrying it is not FOSS despite
 * AGPL coming first and being the only OSI name present.
 */
test("a rider that strips freedoms from the whole work beats the OSI name", () => {
	expect(classifyLicense("AGPL-3.0 + Commons Clause")).toBe("not-foss");
	expect(
		classifyLicense(
			"MPL-2.0 (core) / source-available non-commercial (controller)",
		),
	).toBe("not-foss");
	expect(classifyLicense("ELv2/MIT mix with an ee/ directory")).toBe(
		"not-foss",
	);
});

test("an unrecognised licence is unknown, never FOSS by default", () => {
	// CC-BY-4.0 is Font Awesome's free tier: a free CULTURE licence, and not an
	// OSI software licence. Claiming either way would be inventing a fact.
	expect(classifyLicense("CC-BY-4.0")).toBe("unknown");
	expect(classifyLicense("Ambiguous Vendor Terms 3.0")).toBe("unknown");
	expect(classifyLicense("")).toBe("unknown");
	expect(classifyLicense("   ")).toBe("unknown");
});

test("bare proprietary wording is not FOSS even though no licence is named", () => {
	expect(classifyLicense("Proprietary")).toBe("not-foss");
	expect(classifyLicense("closed source")).toBe("not-foss");
	expect(classifyLicense("All rights reserved")).toBe("not-foss");
});

test("citations that disagree about openness set fossVary, and only those", () => {
	const withLicense = (slug: string, license: string) =>
		product({
			slug,
			alternatives: [{ ...ossAlt("Thing", "o/thing", "docker"), license }],
		});

	// A real split: one citation says the licence is open, another says it is not.
	expect(
		collectProjects([
			withLicense("a", "AGPL-3.0 outside the ee/ directory"),
			withLicense("b", "Elastic-2.0"),
		])[0].fossVary,
	).toBe(true);

	// Two accurate descriptions of one open-core project is NOT a disagreement
	// about openness — `facts.openCore` is where that difference belongs.
	expect(
		collectProjects([
			withLicense("a", "MIT"),
			withLicense("b", "MIT core with an ee/ directory"),
		])[0].fossVary,
	).toBe(false);

	expect(collectProjects([withLicense("a", "MIT")])[0].fossVary).toBe(false);
});

test("the same name on two different forges stays two projects", () => {
	const projects = collectProjects([
		product({
			slug: "a",
			alternatives: [
				ossAlt("Forgejo", "forgejo/forgejo", "docker"),
				{
					...ossAlt("Forgejo", "forgejo/forgejo", "docker"),
					source: {
						host: "codeberg",
						path: "forgejo/forgejo",
						url: "https://codeberg.org/forgejo/forgejo",
					},
				},
			],
		}),
	]);
	expect(projects).toHaveLength(2);
});

const withCheaper = (extra: Record<string, unknown>) =>
	validateProduct(
		{
			...product(),
			alternatives: [
				...product().alternatives,
				{
					kind: "cheaper",
					name: "REAPER",
					url: "https://reaper.fm",
					note: { en: "n" },
					...extra,
				},
			],
		},
		"x",
		new Set(["c"]),
	);

test("a one-time purchase can state its real price", () => {
	expect(withCheaper({ priceMonthly: null, priceOnce: 60 })).toEqual([]);
});

test("a one-time price cannot also claim a monthly price", () => {
	const issues = withCheaper({ priceMonthly: 0, priceOnce: 60 });
	expect(issues.some((i: Issue) => i.path.endsWith("priceMonthly"))).toBe(true);
});

test("a one-time price of zero is rejected — that is not a purchase", () => {
	const issues = withCheaper({ priceMonthly: null, priceOnce: 0 });
	expect(issues.some((i: Issue) => i.path.endsWith("priceOnce"))).toBe(true);
});

test("a cheaper entry cannot carry repo, licence or facts", () => {
	// The half-converted edit this catches: an oss row retyped as `cheaper` and
	// left with the fields that made it read as open source.
	const issues = withCheaper({
		priceMonthly: 3,
		license: "MIT",
		source: { host: "github", path: "o/a", url: "https://github.com/o/a" },
	});
	expect(issues.length).toBeGreaterThan(0);
	expect(issues[0].message).toContain("license");
	expect(issues[0].message).toContain("source");
});

test("an oss entry cannot carry a price", () => {
	const issues = validateProduct(
		{
			...product(),
			alternatives: [{ ...product().alternatives[0], priceMonthly: 9 }],
		},
		"x",
		new Set(["c"]),
	);
	expect(issues.some((i: Issue) => i.message.includes("priceMonthly"))).toBe(
		true,
	);
});

const withLosses = (n: number) =>
	validateProduct(
		{
			...product(),
			whatYouLose: Array.from({ length: n }, () => ({ en: "l" })),
		},
		"x",
		new Set(["c"]),
	);

test("one downside is a shrug, not a list", () => {
	expect(withLosses(1).some((i: Issue) => i.path === "whatYouLose")).toBe(true);
});

test("two to four downsides are accepted", () => {
	expect(withLosses(2)).toEqual([]);
	expect(withLosses(4)).toEqual([]);
});

test("five downsides stop being chips and start being a paragraph", () => {
	expect(withLosses(5).some((i: Issue) => i.path === "whatYouLose")).toBe(true);
});

const receipt = {
	plan: "Business",
	basis: "custom" as const,
	url: "https://x.example/pricing",
	checkedOn: "2026-08-02",
	confidence: "high" as const,
};

const validate = (over: Partial<Product>) =>
	validateProduct(product(over), "x", new Set(["c"]));

test("a null price with no receipt is unverified, not free and not quote-only", () => {
	expect(priceState(product({ priceMonthly: null }))).toBe("unverified");
});

test("notPublic is the only way to say a vendor publishes no price", () => {
	expect(
		priceState(
			product({ priceMonthly: null, pricing: receipt, notPublic: true }),
		),
	).toBe("no-price");
});

test("notPublic is a claim, so it needs a dated receipt", () => {
	const issues = validate({ priceMonthly: null, notPublic: true });
	expect(issues.some((i: Issue) => i.path === "pricing")).toBe(true);
});

test("notPublic cannot sit on a product that has a price", () => {
	const issues = validate({
		priceMonthly: 10,
		pricing: receipt,
		notPublic: true,
	});
	expect(issues.some((i: Issue) => i.path === "notPublic")).toBe(true);
});

test("an unrecognised confidence is rejected — it would render as the strongest", () => {
	const issues = validate({
		pricing: { ...receipt, confidence: "probably" as never },
	});
	expect(issues.some((i: Issue) => i.path === "pricing.confidence")).toBe(true);
});

test("site freshness reports the newest date the DATA carries, never the clock", () => {
	const f = priceFreshness([
		product({ pricing: { ...receipt, checkedOn: "2026-01-09" } }),
		product({ pricing: { ...receipt, checkedOn: "2026-07-31" } }),
		product({ priceMonthly: null }),
	]);
	expect(f).toEqual({ total: 3, sourced: 2, latest: "2026-07-31" });
});

/*
 * Icon keys. Keying these on the forge hostname was invisible while every entry
 * was on GitHub, and handed all 22 GitLab projects one shared icon the moment
 * the hosts were corrected.
 */

test("a GitHub project keys on the owner — that is whose avatar is on disk", () => {
	expect(
		altIconKey({
			host: "github",
			path: "outline/outline",
			url: "https://github.com/outline/outline",
		}),
	).toBe("outline");
});

test("two projects on one forge never share a key", () => {
	const key = (path: string, url: string) =>
		altIconKey({ host: "gitlab", path, url });
	expect(key("graphics/krita", "https://invent.kde.org/graphics/krita")).toBe(
		"kde-krita",
	);
	expect(
		key("multimedia/kdenlive", "https://invent.kde.org/multimedia/kdenlive"),
	).toBe("kde-kdenlive");
	expect(key("GNOME/gimp", "https://gitlab.gnome.org/GNOME/gimp")).toBe(
		"gnome-gimp",
	);
});

test("a source URL we cannot parse has no icon rather than a wrong one", () => {
	expect(altIconKey({ host: "other", path: "x/y", url: "somewhere" })).toBe(
		null,
	);
});

const priced = (
	slug: string,
	category: string,
	price: number | null,
	verdict: Product["verdict"],
	alts: Product["alternatives"],
): Product => ({
	slug,
	name: slug,
	domain: null,
	category,
	priceMonthly: price,
	pricing: null,
	verdict,
	why: { en: "why" },
	whatYouLose: [{ en: "x" }, { en: "y" }],
	alternatives: alts,
	priority: 3,
});

const oss = (
	name: string,
	path: string,
	effort: Effort,
	openCore: Facts["openCore"],
) =>
	({
		kind: "oss",
		name,
		source: { host: "github", path, url: `https://github.com/${path}` },
		license: "MIT",
		effort,
		note: { en: "n" },
		facts: {
			selfHostable: true,
			openCore,
			ssoInFree: true,
			dataResidency: "self",
			...(openCore === "none" ? {} : { paywalled: { en: "sso" } }),
		},
	}) as const;

test("the median is the middle price, over the products that publish one", () => {
	const stats = categoryStats([
		priced("a", "c", 10, "yes", [oss("A", "o/a", "managed", "none")]),
		priced("b", "c", 30, "yes", [oss("B", "o/b", "docker", "none")]),
		priced("c", "c", 20, "yes", [oss("C", "o/c", "ops", "none")]),
		// No published price: counted as a product, excluded from the median.
		priced("d", "c", null, "yes", [oss("D", "o/d", "ops", "none")]),
	]);
	const stat = stats.get("c") as CategoryStat;
	expect(stat.products).toBe(4);
	expect(stat.pricedProducts).toBe(3);
	expect(stat.medianPrice).toBe(20);
});

test("an even count averages the two middle prices", () => {
	const stats = categoryStats([
		priced("a", "c", 10, "yes", [oss("A", "o/a", "docker", "none")]),
		priced("b", "c", 20, "yes", [oss("B", "o/b", "docker", "none")]),
	]);
	expect((stats.get("c") as CategoryStat).medianPrice).toBe(15);
});

test("a category with no published price has no median rather than a zero", () => {
	// Zero renders as "free", which is the exact lie priceLabel was fixed to stop.
	const stats = categoryStats([
		priced("a", "c", null, "yes", [oss("A", "o/a", "docker", "none")]),
	]);
	expect((stats.get("c") as CategoryStat).medianPrice).toBe(null);
});

test("projects are counted once however many products cite them", () => {
	const stats = categoryStats([
		priced("a", "c", 1, "yes", [oss("Same", "o/same", "docker", "none")]),
		priced("b", "c", 1, "yes", [oss("Same", "o/same", "docker", "none")]),
	]);
	expect((stats.get("c") as CategoryStat).projects).toBe(1);
});

test("the rung split sums to the product count", () => {
	const stats = categoryStats([
		priced("a", "c", 1, "yes", [oss("A", "o/a", "managed", "none")]),
		priced("b", "c", 1, "yes", [oss("B", "o/b", "ops", "none")]),
		priced("c", "c", 1, "almost", [oss("C", "o/c", "docker", "none")]),
		priced("d", "c", 1, "not-yet", [oss("D", "o/d", "docker", "none")]),
	]);
	const stat = stats.get("c") as CategoryStat;
	expect(stat.rungs).toEqual({
		"drop-in": 1,
		"self-hostable": 1,
		partial: 1,
		"locked-in": 1,
	});
	expect(RUNGS.reduce((n, r) => n + stat.rungs[r], 0)).toBe(stat.products);
});

test("the cheapest escape is the lowest-effort project with nothing paywalled", () => {
	const stats = categoryStats([
		// Managed and therefore lowest effort — but its free build is a demo, so it
		// is not an escape this site would stand behind.
		priced("a", "c", 1, "yes", [
			oss("Cripple", "o/cripple", "managed", "major"),
		]),
		priced("b", "c", 1, "yes", [oss("Ops", "o/ops", "ops", "none")]),
		priced("c", "c", 1, "yes", [oss("Docker", "o/docker", "docker", "none")]),
	]);
	const best = (stats.get("c") as CategoryStat).cheapestEscape;
	expect(best?.name).toBe("Docker");
	expect(best?.product.slug).toBe("c");
});

test("a category where everything is open core has no escape rather than a bad one", () => {
	const stats = categoryStats([
		priced("a", "c", 1, "yes", [oss("X", "o/x", "managed", "minor")]),
	]);
	expect((stats.get("c") as CategoryStat).cheapestEscape).toBe(null);
});

test("the same dataset in a different order gives the same escape", () => {
	const input = [
		priced("a", "c", 1, "yes", [oss("Beta", "o/beta", "docker", "none")]),
		priced("b", "c", 1, "yes", [oss("Alpha", "o/alpha", "docker", "none")]),
	];
	const forward = categoryStats(input).get("c")?.cheapestEscape?.name;
	const backward = categoryStats([...input].reverse()).get("c")?.cheapestEscape
		?.name;
	expect(forward).toBe("Alpha");
	expect(backward).toBe("Alpha");
});

test("among equally easy escapes, the one covering most of the category wins", () => {
	const stats = categoryStats([
		priced("a", "c", 1, "yes", [
			oss("Wide", "o/wide", "managed", "none"),
			oss("Narrow", "o/narrow", "managed", "none"),
		]),
		priced("b", "c", 1, "yes", [oss("Wide", "o/wide", "managed", "none")]),
	]);
	// Alphabetically "Narrow" sorts first; coverage is the better answer.
	expect((stats.get("c") as CategoryStat).cheapestEscape?.name).toBe("Wide");
});

/* ---- category themes ------------------------------------------------------
 *
 * The theme is authored, so the thing worth testing is that it cannot be left
 * out. Slicing the index on `position` would have needed no field and no test,
 * which is exactly why it was the wrong answer.
 */

const category = (over: Record<string, unknown> = {}) => ({
	slug: "c",
	name: { en: "C" },
	icon: "box",
	group: "work",
	position: 0,
	...over,
});

test("a category with no theme fails validation", () => {
	const { group: _drop, ...ungrouped } = category();
	expect(
		validateCategory(ungrouped, 0).some((i) => i.path === "[0].group"),
	).toBe(true);
});

test("a category with an invented theme fails validation", () => {
	expect(
		validateCategory(category({ group: "misc" }), 0).some(
			(i) => i.path === "[0].group",
		),
	).toBe(true);
});

test("a properly themed category passes", () => {
	expect(validateCategory(category(), 0)).toEqual([]);
});

test("every category ships with a theme", () => {
	for (const c of realCategories) {
		expect(CATEGORY_GROUPS).toContain(c.group);
	}
});

test("byGroup keeps every category exactly once and drops empty themes", () => {
	const groups = byGroup(realCategories);
	expect(groups.flatMap((g) => g.cats).length).toBe(realCategories.length);
	expect(groups.every((g) => g.cats.length > 0)).toBe(true);
	// The order is the authored one, not whatever the data happened to be in.
	expect(groups.map((g) => g.group)).toEqual(
		CATEGORY_GROUPS.filter((g) => realCategories.some((c) => c.group === g)),
	);
});

/**
 * Absence is never a fact.
 *
 * The features page states this rule in its own intro — "a dash means nobody has
 * checked, never that the answer is no" — and the rest of the site has to obey
 * it too, because the fields it applies to are absent far more often than they
 * are present: language and compose readings cover about a third of cited repos.
 *
 * These are the fields where a missing value is a different claim from `false`.
 * A change that gives one of them a default would pass every other test in here
 * and start telling readers, for 2000 projects, something nobody established.
 */
test("optional repo readings stay optional — a default would be a claim", () => {
	const products = readdirSync(DATA)
		.filter((f) => f.endsWith(".json"))
		.map((f) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as Product);

	for (const p of products) {
		for (const a of p.alternatives) {
			if (a.kind !== "oss") continue;
			for (const field of ["archived", "hasCompose"] as const) {
				const v = a[field];
				// Present-and-true, or absent. Never `false`: writing the negative
				// down is what turns "we did not look" into "we looked and it is no".
				expect(v === undefined || v === true).toBe(true);
			}
			expect(a.language === undefined || typeof a.language === "string").toBe(
				true,
			);
		}
	}
});

/**
 * `isArchived` reads the forge first and the entry second, and treats a missing
 * reading as no answer rather than as "alive". The three-way distinction is the
 * whole point, so it is asserted rather than left to the comment.
 */
test("isArchived: forge wins, entry fills the gap, absence is not a no", () => {
	// Forge says so — believe it, whatever the entry says.
	expect(isArchived({ archived: false }, { archived: true })).toBe(true);
	// Forge says alive — believe that too; it is checked nightly and we are not.
	expect(isArchived({ archived: true }, { archived: false })).toBe(false);
	// No reading at all: the entry is the only source, which is the case for
	// roughly two-thirds of cited repos.
	expect(isArchived({ archived: true }, null)).toBe(true);
	expect(isArchived({ archived: undefined }, null)).toBe(false);
});

/**
 * `stackCover` is a cover, not a ranking, and the difference is the whole point:
 * row two is the project covering the most of what row one does NOT, which is a
 * different answer from "the second-biggest project".
 */
test("stackCover picks by what is still uncovered, not by size", () => {
	const p = (name: string, replaces: string[]): Project =>
		({
			slug: name,
			name,
			replaces: replaces.map((slug) => ({
				slug,
				name: slug,
				note: { en: "" },
			})),
		}) as unknown as Project;

	// `big` covers 3. `overlap` covers 2 but both are already taken by `big`.
	// `small` covers 1 that nothing else does — so it must come second.
	const cover = stackCover([
		p("big", ["a", "b", "c"]),
		p("overlap", ["a", "b"]),
		p("small", ["d"]),
	]);

	expect(cover.map((c) => c.project.name)).toEqual(["big", "small"]);
	expect(cover[0]?.adds).toBe(3);
	// Second row adds one and brings the running total to four.
	expect(cover[1]?.adds).toBe(1);
	expect(cover[1]?.total).toBe(4);
	// `overlap` contributes nothing new, so it is absent rather than listed
	// with a zero — a zero row would read as if it mattered.
	expect(cover.some((c) => c.project.name === "overlap")).toBe(false);
});

test("stackCover over the real catalogue covers far more than any one project", () => {
	const products = readdirSync(DATA)
		.filter((f) => f.endsWith(".json"))
		.map((f) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as Product);
	const cover = stackCover(collectProjects(products));
	expect(cover.length).toBeGreaterThan(2);
	// Strictly increasing coverage, or the greedy step is not doing its job.
	for (let i = 1; i < cover.length; i++) {
		expect(cover[i]!.total).toBeGreaterThan(cover[i - 1]!.total);
	}
	expect(cover.at(-1)!.total).toBeGreaterThan(cover[0]!.adds);
});
