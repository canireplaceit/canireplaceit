// Pagination, the openness scale, and the derived collections. A collection is a query over the catalogue, never a hand-maintained list.

import {
	classifyLicense,
	EFFORT_RANK,
	type Facts,
	type OssAlternative,
	type Product,
	type Project,
	rungOf,
} from "./content";

// 48 divides evenly across the 1/2/3-column grid breakpoints and avoids minting too many thin indexable pages.
export const PAGE_SIZE = 48;

// A remainder below half a page folds into the previous page instead of becoming its own thin final page.
export function pageCount(total: number, per: number = PAGE_SIZE): number {
	if (total <= per) return 1;
	const full = Math.floor(total / per);
	return total % per < per / 2 ? full : full + 1;
}

/** The bounds of page `n`, clamped into range. Page 1 is `[0, per)`. */
export function pageBounds(
	total: number,
	page: number,
	per: number = PAGE_SIZE,
): { page: number; pages: number; from: number; to: number } {
	const pages = pageCount(total, per);
	const n = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const from = (n - 1) * per;
	return { page: n, pages, from, to: n === pages ? total : from + per };
}

export function pageSlice<T>(
	items: T[],
	page: number,
	per: number = PAGE_SIZE,
): T[] {
	const { from, to } = pageBounds(items.length, page, per);
	return items.slice(from, to);
}

// Sorts by priority then a byte-wise lowercased name compare — not `localeCompare`, which is locale-dependent and would
// make the prerendered and hydrated page disagree on ordering. Votes (which change nightly) are deliberately excluded.
export const byWeight = <T extends { priority: number; name: string }>(
	items: T[],
): T[] =>
	[...items].sort((a, b) => {
		if (b.priority !== a.priority) return b.priority - a.priority;
		const an = a.name.toLowerCase();
		const bn = b.name.toLowerCase();
		return an < bn ? -1 : an > bn ? 1 : 0;
	});

// How open an "open source alternative" actually is, ranked on one axis (not three independent checkboxes):
//   hosted-only       you cannot run it yourself, whatever the licence says
//   source-available  published source under a licence that is not open source
//   open-core         OSI licence, but the free build is a demo
//   mostly-open       OSI licence, a few enterprise conveniences are sold
//   fully-open        the build you can run yourself is the whole product
export const OPENNESS = [
	"hosted-only",
	"source-available",
	"open-core",
	"mostly-open",
	"fully-open",
] as const;
export type Openness = (typeof OPENNESS)[number];

/** Rank on the scale. Higher is freer, so `>=` reads as "at least this open". */
export const opennessRank = (o: Openness): number => OPENNESS.indexOf(o);

// Delegates to the single `classifyLicense` in content.ts so the openness scale, the `source-available` collection, and
// anything else reading licences never grade the same project differently. `unknown` is not source-available.
export const isSourceAvailable = (license: string): boolean =>
	classifyLicense(license) === "not-foss";

/** Where one alternative or project sits on the scale. Derived, never authored. */
export function openness(entry: {
	license: string;
	facts: Pick<Facts, "selfHostable" | "openCore">;
}): Openness {
	if (entry.facts.selfHostable === false) return "hosted-only";
	if (isSourceAvailable(entry.license)) return "source-available";
	if (entry.facts.openCore === "major") return "open-core";
	if (entry.facts.openCore === "minor") return "mostly-open";
	return "fully-open";
}

/** The freest open source alternative a product offers, or null if it has none. */
export function bestOpenness(product: Product): Openness | null {
	let best: Openness | null = null;
	for (const alt of product.alternatives) {
		if (alt.kind !== "oss") continue;
		const o = openness(alt);
		if (best === null || opennessRank(o) > opennessRank(best)) best = o;
	}
	return best;
}

/** The least work a product's open source alternatives ask of you. */

export function easiestEffort(
	product: Product,
): OssAlternative["effort"] | null {
	let best: OssAlternative["effort"] | null = null;
	for (const alt of product.alternatives) {
		if (alt.kind !== "oss") continue;
		if (best === null || EFFORT_RANK[alt.effort] < EFFORT_RANK[best]) {
			best = alt.effort;
		}
	}
	return best;
}

// A collection is a derived slice of the catalogue with a URL of its own. `of` says whether the rows are products or
// projects, because e.g. "self-hostable"/"cheaper" are facts about a paid product, while "open core" is a fact about a project.
export type CollectionDef = {
	slug: string;
	of: "product" | "project";
};

// Ordered as a ladder: can you run it at all -> is the source open -> is it open with no strings -> what is held back ->
// what is not really open -> what if the answer is a smaller invoice.
// `open-source` and `foss` are siblings, not inverses: open-source only requires an OSI licence (an enterprise edition
// beside it doesn't disqualify); FOSS additionally requires `facts.openCore === "none"`.
export const COLLECTIONS: readonly CollectionDef[] = [
	{ slug: "self-hostable", of: "product" },
	{ slug: "open-source", of: "project" },
	{ slug: "foss", of: "project" },
	{ slug: "open-core", of: "project" },
	{ slug: "source-available", of: "project" },
	{ slug: "cheaper", of: "product" },
	// Two facts the catalogue holds about every project and never gave a page to.
	{ slug: "one-compose", of: "project" },
	{ slug: "archived", of: "project" },
];

export const collectionBySlug = new Map(COLLECTIONS.map((c) => [c.slug, c]));

// Rejected, not for size but because it duplicates `foss`: FOSS already requires `openCore: "none"`, which already
// implies self-hostable, so `foss` intersected with `selfHostable` is identical to `foss` itself.
export const REJECTED = ["foss-self-hostable"] as const;

// The three tests a facet page has to pass: (1) at least 25 members; (2) built from a field populated on at least 80%
// of the data; (3) excludes enough to be a different page from the index it faces (no more than 60% of its universe).
// `open-source` and `foss` are exempt from (3) by the owner's explicit instruction — do not delete them for failing it;
// a test asserts the skip list is exactly these two slugs so a third can't join quietly.
export const OVERSIZED_BY_REQUEST = ["open-source", "foss"] as const;

/** The floor a facet has to clear to be worth a URL. See `REJECTED`. */
export const MIN_MEMBERS = 25;

export type CollectionMembers = {
	of: "product" | "project";
	products: Product[];
	projects: Project[];
	/** Projects whose own citations disagree on the field this collection is built from; rendered as a named list, never dropped. */
	unresolved: Project[];
};

export function collectionMembers(
	slug: string,
	products: Product[],
	projects: Project[],
): CollectionMembers {
	const none: CollectionMembers = {
		of: "product",
		products: [],
		projects: [],
		unresolved: [],
	};

	switch (slug) {
		case "self-hostable":
			return {
				...none,
				products: products.filter((p) => rungOf(p) === "self-hostable"),
			};

		case "cheaper":
			return {
				...none,
				products: products.filter((p) =>
					p.alternatives.some((a) => a.kind === "cheaper"),
				),
			};

		case "open-source":
			return {
				of: "project",
				products: [],
				projects: projects.filter(
					(p) => !p.fossVary && classifyLicense(p.license) === "foss",
				),
				unresolved: projects.filter((p) => p.fossVary),
			};

		// Requires consensus (no fossVary/factsVary disagreement) on BOTH the licence and openCore. selfHostable is
		// deliberately not a third condition: openCore "none" already implies it across the catalogue.
		case "foss": {
			const settledOut = (p: Project) =>
				(!p.fossVary && classifyLicense(p.license) !== "foss") ||
				(!p.factsVary.includes("openCore") && p.facts.openCore !== "none");
			const isMember = (p: Project) =>
				!p.fossVary &&
				classifyLicense(p.license) === "foss" &&
				!p.factsVary.includes("openCore") &&
				p.facts.openCore === "none";
			return {
				of: "project",
				products: [],
				projects: projects.filter(isMember),
				// Unresolved only for disagreement, never a settled no — otherwise the "we cannot say" list would include clear cases.
				unresolved: projects.filter((p) => !isMember(p) && !settledOut(p)),
			};
		}

		case "open-core":
			return {
				of: "project",
				products: [],
				projects: projects.filter(
					(p) =>
						p.facts.openCore !== "none" && !p.factsVary.includes("openCore"),
				),
				unresolved: projects.filter((p) => p.factsVary.includes("openCore")),
			};

		// Same consensus rule as `open-core`, on the licence instead of facts. `unknown` licences are absent from both
		// lists — a licence the classifier doesn't recognise is not evidence either way.
		case "source-available":
			return {
				of: "project",
				products: [],
				projects: projects.filter(
					(p) => !p.fossVary && classifyLicense(p.license) === "not-foss",
				),
				// The licence gate applies here too, or the comment above is a lie: a
				// project whose citations disagree AND whose licence we cannot grade is
				// named on a source-available page purely for being contested, which
				// asserts something about its licence that nobody established.
				unresolved: projects.filter(
					(p) => p.fossVary && classifyLicense(p.license) !== "unknown",
				),
			};

		/**
		 * Ships a compose file in the repo root — `docker compose up` and it runs.
		 *
		 * The most actionable slice in here: not "this is theoretically
		 * self-hostable" but "you can be running this tonight". Detected by
		 * `bun run health`, never authored.
		 */
		case "one-compose":
			return {
				of: "project",
				products: [],
				projects: projects.filter((p) => p.hasCompose === true),
				unresolved: [],
			};

		/**
		 * Projects that are done.
		 *
		 * The owner's rule is that the catalogue records what existed as well as
		 * what exists, so these are kept and shown everywhere rather than dropped.
		 * This is the page that makes that a feature instead of a footnote — and
		 * nobody else publishes it.
		 *
		 * No `unresolved`: archived is not a field citations can disagree about in
		 * a way worth naming. Any citation saying so is enough (see Project.archived).
		 */
		case "archived":
			return {
				of: "project",
				products: [],
				projects: projects.filter((p) => p.archived === true),
				unresolved: [],
			};

		default:
			return none;
	}
}

/** How many rows a collection has, whichever entity it is made of. */
export const memberCount = (m: CollectionMembers): number =>
	m.of === "product" ? m.products.length : m.projects.length;
