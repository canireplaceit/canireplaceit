#!/usr/bin/env bun
/**
 * Static HTML for every URL, in every locale, generated after `rsbuild build`.
 *
 * A directory site earns its traffic from search, and a client-rendered SPA
 * gives a crawler an empty <div>. The content is fully known at build time, so
 * we render the REAL React tree — the same components the browser will run —
 * and let `hydrateRoot` adopt it.
 *
 * That last part is the whole design. Hand-written prose HTML would be simpler
 * to emit, but React cannot reproduce it, so hydration throws it away (#418) and
 * the crawler's renderer sees the empty shell after all. So instead of writing
 * markup, we call `renderToString(<App/>)` with the page's data inlined into
 * `window.__DATA__`, and the client's first render draws exactly the same tree.
 *
 *   bun run prerender      (runs as part of `bun run build`)
 *
 * Emits, per locale, for ~500 products + ~870 projects + ~84 categories:
 *   dist/<lang>/                          home
 *   dist/<lang>/alternatives/<product>/   product   (fr: /fr/alternatives/…)
 *   dist/<lang>/tools/<project>/          project   (fr: /fr/outils/…)
 *   dist/<lang>/categories/<category>/    category
 *   dist/sitemap.xml + dist/sitemap-*.xml
 *   dist/robots.txt
 */

import { Database } from "bun:sqlite";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	byWeight,
	COLLECTIONS,
	collectionMembers,
	memberCount,
	pageCount,
	pageSlice,
} from "core/src/collections";
import {
	type Alternative,
	CATEGORY_GROUPS,
	type Category,
	type CategoryStat,
	categoryStats,
	collectProjects,
	type Health,
	type HealthFile,
	healthKey,
	type PriceFreshness,
	type Product,
	type Project,
	type ProjectPageFacts,
	priceFreshness,
	projectSlug,
	type Source,
	splitGaps,
	thinProject,
} from "core/src/content";
import type { FeatureFile } from "core/src/features";
import {
	DEFAULT_LANG,
	type Lang,
	resolveTranslation,
	SupportedLangs,
	type Translations,
} from "core/src/index";
import type { Route } from "core/src/routes";
import {
	alternateUrls,
	buildProjectSlugs,
	LEGAL_DOCS,
	paths,
} from "core/src/routes";
import type { Row as FeatureRow } from "../apps/frontend/src/FeaturesPage";
import { markdownFor, mdFor } from "./page-markdown";

const ROOT = join(import.meta.dir, "..");
const FE = join(ROOT, "apps/frontend");
const DATA = join(ROOT, "data");
const DIST = join(FE, "dist");
const SITE = process.env.SITE_URL ?? "https://canireplaceit.com";

/**
 * `renderToString` never runs an effect, so the app only touches the four
 * globals below during a render: the URL it was opened on, and the two stores
 * behind the theme and the design. Both stores answer "nothing saved" here,
 * which is exactly what the hooks assume for their first render — see the note
 * on `useTheme` in i18n.ts.
 */
const at = (url: string) => {
	Object.defineProperty(globalThis, "location", {
		value: new URL(`${SITE}${url}`),
		configurable: true,
		writable: true,
	});
};
at("/en/");
Object.assign(globalThis, {
	localStorage: { getItem: () => null, setItem: () => {} },
	matchMedia: () => ({ matches: false }),
});

// Imported through the frontend workspace, which is where react actually lives.
const React = await import(Bun.resolveSync("react", FE));
const { renderToString } = await import(
	Bun.resolveSync("react-dom/server", FE)
);
const { App } = await import(join(FE, "src/App.tsx"));
const { UPDATED: LEGAL_UPDATED } = await import(join(FE, "src/legal.tsx"));
// The neighbours a product page links sideways to. It lives in the frontend
// because it trims each entry to what `ProductCard` prints — see
// apps/frontend/src/listShared.tsx.
const { relatedProducts } = await import(join(FE, "src/listShared.tsx"));
// The feature explorer's own join, over the whole catalogue rather than one
// page's slice. Imported from the page for the same reason as `relatedProducts`:
// a second copy here would be a second answer, and the page would hydrate into
// a different table from the one we shipped.
const { projectRows: featureRowsFor } = (await import(
	join(FE, "src/FeaturesPage.tsx")
)) as {
	projectRows: (
		products: Product[],
		file: FeatureFile | null,
		slugs: Map<string, string>,
	) => FeatureRow[];
};
// Read from the one translation table rather than a second copy here: `meta` is
// computed outside the React tree, so there is no `t` in scope.
const { dict } = (await import(join(FE, "src/i18n.ts"))) as {
	dict: Record<string, Record<string, string>>;
};
const groupLabel = (lang: string, group: string): string =>
	dict[lang]?.[`catGroup.${group}`] ?? dict.en[`catGroup.${group}`] ?? group;
const {
	categoriesMeta,
	categoryMeta,
	collectionMeta,
	collectionsMeta,
	groupMeta,
	homeMeta,
	productMeta,
	productsMeta,
	projectMeta,
	projectsMeta,
	standingMeta,
	legalMeta,
	OG_IMAGE,
	OG_LOCALE,
	X_HANDLE,
} = await import(join(FE, "src/seo.ts"));

type Meta = {
	title: string;
	description: string;
	/** Empty on `/` and `/404.html`, which are not pages with a URL of their own. */
	canonical: string;
	jsonLd?: string[];
};

/** One row of a list page, exactly as the page renders it. See seo.ts. */
type ListRow = { name: string; url: string };

const files = readdirSync(join(DATA, "products"))
	.filter((f) => f.endsWith(".json"))
	.sort();
const products: Product[] = files.map((f) =>
	JSON.parse(readFileSync(join(DATA, "products", f), "utf8")),
);
const categories: Category[] = JSON.parse(
	readFileSync(join(DATA, "categories.json"), "utf8"),
);
const projects = collectProjects(products);
const prettySlug = buildProjectSlugs(
	projects,
	products.map((p) => p.slug),
);

/**
 * The document rsbuild built, before we touch it.
 *
 * `dist/index.html` is also a page we emit (the locale-less landing), so reading
 * the shell straight back out of it would compound our own head onto itself the
 * second time this script runs without a rebuild. A pristine copy is kept beside
 * it, refreshed whenever rsbuild has produced a new untouched one.
 */
const SHELL_PATH = join(DIST, ".shell.html");
const built = readFileSync(join(DIST, "index.html"), "utf8");
if (!built.includes('rel="canonical"') || !existsSync(SHELL_PATH)) {
	writeFileSync(SHELL_PATH, built);
}
const shell = readFileSync(SHELL_PATH, "utf8");

/**
 * When the page last actually changed. Google uses <lastmod>; it ignores
 * <priority> entirely, which is why that is gone.
 *
 * A price check dates the page it is printed on. Everything else is dated by
 * git, never by the file system: `apps/frontend/Dockerfile` does `COPY . .`
 * from a fresh CI checkout, so every mtime in the image is the checkout time,
 * and stamping that told Google the 203 products with no price check had all
 * changed on the morning of every deploy. A sitemap that cries wolf on every
 * build is one a crawler learns to stop reading, and it costs us the one signal
 * that is genuinely ours to give. One pass over the history is enough: `git
 * log` lists the newest commit first, so the first mention of a path is the
 * last time that path changed.
 */
const CATALOGUE_SEEDED = "2026-08-02";
const committedAt = ((): Map<string, string> => {
	const map = new Map<string, string>();
	try {
		const log = Bun.spawnSync(["git", "log", "--format=%cI", "--name-only"], {
			cwd: ROOT,
			stderr: "ignore",
		});
		let day = CATALOGUE_SEEDED;
		for (const line of log.stdout.toString().split("\n")) {
			if (!line) continue;
			if (/^\d{4}-\d{2}-\d{2}T/.test(line)) day = line.slice(0, 10);
			else if (!map.has(line)) map.set(line, day);
		}
	} catch {
		// No git binary at all. Handled below, like a shallow clone.
	}
	return map;
})();
/**
 * A shallow clone, an export with no `.git`, or an image with no git binary:
 * the history is simply not there to read. The answer then is one frozen date,
 * because today's date is the exact lie this function exists to remove, and a
 * build must not fail over a missing `.git`. CI clones with `fetch-depth: 0`,
 * so the real build always has the real answer.
 */
const lastChange = (path: string) => committedAt.get(path) ?? CATALOGUE_SEEDED;
/**
 * The standing pages have no data file of their own: their copy is the
 * frontend source, so the newest commit under it is when they last changed.
 * They used to be stamped with the build clock, which said "changed today" on
 * every deploy — the same lie as the mtimes above, just written by hand. The
 * few that print a live count can now understate the date when only the
 * catalogue moved, and understating is the harmless direction.
 */
const STANDING_CHANGED =
	[...committedAt]
		.filter(([path]) => path.startsWith("apps/frontend/src/"))
		.map(([, day]) => day)
		.sort()
		.at(-1) ?? CATALOGUE_SEEDED;
const changedAt = new Map<string, string>(
	files.map((f, i) => [
		products[i].slug,
		products[i].pricing?.checkedOn ?? lastChange(`data/products/${f}`),
	]),
);
const newest = (slugs: string[]) =>
	slugs
		.map((s) => changedAt.get(s) ?? "")
		.sort()
		.at(-1) || CATALOGUE_SEEDED;

/**
 * Live counts, baked into the HTML.
 *
 * Pages are regenerated on every vote, so the number a crawler sees and the
 * number a reader sees on first paint are the same one.
 *
 * The database is read directly when it is here, because that is exact and
 * needs no server running. It is only here for a local build: release images
 * come out of CI, where the file does not exist, so that path falls back to the
 * live API and zeroes are the last resort rather than the normal case.
 * Must stay in step with `counted()` in apps/backend/src/index.ts.
 */
const TRUST_THRESHOLD = 0.5;
const DB_PATH = process.env.DATABASE_URL ?? join(ROOT, "data/canireplaceit.db");

type Counts = {
	products: Map<string, number>;
	projects: Map<string, number>;
	total: number;
};

const emptyCounts = (): Counts => ({
	products: new Map(),
	projects: new Map(),
	total: 0,
});

/**
 * The live site, asked for the tallies when the database is not on this box.
 *
 * Release images are built in CI from a fresh checkout and the database lives
 * on the server, so `DB_PATH` never exists in a real build. Reading zeroes there
 * is not the harmless fallback the comment above assumed: `/counts.json` ships
 * empty, all 592 product pages claim nobody switched, and the home page
 * prerenders a three-column stat grid that grows a fourth column the instant it
 * hydrates, which is a layout shift on the most-linked page on the site.
 *
 * Best effort by design. A build must never fail because the site is down.
 */
async function fetchCounts(): Promise<Counts> {
	try {
		const res = await fetch(`${SITE}/api/v1/stats`, {
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		const body = (await res.json()) as {
			switches?: number;
			switched_by_product?: Record<string, number>;
			switched_by_project?: Record<string, number>;
		};
		const products = new Map(Object.entries(body.switched_by_product ?? {}));
		const projects = new Map(Object.entries(body.switched_by_project ?? {}));
		const total =
			body.switches ?? [...products.values()].reduce((a, b) => a + b, 0);
		console.log(
			`  counts from ${SITE}: ${total} switches, ${products.size} products`,
		);
		return { products, projects, total };
	} catch (e) {
		console.warn(`  ! no counts baked in: ${(e as Error).message}`);
		return emptyCounts();
	}
}

async function loadCounts(): Promise<Counts> {
	// No file is the normal case in CI and on a fresh clone, so ask the live
	// site instead of baking zeroes.
	if (!existsSync(DB_PATH)) return fetchCounts();

	try {
		// `create: false` so a typo in DATABASE_URL fails loudly rather than
		// silently baking zeroes from a brand new empty file. `readwrite` must be
		// passed with it — bun:sqlite throws SQLITE_MISUSE if neither access flag
		// is set. Not `readonly`: opening a WAL database read-only fails when the
		// -shm file has to be created.
		const sqlite = new Database(DB_PATH, { readwrite: true, create: false });
		sqlite.exec("PRAGMA busy_timeout = 5000");
		const rows = sqlite
			.query(
				`SELECT product_slug, project_slug FROM votes
				 WHERE trust >= ? AND nullified_at IS NULL`,
			)
			.all(TRUST_THRESHOLD) as {
			product_slug: string;
			project_slug: string | null;
		}[];
		sqlite.close();

		const products = new Map<string, number>();
		const projects = new Map<string, number>();
		for (const r of rows) {
			products.set(r.product_slug, (products.get(r.product_slug) ?? 0) + 1);
			if (r.project_slug) {
				projects.set(r.project_slug, (projects.get(r.project_slug) ?? 0) + 1);
			}
		}
		return { products, projects, total: rows.length };
	} catch (e) {
		console.warn(
			`  ! local db unreadable (${(e as Error).message}), asking ${SITE}`,
		);
		return fetchCounts();
	}
}

const counts = await loadCounts();

/**
 * The three headline figures on the home page, baked in.
 *
 * They came from /api/stats, which is a boot-time fetch, so every prerendered
 * home page shipped `<dd>—</dd>` where the numbers belong — the first thing on
 * the page and the one part of it a crawler was guaranteed not to read. Every
 * field is derived from the same catalogue the backend derives it from, and
 * `switches` from the same trusted-vote total the per-product counts use, so
 * the figure a crawler sees and the one /api/stats answers with agree.
 *
 * Must stay in step with GET /api/stats in apps/backend/src/index.ts.
 */
const siteStats: SiteCounts = {
	products: products.length,
	categories: categories.length,
	alternatives: products.reduce((n, p) => n + p.alternatives.length, 0),
	ossAlternatives: products.reduce(
		(n, p) => n + p.alternatives.filter((a) => a.kind === "oss").length,
		0,
	),
	notYet: products.filter((p) => p.verdict === "not-yet").length,
	monthlySpendCents: products.reduce(
		(sum, p) => sum + Math.round((p.priceMonthly ?? 0) * 100),
		0,
	),
	switches: counts.total,
};

/* ------------------------------------------------------------------ */
/* The sponsor board, baked in for the same reason the vote counts are. */
/* ------------------------------------------------------------------ */

type Translated = { en: string; fr?: string };
type Slot = {
	id: string;
	placement: "hero" | "rail" | "category";
	rail?: "left" | "right";
	position?: number;
	label: Translated;
	priceCents: number | null;
	category?: string;
	categoryName?: Translated;
	available: boolean;
	takenUntil: string | null;
	sponsor: {
		purchaseId: string;
		name: Translated;
		tagline: Translated | null;
		url: string | null;
		logoUrl: string | null;
		tint: string | null;
	} | null;
};

/**
 * The hero wall and the rail tape, on screen at first paint.
 *
 * These two were the whole of the remaining layout shift once the catalogue
 * fetch was gone. `SponsorTape` is a sibling ABOVE the main column, so its
 * arrival moved a 7,593px element by its own height, and the ten-cell hero wall
 * moved everything under it again. Measured on the home page at 412px: 0.549
 * CLS with them arriving late, 0.0005 with them never arriving at all.
 *
 * Only `data/sponsors/slots.json` — the ten hero positions and the ten rail
 * ones. The per-category inventory is generated by apps/backend/src/content.ts
 * and is deliberately NOT reproduced here: it is inserted into the list rows
 * rather than above them, and dropping it measured no CLS change at all. It
 * still arrives with the API answer like everything else.
 *
 * Occupancy is the same rule as `takenFrom` in apps/backend/src/occupancy.ts,
 * which is the source of truth: a row at `paid` or `submitted` holds its slot
 * indefinitely, and only a `live` run expires. No database — a fresh clone, CI —
 * means every position renders as open, which is the honest answer when there is
 * nothing to say otherwise.
 */
const slotDefs: Omit<Slot, "available" | "takenUntil" | "sponsor">[] =
	JSON.parse(readFileSync(join(DATA, "sponsors/slots.json"), "utf8"));

type PurchaseRow = {
	id: string;
	slot_id: string;
	status: string;
	ends_at: number | null;
	name: string | null;
	name_fr: string | null;
	tagline: string | null;
	tagline_fr: string | null;
	url: string | null;
	logo_url: string | null;
	tint: string | null;
};

function slotBoard(): Slot[] {
	const taken = new Map<string, PurchaseRow>();
	if (existsSync(DB_PATH)) {
		try {
			const sqlite = new Database(DB_PATH, { readwrite: true, create: false });
			sqlite.exec("PRAGMA busy_timeout = 5000");
			const rows = sqlite
				.query(
					`SELECT id, slot_id, status, ends_at, name, name_fr, tagline,
					        tagline_fr, url, logo_url, tint
					   FROM sponsor_purchases
					  WHERE status IN ('paid', 'submitted', 'live')`,
				)
				.all() as PurchaseRow[];
			sqlite.close();
			// `ends_at` is drizzle's `timestamp` mode, which is seconds.
			const now = Date.now();
			for (const r of rows) {
				if (r.status === "live" && r.ends_at && r.ends_at * 1000 <= now)
					continue;
				taken.set(r.slot_id, r);
			}
		} catch (e) {
			console.warn(`  ! no sponsor board baked in: ${(e as Error).message}`);
		}
	}

	return slotDefs.map((slot) => {
		const p = taken.get(slot.id);
		return {
			...slot,
			available: !p,
			takenUntil: p?.ends_at ? new Date(p.ends_at * 1000).toISOString() : null,
			/**
			 * Occupancy, never the creative.
			 *
			 * Every cell — sold, open, or the house ad — is the same `WALL_CELL`, so
			 * the layout this exists to reserve does not depend on whose logo is in
			 * it. Baking the creative as well would put a paid advert into 8,865
			 * static files that go stale the moment a run ends or a takedown lands,
			 * and its logo is usually somebody else's host: five avatar requests to
			 * a third-party origin, eager and preloaded, on the critical path of
			 * every page on the site. The board arrives with /api/slots ~50 ms in
			 * and swaps each card's contents inside a box that already has the
			 * right size.
			 */
			sponsor: null,
		};
	});
}

const slots = slotBoard();

/** What the API returns, so the prerendered tree and the hydrated one agree. */
type Listed = Product & { switchedCount: number };
const listed: Listed[] = products.map((p) => ({
	...p,
	switchedCount: counts.products.get(p.slug) ?? 0,
}));
const listedBySlug = new Map(listed.map((p) => [p.slug, p]));

/**
 * The rows a list page renders, as the `ItemList` in its structured data.
 *
 * 472 CollectionPage blocks used to carry a name and a canonical and nothing
 * else, and 192 category and theme pages carried no page node at all. This is
 * what turns them into a statement of what actually lives under the URL. It
 * wins no rich result — no carousel type accepts SoftwareApplication — so it is
 * entity hygiene, and it is built here rather than in seo.ts because only the
 * prerenderer knows which slice of the catalogue a given page shows.
 */
const categoryBySlug = new Map(categories.map((c) => [c.slug, c]));
const productRows = (
	rows: { name: string; slug: string }[],
	lang: Lang,
): ListRow[] =>
	rows.map((p) => ({ name: p.name, url: paths.product(lang, p.slug) }));
const projectRows = (rows: Project[], lang: Lang): ListRow[] =>
	rows.map((p) => ({
		name: p.name,
		url: paths.project(lang, prettySlug.get(p.slug) as string),
	}));

/** The category a project is filed under: the one its best-known product is in. */
const categoryOfProject = (project: Project): Category | undefined => {
	const first = listedBySlug.get(project.replaces[0]?.slug ?? "");
	return first ? categoryBySlug.get(first.category) : undefined;
};

const productsIn = (slug: string) => listed.filter((p) => p.category === slug);
const liveCategories = categories.filter((c) => productsIn(c.slug).length > 0);
const noindexCategories = new Set(
	liveCategories
		.filter((c) => productsIn(c.slug).length < 3)
		.map((c) => c.slug),
);

const esc = (s: string) =>
	s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** Safe to sit inside <script>: `<` can never start a closing tag. */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

/**
 * The page's slice of the catalogue, inlined so the first client render can
 * reproduce this document. Shipping the whole thing would be 1.4 MB per page.
 */
type Boot = {
	products: Listed[];
	categories: Category[];
	projectSlugs: [string, string][];
	freshness: PriceFreshness;
	/**
	 * The rest of this product's category, card-shaped. A product page ships one
	 * product, so its neighbours cannot be derived in the browser and travel here
	 * instead. Trimmed by `relatedProducts`; ~1.2 kB each.
	 */
	related?: Listed[];
	/**
	 * `[slug, name, category]` for every product, on the products index and
	 * nowhere else. That page names all 592, so it carries three strings each
	 * rather than the ~7 kB a full list row costs.
	 */
	productIndex?: [string, string, string][];
	categoryStats: [string, CategoryStat][];
	health: HealthFile;
	/**
	 * Pre-derived rows for an index page whose rows are PROJECTS.
	 *
	 * Every other page can reconstruct what it renders from a product payload.
	 * These two cannot: the products citing 48 projects also cite dozens of
	 * others, so `collectProjects` over them returns a different set in a
	 * different order. So the rows travel as rows.
	 */
	projectRows?: Project[];
	projectTotal?: number;
	/** Members per collection, over the whole catalogue. See the note in App.tsx. */
	collectionCounts?: [string, number][];
	unresolvedRows?: Project[];
	/** The feature answers for THIS page's projects, on the three page types that
	 *  render them. Absent everywhere else — see `shipBoot`. */
	features?: FeatureFile;
	/**
	 * The feature explorer's result rows, on that page and nowhere else.
	 *
	 * Same reason as `projectRows`: the page is a join across every product's
	 * open source alternatives, and it ships no products of its own — the whole
	 * catalogue is 1.4 MB and it needs six fields per project. So the join is
	 * done here, by the page's own `projectRows`.
	 */
	featureRows?: FeatureRow[];
	/** The hero wall and the rail tape, so they are on screen at first paint
	 *  rather than dropping in when /api/slots answers. See `slotBoard`. */
	slots: Slot[];
	/** The headline counts, on the home pages and the stats page — the two that
	 *  render them. See `siteStats` below. */
	stats?: SiteCounts;
};

/** Mirrors GET /api/stats in apps/backend/src/index.ts, field for field. */
type SiteCounts = {
	products: number;
	categories: number;
	alternatives: number;
	ossAlternatives: number;
	notYet: number;
	monthlySpendCents: number;
	switches: number;
};

/**
 * Over every product, not the page's slice — the footer line speaks for the
 * whole site. Computed once here rather than in the browser, so the static
 * document a crawler reads carries the same figures a reader sees.
 */
const freshness = priceFreshness(products);

/**
 * Also over every product, and for the same reason: the category menu on a
 * category page names twelve other categories and puts a count beside each. That
 * count is a claim about the whole catalogue, and the page's own slice holds only
 * one category's products — so deriving it per page would print eighty-three
 * zeroes. Every figure in it is computed by `categoryStats` in core.
 */
const allCategoryStats: [string, CategoryStat][] = [...categoryStats(products)];

/**
 * Pretty slugs for the ~84 projects the index names as cheapest escapes.
 *
 * The index ships no products — every figure on it is already in the stats above
 * — but it does name one project per row, and a name that is not a link is a dead
 * end on the page whose whole job is routing people onward. This is the smallest
 * payload that makes those names clickable: the ids of the projects it actually
 * mentions, and nothing else.
 */
const escapeProjectSlugs: [string, string][] = [
	...new Map(
		allCategoryStats
			.map(([, stat]) => stat.cheapestEscape)
			.filter((e): e is NonNullable<typeof e> => e !== null)
			.map((e): [string, string] => {
				const id = projectSlug(e.source);
				return [id, prettySlug.get(id) as string];
			}),
	),
];

/** Repo liveness, regenerated by `bun run health`. Absent on a fresh clone. */
const healthFile: HealthFile = (() => {
	try {
		return JSON.parse(readFileSync(join(DATA, "health.json"), "utf8"));
	} catch {
		console.warn("  ! no data/health.json — run `bun run health`");
		return { fetchedAt: "", repos: {} };
	}
})();

/**
 * The archived reading seo.ts needs, under the same freshness rule the browser
 * applies.
 *
 * `healthOf` in apps/frontend/src/api.ts withholds `archived` and `lastPush`
 * once the file is more than MAX_AGE_DAYS old, and the verdict sentence on the
 * page is computed through it. The structured data quotes that sentence
 * verbatim, so it has to resolve the same reading or it would name a different
 * project from the one the article names.
 */
const HEALTH_MAX_AGE_DAYS = 30;
const healthFresh = (() => {
	const at = Date.parse(`${healthFile.fetchedAt}T00:00:00Z`);
	return (
		Number.isFinite(at) && Date.now() - at < HEALTH_MAX_AGE_DAYS * 86_400_000
	);
})();
const archivedReading = (source: Source): Pick<Health, "archived"> | null =>
	healthFresh ? (healthFile.repos[healthKey(source)] ?? null) : null;

/**
 * The feature matrix. Read once; sliced per page below, exactly like health.
 * Absent or unreadable is not fatal — the block simply does not render, which
 * is the correct behaviour for a project we hold no features for anyway.
 */
const featureFile: FeatureFile = (() => {
	try {
		return JSON.parse(readFileSync(join(DATA, "features.json"), "utf8"));
	} catch {
		console.warn("  ! no data/features.json — run annex/promote-features.ts");
		return { taxonomyVersion: 0, domains: [], projects: {} };
	}
})();

/**
 * Only the repos THIS page cites.
 *
 * The whole file is 170 KB and would be 14 kB gzipped on the critical path of
 * every landing page, to render three or four alternatives. A directory earns
 * its traffic from search, so almost every visit is a single page — which makes
 * a shared cached bundle the wrong trade and a per-page slice the right one. A
 * product page carries about 700 bytes of this.
 */
/**
 * The feature values for a set of projects — the same slicing discipline as
 * `healthFor`. Returns null when we hold nothing for any of them, so the boot
 * payload carries no empty object and the component renders nothing rather
 * than an empty "Features" heading.
 */
const featuresForProjects = (
	sources: Source[],
	/** Product slugs this page shows — the proprietary column of ReplaceMatrix. */
	slugs: string[] = [],
): FeatureFile | null => {
	const projects: FeatureFile["projects"] = {};
	for (const s of sources) {
		const v = featureFile.projects[healthKey(s)];
		if (v) projects[healthKey(s)] = v;
	}
	const products: NonNullable<FeatureFile["products"]> = {};
	const productTiers: NonNullable<FeatureFile["productTiers"]> = {};
	for (const slug of slugs) {
		const v = featureFile.products?.[slug];
		if (v) products[slug] = v;
		const t = featureFile.productTiers?.[slug];
		if (t) productTiers[slug] = t;
	}
	const n = Object.keys(projects).length + Object.keys(products).length;
	if (n === 0) return null;
	// Built key by key rather than spread over `featureFile`: the generated file
	// carries a `$comment` and a `generatedFrom` that were being inlined into all
	// 8,865 documents to say nothing to anybody.
	return {
		taxonomyVersion: featureFile.taxonomyVersion,
		domains: featureFile.domains,
		projects,
		products,
		productTiers,
	};
};

/**
 * Every open source alternative anyone cites — the feature explorer's subject.
 *
 * The page is the one document on the site that is about all of them at once,
 * so it is the one page whose slice is the whole file. 3,234 of the 3,281 keys
 * survive `featuresForProjects`; the rest are projects nothing cites any more.
 */
const ossSources: Source[] = listed.flatMap((p) =>
	p.alternatives.filter((a) => a.kind === "oss").map((a) => a.source),
);

/**
 * The explorer's result rows, joined once for both locales.
 *
 * Locale-independent by construction: a row carries a project's name, its icon,
 * the category SLUGS it is cited under and its page's slug — no prose. The
 * labels beside them are resolved in the page from the categories the payload
 * already carries.
 */
const featureRows: FeatureRow[] = featureRowsFor(
	listed,
	featureFile,
	prettySlug,
);

/**
 * What each project page actually says about its project — the join across the
 * three data files the template reads, handed to the one rule that decides
 * whether the page is worth indexing.
 *
 * `lastPush` is gated on `healthFresh` for the same reason `healthOf` in
 * apps/frontend/src/api.ts gates it: a stale reading is withheld from the page,
 * and a rule that counted a date the page will not print would be scoring
 * markup that does not exist.
 */
const pageFactsFor = (project: Project): ProjectPageFacts => {
	const key = healthKey(project.source);
	const health = healthFile.repos[key] ?? null;
	const decided = featureFile.projects[key] ?? {};
	const labelled = new Map<string, Translations>();
	for (const d of featureFile.domains) {
		for (const f of d.features) labelled.set(f.key, f.name);
	}
	return {
		whatYouLose: project.replaces.flatMap((r) =>
			(listedBySlug.get(r.slug)?.whatYouLose ?? []).map((b) =>
				resolveTranslation(b, DEFAULT_LANG),
			),
		),
		featureLabels: Object.entries(decided)
			.filter(([, v]) => v !== "unknown")
			.map(([k]) => {
				const name = labelled.get(k);
				return name ? resolveTranslation(name, DEFAULT_LANG) : "";
			}),
		health: health
			? healthFresh
				? health
				: { ...health, lastPush: undefined, archived: undefined }
			: null,
	};
};

// `thinProject` is in packages/core/src/content.ts: scripts/build-og-pages.ts
// now reads the same rule to decide which project pages get a card of their own,
// and two copies of it would disagree the first time either moved.
const noindexProjects = new Set(
	projects.filter((p) => thinProject(p, pageFactsFor(p))).map((p) => p.slug),
);

const healthFor = (subset: Listed[]): HealthFile => {
	const repos: Record<string, Health> = {};
	for (const p of subset) {
		for (const a of p.alternatives) {
			if (a.kind !== "oss") continue;
			const key = healthKey(a.source);
			const h = healthFile.repos[key];
			if (h) repos[key] = h;
		}
	}
	return { fetchedAt: healthFile.fetchedAt, repos };
};

/** The repo readings for a set of PROJECTS, rather than for a set of products. */
const healthForProjects = (subset: Project[]): HealthFile => {
	const repos: Record<string, Health> = {};
	for (const p of subset) {
		if (p.source.host !== "github") continue;
		const h = healthFile.repos[p.source.path];
		if (h) repos[p.source.path] = h;
	}
	return { fetchedAt: healthFile.fetchedAt, repos };
};

/**
 * How many members each collection holds, over every product and project.
 *
 * Computed once, shipped with every collection page and with the index over
 * them, because a page carrying 48 of 209 rows cannot count its own collection —
 * and the pager it needs to render is the crawlable spine.
 */
const collectionCounts: [string, number][] = COLLECTIONS.map((def) => [
	def.slug,
	memberCount(collectionMembers(def.slug, products, projects)),
]);

/* ------------------------------------------------------------------ */
/* What actually ships in the document, as opposed to what a page holds. */
/* ------------------------------------------------------------------ */

/**
 * The alternative as a LIST page renders it.
 *
 * A row on the home page, a category or a collection prints three names and a
 * count. It never prints `note`, and `note` is 2.5 MB of the 5.0 MB catalogue —
 * on the English home page, 643 nested entries rode along and one of them was
 * on screen. Everything the row and the browse filters read stays: the name, the
 * repo, the licence, the effort and the facts the effort/openness filters sort
 * on. The array keeps its length, because the row prints "+7 more" from it.
 */
const forList = (a: Alternative): Alternative => {
	const out: Record<string, unknown> = { ...a };
	delete out.note;
	return out as unknown as Alternative;
};

const listShaped = new Map<string, Listed>(
	listed.map((p) => [
		p.slug,
		{ ...p, alternatives: p.alternatives.map(forList) },
	]),
);

const LANG_KEYS: ReadonlySet<string> = new Set(SupportedLangs);

/** A `{ en, fr }` map, and not some other object that happens to carry an `en`. */
const isTranslations = (v: Record<string, unknown>): boolean =>
	typeof v.en === "string" &&
	Object.keys(v).every((k) => LANG_KEYS.has(k) && typeof v[k] === "string");

/**
 * One language per document.
 *
 * 1,147 bilingual maps put 162 KB of French on the English home page, against
 * 127 KB of English, and none of it rendered — the page is written in one
 * language and every reader of it resolves through `resolveTranslation` with
 * that language.
 *
 * The survivor is stored under `en` whatever the locale: `resolveTranslation`
 * falls back to `en`, the type requires it, and a French page carrying French
 * under `en` renders French. Nothing on the page ever wants the other one.
 *
 * Cached by object identity, per language. The same `Listed` and the same
 * `FeatureDomain` instances are reused across all 8,865 pages, so the walk runs
 * once per object rather than once per page.
 */
const localeCache: Record<Lang, WeakMap<object, unknown>> = {
	en: new WeakMap(),
	fr: new WeakMap(),
};

function oneLocale<T>(value: T, lang: Lang): T {
	if (value === null || typeof value !== "object") return value;
	const cache = localeCache[lang];
	const hit = cache.get(value as object);
	if (hit !== undefined) return hit as T;

	let out: unknown;
	if (Array.isArray(value)) {
		out = value.map((v) => oneLocale(v, lang));
	} else if (isTranslations(value as Record<string, unknown>)) {
		out = { en: resolveTranslation(value as unknown as Translations, lang) };
	} else {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			o[k] = oneLocale(v, lang);
		}
		out = o;
	}
	cache.set(value as object, out);
	return out as T;
}

/**
 * The payload as it goes into the document — and as `renderToString` reads it,
 * so the prerendered markup and the hydrated markup are produced from exactly
 * the same object. Trimming it after the render would be a hydration mismatch.
 *
 * `full` is a product page, a project page or the feature explorer: the pages
 * that print an alternative's prose or the feature matrix. Every other page
 * ships neither, and carrying the readings there was 170 kB saying nothing.
 */
const shipBoot = (boot: Boot, lang: Lang, full: boolean): Boot => {
	const trimmed = full
		? boot
		: {
				...boot,
				products: boot.products.map((p) => listShaped.get(p.slug) ?? p),
				features: undefined,
			};
	return {
		...oneLocale(trimmed, lang),
		// The one exception, and it stays bilingual on purpose: `byWeight` in
		// categories.tsx breaks ties on `name.en` so the menu comes out in the same
		// order in both languages. Collapsing it would reorder the French menu.
		// All 85 of them cost 2.2 kB, which is not worth a behaviour change.
		categories: boot.categories,
	};
};

const bootFor = (subset: Listed[]): Boot => ({
	slots,
	products: subset,
	categories,
	// Only the projects this page can reach, but with the slug the FULL catalogue
	// gave them — collisions are resolved globally or the URLs would not match.
	projectSlugs: collectProjects(subset).map((p) => [
		p.slug,
		prettySlug.get(p.slug) as string,
	]),
	freshness,
	categoryStats: allCategoryStats,
	health: healthFor(subset),
	features:
		featuresForProjects(
			subset.flatMap((p) =>
				p.alternatives.filter((x) => x.kind === "oss").map((x) => x.source),
			),
			subset.map((p) => p.slug),
		) ?? undefined,
	collectionCounts,
});

/**
 * Runs before anything else on the page so the colours are right on the first
 * paint. The React state cannot do this job: it has to start at the prerendered
 * default or hydration mismatches, so the stored preference is applied here, to
 * the <html> attributes the stylesheet keys off.
 */
const THEME_SCRIPT =
	`try{var d=document.documentElement,t=localStorage.getItem("theme");
if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";
d.dataset.theme=t;d.style.colorScheme=t}catch(e){}`.replace(/\n/g, "");

// The Umami tag lives in apps/frontend/rsbuild.config.ts, in the shell this
// function's output is spliced into — so it is present in `bun run dev` too,
// which never reaches this file. `withHead` preserves it.

/**
 * The card this page should unfurl with.
 *
 * `scripts/build-og-pages.ts` writes one per route name and language;
 * everything else keeps the one static card. Checked on disk rather than
 * assumed, because that script is deliberately NOT part of the build. The
 * production image has no fonts, so the cards are generated where fonts exist
 * and committed. A missing file therefore means "not generated yet", which must
 * degrade to the static card rather than to a 404 in every social preview. That
 * is also what lets the set land one page type at a time.
 *
 * `kind` is the route name, and the language is part of the filename because the
 * cards carry copy now. A route with no slug of its own is `og/{kind}-{lang}.png`.
 */
const OG_DIR = join(FE, "public/og");

/**
 * Every card is drawn at exactly this size — `W`/`H` in build-og-pages.ts, and
 * the static `og.png` with them — so `og:image:width`/`height` are constants
 * rather than a `sharp` call per page. Facebook documents them as the fix for
 * the blank box the FIRST person to share a URL sees: without them the crawler
 * queues the file for download and renders the story before it arrives.
 */
const OG_W = 1200;
const OG_H = 630;

/**
 * What each card actually shows, in words, written beside the PNGs by
 * build-og-pages.ts.
 *
 * `og:image:alt` has to describe the image, and the image is drawn there. A
 * second description composed here would be a copy of the card's contents that
 * drifts the first time a card is redesigned — and these cards carry meaning
 * that exists ONLY as pixels (the verdict, the price, what you give up), so a
 * wrong one is worse than none. Absent file, or absent key, falls back to the
 * page's own title, which is also what every page on the static card gets.
 */
const OG_ALT: Record<string, string> = existsSync(join(OG_DIR, "alt.json"))
	? JSON.parse(readFileSync(join(OG_DIR, "alt.json"), "utf8"))
	: {};

/** A page's card: where it is, and what it says. */
type Card = { image: string; alt?: string };

const ogFor = (kind: string, slug: string, lang: Lang): Card => {
	const name = slug ? `${kind}-${slug}-${lang}` : `${kind}-${lang}`;
	return existsSync(join(OG_DIR, `${name}.png`))
		? { image: `${SITE}/og/${name}.png`, alt: OG_ALT[name] }
		: { image: OG_IMAGE };
};

/**
 * Route names that have a card of their own, keyed by whether it carries a slug.
 *
 * `project` is here for the INDEXABLE project pages only: build-og-pages.ts
 * draws 2,602 of them and skips the `thinProject` two thirds, and `ogFor` hands
 * the rest the static card because their file is not on disk.
 */
const OG_SLUGGED = new Set([
	"product",
	"project",
	"category",
	"group",
	"collection",
]);
const OG_STANDING = new Set([
	"home",
	"categories",
	"collections",
	"projects",
	"features",
	"glossary",
	"gaps",
	"stats",
	"submit",
	"sponsor",
	"contact",
]);

/**
 * A paginated route keeps its parent's card: page 7 of a collection is the same
 * subject as page 1, and minting a second image for it would say otherwise.
 */
function ogForRoute(route: Route): Card | undefined {
	const slug = (route as { slug?: string }).slug;
	if (OG_SLUGGED.has(route.name) && slug) {
		return ogFor(route.name, slug, route.lang);
	}
	if (OG_STANDING.has(route.name)) return ogFor(route.name, "", route.lang);
	return undefined;
}

/**
 * The font files the first screen actually paints in.
 *
 * Only the latin subsets ever load — but nothing asks for them until the browser
 * has downloaded and parsed a stylesheet that is itself discovered after the head
 * of a large document. Measured, they did not start until 696 ms. Three preload
 * links move that to the first bytes of the head.
 *
 * The names are hashed by rsbuild, so they are read off the build rather than
 * written down here, and a missing file emits nothing rather than a dead link.
 * `crossorigin` is not optional: a font preload without it is fetched in a
 * different mode from the CSS request and downloads the file twice.
 */
const FONT_DIR = join(DIST, "static/font");
const fontFiles = existsSync(FONT_DIR) ? readdirSync(FONT_DIR) : [];
// Space Grotesk is third because it is now `font-display: optional`: a font that
// is not there when the page first paints is not used at all for that document,
// and this is a pushState site, so "that document" is the whole visit. The
// preload is what gets it there in time — with it, the h1 renders in Space
// Grotesk from the first paint down to 400 kbps / 400 ms; without it, a first
// visit is served the fallback throughout. Measured, it costs no LCP.
const PRELOAD_FONTS = [
	"ibm-plex-sans-latin-400-normal",
	"ibm-plex-mono-latin-400-normal",
	"space-grotesk-latin-wght-normal",
]
	.map((base) =>
		fontFiles.find((f) => f.startsWith(`${base}.`) && f.endsWith(".woff2")),
	)
	.filter((f): f is string => f !== undefined)
	.map(
		(f) =>
			`<link rel="preload" as="font" type="font/woff2" href="/static/font/${f}" crossorigin>`,
	);

function head(o: {
	lang: Lang;
	meta: Meta;
	alternates: Record<Lang, string>;
	noindex: boolean;
	/** Per-page card, when one has been generated for this route. */
	card?: Card;
}): string {
	const { lang, meta, alternates } = o;
	const image = o.card?.image ?? OG_IMAGE;
	// The static card carries the site's own name and tagline, which describes
	// nothing about the page it is standing in for. The title does.
	const imageAlt = o.card?.alt ?? meta.title;
	return [
		// First, ahead of the title: these are the only things in this block a
		// preload scanner can start before the stylesheet exists.
		...PRELOAD_FONTS,
		`<title>${esc(meta.title)}</title>`,
		`<meta name="description" content="${esc(meta.description)}">`,
		// `/` redirects and `/404.html` answers under every URL that does not
		// exist. Neither has a canonical URL of its own, and pointing both at the
		// home page told Google the 404 WAS the home page.
		meta.canonical ? `<link rel="canonical" href="${meta.canonical}">` : "",
		o.noindex ? `<meta name="robots" content="noindex, follow">` : "",
		// Every locale, INCLUDING this one, plus x-default. The return links are
		// what make the set valid: two pages that do not both point at each other
		// are ignored outright, so the same block is emitted on every page of the
		// set rather than "the other languages".
		// `data-alt` marks these as the set applyMeta owns, so a client-side
		// navigation replaces them instead of appending a second, stale set.
		...SupportedLangs.map(
			(l) =>
				`<link rel="alternate" hreflang="${l}" href="${SITE}${alternates[l]}" data-alt>`,
		),
		`<link rel="alternate" hreflang="x-default" href="${SITE}${alternates[DEFAULT_LANG]}" data-alt>`,
		// Feed autodiscovery. /feed.xml has answered 200 with 50 valid Atom entries
		// since the backend shipped, and nothing in 8,867 documents ever pointed at
		// it, so every reader's "find the feed" button came back empty. `atom+xml`,
		// not `rss+xml`: the handler in apps/backend/src/api-v1.ts emits Atom, and
		// the title is that feed's own <title> so the two cannot disagree. One
		// feed, English only, which is why there is no per-locale variant here.
		`<link rel="alternate" type="application/atom+xml" title="canireplaceit: prices just verified" href="${SITE}/feed.xml">`,
		// The SVG icon link is already in the shell, ahead of this block: rsbuild
		// picks up apps/frontend/public/favicon.svg on its own, and first is where
		// a browser that supports SVG should find it. The rasters below are for
		// everything that does not take one — Google's favicon documentation names
		// every other format and never SVG, and iOS ignores it outright.
		`<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">`,
		`<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">`,
		`<link rel="manifest" href="/site.webmanifest">`,
		// The real page background in each scheme, not the brand blue: this paints
		// the browser's own chrome around the document, and a blue bar over a white
		// page reads as a rendering bug.
		`<meta name="theme-color" content="#fbfbfd" media="(prefers-color-scheme: light)">`,
		`<meta name="theme-color" content="#0a0d13" media="(prefers-color-scheme: dark)">`,
		`<meta property="og:type" content="website">`,
		`<meta property="og:site_name" content="canireplaceit">`,
		`<meta property="og:title" content="${esc(meta.title)}">`,
		`<meta property="og:description" content="${esc(meta.description)}">`,
		meta.canonical
			? `<meta property="og:url" content="${meta.canonical}">`
			: "",
		`<meta property="og:image" content="${image}">`,
		// Recommended by Facebook: with the type declared the scraper does not have
		// to probe-fetch the file the first time a URL is shared.
		`<meta property="og:image:type" content="image/png">`,
		`<meta property="og:image:width" content="${OG_W}">`,
		`<meta property="og:image:height" content="${OG_H}">`,
		`<meta property="og:image:alt" content="${esc(imageAlt)}">`,
		`<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
		...SupportedLangs.filter((l) => l !== lang).map(
			(l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`,
		),
		`<meta name="twitter:card" content="summary_large_image">`,
		// Without these X renders the card with no attribution and no way back to
		// an account. The handle is the one already linked in the footer.
		`<meta name="twitter:site" content="${X_HANDLE}">`,
		`<meta name="twitter:creator" content="${X_HANDLE}">`,
		`<meta name="twitter:title" content="${esc(meta.title)}">`,
		`<meta name="twitter:description" content="${esc(meta.description)}">`,
		`<meta name="twitter:image" content="${image}">`,
		`<meta name="twitter:image:alt" content="${esc(imageAlt)}">`,
		...(meta.jsonLd ?? []).map(
			(s) =>
				`<script type="application/ld+json" data-ld>${s.replace(/</g, "\\u003c")}</script>`,
		),
		`<script>${THEME_SCRIPT}</script>`,
	]
		.filter(Boolean)
		.join("\n");
}

const write = (path: string, html: string) => {
	const full = join(DIST, path);
	mkdirSync(dirname(full), { recursive: true });
	writeFileSync(full, html);
};

/** `/en/` → `en/index.html`, `/fr/outils/x` → `fr/outils/x/index.html`. */
const fileFor = (url: string) => `${url.replace(/^\/|\/$/g, "")}/index.html`;

/**
 * Swaps the shell's head for ours.
 *
 * The block goes in immediately after `<meta charset>`, not in place of the
 * title: the charset declaration has to land inside the first 1024 bytes or the
 * browser stops looking and guesses the encoding, and a page of JSON-LD in front
 * of it pushes it well past that.
 */
const withHead = (lang: Lang, headHtml: string) =>
	shell
		// No `data-design`: there is one design, its tokens are at `:root`, and
		// nothing keys off the attribute. The `?design=` override that used to set
		// it went with the other seven — leaving it behind meant every page had an
		// infinite family of query-string duplicates that rendered identically.
		.replace("<html>", `<html lang="${lang}">`)
		.replace(/<title>.*?<\/title>/s, "")
		.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${headHtml}`);

type Page = {
	url: string;
	lang: Lang;
	kind:
		| "home"
		| "product"
		| "project"
		| "projects"
		| "category"
		| "categories"
		| "collections"
		| "collection"
		| "standing"
		| "legal";
	lastmod: string;
	noindex: boolean;
	alternates: Record<Lang, string>;
};

const pages: Page[] = [];

function emit(o: {
	route: Route;
	meta: Meta;
	boot: Boot;
	kind: Page["kind"];
	lastmod: string;
	noindex?: boolean;
}) {
	const lang = o.route.lang;
	const alternates = alternateUrls(o.route);
	const url = alternates[lang];
	// A route that is private by nature carries the flag on its metadata, so the
	// prerendered tag and the one applyMeta writes on a client-side navigation
	// cannot disagree. `o.noindex` stays for the thin-page rule, which is a
	// property of the catalogue rather than of the route.
	const noindex = o.noindex ?? o.meta.noindex ?? false;

	// One object for the render, the inline payload and the Markdown twin: they
	// have to be produced from identical data or hydration finds a different
	// document than the one it was handed.
	const shipped = shipBoot(
		o.boot,
		lang,
		o.route.name === "product" ||
			o.route.name === "project" ||
			o.route.name === "features",
	);

	at(url);
	(globalThis as { __DATA__?: Boot }).__DATA__ = shipped;
	const body = renderToString(React.createElement(App));

	// The card for this route, when one has been generated. Sign-in, the
	// dashboard, admin, the legal pages and the noindex project pages keep the
	// static card on purpose, see the header of scripts/build-og-pages.ts.
	const card = ogForRoute(o.route);
	const html = withHead(
		lang,
		head({ lang, meta: o.meta, alternates, noindex, card }),
	)
		/**
		 * JSON, not JavaScript.
		 *
		 * These are the first bytes of the body and on the home page they are 80%
		 * of the document, so what parses them matters. A bare `<script>` hands
		 * the whole blob to the JS parser as an object literal; `type=
		 * "application/json"` is inert text the JS parser never sees, and
		 * `JSON.parse` reads it about twice as fast at this size. src/index.tsx
		 * puts it back on `window.__DATA__` before hydrating, which is where
		 * everything downstream still looks for it.
		 *
		 * `json()` escapes every `<` as `\u003c`, which is a valid escape inside a
		 * JSON string, so no `</script>` in the data can end the block early.
		 */
		.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
		/**
		 * AFTER the markup, not before it.
		 *
		 * It used to sit 42 bytes into `<body>`, so on a big page the browser
		 * parsed half a megabyte of JSON before it reached a single element:
		 * `/en/collections/foss/` did not have a `<main>` until byte 505,202 of
		 * 619,370, and under throttling that is ~2s of blank screen followed by
		 * the whole document laying out at once. That was the residual layout
		 * shift on the long collection pages, and no amount of trimming markup
		 * above it helped, because the blob WAS what was above it.
		 *
		 * Safe to move: the bundle is `defer`, so it does not run until parsing
		 * has finished, and `src/index.tsx` reads this tag before hydrating.
		 */
		.replace(
			"</body>",
			`<script type="application/json" id="boot-data">${json(shipped)}</script></body>`,
		);

	/**
	 * The Markdown twin, beside the HTML.
	 *
	 * Deliberately NOT pushed into `pages`. These are alternate representations
	 * of a document, not documents of their own, so they stay out of the sitemap
	 * and out of the hreflang set. Listing them would ask a crawler to treat one
	 * page as two, which is the duplicate-content problem this file works hard
	 * everywhere else to avoid.
	 *
	 * `markdownFor` returns null for pages whose content lives in the React tree
	 * rather than in the payload, and those simply get no twin.
	 */
	const markdown = markdownFor({
		route: o.route,
		url,
		lang,
		title: o.meta.title,
		description: o.meta.description,
		boot: shipped,
		site: SITE,
		lastmod: o.lastmod,
	});

	/**
	 * The twin's `rel="alternate"` tag, added here rather than in `head()`.
	 *
	 * Every other tag in this document comes from `head()`, so that is where to
	 * look for this one first. It is not there because the tag may only be
	 * emitted when a twin actually exists, and `head()` runs before we know
	 * that. Threading the answer through its arguments would couple it to a
	 * question it does not otherwise ask, so the tag goes in afterwards instead.
	 */
	const withTwin =
		markdown === null
			? html
			: html.replace(
					"</head>",
					`<link rel="alternate" type="text/markdown" href="${SITE}${url.replace(/\/$/, "")}.md">\n</head>`,
				);

	write(fileFor(url), withTwin);
	if (markdown !== null) {
		for (const path of mdFor(url)) write(path, markdown);
	}

	pages.push({
		url,
		lang,
		kind: o.kind,
		lastmod: o.lastmod,
		noindex,
		alternates,
	});
}

/**
 * The paginated spine.
 *
 * The home page used to carry the top 100 products by editorial weight and stop
 * there — which meant 393 of 493 products were reachable only through their
 * category, and the tail of the catalogue had no crawlable path at all. It is now
 * ten real pages: `/en/`, `/en/page/2` … `/en/page/10`.
 *
 * The order is `byWeight` and not the vote count. Votes change nightly, and a
 * page whose membership churns is a URL that means something different every
 * week — which is the one thing an indexable URL must not be.
 */
/**
 * The not-yet list, inlined into its own page so a crawler can read it.
 *
 * Both halves travel: the page renders the paid ones and the free ones under
 * separate headings, and `splitGaps` does the dividing on the page and again in
 * the Markdown twin. Only the paid count reaches the `<title>`.
 */
const gapProducts = listed.filter((p) => p.verdict === "not-yet");
const paidGaps = splitGaps(listed).paid;

/**
 * What a standing page ships with, which for most of them is nothing.
 *
 * Three are exceptions, and for the same reason: their content is derived from
 * the catalogue rather than written in their own copy, so an empty payload made
 * them prerender their pending state — a heading over a "Loading…" — and
 * hydration then reproduced exactly that, which is all a crawler ever sees.
 *
 * `gaps` is 43 products, the smallest slice any page here ships.
 *
 * `features` is the feature matrix itself: 149 keys over the 3,234 projects
 * anything cites, which is the one thing on this site nobody else has. It was
 * fetching that dataset as a code-split chunk AFTER hydration, so the page
 * linked from the header of all 8,868 documents rendered twelve words and no
 * links. The rows travel beside it because the page is a join over every
 * product's alternatives and ships no products of its own.
 *
 * `stats` gets the catalogue counts only. The traffic figures beside them are
 * read from Umami per request and genuinely cannot be baked; that half still
 * arrives after hydration, under headings and an explanation that no longer
 * wait for it.
 */
const standingBoot = (page: string): Boot => {
	if (page === "gaps") return bootFor(gapProducts);
	if (page === "features") {
		return {
			...bootFor([]),
			features: featuresForProjects(ossSources) ?? undefined,
			featureRows,
		};
	}
	if (page === "stats") return { ...bootFor([]), stats: siteStats };
	return bootFor([]);
};

const ordered = byWeight(listed);
const HOME_PAGES = pageCount(ordered.length);

/**
 * The alternatives index: all 871 projects, eighteen pages per language.
 *
 * This is also the fix for a real structural problem. 545 project pages replace
 * exactly one product, are thin enough to carry `noindex, follow`, and had no
 * inbound internal link anywhere on the site — `follow` is worthless on a page
 * nothing follows to. These pages give every one of them a crawlable home.
 */
const PROJECT_PAGES = pageCount(projects.length);

for (const lang of SupportedLangs) {
	for (let n = 1; n <= HOME_PAGES; n++) {
		emit({
			route: { name: "home", lang, ...(n > 1 ? { page: n } : {}) },
			meta: homeMeta(
				lang,
				products.length,
				n,
				productRows(pageSlice(ordered, n), lang),
			),
			// The only page that renders the headline counts, so the only one that
			// carries them.
			boot: { ...bootFor(pageSlice(ordered, n)), stats: siteStats },
			kind: "home",
			lastmod: newest(pageSlice(ordered, n).map((p) => p.slug)),
		});
	}

	for (let n = 1; n <= PROJECT_PAGES; n++) {
		const rows = pageSlice(projects, n);
		emit({
			route: { name: "projects", lang, ...(n > 1 ? { page: n } : {}) },
			meta: projectsMeta(lang, projects.length, n, projectRows(rows, lang)),
			// No products at all: the rows travel pre-derived, and the only other
			// thing this page needs is the repo readings for the 48 repos it names.
			boot: {
				...bootFor([]),
				projectSlugs: rows.map((p) => [
					p.slug,
					prettySlug.get(p.slug) as string,
				]),
				health: healthForProjects(rows),
				projectRows: rows,
				projectTotal: projects.length,
			},
			kind: "projects",
			lastmod: newest(rows.flatMap((p) => p.replaces.map((r) => r.slug))),
		});
	}

	// The index of the collections. Six rows, each a real slice of the
	// catalogue — see packages/core/src/collections.ts for the one that was asked
	// for and dropped, and why.
	emit({
		route: { name: "collections", lang },
		meta: collectionsMeta(
			lang,
			COLLECTIONS.length,
			COLLECTIONS.map((def) => ({
				// The short name the index prints, not the long title phrase.
				name: dict[lang]?.[`collection.${def.slug}.title`] ?? def.slug,
				url: paths.collection(lang, def.slug),
			})),
		),
		boot: bootFor([]),
		kind: "collections",
		lastmod: newest(listed.map((p) => p.slug)),
	});

	for (const def of COLLECTIONS) {
		const members = collectionMembers(def.slug, products, projects);
		const total = memberCount(members);
		const pages = pageCount(total);
		const orderedMembers =
			def.of === "product"
				? byWeight(
						members.products.map((p) => listedBySlug.get(p.slug) as Listed),
					)
				: [];

		for (let n = 1; n <= pages; n++) {
			const rows =
				def.of === "product"
					? pageSlice(orderedMembers, n)
					: pageSlice(members.projects, n);
			// The unresolved block renders on page 1 only, so only page 1 has to
			// ship the slugs that make its names clickable.
			const named =
				def.of === "product"
					? []
					: [...(rows as Project[]), ...(n === 1 ? members.unresolved : [])];

			emit({
				route: {
					name: "collection",
					lang,
					slug: def.slug,
					...(n > 1 ? { page: n } : {}),
				},
				meta: collectionMeta(
					def.slug,
					lang,
					total,
					n,
					def.of === "product"
						? productRows(rows as Listed[], lang)
						: projectRows(rows as Project[], lang),
				),
				boot:
					def.of === "product"
						? bootFor(rows as Listed[])
						: {
								...bootFor([]),
								projectSlugs: named.map((p) => [
									p.slug,
									prettySlug.get(p.slug) as string,
								]),
								health: healthForProjects(named),
								projectRows: rows as Project[],
								projectTotal: projects.length,
								// Page 1 only: naming them under all four pages would put
								// the same block on four URLs.
								unresolvedRows: n === 1 ? members.unresolved : [],
							},
				kind: "collection",
				lastmod:
					def.of === "product"
						? newest((rows as Listed[]).map((p) => p.slug))
						: newest(
								(rows as Project[]).flatMap((p) =>
									p.replaces.map((r) => r.slug),
								),
							),
			});
		}
	}

	for (const product of listed) {
		emit({
			route: { name: "product", lang, slug: product.slug },
			meta: productMeta(product, lang, categoryBySlug.get(product.category), {
				// So every alternative on the page names ITS page here, rather than a
				// forge URL that says the project exists and nothing about this site.
				projectSlugs: prettySlug,
				healthOf: archivedReading,
			}),
			boot: {
				...bootFor([product]),
				related: relatedProducts(listed, product),
			},
			kind: "product",
			lastmod: changedAt.get(product.slug) as string,
		});
	}

	for (const project of projects) {
		const slug = prettySlug.get(project.slug) as string;
		// The project page is derived from the products that cite it, so those are
		// exactly the products it has to ship with.
		const cited = project.replaces
			.map((r) => listedBySlug.get(r.slug))
			.filter((p): p is Listed => p !== undefined);
		emit({
			route: { name: "project", lang, slug },
			meta: projectMeta(project, lang, slug, {
				category: categoryOfProject(project),
				// The one dated fact a project page holds, and it was nowhere in the
				// markup: `bun run health` reads it off the forge nightly.
				lastPush: healthFile.repos[healthKey(project.source)]?.lastPush,
				homepage: healthFile.repos[healthKey(project.source)]?.homepage,
			}),
			boot: bootFor(cited),
			kind: "project",
			lastmod: newest(project.replaces.map((r) => r.slug)),
			noindex: noindexProjects.has(project.slug),
		});
	}

	// The standing pages. Three of them were in-page anchors on the home page, so
	// they had no URL to rank, share or link to from the other 3,050 documents.
	for (const page of [
		"sponsor",
		"submit",
		"contact",
		// Half of this one is genuinely per-request — the traffic figures come from
		// Umami when somebody asks — and half of it is the catalogue, which is
		// known here. It carries the catalogue half (`stats` below) and fills the
		// traffic in after hydration, rather than rendering its headings over
		// nothing at all. "signin" and "dashboard" are session-gated, so
		// standingMeta marks them noindex — which is also what keeps them out of
		// the sitemap shards.
		"stats",
		// The feature explorer. ONE document per locale — the filter state is query
		// params rather than paths, so this route can never mint a second URL no
		// matter how many of the 149 keys a reader ticks, which is why it is safe
		// to index the bare path. It DOES carry a payload: see below.
		"features",
		// The terms the whole catalogue runs on. One document, static copy, and
		// the destination every jargon tooltip points at — including on a phone,
		// where there is no hover.
		"glossary",
		// The not-yet list. Derived, so it empties itself as the catalogue improves.
		"gaps",
		// Who runs this, how a verdict is decided, how a price is checked and what
		// sponsorship does not buy. Static copy and no payload, but the Quality
		// Rater Guidelines name the About page as the starting point for judging
		// whether a site can be trusted, so its absence was load-bearing.
		"about",
		"signin",
		"dashboard",
		// The operator's console, on the same terms: one document of labels, its
		// contents fetched from /api/site-admin after hydration, and noindex via
		// standingMeta — which is what keeps it out of the sitemap shards below.
		"admin",
	] as const) {
		emit({
			route: { name: page, lang },
			// The count belongs in the title, not just the H1. App.tsx already
			// passes it on a client-side navigation, so without this a reader saw
			// "31 paid tools..." and a crawler saw "Paid tools...".
			meta: standingMeta(
				page,
				lang,
				page === "gaps" ? { gaps: paidGaps.length } : undefined,
			),
			// Nothing, for most of them. See `standingBoot` for the three that
			// derive their content from the catalogue and so have to carry it.
			boot: standingBoot(page),
			kind: "standing",
			lastmod: STANDING_CHANGED,
		});
	}

	// The legal pages: the index plus one document each. Static copy, no payload,
	// and indexable — a legal notice nobody can find is not a published one.
	// `lastmod` is the documents' own revision date, not the build date: these
	// change when the text changes, and claiming otherwise in a sitemap is the
	// kind of small lie that gets a whole sitemap distrusted.
	for (const doc of [undefined, ...LEGAL_DOCS] as const) {
		emit({
			route: { name: "legal", lang, ...(doc ? { doc } : {}) },
			meta: legalMeta(doc, lang),
			boot: bootFor([]),
			kind: "legal",
			lastmod: LEGAL_UPDATED,
		});
	}

	// The index of every category. It ships no products of its own — every figure
	// on it comes from `categoryStats` in the payload above, which is already the
	// whole catalogue — so the page is a few kB rather than 1.4 MB.
	//
	// `lastmod` is the newest change anywhere in the catalogue, because that is
	// genuinely when a row on this page last moved: a price edit changes a median
	// and a new product changes an ordering.
	emit({
		route: { name: "categories", lang },
		meta: categoriesMeta(
			lang,
			liveCategories.length,
			products.length,
			liveCategories.map((c) => ({
				name: resolveTranslation(c.name, lang),
				url: paths.category(lang, c.slug),
			})),
		),
		boot: { ...bootFor([]), projectSlugs: escapeProjectSlugs },
		kind: "categories",
		lastmod: newest(listed.map((p) => p.slug)),
	});

	/**
	 * The index over every product, at the prefix all 592 of them sit under.
	 *
	 * `/en/alternatives/` had no route at all, so `parseRoute` returned
	 * `unknown`, nginx answered the directory with its stock 403, and Googlebot's
	 * path-trimming recorded the whole money-page prefix as blocked. It is not a
	 * second home page: the home page is a ranked, filterable 48 at a time, and
	 * this is every product at once, grouped by category. `kind: "standing"` on
	 * purpose — one document per locale, and the standing shard is where it goes.
	 */
	emit({
		route: { name: "products", lang },
		meta: productsMeta(
			lang,
			listed.length,
			liveCategories.length,
			// The 4th argument existed and was never passed, so the one hub whose
			// whole job is enumerating 592 products listed none of them.
			productRows(listed, lang),
		),
		boot: {
			...bootFor([]),
			productIndex: listed.map((p) => [p.slug, p.name, p.category]),
		},
		kind: "standing",
		lastmod: newest(listed.map((p) => p.slug)),
	});

	/**
	 * The ten theme hubs. Emitted BEFORE the categories so the sitemap lists the
	 * hub above the thin pages it collects — 50 of the 85 categories hold five
	 * products or fewer, and the hub is what makes those reachable in two clicks
	 * rather than one long list.
	 */
	for (const group of CATEGORY_GROUPS) {
		const inGroup = liveCategories.filter((c) => c.group === group);
		if (inGroup.length === 0) continue;
		const slugs = new Set(inGroup.map((c) => c.slug));
		const groupProducts = listed.filter((p) => slugs.has(p.category));
		emit({
			route: { name: "group", lang, slug: group },
			meta: groupMeta(
				group,
				groupLabel(lang, group),
				groupProducts.length,
				inGroup.length,
				lang,
				productRows(groupProducts, lang),
			),
			boot: bootFor(groupProducts),
			kind: "category",
			lastmod: newest(groupProducts.map((p) => p.slug)),
		});
	}

	for (const category of liveCategories) {
		const inCat = productsIn(category.slug);
		emit({
			route: { name: "category", lang, slug: category.slug },
			meta: categoryMeta(
				category,
				inCat.length,
				lang,
				productRows(inCat, lang),
			),
			boot: bootFor(inCat),
			kind: "category",
			lastmod: newest(inCat.map((p) => p.slug)),
			noindex: noindexCategories.has(category.slug),
		});
	}
}

/**
 * `/` is not a page: it has no locale, so the app cannot know what to render and
 * redirects. Leaving #root empty keeps it on the `createRoot` path in index.tsx,
 * which is right — a French visitor landing here must not hydrate onto English.
 */
writeFileSync(
	join(DIST, "index.html"),
	withHead(
		DEFAULT_LANG,
		head({
			lang: DEFAULT_LANG,
			// The head, but not the home page's structured data: #root is empty here,
			// so a CollectionPage over 48 products would describe rows this document
			// does not contain. The canonical still names /en/, which is where this
			// URL sends every reader.
			meta: { ...homeMeta(DEFAULT_LANG, products.length), jsonLd: [] },
			alternates: alternateUrls({ name: "home", lang: DEFAULT_LANG }),
			noindex: false,
			card: ogFor("home", "", DEFAULT_LANG),
		}),
	),
);

/**
 * The 404 document.
 *
 * Without one, `front.conf` fell back to `/index.html` for every unmatched URL
 * and answered HTTP 200 — a soft 404, and an unbounded supply of them, since
 * any misspelling produced a real-looking page. The app already renders the
 * right thing for an unknown route (the list, with a line saying the page does
 * not exist, and `noindex`); this is the same shell served under the status
 * that agrees with it.
 *
 * Empty #root on purpose, exactly as `/` is: a 404 has no locale either, so the
 * client picks one and renders rather than hydrating onto the wrong language.
 */
writeFileSync(
	join(DIST, "404.html"),
	withHead(
		DEFAULT_LANG,
		head({
			lang: DEFAULT_LANG,
			// No canonical and no structured data. This document answers under every
			// URL that does not exist, so canonicalling it to the home page told
			// Google that every misspelling WAS the home page, and the `WebSite`
			// entity it carried made a third document claim to be the site.
			meta: {
				...homeMeta(DEFAULT_LANG, products.length),
				canonical: "",
				jsonLd: [],
			},
			alternates: alternateUrls({ name: "home", lang: DEFAULT_LANG }),
			noindex: true,
			// A dead link gets shared too, usually as a screenshot.
			card: ogFor("notfound", "", DEFAULT_LANG),
		}),
	),
);

const indexed = pages.filter((p) => !p.noindex);

const urlset = (rows: Page[]) =>
	`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rows
	.map((p) =>
		[
			"<url>",
			`<loc>${SITE}${p.url}</loc>`,
			// Bing asks for ISO 8601 with a time, not a bare date. The date itself
			// stays per-URL and honest: a page that has not changed keeps its old
			// one rather than being restamped at generation time.
			`<lastmod>${p.lastmod.length === 10 ? `${p.lastmod}T00:00:00+00:00` : p.lastmod}</lastmod>`,
			...SupportedLangs.map(
				(l) =>
					`<xhtml:link rel="alternate" hreflang="${l}" href="${SITE}${p.alternates[l]}"/>`,
			),
			`<xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${p.alternates[DEFAULT_LANG]}"/>`,
			"</url>",
		].join(""),
	)
	.join("\n")}
</urlset>
`;

// Split by type and locale: a 50k-URL file tells you nothing when coverage
// drops, and four small ones say which kind of page lost it.
const shards: { name: string; lastmod: string }[] = [];
for (const kind of [
	"home",
	"standing",
	"legal",
	"categories",
	"category",
	"collections",
	"collection",
	"product",
	"projects",
	"project",
] as const) {
	for (const lang of SupportedLangs) {
		const rows = indexed.filter((p) => p.kind === kind && p.lang === lang);
		if (rows.length === 0) continue;
		const name = `sitemap-${kind}-${lang}.xml`;
		writeFileSync(join(DIST, name), urlset(rows));
		// A shard is only as new as the newest URL in it. Stamping all twenty with
		// the build date told Google every one of them had changed on every deploy,
		// which costs twenty refetches and eventually the field's credibility.
		// `lastmod` is YYYY-MM-DD, so the string sort is a date sort.
		shards.push({
			name,
			lastmod: rows
				.map((p) => p.lastmod)
				.sort()
				.at(-1) as string,
		});
	}
}

writeFileSync(
	join(DIST, "sitemap.xml"),
	`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${shards
	.map(
		(s) =>
			`<sitemap><loc>${SITE}/${s.name}</loc><lastmod>${s.lastmod.length === 10 ? `${s.lastmod}T00:00:00+00:00` : s.lastmod}</lastmod></sitemap>`,
	)
	.join("\n")}
</sitemapindex>
`,
);

// The SPA reads this so a hydrated page shows the same numbers as the static
// one, without a round-trip to the API on every load.
writeFileSync(
	join(DIST, "counts.json"),
	`${JSON.stringify({
		builtAt: new Date().toISOString(),
		total: counts.total,
		products: Object.fromEntries(counts.products),
		projects: Object.fromEntries(counts.projects),
	})}\n`,
);

/**
 * /en/admin/, /en/dashboard/ and /en/signin/ stay crawlable on purpose: they
 * carry `noindex`, and a Disallow would stop Google reading the very tag that
 * keeps them out.
 *
 * The named groups below grant exactly the same access as the wildcard one.
 * Under RFC 9309 a named `Allow: /` and a wildcard `Allow: /` are identical, so
 * naming a crawler is not a ranking signal and not a citation signal. Two
 * operational reasons to name them anyway: Applebot falls back to Googlebot's
 * rules when Googlebot is named and Applebot is not, which makes a half-named
 * file more dangerous than a wildcard-only one; and throttling one misbehaving
 * crawler later becomes one line here instead of a restructure.
 *
 * Every token was checked against its operator's own documentation. Tokens that
 * only survive in copied robots.txt files are deliberately absent:
 * `anthropic-ai` and `claude-web` (Anthropic documents three bots and neither is
 * one), `cohere-ai` (Cohere's own bot table reads N/A), and Bytespider, any xAI
 * token, Timpibot and YouBot (no first-party docs exist at all).
 */
const crawlerRules = `Allow: /
Disallow: /api/v1/dump.json
Disallow: /api/products
Disallow: /u/`;

writeFileSync(
	join(DIST, "robots.txt"),
	`# The two bulk payloads are 7 MB and 5 MB of JSON with nothing indexable in
# them, and /u/ is the Umami proxy. The REST of /api/v1/ is deliberately open:
# llms.txt and skill.md both tell agents to start with the API, and a blanket
# Disallow: /api/ meant this site forbade the surface its own agent documentation
# points at. Coding agents are the class that actually reads llms.txt AND honours
# robots.txt, so they were the ones the blanket rule locked out.
# Everything else, including the noindexed pages, is open.
User-agent: *
${crawlerRules}

# Search-index crawlers. They crawl, index, and cite with a link back, which is
# the group whose access is worth the most here.
# Google-Extended does not gate AI Overviews or AI Mode — those ride on
# Googlebot, and there is no way out of them short of noindex.
User-agent: Googlebot
User-agent: bingbot
User-agent: Applebot
User-agent: OAI-SearchBot
User-agent: PerplexityBot
User-agent: Claude-SearchBot
${crawlerRules}

# Live fetchers. No crawl and no index: one page, because a person just asked
# about it. Three of the four operators state that robots.txt may not apply to
# them at all; only Anthropic's Claude-User carries no such carve-out.
User-agent: ChatGPT-User
User-agent: Claude-User
User-agent: Perplexity-User
User-agent: meta-externalfetcher
${crawlerRules}

# Training crawlers, and the two opt-out tokens that are not crawlers at all.
# This is the ambiguous group: they produce no citation and no link, and a model
# that memorises a price with a check date and repeats it uncited two years later
# has taken the value and dropped the attribution, which is the one thing SKILL.md
# asks agents not to do. Allowed anyway, because being recognised by a model is
# how a catalogue this new gets known. A bet, not a lever.
User-agent: GPTBot
User-agent: ClaudeBot
User-agent: Google-Extended
User-agent: Applebot-Extended
User-agent: meta-externalagent
User-agent: Amazonbot
User-agent: CCBot
${crawlerRules}

Sitemap: ${SITE}/sitemap.xml
`,
);

const byKind = (k: Page["kind"]) => pages.filter((p) => p.kind === k).length;
console.log(
	`prerendered ${pages.length} pages across ${SupportedLangs.length} locales ` +
		`(${byKind("product")} product, ${byKind("project")} project, ` +
		`${byKind("projects")} project index, ${byKind("category")} category, ` +
		`${byKind("categories")} category index, ${byKind("collections")} collection index, ` +
		`${byKind("collection")} collection, ` +
		`${byKind("standing")} standing, ${byKind("legal")} legal, ${byKind("home")} home)`,
);
console.log(
	`noindex: ${noindexProjects.size}/${projects.length} projects, ` +
		`${noindexCategories.size}/${liveCategories.length} categories ` +
		`(${pages.length - indexed.length} pages, ${indexed.length} in the sitemap)`,
);
console.log(
	`sitemap: ${shards.length} shards · ${counts.total} switches baked in`,
);
