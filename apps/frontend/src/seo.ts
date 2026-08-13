/**
 * Per-page metadata. Written into the prerendered HTML at build time and kept in
 * sync on client-side navigation, so a crawler and a human see the same thing.
 */

import type { Category, Product, Project } from "core/src/content";
import { CATEGORY_GROUPS } from "core/src/content";
import type { Lang } from "core/src/index";
import {
	DEFAULT_LANG,
	resolveTranslation,
	SupportedLangs,
} from "core/src/index";
import { type LegalDoc, paths } from "core/src/routes";
import { dict } from "./i18n";
import { legalCopy } from "./legal";

export const SITE = "https://canireplaceit.com";

/** One static card for every share — see scripts/prerender.ts. */
export const OG_IMAGE = `${SITE}/og.png`;

export const OG_LOCALE: Record<Lang, string> = { en: "en_US", fr: "fr_FR" };

export type Meta = {
	title: string;
	description: string;
	canonical: string;
	/** JSON-LD, already stringified. One <script> each. */
	jsonLd?: string[];
	/**
	 * Set only by routes that are private by nature — a session-gated page cannot
	 * render anything for a crawler, so it carries `noindex, follow` on every
	 * document that describes it. Thin *content* pages are a separate, build-time
	 * decision made in scripts/prerender.ts.
	 */
	noindex?: boolean;
};

const clamp = (s: string, n = 155) =>
	s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;

/**
 * Google truncates a title around 60 characters, and the tail is the first thing
 * a long product name eats. Everything before the year is load-bearing, so the
 * year is what gets dropped when the line does not fit.
 */
const TITLE_MAX = 60;

/** Build year. Baked once so every page in a build agrees. */
export const YEAR = new Date().getFullYear();

/** A real rich result, and the only structured data Google still renders here. */
export function breadcrumbJsonLd(
	trail: { name: string; url: string }[],
): string {
	return JSON.stringify({
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: trail.map((item, i) => ({
			"@type": "ListItem",
			position: i + 1,
			name: item.name,
			item: `${SITE}${item.url}`,
		})),
	});
}

/** The label the home page carries in a breadcrumb trail. */
export const HOME_LABEL: Record<Lang, string> = {
	en: "All products",
	fr: "Tous les produits",
};

/** The same, for the category index. Kept in step with `page.categories` in i18n.ts. */
/**
 * Theme names for structured data, which is built outside the React tree and so
 * has no `t`. Read from the same `dict` the UI uses — a second hand-written copy
 * drifted within minutes when the prerenderer tried it.
 */
export const GROUP_LABEL: Record<Lang, Record<string, string>> = {
	en: Object.fromEntries(
		CATEGORY_GROUPS.map((g) => [g, dict.en[`catGroup.${g}`] ?? g]),
	),
	fr: Object.fromEntries(
		CATEGORY_GROUPS.map((g) => [
			g,
			dict.fr[`catGroup.${g}`] ?? dict.en[`catGroup.${g}`] ?? g,
		]),
	),
};

export const CATEGORIES_LABEL: Record<Lang, string> = {
	en: "All categories",
	fr: "Toutes les catégories",
};

export function productMeta(
	product: Product,
	lang: Lang,
	category?: Category,
): Meta {
	const oss = product.alternatives.filter((a) => a.kind === "oss");
	const names = oss
		.slice(0, 3)
		.map((a) => a.name)
		.join(", ");

	// The query people actually type is "<n> best open source <thing>
	// alternatives <year>" — a count, the product, and a freshness signal. The
	// verdict phrase that used to sit here is nobody's search term and it was the
	// half that got truncated away.
	const dated =
		lang === "fr"
			? `${oss.length} alternatives open source à ${product.name} (${YEAR})`
			: `${oss.length} open source ${product.name} alternatives (${YEAR})`;
	const title =
		dated.length <= TITLE_MAX ? dated : dated.replace(` (${YEAR})`, "");

	const description = clamp(
		`${names ? `${names}. ` : ""}${resolveTranslation(product.why, lang)}`,
	);

	const trail = [{ name: HOME_LABEL[lang], url: paths.home(lang) }];
	if (category) {
		// Same three rungs the visible breadcrumb walks, or the structured data
		// and the page disagree about where this product sits.
		trail.push({
			name: GROUP_LABEL[lang][category.group],
			url: paths.group(lang, category.group),
		});
		trail.push({
			name: resolveTranslation(category.name, lang),
			url: paths.category(lang, category.slug),
		});
	}
	trail.push({ name: product.name, url: paths.product(lang, product.slug) });

	return {
		title,
		description,
		canonical: `${SITE}${paths.product(lang, product.slug)}`,
		jsonLd: [
			// Inert for Google, but it is the cleanest machine-readable statement of
			// "these N projects replace this product" for anything else parsing us.
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "ItemList",
				name: title,
				description,
				numberOfItems: oss.length,
				itemListElement: oss.map((a, i) => ({
					"@type": "ListItem",
					position: i + 1,
					item: {
						"@type": "SoftwareApplication",
						name: a.name,
						applicationCategory: product.category,
						url: a.kind === "oss" ? a.source.url : undefined,
						license: a.kind === "oss" ? a.license : undefined,
					},
				})),
			}),
			breadcrumbJsonLd(trail),
		],
	};
}

/** `slug` is the pretty URL slug, not the forge id the Project carries. */
export function projectMeta(project: Project, lang: Lang, slug: string): Meta {
	const replaces = project.replaces.map((r) => r.name);
	const title =
		lang === "fr"
			? `${project.name} — remplace ${replaces.slice(0, 3).join(", ")}`
			: `${project.name} — replaces ${replaces.slice(0, 3).join(", ")}`;

	const description = clamp(
		lang === "fr"
			? `${project.name} (${project.license}) remplace ${replaces.length} produit(s) payant(s) : ${replaces.join(", ")}.`
			: `${project.name} (${project.license}) replaces ${replaces.length} paid product${replaces.length > 1 ? "s" : ""}: ${replaces.join(", ")}.`,
	);

	return {
		title,
		description,
		canonical: `${SITE}${paths.project(lang, slug)}`,
		jsonLd: [
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "SoftwareApplication",
				name: project.name,
				description,
				url: project.source.url,
				license: project.license,
				applicationCategory: "BusinessApplication",
				// No `offers`. SoftwareApplication only validates an offer alongside a
				// rating, we have no rating, and inventing one is how sites earn a
				// manual action. A free licence is already stated by `license`.
			}),
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: project.name, url: paths.project(lang, slug) },
			]),
		],
	};
}

export function categoryMeta(
	category: Category,
	count: number,
	lang: Lang,
): Meta {
	const name = resolveTranslation(category.name, lang);
	const dated =
		lang === "fr"
			? `${count} alternatives open source ${name} (${YEAR})`
			: `${count} open source ${name} alternatives (${YEAR})`;
	return {
		title: dated.length <= TITLE_MAX ? dated : dated.replace(` (${YEAR})`, ""),
		description: clamp(
			lang === "fr"
				? `${count} produits ${name} passés en revue, avec leurs alternatives open source et ce que migrer coûte vraiment.`
				: `${count} ${name} products reviewed, with their open source alternatives and what switching actually costs.`,
		),
		canonical: `${SITE}${paths.category(lang, category.slug)}`,
		jsonLd: [
			// Three levels now, matching the trail the page actually renders: the
			// index sits between the home page and a category, so the markup and the
			// visible breadcrumb say the same thing.
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: CATEGORIES_LABEL[lang], url: paths.categories(lang) },
				{ name, url: paths.category(lang, category.slug) },
			]),
		],
	};
}

/**
 * The category index.
 *
 * No `aggregateRating` and no `FAQPage`: the votes here are boolean "I switched"
 * events with no scale behind them, and Google stopped rendering FAQ results in
 * May 2026. `CollectionPage` is the honest description of what this is — a list
 * of pages — and `BreadcrumbList` is the part that still earns a rich result.
 */
export function categoriesMeta(
	lang: Lang,
	categories: number,
	products: number,
): Meta {
	const title =
		lang === "fr"
			? `Les ${categories} catégories — alternatives open source (${YEAR})`
			: `All ${categories} categories — open source alternatives (${YEAR})`;
	return {
		title: title.length <= TITLE_MAX ? title : title.replace(` (${YEAR})`, ""),
		description: clamp(
			lang === "fr"
				? `${products} produits payants répartis en ${categories} catégories, regroupées par thème, avec pour chacune l'échelle de sortie et le prix médian.`
				: `${products} paid products across ${categories} categories, grouped by theme, each with its exit ladder and median price.`,
		),
		canonical: `${SITE}${paths.categories(lang)}`,
		jsonLd: [
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "CollectionPage",
				name: title,
				url: `${SITE}${paths.categories(lang)}`,
			}),
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: CATEGORIES_LABEL[lang], url: paths.categories(lang) },
			]),
		],
	};
}

/**
 * The home page, and pages 2-10 of it.
 *
 * Each page canonicals to ITSELF, never to page 1. A `rel=canonical` from page 4
 * to page 1 tells Google the two are the same document, which they are not — the
 * 48 products on page 4 appear nowhere else, and consolidating would drop them
 * out of the index entirely. Google's own guidance since 2019 has been that each
 * page in a series is its own canonical.
 *
 * `rel="prev"/"next"` are deliberately absent: Google stopped using them for
 * indexing in 2019 and said so. The `<a href>` pager is the signal now.
 */
export const homeMeta = (lang: Lang, products: number, page = 1): Meta => {
	const base =
		lang === "fr"
			? "Puis-je le remplacer ? — alternatives open source aux SaaS payants"
			: "Can I replace it? — open source alternatives to paid SaaS";
	// The page number goes in the title so ten sibling pages are not ten
	// identically-titled documents in a search result.
	const title =
		page > 1
			? lang === "fr"
				? `Alternatives open source aux SaaS payants — page ${page}`
				: `Open source alternatives to paid SaaS — page ${page}`
			: base;
	const description =
		lang === "fr"
			? `${products} abonnements SaaS, un verdict honnête chacun : l'alternative open source tient-elle la route, et que coûte la migration ?${page > 1 ? ` Page ${page}.` : ""}`
			: `${products} SaaS subscriptions, one honest verdict each: is the open source alternative good enough yet, and what does switching cost?${page > 1 ? ` Page ${page}.` : ""}`;
	return {
		title: title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX),
		description: clamp(description),
		canonical: `${SITE}${paths.home(lang, page)}`,
	};
};

/** The label the alternatives index carries in a breadcrumb trail. */
export const PROJECTS_LABEL: Record<Lang, string> = {
	en: "All open source projects",
	fr: "Tous les projets open source",
};

export const COLLECTIONS_LABEL: Record<Lang, string> = {
	en: "Collections",
	fr: "Collections",
};

/**
 * The alternatives index — every open source project, paginated.
 *
 * No `aggregateRating` anywhere on this site: the votes are boolean "I switched"
 * events with no scale behind them, so emitting a rating would mean inventing a
 * number. No `FAQPage` either — Google stopped rendering those in May 2026.
 * `CollectionPage` plus `BreadcrumbList` is what these pages honestly are.
 */
export const projectsMeta = (lang: Lang, projects: number, page = 1): Meta => {
	const title =
		lang === "fr"
			? page > 1
				? `Projets open source — page ${page}`
				: `Les ${projects} projets open source du catalogue (${YEAR})`
			: page > 1
				? `Open source projects — page ${page}`
				: `All ${projects} open source projects (${YEAR})`;
	const url = paths.projects(lang, page);
	return {
		title: title.length <= TITLE_MAX ? title : title.replace(` (${YEAR})`, ""),
		description: clamp(
			lang === "fr"
				? `${projects} projets open source, avec ce que chacun remplace, sa licence, l'effort d'hébergement et l'activité du dépôt.${page > 1 ? ` Page ${page}.` : ""}`
				: `${projects} open source projects, each with what it replaces, its licence, the effort to run it and how alive the repo is.${page > 1 ? ` Page ${page}.` : ""}`,
		),
		canonical: `${SITE}${url}`,
		jsonLd: [
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "CollectionPage",
				name: title,
				url: `${SITE}${url}`,
			}),
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: PROJECTS_LABEL[lang], url: paths.projects(lang) },
			]),
		],
	};
};

/** The index of the derived collections. Six of them; small, and a real hub. */
export const collectionsMeta = (lang: Lang, collections: number): Meta => {
	const title =
		lang === "fr"
			? "Collections — coupes transversales du catalogue"
			: "Collections — cross-sections of the catalogue";
	return {
		title,
		description: clamp(
			lang === "fr"
				? `${collections} collections dérivées du catalogue : ce que vous pouvez auto-héberger, ce qui est open source, ce qui est libre sans contrepartie, ce qui est open core, ce qui n’est pas open source, et ce qui a une alternative payante moins chère.`
				: `${collections} collections derived from the catalogue: what you can self-host, what is open source, what is free with no strings, what is open core, what is not open source at all, and what has a cheaper paid alternative.`,
		),
		canonical: `${SITE}${paths.collections(lang)}`,
		jsonLd: [
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "CollectionPage",
				name: title,
				url: `${SITE}${paths.collections(lang)}`,
			}),
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: COLLECTIONS_LABEL[lang], url: paths.collections(lang) },
			]),
		],
	};
};

/** Titles and descriptions per collection. Kept beside the copy in i18n. */
const COLLECTION_COPY: Record<
	string,
	Record<Lang, { title: string; description: string }>
> = {
	"under-10": {
		en: {
			title: "{n} cheap subscriptions with a drop-in open source replacement",
			description:
				"{n} products under $10/mo where leaving costs an install rather than a migration. Individually too small to audit, which is why they accumulate.",
		},
		fr: {
			title: "{n} petits abonnements avec un remplaçant open source immédiat",
			description:
				"{n} produits à moins de 10 $/mois où partir coûte une installation, pas une migration. Trop petits pour qu’on y regarde, et c’est pour ça qu’ils s’accumulent.",
		},
	},
	expensive: {
		en: {
			title: "{n} SaaS products over $100/mo, and what replaces them",
			description:
				"{n} products billed above $100 a month, with an honest verdict on each: whether the open source replacement is good enough yet, and what switching costs.",
		},
		fr: {
			title: "{n} SaaS à plus de 100 $/mois, et ce qui les remplace",
			description:
				"{n} produits facturés au-delà de 100 $ par mois, avec un verdict honnête sur chacun : le remplaçant open source tient-il la route, et que coûte la migration ?",
		},
	},
	"in-rust": {
		en: {
			title: "{n} self-hosted open source projects written in Rust",
			description:
				"{n} open source projects whose largest body of code is Rust, each listed against the paid product it replaces.",
		},
		fr: {
			title: "{n} projets open source auto-hébergeables écrits en Rust",
			description:
				"{n} projets open source dont le plus gros du code est en Rust, chacun listé face au produit payant qu’il remplace.",
		},
	},
	"in-go": {
		en: {
			title: "{n} self-hosted open source projects written in Go",
			description:
				"{n} open source projects whose largest body of code is Go, each listed against the paid product it replaces.",
		},
		fr: {
			title: "{n} projets open source auto-hébergeables écrits en Go",
			description:
				"{n} projets open source dont le plus gros du code est en Go, chacun listé face au produit payant qu’il remplace.",
		},
	},
	"in-python": {
		en: {
			title: "{n} self-hosted open source projects written in Python",
			description:
				"{n} open source projects whose largest body of code is Python, each listed against the paid product it replaces.",
		},
		fr: {
			title: "{n} projets open source auto-hébergeables écrits en Python",
			description:
				"{n} projets open source dont le plus gros du code est en Python, chacun listé face au produit payant qu’il remplace.",
		},
	},
	"one-compose": {
		en: {
			title: "{n} self-hosted apps that are one docker compose away",
			description:
				"{n} open source projects that ship a compose file in the repo root — clone, one command, running. Detected from the repositories themselves, never authored.",
		},
		fr: {
			title: "{n} applications auto-hébergées à un docker compose près",
			description:
				"{n} projets open source qui livrent un fichier compose à la racine du dépôt — clonez, une commande, ça tourne. Détecté depuis les dépôts eux-mêmes, jamais saisi à la main.",
		},
	},
	archived: {
		en: {
			title: "The graveyard: {n} open source projects that are done",
			description:
				"{n} projects that have been archived or abandoned, kept in the catalogue on purpose. Knowing something died is worth as much as knowing it exists.",
		},
		fr: {
			title: "Le cimetière : {n} projets open source terminés",
			description:
				"{n} projets archivés ou abandonnés, conservés volontairement au catalogue. Savoir qu’une chose est morte vaut autant que savoir qu’elle existe.",
		},
	},
	"self-hostable": {
		en: {
			title: "Self-hostable: {n} products with a real replacement you run",
			description:
				"{n} paid products where a credible open source replacement exists and you operate it yourself. Derived from the exit ladder, never from an editor's list.",
		},
		fr: {
			title: "Auto-hébergeable : {n} produits avec un vrai remplaçant",
			description:
				"{n} produits payants pour lesquels un remplaçant open source crédible existe, à condition de l'héberger vous-même. Dérivé de l'échelle de sortie, jamais d'une liste éditoriale.",
		},
	},
	"open-core": {
		en: {
			title: "Open core: {n} projects that hold something back",
			description:
				"{n} open source projects where the build you can run is not the whole product. What is paywalled, per project, and what the free half actually gives you.",
		},
		fr: {
			title: "Open core : {n} projets qui gardent une partie payante",
			description:
				"{n} projets open source dont la version auto-hébergeable n'est pas le produit complet. Ce qui est réservé au payant, projet par projet.",
		},
	},
	"open-source": {
		en: {
			title: "Open source: {n} projects under a real OSI licence",
			description:
				"{n} projects whose source is public under a recognised open source licence and that you can build and run yourself — open core included. Derived from the licence, never from an editor's list.",
		},
		fr: {
			title: "Open source : {n} projets sous une vraie licence OSI",
			description:
				"{n} projets dont le code est public sous une licence open source reconnue et que vous pouvez compiler et exécuter — open core compris. Dérivé de la licence, jamais d'une liste éditoriale.",
		},
	},
	foss: {
		en: {
			title: "Free and open source: {n} projects with no strings attached",
			description:
				"{n} projects under an OSI licence with nothing held back — no Commons Clause, no BSL, no enterprise edition beside the free one. The build you run is the whole product.",
		},
		fr: {
			title: "Libre et open source : {n} projets sans contrepartie",
			description:
				"{n} projets sous licence OSI sans rien de réservé — pas de Commons Clause, pas de BSL, pas d'édition entreprise à côté de la gratuite. Ce que vous hébergez est le produit entier.",
		},
	},
	"source-available": {
		en: {
			title: "Source-available: {n} projects that are not open source",
			description:
				"{n} projects you can self-host whose licence is not an open source licence — BSL, SSPL, Elastic, FSL, Commons Clause. Self-hosting and free licensing are different questions.",
		},
		fr: {
			title: "Source ouverte : {n} projets qui ne sont pas libres",
			description:
				"{n} projets auto-hébergeables dont la licence n’est pas une licence libre — BSL, SSPL, Elastic, FSL, Commons Clause. Auto-héberger et être libre sont deux questions distinctes.",
		},
	},
	cheaper: {
		en: {
			title:
				"Cheaper: {n} products with a paid alternative that undercuts them",
			description:
				"{n} paid products with a commercial alternative that genuinely costs less. For when self-hosting is not the answer but the invoice still is.",
		},
		fr: {
			title:
				"Moins cher : {n} produits avec une alternative payante moins chère",
			description:
				"{n} produits payants dont une alternative commerciale coûte réellement moins cher. Pour quand l'auto-hébergement n'est pas la réponse mais la facture l'est.",
		},
	},
};

/**
 * A theme hub. Titles name the theme and the two counts that make the page
 * worth opening, because "Building software" alone competes with every other
 * page on the internet called that.
 */
export const groupMeta = (
	group: string,
	label: string,
	products: number,
	categories: number,
	lang: Lang,
): Meta => {
	const title =
		lang === "fr"
			? `${label} : ${products} produits et leurs alternatives open source`
			: `${label}: ${products} products and their open source alternatives`;
	const description =
		lang === "fr"
			? `${products} produits payants répartis sur ${categories} catégories, chacun avec un verdict honnête : le remplaçant open source tient-il la route, et que coûte la migration ?`
			: `${products} paid products across ${categories} categories, each with an honest verdict: is the open source replacement good enough yet, and what does switching cost?`;
	const url = paths.group(lang, group);
	return {
		title: title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX),
		description: clamp(description),
		canonical: `${SITE}${url}`,
		jsonLd: [
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: CATEGORIES_LABEL[lang], url: paths.categories(lang) },
				{ name: label, url },
			]),
		],
	};
};

export const collectionMeta = (
	slug: string,
	lang: Lang,
	members: number,
	page = 1,
): Meta => {
	const copy = COLLECTION_COPY[slug]?.[lang];
	const name = copy
		? copy.title.replace("{n}", String(members))
		: `${slug} (${members})`;
	const title = page > 1 ? `${name} — page ${page}` : name;
	const url = paths.collection(lang, slug, page);
	return {
		title: title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX),
		description: clamp(
			(copy?.description ?? "").replace("{n}", String(members)) +
				(page > 1 ? ` Page ${page}.` : ""),
		),
		canonical: `${SITE}${url}`,
		jsonLd: [
			JSON.stringify({
				"@context": "https://schema.org",
				"@type": "CollectionPage",
				name: title,
				url: `${SITE}${url}`,
			}),
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: COLLECTIONS_LABEL[lang], url: paths.collections(lang) },
				{ name, url: paths.collection(lang, slug) },
			]),
		],
	};
};

/**
 * The standing pages. Each one is a page because it needs to be linkable,
 * shareable and indexable — which means each one needs its own title and
 * description, not the home page's.
 *
 * `estimate` is one page in two steps — the calculator, then the offer to do the
 * migration — so its description has to promise the number first. The lead is
 * what happens after somebody already got value, not what they searched for.
 */
export const standingMeta = (
	page:
		| "estimate"
		| "sponsor"
		| "submit"
		| "contact"
		| "stats"
		| "features"
		| "glossary"
		| "gaps"
		| "signin"
		| "dashboard"
		| "admin",
	lang: Lang,
	products: number,
): Meta => {
	const copy = {
		estimate: {
			en: [
				`Build a self-hosting plan — what to run instead of your SaaS`,
				`Pick from ${products} paid products, choose the open source replacement for each, and see the effort, the licences and what you give up. No signup — the plan lives in the link.`,
			],
			fr: [
				`Construisez votre plan d’auto-hébergement — quoi héberger à la place`,
				`Choisissez parmi ${products} produits payants, décidez du remplaçant open source de chacun, et voyez l’effort, les licences et ce que vous perdez. Sans inscription — le plan tient dans le lien.`,
			],
		},
		sponsor: {
			en: [
				"Sponsor canireplaceit",
				"Sponsors keep the site free and independent. Flat prices, 30-day runs, one rate for everyone, and the audience numbers are published only once they are real.",
			],
			fr: [
				"Soutenir canireplaceit",
				"Les sponsors permettent au site de rester gratuit et indépendant. Tarifs fixes, campagnes de 30 jours, un seul tarif pour tous, et les chiffres d'audience ne sont publiés qu'une fois réels.",
			],
		},
		gaps: {
			en: [
				"What open source still cannot do",
				"The paid products with no credible open source replacement, and the specific thing each one withholds. The honest counterweight to a catalogue of alternatives.",
			],
			fr: [
				"Ce que l’open source ne sait pas encore faire",
				"Les produits payants sans remplaçant open source crédible, et ce que chacun retient précisément. Le contrepoids honnête à un catalogue d’alternatives.",
			],
		},
		glossary: {
			en: [
				"What the words mean — the terms this catalogue runs on",
				"Fifteen terms defined once and applied the same way to all products: what “almost” means, what “open core” costs you, and when a repo counts as archived.",
			],
			fr: [
				"Ce que les mots veulent dire — le vocabulaire du catalogue",
				"Quinze termes définis une fois et appliqués de la même façon à tous les produits : ce que veut dire « presque », ce que coûte l’open core, et quand un dépôt est considéré comme archivé.",
			],
		},
		features: {
			en: [
				"What these open source projects actually do",
				"A closed vocabulary of features — SSO, real-time editing, public docs, offline, backups — answered per project from its own docs and repo. A dash means nobody checked, never that the answer is no.",
			],
			fr: [
				"Ce que ces projets open source font vraiment",
				"Un vocabulaire fermé de fonctionnalités — SSO, édition simultanée, docs publiques, hors ligne, sauvegardes — renseigné projet par projet depuis sa documentation et son dépôt. Un tiret veut dire que personne n'a vérifié, jamais que la réponse est non.",
			],
		},
		submit: {
			en: [
				"Submit a product or an alternative",
				"Every entry is one JSON file in a public repo. No form, no account: open a pull request and it ships on the next deploy.",
			],
			fr: [
				"Proposer un produit ou une alternative",
				"Chaque entrée est un fichier JSON dans un dépôt public. Sans formulaire ni compte : ouvrez une pull request et ça part au prochain déploiement.",
			],
		},
		// No postal address, no phone number, no `Organization` markup: none of
		// that exists, and inventing it to satisfy a schema validator would be the
		// same class of lie as an unpriced slot rendering as free.
		// Published traffic. The description promises the thing that makes it worth
		// reading — that the numbers are ours and auditable — rather than the
		// figures themselves, which change.
		stats: {
			en: [
				"Traffic — what this site actually gets",
				"Pageviews, sessions and where readers come from, measured on our own server with self-hosted analytics. No third-party tracker, no cross-site cookie.",
			],
			fr: [
				"Trafic — ce que ce site reçoit vraiment",
				"Pages vues, sessions et provenance des lecteurs, mesurés sur notre propre serveur avec des analytics auto-hébergés. Aucun traceur tiers, aucun cookie inter-sites.",
			],
		},
		// The dashboard and the sign-in form are noindex — see the flag returned
		// below — because both are session-gated: the dashboard renders an empty
		// <main> for anyone without a session, and the form has nothing to offer a
		// searcher. The copy still has to be honest for the tab and for shares.
		dashboard: {
			en: [
				"Your placements — canireplaceit",
				"Impressions, clicks and CTR for the ad slots you bought, counted server-side and filtered for automated traffic.",
			],
			fr: [
				"Vos emplacements — canireplaceit",
				"Impressions, clics et CTR de vos emplacements, comptés sur notre serveur et filtrés du trafic automatisé.",
			],
		},
		// The operator's own console, and noindex for a stronger reason than the two
		// above: there is nothing on it for anybody but one person, and its whole
		// content arrives from an endpoint that answers 401 to a crawler.
		admin: {
			en: [
				"Console — canireplaceit",
				"The review queue, every campaign and the whole slot board. For the platform operator only.",
			],
			fr: [
				"Console — canireplaceit",
				"La file de validation, toutes les campagnes et l'ensemble des emplacements. Réservé à l'exploitant du site.",
			],
		},
		signin: {
			en: [
				"Sign in — see your placement's numbers",
				"Advertisers sign in with the email they paid with. No password: we email a link that works once.",
			],
			fr: [
				"Connexion — consultez les chiffres de votre emplacement",
				"Les annonceurs se connectent avec l'e-mail utilisé pour payer. Sans mot de passe : nous envoyons un lien à usage unique.",
			],
		},
		contact: {
			en: [
				"Contact — report a wrong verdict, or reach the maintainer",
				"A wrong verdict or a stale price is worth reporting: every entry is one public file, and corrections go through the repo. Sponsorship and new products have their own pages.",
			],
			fr: [
				"Contact — signaler un verdict erroné, ou nous écrire",
				"Un verdict erroné ou un prix périmé mérite d'être signalé : chaque entrée est un fichier public, et les corrections passent par le dépôt. Le sponsoring et les nouveaux produits ont leurs propres pages.",
			],
		},
	}[page][lang];

	const url = paths[page](lang);
	return {
		title: copy[0].length <= TITLE_MAX ? copy[0] : clamp(copy[0], TITLE_MAX),
		description: clamp(copy[1]),
		canonical: `${SITE}${url}`,
		jsonLd: [
			breadcrumbJsonLd([
				{ name: HOME_LABEL[lang], url: paths.home(lang) },
				{ name: copy[0].split(" — ")[0], url },
			]),
		],
		noindex: page === "signin" || page === "dashboard" || page === "admin",
	};
};

/**
 * The legal pages. Indexable — they are required reading, they are linked from
 * every page in the footer, and a `noindex` on a legal notice defeats the point
 * of publishing one. Their descriptions are the documents' own first lines, so
 * the summary and the page can never drift apart.
 */
export const legalMeta = (doc: LegalDoc | undefined, lang: Lang): Meta => {
	const copy = legalCopy(doc, lang);
	const url = paths.legal(lang, doc);
	const trail = [
		{ name: HOME_LABEL[lang], url: paths.home(lang) },
		{ name: legalCopy(undefined, lang).title, url: paths.legal(lang) },
	];
	if (doc) trail.push({ name: copy.title, url });
	return {
		title:
			copy.title.length <= TITLE_MAX
				? copy.title
				: clamp(copy.title, TITLE_MAX),
		description: clamp(copy.description),
		canonical: `${SITE}${url}`,
		jsonLd: [breadcrumbJsonLd(trail)],
	};
};

/** Upserts one <meta>/<link>, matching on the attribute that identifies it. */
function upsert(
	tag: "meta" | "link",
	key: "name" | "property" | "rel",
	keyValue: string,
	valueAttr: "content" | "href",
	value: string,
): void {
	const selector = `${tag}[${key}="${keyValue}"]`;
	let el = document.head.querySelector<HTMLElement>(selector);
	if (!el) {
		el = document.createElement(tag);
		el.setAttribute(key, keyValue);
		document.head.appendChild(el);
	}
	el.setAttribute(valueAttr, value);
}

/**
 * Replaces the hreflang set. Marked so this owns exactly the tags it wrote and
 * never the unrelated ones: a plain `link[rel=alternate]` sweep would also take
 * out an RSS or an amphtml link the moment either is added.
 */
function syncAlternates(alternates: Record<Lang, string>): void {
	for (const el of document.head.querySelectorAll("link[data-alt]")) {
		el.remove();
	}
	const add = (hreflang: string, href: string) => {
		const el = document.createElement("link");
		el.setAttribute("rel", "alternate");
		el.setAttribute("hreflang", hreflang);
		el.setAttribute("href", `${SITE}${href}`);
		el.setAttribute("data-alt", "");
		document.head.appendChild(el);
	};
	for (const l of SupportedLangs) add(l, alternates[l]);
	add("x-default", alternates[DEFAULT_LANG]);
}

/**
 * Replaces the JSON-LD blocks. Same marker trick, and for a sharper reason: the
 * BreadcrumbList here has to keep describing the same trail the visible <Trail>
 * shows, and a stale block claiming the previous page's crumbs is the one
 * structured-data error Google treats as a mismatch with the page.
 */
function syncJsonLd(blocks: string[]): void {
	for (const el of document.head.querySelectorAll("script[data-ld]")) {
		el.remove();
	}
	for (const block of blocks) {
		const el = document.createElement("script");
		el.setAttribute("type", "application/ld+json");
		el.setAttribute("data-ld", "");
		el.textContent = block;
		document.head.appendChild(el);
	}
}

function syncRobots(noindex: boolean): void {
	if (noindex) {
		upsert("meta", "name", "robots", "content", "noindex, follow");
		return;
	}
	document.head.querySelector('meta[name="robots"]')?.remove();
}

/**
 * Applied on client-side navigation so the tab and shares stay correct.
 *
 * `robots` is synced from `meta.noindex` alone. Which *content* pages are too
 * thin to index is still decided in scripts/prerender.ts from the whole
 * catalogue, and a second copy of that rule here would be free to drift from the
 * one that actually writes the tag — a crawler fetches each URL fresh and gets
 * the prerendered document, so for those the build-time tag is the one that
 * counts. But the tag has to be removed on the way out of a page that carries
 * it: navigating from /dashboard to the home page would otherwise leave the
 * dashboard's noindex on an indexable document for anything that renders the SPA.
 */
export function applyMeta(meta: Meta, alternates?: Record<Lang, string>): void {
	document.title = meta.title;
	syncRobots(meta.noindex === true);
	upsert("meta", "name", "description", "content", meta.description);
	upsert("meta", "property", "og:title", "content", meta.title);
	upsert("meta", "property", "og:description", "content", meta.description);
	upsert("meta", "property", "og:url", "content", meta.canonical);
	upsert("link", "rel", "canonical", "href", meta.canonical);
	syncJsonLd(meta.jsonLd ?? []);
	if (alternates) syncAlternates(alternates);
}
