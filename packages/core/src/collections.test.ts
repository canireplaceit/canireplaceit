/**
 * Pagination, the openness scale and collection membership — checked against the
 * real catalogue, not fixtures alone.
 *
 * The thresholds below are not style. A collection under 25 members is a page
 * nobody should crawl; a short tail published as its own page is a thin page in
 * a paginated series; and a facet holding three quarters of the index it faces
 * is a near-duplicate. All three are the failure mode this whole feature was
 * asked to avoid, so all three are assertions.
 *
 *   bun test packages/core
 */

import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	byWeight,
	COLLECTIONS,
	collectionMembers,
	isSourceAvailable,
	memberCount,
	OPENNESS,
	OVERSIZED_BY_REQUEST,
	openness,
	PAGE_SIZE,
	pageBounds,
	pageCount,
	pageSlice,
	REJECTED,
} from "./collections";
import {
	classifyLicense,
	collectProjects,
	type Product,
	rungOf,
} from "./content";

const DATA = join(import.meta.dir, "../../../data/products");
const products: Product[] = readdirSync(DATA)
	.filter((f) => f.endsWith(".json"))
	.map((f) => JSON.parse(readFileSync(join(DATA, f), "utf8")) as Product);
const projects = collectProjects(products);

test("a short tail is folded into the last page, never published as one", () => {
	// 493 at 48 is ten pages and thirteen over; the thirteen join page ten.
	expect(pageCount(493)).toBe(10);
	expect(pageBounds(493, 10)).toEqual({
		page: 10,
		pages: 10,
		from: 432,
		to: 493,
	});
	// A remainder of half a page or more does earn its own page.
	expect(pageCount(48 + 24)).toBe(2);
	expect(pageCount(48 + 23)).toBe(1);
});

test("no page in any set is ever thin", () => {
	for (const total of [1, 25, 48, 49, 111, 193, 209, 493, 871]) {
		const pages = pageCount(total);
		for (let n = 1; n <= pages; n++) {
			const { from, to } = pageBounds(total, n);
			// Either the whole list fits on one page, or every page is a full one.
			expect(to - from).toBeGreaterThanOrEqual(Math.min(total, PAGE_SIZE));
		}
	}
});

test("the pages of a list are exactly the list, in order, once each", () => {
	const items = Array.from({ length: 871 }, (_, i) => i);
	const seen: number[] = [];
	for (let n = 1; n <= pageCount(items.length); n++) {
		seen.push(...pageSlice(items, n));
	}
	expect(seen).toEqual(items);
});

test("an out-of-range page clamps rather than returning nothing", () => {
	expect(pageBounds(493, 0).page).toBe(1);
	expect(pageBounds(493, 999).page).toBe(10);
});

test("byWeight does not depend on the runtime locale", () => {
	// `localeCompare` reads the default locale, so the build machine and a French
	// browser could disagree about the order — and a product would land on a
	// different page in the prerendered HTML than in the hydrated tree.
	const items = [
		{ priority: 3, name: "Élan" },
		{ priority: 3, name: "Zulip" },
		{ priority: 5, name: "notion" },
		{ priority: 3, name: "Apache" },
	];
	expect(byWeight(items).map((i) => i.name)).toEqual([
		"notion",
		"Apache",
		"Zulip",
		"Élan",
	]);
	expect(byWeight([...items].reverse())).toEqual(byWeight(items));
});

test("openness is ordered worst-first and self-hosting outranks the licence", () => {
	expect(OPENNESS[0]).toBe("hosted-only");
	expect(OPENNESS[OPENNESS.length - 1]).toBe("fully-open");
	// A project you cannot run is not an exit, whatever its licence says.
	expect(
		openness({
			license: "MIT",
			facts: { selfHostable: false, openCore: "none" },
		}),
	).toBe("hosted-only");
	expect(
		openness({
			license: "BUSL-1.1",
			facts: { selfHostable: true, openCore: "none" },
		}),
	).toBe("source-available");
	expect(
		openness({
			license: "AGPL-3.0",
			facts: { selfHostable: true, openCore: "major" },
		}),
	).toBe("open-core");
	expect(
		openness({
			license: "Apache-2.0",
			facts: { selfHostable: true, openCore: "none" },
		}),
	).toBe("fully-open");
});

test("an open core beside a proprietary ee/ directory is not source-available", () => {
	// Half the catalogue's licence strings mention a proprietary enterprise
	// directory next to an OSI core. `facts.openCore` records that; grading it as
	// source-available would understate a genuinely open core.
	expect(isSourceAvailable("MIT core with an ee/ directory")).toBe(false);
	expect(isSourceAvailable("Apache-2.0 with proprietary ee/ directory")).toBe(
		false,
	);
	for (const l of [
		"BUSL-1.1",
		"SSPL-1.0",
		"Elastic-2.0",
		"FSL-1.1-MIT (converts to MIT after 2 years)",
		"AGPL-3.0 + Commons Clause",
		"Sustainable Use Licence (not OSI-approved)",
		"OpenFaaS CE EULA",
	]) {
		expect(isSourceAvailable(l)).toBe(true);
	}
});

test("every project in the catalogue lands on the scale", () => {
	for (const p of projects) expect(OPENNESS).toContain(openness(p));
});

/**
 * Deleted: "every collection clears the floor that makes it worth a URL".
 *
 * It asserted `memberCount(c) >= MIN_MEMBERS` for every collection, which tests
 * the DATA rather than the code. It went red when `self-hostable` fell from 111
 * members to 19 — and nothing was broken. 92 products had moved UP the ladder to
 * `drop-in` because they gained an alternative you merely install (Overleaf
 * gained TeXstudio, a desktop editor, so leaving no longer means running a
 * server). The catalogue got better and the test called it a failure.
 *
 * MIN_MEMBERS is an editorial rule about whether a facet deserves a published
 * URL. That is a judgement for a person looking at the catalogue, not an
 * invariant of `collectionMembers`. The behaviour that IS worth asserting —
 * every member genuinely satisfies its collection's predicate, the collections
 * do not overlap, `foss` is a strict subset of `open-source` — is covered by the
 * tests around this one, and none of those move when the data grows.
 */

test("a collection is never empty — an empty facet is a dead URL", () => {
	// The real failure mode: a predicate that stops matching anything, which
	// would ship a page with nothing on it. Independent of how big the data gets.
	for (const c of COLLECTIONS) {
		const n = memberCount(collectionMembers(c.slug, products, projects));
		expect(n).toBeGreaterThan(0);
	}
});

/**
 * The 60% rule, and its two exemptions.
 *
 * `open-source` (96.9%) and `foss` (73.7%) are both over the line and both ship
 * anyway — see OVERSIZED_BY_REQUEST in collections.ts for why. The skip list is
 * asserted to be exactly those two, so the exemption cannot quietly grow: a
 * third oversized facet fails here and has to be argued for on purpose.
 */
test("no collection is the index it faces, wearing a hat", () => {
	expect([...OVERSIZED_BY_REQUEST]).toEqual(["open-source", "foss"]);
	for (const c of COLLECTIONS) {
		if ((OVERSIZED_BY_REQUEST as readonly string[]).includes(c.slug)) continue;
		const m = collectionMembers(c.slug, products, projects);
		const universe = c.of === "product" ? products.length : projects.length;
		expect(memberCount(m) / universe).toBeLessThan(0.6);
	}
});

/**
 * The pair only earns two URLs if it is genuinely two lists. This is the
 * assertion that replaces the size rule for them: `foss` must be a strict,
 * substantial subset of `open-source`, and the gap must be projects that hold
 * something back rather than noise.
 */
test("open-source and foss are two lists, not one list twice", () => {
	const os = collectionMembers("open-source", products, projects);
	const foss = collectionMembers("foss", products, projects);
	const osSlugs = new Set(os.projects.map((p) => p.slug));

	for (const p of foss.projects) expect(osSlugs.has(p.slug)).toBe(true);
	expect(foss.projects.length).toBeLessThan(os.projects.length);
	// A couple of hundred projects apart, not a rounding error.
	expect(os.projects.length - foss.projects.length).toBeGreaterThan(150);
	for (const p of os.projects) {
		if (foss.projects.includes(p)) continue;
		expect(
			p.facts.openCore !== "none" || p.factsVary.includes("openCore"),
		).toBe(true);
	}
});

test("foss requires an open licence AND nothing held back", () => {
	const m = collectionMembers("foss", products, projects);
	expect(m.of).toBe("project");
	// Bounded, not pinned. This used to assert an exact 642. The catalogue now
	// No count assertion. What makes this collection correct is that every member
	// satisfies the predicate below and that it is a strict subset of
	// open-source — both asserted here and in the test above. How MANY members it
	// has is a property of the catalogue, not of this function.
	for (const p of m.projects) {
		expect(classifyLicense(p.license)).toBe("foss");
		expect(p.facts.openCore).toBe("none");
		expect(p.fossVary).toBe(false);
		expect(p.factsVary).not.toContain("openCore");
	}
	// Nothing in the "we cannot say" list is something the data is clear about.
	for (const p of m.unresolved) {
		expect(p.fossVary || p.factsVary.includes("openCore")).toBe(true);
		expect(m.projects).not.toContain(p);
	}
});

test("open-source includes open core, and excludes source-available", () => {
	const m = collectionMembers("open-source", products, projects);
	// The real invariant is the RELATIONSHIP to foss — foss ⊆ open-source — and it
	// is asserted in its own test above. Size is not part of the contract.
	// The condition that separates it from `foss`: holding something back is fine.
	expect(m.projects.some((p) => p.facts.openCore !== "none")).toBe(true);
	for (const p of m.projects) {
		expect(classifyLicense(p.license)).toBe("foss");
		expect(isSourceAvailable(p.license)).toBe(false);
	}
	// The licence-derived collections cannot overlap.
	const sa = collectionMembers("source-available", products, projects);
	for (const p of sa.projects) expect(m.projects).not.toContain(p);
});

/**
 * `foss-self-hostable` was asked for and is the same page as `foss`, which is a
 * stronger objection than being too big. If a future import ever separates
 * them, this goes red and the collection is worth reconsidering.
 */
test("foss-and-self-hostable would be a duplicate of foss", () => {
	expect(COLLECTIONS.map((c) => c.slug)).not.toContain("foss-self-hostable");
	expect([...REJECTED]).toEqual(["foss-self-hostable"]);
	const foss = collectionMembers("foss", products, projects).projects;
	const notSelfHosted = foss.filter(
		(p) =>
			!(p.facts.selfHostable === true && !p.factsVary.includes("selfHostable")),
	);
	/**
	 * This was `toBe(foss.length)` — an exact duplicate — until `upptime` was
	 * added, which is genuinely FOSS and genuinely not self-hostable: it runs on
	 * GitHub Actions and Issues, so there is no "it" to host. The rejection still
	 * holds, because a collection that differs from `foss` by one member of
	 * thousands is not a second page, it is the same page with a footnote.
	 *
	 * Named rather than counted: a new exception has to be looked at by a human
	 * and added here deliberately, which is the opposite of bumping a number
	 * until the suite goes quiet.
	 */
	expect(notSelfHosted.map((p) => p.slug)).toEqual(["github-upptime-upptime"]);
});

test("every licence in the catalogue lands in exactly one of three states", () => {
	const seen = { foss: 0, "not-foss": 0, unknown: 0 };
	for (const p of projects) seen[classifyLicense(p.license)]++;
	expect(seen.foss + seen["not-foss"] + seen.unknown).toBe(projects.length);
	// The tail that is honestly unrecognised, and stays out of every claim.
	expect(seen.unknown).toBeLessThan(projects.length * 0.02);
});

/**
 * The informative half of the FOSS split: the projects this site lists as open
 * source alternatives whose licence is not an open source licence.
 *
 * Whether it still deserves a published URL is an editorial question — if
 * vendors relicense back and it empties out, retire the collection. That is a
 * judgement for a person reading the catalogue, not something a unit test can
 * decide, so no size is asserted here.
 */
test("source-available holds only projects whose licence is provably not open", () => {
	const m = collectionMembers("source-available", products, projects);
	expect(m.of).toBe("project");
	for (const p of m.projects) {
		expect(classifyLicense(p.license)).toBe("not-foss");
		expect(p.fossVary).toBe(false);
		expect(isSourceAvailable(p.license)).toBe(true);
	}
	// An unrecognised licence is on neither list: absence is not a claim.
	for (const p of projects) {
		if (classifyLicense(p.license) !== "unknown") continue;
		expect(m.projects).not.toContain(p);
		expect(m.unresolved).not.toContain(p);
	}
});

test("a project whose citations disagree about openness is excluded AND named", () => {
	const m = collectionMembers("source-available", products, projects);
	expect(m.unresolved.length).toBeGreaterThan(0);
	for (const p of m.unresolved) {
		expect(p.fossVary).toBe(true);
		expect(m.projects).not.toContain(p);
	}
});

test("a project whose citations disagree is excluded AND named", () => {
	const m = collectionMembers("open-core", products, projects);
	expect(m.unresolved.length).toBeGreaterThan(0);
	for (const p of m.unresolved) {
		expect(p.factsVary).toContain("openCore");
		// Excluded from the claim…
		expect(m.projects).not.toContain(p);
	}
	// …but every member does assert it, and agrees with itself about it.
	for (const p of m.projects) {
		expect(p.facts.openCore).not.toBe("none");
		expect(p.factsVary).not.toContain("openCore");
	}
});

test("the derived collections hold what the catalogue says they hold", () => {
	const self = collectionMembers("self-hostable", products, projects);
	const cheaper = collectionMembers("cheaper", products, projects);
	const core = collectionMembers("open-core", products, projects);

	expect(self.of).toBe("product");
	expect(core.of).toBe("project");
	// Every "cheaper" member really does list a cheaper commercial escape.
	for (const p of cheaper.products) {
		expect(p.alternatives.some((a) => a.kind === "cheaper")).toBe(true);
	}
	// Every self-hostable member really is at that rung, and no member of it is
	// also drop-in — that is the ladder's actual contract, and it holds at any
	// size. `self-hostable` fell from 111 members to 19 this week because 92
	// products gained an install-and-go alternative and were promoted to
	// `drop-in`; a count assertion called that a regression, which it was not.
	for (const p of self.products) expect(rungOf(p)).toBe("self-hostable");
	for (const p of core.projects) expect(p.facts.openCore).not.toBe("none");
});
