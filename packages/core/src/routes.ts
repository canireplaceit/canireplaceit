// The locale prefix AND the path segments are both translated: `/fr/outils/appflowy`, not `/fr/tools/appflowy`.
// `paths` builds URLs, `parseRoute` reads them back; tests assert the two are exact inverses.

import type { Project } from "./content";
import { DEFAULT_LANG, isLang, type Lang, SupportedLangs } from "./index";

// French segments stay unaccented (e.g. `categories` not `catégories`) so links never need percent-encoding.
export const SEGMENTS: Record<
	Lang,
	{
		alternatives: string;
		tools: string;
		categories: string;
		/** The ten themes categories are filed under; see the `group` route. */
		groups: string;
		collections: string;
		sponsor: string;
		estimate: string;
		submit: string;
		contact: string;
		stats: string;
		features: string;
		/** The terms this catalogue runs on, defined in one place. */
		glossary: string;
		signin: string;
		dashboard: string;
		admin: string;
		legal: string;
		page: string;
	}
> = {
	en: {
		alternatives: "alternatives",
		tools: "tools",
		categories: "categories",
		groups: "themes",
		collections: "collections",
		sponsor: "sponsor",
		estimate: "estimate",
		submit: "submit",
		contact: "contact",
		stats: "stats",
		features: "features",
		glossary: "glossary",
		signin: "signin",
		dashboard: "dashboard",
		admin: "admin",
		legal: "legal",
		page: "page",
	},
	fr: {
		alternatives: "alternatives",
		tools: "outils",
		categories: "categories",
		// Unaccented like every other FR segment, so the URL never percent-encodes.
		groups: "themes",
		collections: "collections",
		sponsor: "sponsoriser",
		estimate: "estimation",
		submit: "proposer",
		contact: "contact",
		stats: "statistiques",
		// One word, unaccented like every other FR segment, so the URL never percent-encodes.
		features: "fonctionnalites",
		glossary: "glossaire",
		signin: "connexion",
		dashboard: "tableau-de-bord",
		// Not the bare "admin" — that would read as untranslated English in a French address bar.
		admin: "administration",
		// One French word for the whole section, so `/fr/legal/cgu` reads as an
		// address rather than as an untranslated path.
		legal: "legal",
		page: "page",
	},
};

/**
 * The legal pages. One segment with a document under it, not seven top-level
 * segments: they share a parent in the breadcrumb, they are found together or
 * not at all, and an eighth one later costs a line here instead of a route.
 *
 * The slug is translated like every other segment — a French reader gets
 * `/fr/legal/cgu`, not `/fr/legal/terms` — and `parseRoute` accepts either
 * language's spelling so an EN link pasted into an FR context still resolves.
 */
export const LEGAL_DOCS = [
	"terms",
	"privacy",
	"cookies",
	"notice",
	"sponsorship",
	"disclosure",
	"licences",
] as const;

export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_SLUGS: Record<Lang, Record<LegalDoc, string>> = {
	en: {
		terms: "terms",
		privacy: "privacy",
		cookies: "cookies",
		notice: "legal-notice",
		sponsorship: "sponsorship-terms",
		disclosure: "disclosure",
		licences: "licences",
	},
	fr: {
		terms: "cgu",
		privacy: "confidentialite",
		cookies: "cookies",
		notice: "mentions-legales",
		sponsorship: "cgv",
		disclosure: "transparence",
		licences: "licences",
	},
};

/** Every spelling of every legal slug, in every locale, back to its document. */
const LEGAL_KINDS: ReadonlyMap<string, LegalDoc> = new Map(
	SupportedLangs.flatMap((lang) =>
		(Object.entries(LEGAL_SLUGS[lang]) as [LegalDoc, string][]).map(
			([doc, slug]) => [slug, doc] as const,
		),
	),
);

export type SegmentKey = keyof (typeof SEGMENTS)[Lang];

// Pagination is a PATH, not a query parameter: `/en/page/3`, never `/en/?page=3`. Page 1 is always the bare URL.
export type Paged = { page?: number };

export type Route =
	| ({ name: "home"; lang: Lang } & Paged)
	| { name: "product"; lang: Lang; slug: string }
	| { name: "project"; lang: Lang; slug: string }
	| ({ name: "projects"; lang: Lang } & Paged)
	| { name: "category"; lang: Lang; slug: string }
	// The ten themes categories are already filed under, given a URL. 50 of the
	// 85 categories hold five products or fewer and six hold exactly one, so the
	// group is the browsable level the taxonomy always had and never exposed.
	| { name: "group"; lang: Lang; slug: string }
	| { name: "categories"; lang: Lang }
	| { name: "collections"; lang: Lang }
	| ({ name: "collection"; lang: Lang; slug: string } & Paged)
	// `slot` is a query param, not a path segment, so the 199 slots don't each mint a near-duplicate indexable URL.
	| { name: "sponsor"; lang: Lang; slot?: string }
	// `estimate` is one page in two steps: step 1 sizes the reader's spend, step 2 carries it into a lead form.
	| { name: "estimate"; lang: Lang }
	| { name: "submit"; lang: Lang }
	| { name: "contact"; lang: Lang }
	| { name: "stats"; lang: Lang }
	// One route, never one per filter combination: 137 feature keys would mint a
	// combinatorial space of near-duplicate URLs. Filter state is query params,
	// the parameterised states are noindex, and the canonical is the bare path.
	| { name: "features"; lang: Lang }
	// The fifteen terms this catalogue runs on, defined once. Every tooltip in
	// the UI is the short form of an entry here.
	| { name: "glossary"; lang: Lang }
	| { name: "signin"; lang: Lang }
	| { name: "dashboard"; lang: Lang }
	// Public route, gated data: everything on it is fetched after hydration and refused server-side unless the session email is in SITE_ADMIN.
	| { name: "admin"; lang: Lang }
	// `doc` absent is the index of the legal pages, not a missing document.
	| { name: "legal"; lang: Lang; doc?: LegalDoc }
	| { name: "unknown"; lang: Lang };

/** `/page/3` appended to a base, or nothing at all for page 1. */
const pagePath = (lang: Lang, base: string, page?: number): string =>
	page !== undefined && page > 1
		? `${base.endsWith("/") ? base : `${base}/`}${SEGMENTS[lang].page}/${page}`
		: base;

export const paths = {
	home: (lang: Lang, page?: number): string =>
		pagePath(lang, `/${lang}/`, page),
	product: (lang: Lang, slug: string): string =>
		`/${lang}/${SEGMENTS[lang].alternatives}/${slug}`,
	project: (lang: Lang, slug: string): string =>
		`/${lang}/${SEGMENTS[lang].tools}/${slug}`,
	projects: (lang: Lang, page?: number): string =>
		pagePath(lang, `/${lang}/${SEGMENTS[lang].tools}/`, page),
	category: (lang: Lang, slug: string): string =>
		`/${lang}/${SEGMENTS[lang].categories}/${slug}`,
	categories: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].categories}/`,
	group: (lang: Lang, slug: string): string =>
		`/${lang}/${SEGMENTS[lang].groups}/${slug}`,
	groups: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].groups}/`,
	collections: (lang: Lang): string =>
		`/${lang}/${SEGMENTS[lang].collections}/`,
	collection: (lang: Lang, slug: string, page?: number): string =>
		pagePath(lang, `/${lang}/${SEGMENTS[lang].collections}/${slug}`, page),
	sponsor: (lang: Lang, slot?: string): string => {
		const base = `/${lang}/${SEGMENTS[lang].sponsor}`;
		return slot ? `${base}?slot=${encodeURIComponent(slot)}` : base;
	},
	estimate: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].estimate}`,
	submit: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].submit}`,
	contact: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].contact}`,
	stats: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].stats}`,
	features: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].features}`,
	glossary: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].glossary}`,
	signin: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].signin}`,
	dashboard: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].dashboard}`,
	admin: (lang: Lang): string => `/${lang}/${SEGMENTS[lang].admin}`,
	legal: (lang: Lang, doc?: LegalDoc): string => {
		const base = `/${lang}/${SEGMENTS[lang].legal}`;
		return doc ? `${base}/${LEGAL_SLUGS[lang][doc]}` : `${base}/`;
	},
};

// Segment word → route kind, across all locales, so `/fr/tools/x` resolves even though the canonical form is `/fr/outils/x`.
const SEGMENT_KINDS: ReadonlyMap<string, SegmentKey> = new Map(
	SupportedLangs.flatMap((lang) =>
		(Object.entries(SEGMENTS[lang]) as [SegmentKey, string][]).map(
			([key, word]) => [word, key] as const,
		),
	),
);

// `"3"` -> 3; everything else, including `"1"`, `"03"` and `"3abc"`, -> null. `"1"` is rejected because page 1 is the bare URL.
const pageNumber = (raw: string | undefined): number | null => {
	if (raw === undefined || !/^[1-9][0-9]*$/.test(raw)) return null;
	const n = Number(raw);
	if (!Number.isSafeInteger(n) || n < 2) return null;
	return n;
};

export function parseRoute(url: URL): Route {
	const parts = url.pathname.split("/").filter(Boolean);
	const [prefix, segment, slug] = parts;

	if (!isLang(prefix)) return { name: "unknown", lang: DEFAULT_LANG };
	const lang = prefix;

	if (segment === undefined) return { name: "home", lang };

	const kind = SEGMENT_KINDS.get(segment);
	if (kind === undefined) return { name: "unknown", lang };

	// `/en/page/4` — the home list, the one paginated route whose base is the locale root.
	if (kind === "page") {
		const page = pageNumber(slug);
		return page !== null && parts.length === 3
			? { name: "home", lang, page }
			: { name: "unknown", lang };
	}

	if (kind === "collections") {
		if (slug === undefined) return { name: "collections", lang };
		if (parts.length === 3) return { name: "collection", lang, slug };
		if (parts.length === 5 && SEGMENT_KINDS.get(parts[3]) === "page") {
			const page = pageNumber(parts[4]);
			if (page !== null) return { name: "collection", lang, slug, page };
		}
		return { name: "unknown", lang };
	}

	// `/en/tools/` is the project index; `page` is a reserved slug (see RESERVED_SLUGS) so a project can never collide with `/en/tools/page/3`.
	if (
		kind === "tools" &&
		(slug === undefined || SEGMENT_KINDS.get(slug) === "page")
	) {
		if (slug === undefined) {
			return parts.length === 2
				? { name: "projects", lang }
				: { name: "unknown", lang };
		}
		const page = pageNumber(parts[3]);
		return page !== null && parts.length === 4
			? { name: "projects", lang, page }
			: { name: "unknown", lang };
	}

	if (kind === "legal") {
		if (slug === undefined) {
			return parts.length === 2
				? { name: "legal", lang }
				: { name: "unknown", lang };
		}
		const doc = LEGAL_KINDS.get(slug);
		return doc !== undefined && parts.length === 3
			? { name: "legal", lang, doc }
			: { name: "unknown", lang };
	}

	if (kind === "sponsor") {
		const slot = url.searchParams.get("slot");
		return { name: "sponsor", lang, ...(slot ? { slot } : {}) };
	}

	if (
		kind === "estimate" ||
		kind === "submit" ||
		kind === "contact" ||
		kind === "stats" ||
		kind === "features" ||
		kind === "glossary" ||
		kind === "signin" ||
		kind === "dashboard" ||
		kind === "admin"
	) {
		return parts.length > 2 ? { name: "unknown", lang } : { name: kind, lang };
	}

	if (kind === "categories" && slug === undefined) {
		return { name: "categories", lang };
	}

	if (kind === "groups") {
		return slug === undefined
			? { name: "categories", lang }
			: parts.length === 3
				? { name: "group", lang, slug }
				: { name: "unknown", lang };
	}

	if (!slug || parts.length > 3) return { name: "unknown", lang };

	if (kind === "alternatives") return { name: "product", lang, slug };
	if (kind === "tools") return { name: "project", lang, slug };
	return { name: "category", lang, slug };
}

/** The same page in every language, for `<link rel="alternate" hreflang>`. An unknown route falls back to each home page. */
export function alternateUrls(route: Route): Record<Lang, string> {
	const out = {} as Record<Lang, string>;
	for (const lang of SupportedLangs) {
		switch (route.name) {
			case "product":
				out[lang] = paths.product(lang, route.slug);
				break;
			case "project":
				out[lang] = paths.project(lang, route.slug);
				break;
			case "projects":
				out[lang] = paths.projects(lang, route.page);
				break;
			case "collections":
				out[lang] = paths.collections(lang);
				break;
			case "collection":
				out[lang] = paths.collection(lang, route.slug, route.page);
				break;
			case "category":
				out[lang] = paths.category(lang, route.slug);
				break;
			case "categories":
				out[lang] = paths.categories(lang);
				break;
			case "glossary":
				out[lang] = paths.glossary(lang);
				break;
			case "group":
				out[lang] = paths.group(lang, route.slug);
				break;
			case "legal":
				out[lang] = paths.legal(lang, route.doc);
				break;
			case "home":
				out[lang] = paths.home(lang, route.page);
				break;
			case "sponsor":
				out[lang] = paths.sponsor(lang);
				break;
			case "estimate":
				out[lang] = paths.estimate(lang);
				break;
			case "submit":
				out[lang] = paths.submit(lang);
				break;
			case "contact":
				out[lang] = paths.contact(lang);
				break;
			case "features":
				out[lang] = paths.features(lang);
				break;
			case "stats":
				out[lang] = paths.stats(lang);
				break;
			case "signin":
				out[lang] = paths.signin(lang);
				break;
			case "dashboard":
				out[lang] = paths.dashboard(lang);
				break;
			case "admin":
				out[lang] = paths.admin(lang);
				break;
			default:
				out[lang] = paths.home(lang);
		}
	}
	return out;
}

/** Lowercase, unaccented, hyphenated. Shared by projects and the collision set. */
export const kebab = (value: string): string =>
	value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** The forge owner, used as the disambiguator: `block/goose` → `block`. */
const ownerOf = (project: Project): string =>
	kebab(project.source.path.split("/")[0] ?? project.source.host);

// Words a project slug may never be, so a URL segment can't collide with one — e.g. a project called "Page" silently owning `/en/tools/page/2`.
const RESERVED_SLUGS: ReadonlySet<string> = new Set(
	SupportedLangs.flatMap((lang) => Object.values(SEGMENTS[lang])),
);

/** Maps each project's forge-path id to a short, readable URL slug, appending the owner to disambiguate colliding names. */
export function buildProjectSlugs(
	projects: Project[],
	productSlugs: Iterable<string> = [],
): Map<string, string> {
	const taken = new Set([...productSlugs, ...RESERVED_SLUGS]);

	// Sort by the already-unique forge-path id so output depends only on the set of projects, never arrival order.
	const sorted = [...projects].sort((a, b) => (a.slug < b.slug ? -1 : 1));

	const bases = new Map<string, string>();
	const baseCounts = new Map<string, number>();
	for (const project of sorted) {
		const base = kebab(project.name) || project.slug;
		bases.set(project.slug, base);
		baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
	}

	const out = new Map<string, string>();
	for (const project of sorted) {
		const base = bases.get(project.slug) as string;
		let slug =
			baseCounts.get(base) === 1 && !taken.has(base)
				? base
				: `${base}-${ownerOf(project)}`;

		// Same name and owner across different forges (a mirror, or a hard fork). Rare, but must not collapse two pages into one.
		if (taken.has(slug)) {
			let n = 2;
			while (taken.has(`${slug}-${n}`)) n++;
			slug = `${slug}-${n}`;
		}

		taken.add(slug);
		out.set(project.slug, slug);
	}
	return out;
}
