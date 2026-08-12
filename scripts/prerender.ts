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
	statSync,
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
	priceFreshness,
	projectSlug,
} from "core/src/content";
import type { FeatureFile } from "core/src/features";
import {
	DEFAULT_LANG,
	type Lang,
	resolveTranslation,
	SupportedLangs,
} from "core/src/index";
import type { Route } from "core/src/routes";
import { alternateUrls, buildProjectSlugs, LEGAL_DOCS } from "core/src/routes";

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
	projectMeta,
	projectsMeta,
	standingMeta,
	legalMeta,
	OG_IMAGE,
	OG_LOCALE,
} = await import(join(FE, "src/seo.ts"));

type Meta = {
	title: string;
	description: string;
	canonical: string;
	jsonLd?: string[];
};

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
 */
const iso = (d: Date) => d.toISOString().slice(0, 10);
const changedAt = new Map<string, string>(
	files.map((f, i) => [
		products[i].slug,
		products[i].pricing?.checkedOn ??
			iso(statSync(join(DATA, "products", f)).mtime),
	]),
);
const newest = (slugs: string[]) =>
	slugs
		.map((s) => changedAt.get(s) ?? "")
		.sort()
		.at(-1) || iso(new Date());

/**
 * Live counts, baked into the HTML.
 *
 * Pages are regenerated on every vote, so the number a crawler sees and the
 * number a reader sees on first paint are the same one. The DB is optional: a
 * fresh clone or a CI run with no database still builds, just with zeroes.
 *
 * Read directly rather than through the API so a build never needs the server
 * running. Must stay in step with `counted()` in apps/backend/src/index.ts.
 */
const TRUST_THRESHOLD = 0.5;
const DB_PATH = process.env.DATABASE_URL ?? join(ROOT, "data/canireplaceit.db");

function loadCounts(): {
	products: Map<string, number>;
	projects: Map<string, number>;
	total: number;
} {
	const empty = { products: new Map(), projects: new Map(), total: 0 };
	// No file yet is the normal case on a fresh clone and in CI, not an error.
	if (!existsSync(DB_PATH)) return empty;

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
		console.warn(`  ! no counts baked in: ${(e as Error).message}`);
		return empty;
	}
}

const counts = loadCounts();

/** What the API returns, so the prerendered tree and the hydrated one agree. */
type Listed = Product & { switchedCount: number };
const listed: Listed[] = products.map((p) => ({
	...p,
	switchedCount: counts.products.get(p.slug) ?? 0,
}));
const listedBySlug = new Map(listed.map((p) => [p.slug, p]));

/**
 * A page with one link and one sentence on it is what Google's scaled-content
 * policy is aimed at, and that policy is enforced algorithmically — no notice,
 * no appeal. So the thinnest pages ship `noindex, follow` and stay out of the
 * sitemap. `follow`, not `nofollow`: they must keep passing authority to the
 * products they link to, which is the whole reason they exist.
 *
 * Judged once, on the English text, and applied to every locale — a page that is
 * indexable in one language and not the other makes the hreflang set incoherent.
 */
const WORDS = /[\p{L}\p{N}]+/gu;

const thinProject = (project: Project): boolean =>
	project.replaces.length < 2 &&
	new Set(
		project.replaces
			.map((r) => resolveTranslation(r.note, DEFAULT_LANG).toLowerCase())
			.join(" ")
			.match(WORDS) ?? [],
	).size < 40;

const noindexProjects = new Set(
	projects.filter(thinProject).map((p) => p.slug),
);

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
	return { ...featureFile, projects, products, productTiers };
};

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

const bootFor = (subset: Listed[]): Boot => ({
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

function head(o: {
	lang: Lang;
	meta: Meta;
	alternates: Record<Lang, string>;
	noindex: boolean;
}): string {
	const { lang, meta, alternates } = o;
	return [
		`<title>${esc(meta.title)}</title>`,
		`<meta name="description" content="${esc(meta.description)}">`,
		`<link rel="canonical" href="${meta.canonical}">`,
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
		// The favicon link is already in the shell: rsbuild picks up
		// apps/frontend/public/favicon.svg on its own.
		`<meta property="og:type" content="website">`,
		`<meta property="og:site_name" content="canireplaceit">`,
		`<meta property="og:title" content="${esc(meta.title)}">`,
		`<meta property="og:description" content="${esc(meta.description)}">`,
		`<meta property="og:url" content="${meta.canonical}">`,
		`<meta property="og:image" content="${OG_IMAGE}">`,
		`<meta property="og:locale" content="${OG_LOCALE[lang]}">`,
		...SupportedLangs.filter((l) => l !== lang).map(
			(l) => `<meta property="og:locale:alternate" content="${OG_LOCALE[l]}">`,
		),
		`<meta name="twitter:card" content="summary_large_image">`,
		`<meta name="twitter:title" content="${esc(meta.title)}">`,
		`<meta name="twitter:description" content="${esc(meta.description)}">`,
		`<meta name="twitter:image" content="${OG_IMAGE}">`,
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

	at(url);
	(globalThis as { __DATA__?: Boot }).__DATA__ = o.boot;
	const body = renderToString(React.createElement(App));

	const html = withHead(lang, head({ lang, meta: o.meta, alternates, noindex }))
		// Parser-blocking, so it is set before the deferred bundle runs.
		.replace("<body>", `<body><script>window.__DATA__=${json(o.boot)}</script>`)
		.replace('<div id="root"></div>', `<div id="root">${body}</div>`);

	write(fileFor(url), html);
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
			meta: homeMeta(lang, products.length, n),
			boot: bootFor(pageSlice(ordered, n)),
			kind: "home",
			lastmod: newest(pageSlice(ordered, n).map((p) => p.slug)),
		});
	}

	for (let n = 1; n <= PROJECT_PAGES; n++) {
		const rows = pageSlice(projects, n);
		emit({
			route: { name: "projects", lang, ...(n > 1 ? { page: n } : {}) },
			meta: projectsMeta(lang, projects.length, n),
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
		meta: collectionsMeta(lang, COLLECTIONS.length),
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
				meta: collectionMeta(def.slug, lang, total, n),
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
			meta: productMeta(
				product,
				lang,
				categories.find((c) => c.slug === product.category),
			),
			boot: bootFor([product]),
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
			meta: projectMeta(project, lang, slug),
			boot: bootFor(cited),
			kind: "project",
			lastmod: newest(project.replaces.map((r) => r.slug)),
			noindex: noindexProjects.has(project.slug),
		});
	}

	// The standing pages. Three of them were in-page anchors on the home page, so
	// they had no URL to rank, share or link to from the other 3,050 documents.
	// They ship the whole catalogue in their payload because the estimate and the
	// quote both let a reader tick any product on the site.
	// "estimate" is deliberately absent: the route still resolves so old links do
	// not 404, but nothing on the site points at it, and shipping a document for a
	// page with no inbound links is 2 URLs of index bloat per locale.
	for (const page of [
		"sponsor",
		"submit",
		"contact",
		// Both render their own copy and fetch anything dynamic after hydration:
		// the traffic figures come from Umami at request time, and the sign-in form
		// has nothing to prerender but its own labels. So they cost one document
		// each and carry no payload. "signin" and "dashboard" are session-gated, so
		// standingMeta marks them noindex — which is also what keeps them out of
		// the sitemap shards.
		"stats",
		// The feature explorer. ONE document per locale and no payload: the
		// dataset is code-split and fetched on demand, and the filter state is
		// query params rather than paths, so this route can never mint a second
		// URL no matter how many of the 130 keys a reader ticks. That is why it is
		// safe to index the bare path — see the comment in FeaturesPage.tsx.
		"features",
		"signin",
		"dashboard",
		// The operator's console, on the same terms: one document of labels, its
		// contents fetched from /api/site-admin after hydration, and noindex via
		// standingMeta — which is what keeps it out of the sitemap shards below.
		"admin",
	] as const) {
		emit({
			route: { name: page, lang },
			meta: standingMeta(page, lang, products.length),
			// Only the estimate needs the catalogue — its step 1 lets a reader tick
			// any product on the site. The rate card and the contribution page
			// render from inventory and static copy.
			boot: bootFor(page === "estimate" ? listed : []),
			kind: "standing",
			lastmod: iso(new Date()),
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
		meta: categoriesMeta(lang, liveCategories.length, products.length),
		boot: { ...bootFor([]), projectSlugs: escapeProjectSlugs },
		kind: "categories",
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
			meta: categoryMeta(category, inCat.length, lang),
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
			meta: homeMeta(DEFAULT_LANG, products.length),
			alternates: alternateUrls({ name: "home", lang: DEFAULT_LANG }),
			noindex: false,
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
			`<lastmod>${p.lastmod}</lastmod>`,
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
const shards: string[] = [];
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
		shards.push(name);
	}
}

writeFileSync(
	join(DIST, "sitemap.xml"),
	`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${shards
	.map(
		(n) =>
			`<sitemap><loc>${SITE}/${n}</loc><lastmod>${iso(new Date())}</lastmod></sitemap>`,
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

// `?plan=` on the estimate page is unbounded crawl space with nothing
// indexable at the end of it — every shared plan is a distinct URL for one
// document. The page's canonical already points at the bare `/en/estimate`,
// so this only saves the crawl budget it would otherwise spend proving that.
writeFileSync(
	join(DIST, "robots.txt"),
	`User-agent: *
Allow: /
Disallow: /*?plan=

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
