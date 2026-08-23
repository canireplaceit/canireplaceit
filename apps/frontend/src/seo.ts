/**
 * Per-page metadata. Written into the prerendered HTML at build time and kept in
 * sync on client-side navigation, so a crawler and a human see the same thing.
 *
 * The structured data is ONE `@graph` per document rather than three or four
 * loose blocks. Every node carries an `@id`, and the nodes point at each other
 * with it: the page node names its main entity, the main entity names the
 * publisher, an alternative on a product page is the same `@id` as the node on
 * that project's own page. Four disconnected blocks describe four unrelated
 * things; one graph describes one site.
 */

import type {
	Category,
	Health,
	Product,
	Project,
	Source,
} from "core/src/content";
import {
	byExitQuality,
	CATEGORY_GROUPS,
	isArchived,
	projectSlug,
} from "core/src/content";
import type { Lang } from "core/src/index";
import {
	DEFAULT_LANG,
	resolveTranslation,
	SupportedLangs,
} from "core/src/index";
import { type LegalDoc, paths } from "core/src/routes";
import { money } from "./api";
import { dict } from "./i18n";
import { legalCopy, PUBLISHER } from "./legal";

export const SITE = "https://canireplaceit.com";

/** One static card for every share — see scripts/prerender.ts. */
export const OG_IMAGE = `${SITE}/og.png`;

export const OG_LOCALE: Record<Lang, string> = { en: "en_US", fr: "fr_FR" };

export type Meta = {
	title: string;
	description: string;
	/**
	 * Empty on the two documents that are not pages: `/` redirects and `/404.html`
	 * is served under every URL that does not exist, so neither has a canonical
	 * URL of its own to declare.
	 */
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

/**
 * A label from the same table the UI reads.
 *
 * Every breadcrumb name below comes through here rather than from a constant
 * written twice: the markup has to name the crumb the page actually renders,
 * and a second hand-kept copy of "All open source projects" drifted from the
 * visible one in French within a single edit.
 */
const label = (lang: Lang, key: string): string =>
	(dict[lang] as Record<string, string>)[key] ??
	(dict.en as Record<string, string>)[key] ??
	key;

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * The site's own entity, declared once and referenced everywhere else by `@id`.
 *
 * The footer has always linked the GitHub organisation and the X account and
 * none of it was marked up, so nothing tied the editorial work on 8,864 pages
 * to a publisher. The full node is emitted on the home page only — Google's
 * guidance is explicit that it does not belong on every page — and every other
 * document reaches it through `{ "@id": ORG_ID }`. The one exception is the
 * review author on a product page, which repeats the name because Google asks a
 * review for one, under the same `@id` so it is still the same entity.
 */
const ORG_ID = `${SITE}/#organization`;
const WEBSITE_ID = `${SITE}/#website`;
const LOGO_ID = `${SITE}/#logo`;
const FOUNDER_ID = `${SITE}/#founder`;

/** The two profiles the footer already links, and the repo behind every entry. */
const GITHUB_ORG = "https://github.com/canireplaceit";
const GITHUB_REPO = "https://github.com/canireplaceit/canireplaceit";
const X_PROFILE = "https://x.com/hadesdevs";

const abs = (path: string): string => `${SITE}${path}`;

/** `/en/alternatives/notion` + `product` → the node's stable identity. */
const nodeId = (path: string, fragment: string): string =>
	`${abs(path)}#${fragment}`;

type Node = Record<string, unknown>;

/**
 * One document, one script, one graph.
 *
 * `JSON.stringify` drops undefined values, so a node can name a property it may
 * not have without the caller branching around it.
 */
const graph = (nodes: (Node | null | undefined)[]): string =>
	JSON.stringify({
		"@context": "https://schema.org",
		"@graph": nodes.filter((n): n is Node => Boolean(n)),
	});

/**
 * The publisher. Language-neutral on purpose: it is ONE entity, and an English
 * page and a French page describing the same `@id` with two different
 * descriptions is exactly the "three documents claim the same thing" problem
 * this file is fixing. The bilingual half lives in `alternateName`.
 */
const organizationNode = (): Node => ({
	"@type": "Organization",
	"@id": ORG_ID,
	name: "canireplaceit",
	alternateName: ["Can I replace it?", "Puis-je le remplacer ?"],
	url: `${SITE}/`,
	description:
		"An open catalogue of paid SaaS products and the open source projects that replace them, with a dated price receipt and an honest verdict on each.",
	// TODO(social): point this at the square raster brand mark once the Social &
	// OG pass produces one. `og.png` is a 1200x630 share card carrying the
	// wordmark — the only raster brand asset in the repo today, and legal to use
	// here, but a logo is what Google wants and a card is not one.
	logo: {
		"@type": "ImageObject",
		"@id": LOGO_ID,
		url: OG_IMAGE,
		contentUrl: OG_IMAGE,
		width: 1200,
		height: 630,
		caption: "canireplaceit",
	},
	image: { "@id": LOGO_ID },
	sameAs: [GITHUB_ORG, GITHUB_REPO, X_PROFILE],
	founder: {
		"@type": "Person",
		"@id": FOUNDER_ID,
		// The same name the legal notice publishes. Nothing here is invented to
		// satisfy a validator — see the note in `standingMeta`.
		name: PUBLISHER.name ?? "canireplaceit",
		sameAs: [X_PROFILE],
	},
});

/**
 * The site.
 *
 * No `potentialAction`: the sitelinks searchbox was removed from Google Search
 * on 21 November 2024, and the `SearchAction` that used to sit here pointed at a
 * JSON API endpoint, which was never a page a human could be sent to.
 */
const websiteNode = (): Node => ({
	"@type": "WebSite",
	"@id": WEBSITE_ID,
	name: "canireplaceit",
	alternateName: ["Can I replace it?", "Puis-je le remplacer ?"],
	url: `${SITE}/`,
	inLanguage: [...SupportedLangs],
	license: "https://creativecommons.org/licenses/by/4.0/",
	publisher: { "@id": ORG_ID },
});

/* ------------------------------------------------------------------ */
/* Shared node builders                                                */
/* ------------------------------------------------------------------ */

/**
 * The breadcrumb, and the only structured data on most of these pages that
 * still earns a rich result.
 *
 * The trail passed in must be the trail the page RENDERS — same rungs, same
 * labels. Markup describing a breadcrumb a reader cannot see is the same
 * hidden-content rule that made the FAQ block a liability, at a smaller scale.
 */
const breadcrumbNode = (
	url: string,
	trail: { name: string; url: string }[],
): Node => ({
	"@type": "BreadcrumbList",
	"@id": nodeId(url, "breadcrumb"),
	itemListElement: trail.map((item, i) => ({
		"@type": "ListItem",
		position: i + 1,
		name: item.name,
		item: abs(item.url),
	})),
});

/** One row of a list page, as the page renders it. */
export type ListRow = { name: string; url: string };

/**
 * What a collection page actually holds.
 *
 * Worth being honest about what this buys: nothing in the SERP. No carousel
 * rich result accepts `SoftwareApplication`, and there is no generic list
 * appearance. It is here so a machine reading one of these URLs can see which
 * pages live under it instead of a name and a canonical.
 *
 * `rows` is supplied by the prerenderer only. A crawler always fetches the URL
 * fresh and reads the static document, so the build-time head is the one that
 * counts; reproducing every page's slice of the catalogue a second time in the
 * browser would cost bytes on the critical path to describe a page the reader
 * is already looking at. Without rows the page node is still emitted, with the
 * name, the URL and the description it never used to carry.
 */
const itemListNode = (
	url: string,
	name: string,
	rows: ListRow[] | undefined,
): Node | null =>
	rows && rows.length > 0
		? {
				"@type": "ItemList",
				"@id": nodeId(url, "list"),
				name,
				numberOfItems: rows.length,
				itemListElement: rows.map((row, i) => ({
					"@type": "ListItem",
					position: i + 1,
					name: row.name,
					url: abs(row.url),
				})),
			}
		: null;

/** The page itself. `CollectionPage` for anything that is a list of pages. */
const pageNode = (o: {
	url: string;
	lang: Lang;
	name: string;
	description: string;
	type?: "WebPage" | "CollectionPage";
	mainEntity?: string;
	dateModified?: string;
}): Node => ({
	"@type": o.type ?? "WebPage",
	"@id": nodeId(o.url, "webpage"),
	url: abs(o.url),
	name: o.name,
	description: o.description,
	inLanguage: o.lang,
	isPartOf: { "@id": WEBSITE_ID },
	breadcrumb: { "@id": nodeId(o.url, "breadcrumb") },
	mainEntity: o.mainEntity ? { "@id": o.mainEntity } : undefined,
	dateModified: o.dateModified,
	publisher: { "@id": ORG_ID },
});

/* ------------------------------------------------------------------ */
/* Licences                                                            */
/* ------------------------------------------------------------------ */

/**
 * `license` has a range of URL or CreativeWork, so the bare `"MIT"` this used
 * to emit was a type error every validator flagged.
 *
 * Checked against spdx.org/licenses/licenses.json on 2026-08-23: these are the
 * ids in the catalogue that are real SPDX identifiers. The other 79 strings in
 * `data/products` are prose — "MIT core with an ee/ directory", "AGPL-3.0 or
 * commercial" — which is information worth keeping and is NOT an identifier, so
 * those become a named CreativeWork rather than a link to a page that does not
 * exist.
 */
const SPDX_IDS: ReadonlySet<string> = new Set([
	"0BSD",
	"AAL",
	"AFL-3.0",
	"AGPL-3.0",
	"Apache-2.0",
	"Artistic-1.0-Perl",
	"Artistic-2.0",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"BSD-4-Clause",
	"BSL-1.0",
	"BUSL-1.1",
	"BlueOak-1.0.0",
	"CC0-1.0",
	"CDDL-1.0",
	"CECILL-2.0",
	"CECILL-C",
	"CPAL-1.0",
	"CPL-1.0",
	"ECL-2.0",
	"EPL-1.0",
	"EPL-2.0",
	"EUPL-1.1",
	"EUPL-1.2",
	"Elastic-2.0",
	"FSL-1.1-MIT",
	"GPL-2.0",
	"GPL-2.0+",
	"GPL-2.0-only",
	"GPL-2.0-or-later",
	"GPL-3.0",
	"ISC",
	"ImageMagick",
	"LGPL-2.0",
	"LGPL-2.1",
	"LGPL-3.0",
	"MIT",
	"MPL-1.1",
	"MPL-2.0",
	"MS-PL",
	"OFL-1.1",
	"OSL-3.0",
	"PSF-2.0",
	"PostgreSQL",
	"SSPL-1.0",
	"Unlicense",
	"Vim",
	"WTFPL",
	"Zlib",
]);

const licenseValue = (raw: string | undefined): string | Node | undefined => {
	if (!raw) return undefined;
	return SPDX_IDS.has(raw)
		? `https://spdx.org/licenses/${raw}.html`
		: { "@type": "CreativeWork", name: raw };
};

/* ------------------------------------------------------------------ */
/* applicationCategory                                                 */
/* ------------------------------------------------------------------ */

/**
 * Google publishes a closed list of `applicationCategory` values; the catalogue
 * has 85 internal slugs and none of them is on it. This is the map, and it is
 * exhaustive by construction — `categoryApplication` falls back to
 * `BusinessApplication`, which is what the project pages already said, so a new
 * category never emits an invalid value while nobody is looking.
 *
 * The list itself was read off developers.google.com/search/docs/appearance/
 * structured-data/software-app on 2026-08-23: 22 values, not the 25 that get
 * repeated second-hand.
 */
const APP_CATEGORY: Record<string, string> = {
	ai: "BusinessApplication",
	analytics: "BusinessApplication",
	auth: "SecurityApplication",
	automation: "BusinessApplication",
	backend: "DeveloperApplication",
	cms: "BusinessApplication",
	comms: "CommunicationApplication",
	crm: "BusinessApplication",
	design: "DesignApplication",
	"dev-tools": "DeveloperApplication",
	documents: "BusinessApplication",
	"e-commerce": "ShoppingApplication",
	forms: "BusinessApplication",
	"internal-tools": "BusinessApplication",
	marketing: "BusinessApplication",
	"notes-docs": "BusinessApplication",
	observability: "DeveloperApplication",
	payments: "FinanceApplication",
	productivity: "BusinessApplication",
	"project-mgmt": "BusinessApplication",
	scheduling: "BusinessApplication",
	search: "DeveloperApplication",
	security: "SecurityApplication",
	storage: "UtilitiesApplication",
	support: "BusinessApplication",
	video: "MultimediaApplication",
	"website-builders": "DesignApplication",
	"cloud-platforms-hosting": "DeveloperApplication",
	"databases-caches": "DeveloperApplication",
	"data-platform-etl": "DeveloperApplication",
	"build-delivery": "DeveloperApplication",
	"infrastructure-as-code": "DeveloperApplication",
	"containers-kubernetes": "DeveloperApplication",
	"developer-tooling": "DeveloperApplication",
	"observability-telemetry": "DeveloperApplication",
	"secrets-privileged-access": "SecurityApplication",
	"application-security": "SecurityApplication",
	"networking-vpn": "SecurityApplication",
	"api-development": "DeveloperApplication",
	"ai-infrastructure": "DeveloperApplication",
	"backup-recovery": "UtilitiesApplication",
	"accounting-invoicing": "FinanceApplication",
	"people-hiring": "BusinessApplication",
	"commerce-payments-ops": "FinanceApplication",
	"learning-teaching": "EducationalApplication",
	"health-care": "HealthApplication",
	"legal-contracts-signing": "BusinessApplication",
	"bookings-property-events": "BusinessApplication",
	"creative-studio": "DesignApplication",
	"personal-media-libraries": "MultimediaApplication",
	"home-devices": "HomeApplication",
	"money-budgeting": "FinanceApplication",
	"community-publishing": "SocialNetworkingApplication",
	"language-localization": "BusinessApplication",
	"maps-location": "TravelApplication",
	"3d-cad": "DesignApplication",
	"diagramming-whiteboards": "DesignApplication",
	"testing-qa": "DeveloperApplication",
	"mobile-development": "DeveloperApplication",
	"research-science": "EducationalApplication",
	"scientific-computing": "EducationalApplication",
	"retail-pos": "BusinessApplication",
	"inventory-warehouse": "BusinessApplication",
	"shipping-logistics": "BusinessApplication",
	"field-service-maintenance": "BusinessApplication",
	"manufacturing-quality": "BusinessApplication",
	"procurement-suppliers": "BusinessApplication",
	"construction-tech": "BusinessApplication",
	agriculture: "BusinessApplication",
	"facilities-access": "SecurityApplication",
	"email-deliverability": "CommunicationApplication",
	"remote-access": "UtilitiesApplication",
	"seo-rank-tracking": "BusinessApplication",
	"advertising-affiliate": "BusinessApplication",
	"sales-outreach-data": "BusinessApplication",
	"live-streaming-broadcast": "MultimediaApplication",
	"audio-podcasting": "MultimediaApplication",
	"game-development": "DeveloperApplication",
	"game-hosting-play": "GameApplication",
	"vr-ar": "MultimediaApplication",
	"media-servers-tv": "MultimediaApplication",
	"digital-signage": "MultimediaApplication",
	"email-clients": "CommunicationApplication",
	"social-dating": "SocialNetworkingApplication",
	"shell-terminal": "DeveloperApplication",
};

export const categoryApplication = (slug: string | undefined): string =>
	(slug && APP_CATEGORY[slug]) || "BusinessApplication";

/* ------------------------------------------------------------------ */
/* Glossary                                                            */
/* ------------------------------------------------------------------ */

/** The id a term's `<dt>` carries, and the fragment every deep link points at. */
export const glossaryAnchor = (label: string): string =>
	label.toLowerCase().replace(/\./g, "-");

/**
 * The terms this catalogue runs on.
 *
 * Declared here rather than in `GlossaryPage` because two things read it: the
 * page that renders the definitions, and the `DefinedTermSet` below that names
 * them for a machine. A second copy would drift, and the anchors would stop
 * agreeing with the ~12,000 deep links pointing at them.
 */
export const GLOSSARY_GROUPS: {
	heading: string;
	terms: { label: string; def: string }[];
}[] = [
	{
		heading: "glossary.verdicts",
		terms: [
			{ label: "verdict.yes", def: "def.verdict.yes" },
			{ label: "verdict.almost", def: "def.verdict.almost" },
			{ label: "verdict.not-yet", def: "def.verdict.not-yet" },
		],
	},
	{
		heading: "glossary.effort",
		terms: [
			{ label: "effort.managed", def: "def.effort.managed" },
			{ label: "effort.docker", def: "def.effort.docker" },
			{ label: "effort.ops", def: "def.effort.ops" },
		],
	},
	{
		heading: "glossary.openness",
		terms: [
			{ label: "facts.openCore.none", def: "def.facts.openCore.none" },
			{ label: "facts.openCore.minor", def: "def.facts.openCore.minor" },
			{ label: "facts.openCore.major", def: "def.facts.openCore.major" },
			{ label: "facts.selfHost", def: "def.facts.selfHost" },
			{ label: "facts.noSelfHost", def: "def.facts.noSelfHost" },
		],
	},
	{
		heading: "glossary.repo",
		terms: [
			{ label: "repo.archived", def: "def.repo.archived" },
			{ label: "repo.dormant", def: "def.repo.dormant" },
			{ label: "repo.compose", def: "def.repo.compose" },
			{ label: "facts.sso", def: "def.facts.sso" },
			{ label: "facts.ssoPaid", def: "def.facts.ssoPaid" },
		],
	},
];

/**
 * The glossary as a term set.
 *
 * Be honest about what this buys: Google has no rich result for `DefinedTerm`,
 * no documentation page for it and no gallery entry. The reason it is here is
 * that these sixteen words are the catalogue's own vocabulary — every product
 * page labels an alternative "open core" or "docker" — and an `@id` per term
 * gives anything parsing the site one definition to resolve them against
 * instead of 592 loose adjectives.
 */
const definedTermSetNode = (lang: Lang): Node => {
	const url = paths.glossary(lang);
	const setId = nodeId(url, "glossary");
	return {
		"@type": "DefinedTermSet",
		"@id": setId,
		name: label(lang, "glossary.title"),
		url: abs(url),
		inLanguage: lang,
		hasDefinedTerm: GLOSSARY_GROUPS.flatMap((group) =>
			group.terms.map((term) => ({
				"@type": "DefinedTerm",
				"@id": nodeId(url, glossaryAnchor(term.label)),
				name: label(lang, term.label),
				description: label(lang, term.def),
				url: `${abs(url)}#${glossaryAnchor(term.label)}`,
				inDefinedTermSet: { "@id": setId },
			})),
		),
	};
};

/* ------------------------------------------------------------------ */
/* Breadcrumb labels                                                   */
/* ------------------------------------------------------------------ */

/**
 * Every label below is read from the same table the visible `<Trail>` reads.
 * They are exported because the prerenderer builds some of these trails too.
 */
export const HOME_LABEL: Record<Lang, string> = {
	en: label("en", "page.home"),
	fr: label("fr", "page.home"),
};

export const CATEGORIES_LABEL: Record<Lang, string> = {
	en: label("en", "page.categories"),
	fr: label("fr", "page.categories"),
};

export const PROJECTS_LABEL: Record<Lang, string> = {
	en: label("en", "page.projects"),
	fr: label("fr", "page.projects"),
};

export const COLLECTIONS_LABEL: Record<Lang, string> = {
	en: label("en", "page.collections"),
	fr: label("fr", "page.collections"),
};

/**
 * Theme names for structured data, which is built outside the React tree and so
 * has no `t`. Read from the same `dict` the UI uses — a second hand-written copy
 * drifted within minutes when the prerenderer tried it.
 */
export const GROUP_LABEL: Record<Lang, Record<string, string>> = {
	en: Object.fromEntries(
		CATEGORY_GROUPS.map((g) => [g, label("en", `catGroup.${g}`)]),
	),
	fr: Object.fromEntries(
		CATEGORY_GROUPS.map((g) => [g, label("fr", `catGroup.${g}`)]),
	),
};

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

/**
 * How a project is named from somewhere that is not its own page.
 *
 * The `@id` is the node on the project's page, so the same project cited by
 * nine products is nine references to one entity rather than nine unrelated
 * claims that a piece of software exists. Without the slug map — a client-side
 * render that has not been handed one — the reference degrades to a name and
 * the forge URL, which is true but anonymous.
 */
const projectRef = (
	source: Source,
	name: string,
	lang: Lang,
	slugs?: ReadonlyMap<string, string>,
): Node => {
	const slug = slugs?.get(projectSlug(source));
	if (!slug) {
		return { "@type": "SoftwareApplication", name, sameAs: source.url };
	}
	const url = paths.project(lang, slug);
	return {
		"@type": "SoftwareApplication",
		"@id": nodeId(url, "software"),
		name,
		url: abs(url),
	};
};

/**
 * What the caller knows that this file cannot work out for itself.
 *
 * `healthOf` is the same reading `VerdictSentence` and `ExitLadder` resolve
 * through, and it has to be: the verdict sentence names whichever project
 * `byExitQuality` puts first, and the forge can demote one by archiving it.
 * Without this the markup would quote a sentence naming a different project
 * from the one the page prints.
 */
export type ProductOpts = {
	/** Forge id → pretty slug, so an alternative can be named as OUR page. */
	projectSlugs?: ReadonlyMap<string, string>;
	/** This repo's reading, already gated on the health file's own freshness. */
	healthOf?: (source: Source) => Pick<Health, "archived"> | null | undefined;
};

/**
 * The paid product, as an editorial review of it.
 *
 * `Product` rather than `SoftwareApplication`, and `url` pointing here rather
 * than at the vendor: the page is a review of somebody else's product, and
 * until now nothing in the markup said that this domain was the thing doing the
 * reviewing. The vendor's own site moves to `sameAs`, which is what it is.
 *
 * NO `reviewRating`. The verdict is a three-point scale measuring how
 * replaceable something is, not how good it is — two stars out of three under
 * "Modal" would render as "this reviewer thinks Modal is mediocre", which is
 * the opposite of what the page says. `positiveNotes`/`negativeNotes` earn the
 * pros-and-cons appearance without asserting a score nobody made.
 *
 * NO `availability`. Google restricts merchant listing experiences to pages
 * where a shopper can buy the thing, and nothing here is for sale; claiming
 * `InStock` is how a catalogue earns "Non-product labeled as product".
 */
const productNode = (
	product: Product,
	lang: Lang,
	url: string,
	category: Category | undefined,
	description: string,
	opts: ProductOpts | undefined,
): Node => {
	const oss = product.alternatives.filter(
		(a): a is Extract<Product["alternatives"][number], { kind: "oss" }> =>
			a.kind === "oss",
	);
	/** The same two lines `VerdictSentence` and `ExitLadder` compute. */
	const health = opts?.healthOf;
	const live = oss.filter((a) => !isArchived(a, health?.(a.source)));
	const best = byExitQuality(live, (a) => health?.(a.source))[0];

	/**
	 * Pros and cons, read the way a searcher reads them.
	 *
	 * Google attaches these to the PRODUCT and shows them as bare "Pros" and
	 * "Cons" headings. It does not show `reviewAspect`. So the lists have to be
	 * true of the product itself, not of the review's thesis — the first cut of
	 * this put `whatYouLose` under "Cons", which renders as "Notion: Cons —
	 * databases and relations", the exact opposite of what the page says.
	 *
	 * PROS are `whatYouLose`: what you give up by leaving IS what the product is
	 * genuinely good at, printed as chips under "What you give up".
	 *
	 * CONS are the case against staying, and both lines come off the page as
	 * rendered: the exit ladder's own price line, and the verdict sentence that
	 * opens the article. Nothing is composed here — a sentence assembled in this
	 * file would be a sentence that appears nowhere on the page, which is the rule
	 * that made the FAQ block a liability.
	 */
	const pros = product.whatYouLose.map((v) => resolveTranslation(v, lang));

	const cons: string[] = [];
	const monthly = product.priceMonthly;
	if (monthly !== null && monthly > 0) {
		// `ExitLadder` prints "$10/mo — $120/yr" on its "you are here" rung, but
		// only when there is a rung below it to climb to. `PriceBlock` prints the
		// monthly figure alone on every priced page, which is the fallback.
		cons.push(
			best
				? `${money(monthly * 100, lang)}${label(lang, "row.perMonth")} — ${money(
						monthly * 1200,
						lang,
					)}${label(lang, "ladder.perYear")}`
				: `${money(monthly * 100, lang)}${label(lang, "row.perMonth")}`,
		);
	}
	// The lede, verbatim. Skipped on "not-yet": there the sentence reads "you
	// cannot replace this yet", which is an argument FOR staying, so filing it
	// under "Cons" would be the same inversion this block exists to avoid.
	if (best && product.verdict !== "not-yet") {
		cons.push(
			label(lang, product.verdict === "yes" ? "lede.yes" : "lede.almost")
				.replace("{product}", product.name)
				.replace("{best}", best.name)
				.replace("{licence}", best.license),
		);
	}

	const notes = (rows: string[]): Node | undefined =>
		rows.length > 0
			? {
					"@type": "ItemList",
					itemListElement: rows.map((name, i) => ({
						"@type": "ListItem",
						position: i + 1,
						name,
					})),
				}
			: undefined;

	const priced = product.priceMonthly !== null && product.pricing !== null;

	return {
		"@type": "Product",
		"@id": nodeId(url, "product"),
		name: product.name,
		url: abs(url),
		description,
		category: category
			? resolveTranslation(category.name, lang)
			: product.category,
		sameAs: product.domain ? [`https://${product.domain}`] : undefined,
		brand: { "@type": "Brand", name: product.name },
		mainEntityOfPage: { "@id": nodeId(url, "webpage") },
		offers: priced
			? {
					"@type": "Offer",
					price: product.priceMonthly,
					priceCurrency: "USD",
					// The vendor page the figure was read from.
					url: product.pricing?.url,
					/**
					 * The figure is a monthly subscription and nothing in the old
					 * `Offer` said so, which reads to a parser as a flat $250. NOT
					 * `priceValidUntil`: that means "guaranteed until", and Google drops
					 * the price from a result once it expires. Our date is a receipt for
					 * a reading already taken, which is `dateModified` on the page.
					 */
					priceSpecification: {
						"@type": "UnitPriceSpecification",
						price: product.priceMonthly,
						priceCurrency: "USD",
						unitCode: "MON",
						unitText: lang === "fr" ? "mois" : "month",
					},
				}
			: undefined,
		// Google asks for at least two statements across the two lists before it
		// will render pros and cons. One bullet is not a summary anyway.
		review:
			pros.length + cons.length >= 2
				? {
						"@type": "Review",
						"@id": nodeId(url, "review"),
						name: `${label(lang, "hero.title")} ${product.name}${
							lang === "fr" ? " ?" : "?"
						}`,
						itemReviewed: { "@id": nodeId(url, "product") },
						reviewAspect:
							lang === "fr"
								? "Remplaçabilité par de l'open source"
								: "Open source replaceability",
						author: {
							// Both a reference and a definition: Google wants an author with
							// a name on the page that carries the review, and the `@id` is
							// what ties it to the Organization declared on the home page.
							"@type": "Organization",
							"@id": ORG_ID,
							name: "canireplaceit",
							url: `${SITE}/`,
						},
						// The date the record was last verified, which is the date the page
						// itself prints beside the price.
						dateModified: product.pricing?.checkedOn,
						positiveNotes: notes(pros),
						negativeNotes: notes(cons),
					}
				: undefined,
	};
};

export function productMeta(
	product: Product,
	lang: Lang,
	category?: Category,
	opts?: ProductOpts,
): Meta {
	const oss = product.alternatives.filter(
		(a): a is Extract<Product["alternatives"][number], { kind: "oss" }> =>
			a.kind === "oss",
	);
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

	const url = paths.product(lang, product.slug);
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
	trail.push({ name: product.name, url });

	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name: title,
					description,
					mainEntity: nodeId(url, "product"),
					dateModified: product.pricing?.checkedOn,
				}),
				productNode(product, lang, url, category, description, opts),
				// Inert for Google, but it is the cleanest machine-readable statement
				// of "these N projects replace this product", and every entry in it now
				// names the project's page here rather than a forge.
				oss.length > 0
					? {
							"@type": "ItemList",
							"@id": nodeId(url, "alternatives"),
							name: title,
							description,
							numberOfItems: oss.length,
							itemListElement: oss.map((a, i) => ({
								"@type": "ListItem",
								position: i + 1,
								item: projectRef(a.source, a.name, lang, opts?.projectSlugs),
							})),
						}
					: null,
				breadcrumbNode(url, trail),
			]),
		],
	};
}

/* ------------------------------------------------------------------ */
/* Projects                                                            */
/* ------------------------------------------------------------------ */

/** `slug` is the pretty URL slug, not the forge id the Project carries. */
export function projectMeta(
	project: Project,
	lang: Lang,
	slug: string,
	opts?: {
		/** The category of the first product it replaces — see `APP_CATEGORY`. */
		category?: Category;
		/** `health.repos[…].lastPush`, the one dated fact a project page holds. */
		lastPush?: string;
		/** The project's own site as the forge records it, when it declares one. */
		homepage?: string | null;
	},
): Meta {
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

	const url = paths.project(lang, slug);
	const sameAs = [project.source.url, opts?.homepage].filter(
		(v): v is string => typeof v === "string" && v.length > 0,
	);

	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name: title,
					description,
					mainEntity: nodeId(url, "software"),
					dateModified: opts?.lastPush,
				}),
				{
					"@type": "SoftwareApplication",
					"@id": nodeId(url, "software"),
					name: project.name,
					description,
					// Our page, not the forge. The forge is where the code is, which is a
					// different question from where the write-up is.
					url: abs(url),
					sameAs: [...new Set(sameAs)],
					codeRepository: project.source.url,
					license: licenseValue(project.license),
					applicationCategory: categoryApplication(opts?.category?.slug),
					applicationSubCategory: opts?.category
						? resolveTranslation(opts.category.name, lang)
						: undefined,
					mainEntityOfPage: { "@id": nodeId(url, "webpage") },
					dateModified: opts?.lastPush,
					// No `offers`. SoftwareApplication only validates an offer alongside a
					// rating, we have no rating, and inventing one is how sites earn a
					// manual action. A free licence is already stated by `license`.
				},
				// Three rungs, matching the trail the page renders: the index sits
				// between the home page and a project. `categoryMeta` has always done
				// this and this one never got the same treatment.
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: PROJECTS_LABEL[lang], url: paths.projects(lang) },
					{ name: project.name, url },
				]),
			]),
		],
	};
}

/* ------------------------------------------------------------------ */
/* Category, theme and index pages                                     */
/* ------------------------------------------------------------------ */

export function categoryMeta(
	category: Category,
	count: number,
	lang: Lang,
	rows?: ListRow[],
): Meta {
	const name = resolveTranslation(category.name, lang);
	const dated =
		lang === "fr"
			? `${count} alternatives open source ${name} (${YEAR})`
			: `${count} open source ${name} alternatives (${YEAR})`;
	const title =
		dated.length <= TITLE_MAX ? dated : dated.replace(` (${YEAR})`, "");
	const description = clamp(
		lang === "fr"
			? `${count} produits ${name} passés en revue, avec leurs alternatives open source et ce que migrer coûte vraiment.`
			: `${count} ${name} products reviewed, with their open source alternatives and what switching actually costs.`,
	);
	const url = paths.category(lang, category.slug);
	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name: title,
					description,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, title, rows),
				// Three levels, matching the trail the page actually renders: the
				// index sits between the home page and a category, so the markup and the
				// visible breadcrumb say the same thing.
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: CATEGORIES_LABEL[lang], url: paths.categories(lang) },
					{ name, url },
				]),
			]),
		],
	};
}

/**
 * The category index.
 *
 * No `aggregateRating`: the votes here are boolean "I switched" events with no
 * scale behind them, and inventing a number out of them is how a catalogue
 * earns a manual action. `CollectionPage` is the honest description of what this
 * is — a list of pages — and `BreadcrumbList` is the part that still earns a
 * rich result.
 */
export function categoriesMeta(
	lang: Lang,
	categories: number,
	products: number,
	rows?: ListRow[],
): Meta {
	const title =
		lang === "fr"
			? `Les ${categories} catégories — alternatives open source (${YEAR})`
			: `All ${categories} categories — open source alternatives (${YEAR})`;
	const name =
		title.length <= TITLE_MAX ? title : title.replace(` (${YEAR})`, "");
	const description = clamp(
		lang === "fr"
			? `${products} produits payants répartis en ${categories} catégories, regroupées par thème, avec pour chacune l'échelle de sortie et le prix médian.`
			: `${products} paid products across ${categories} categories, grouped by theme, each with its exit ladder and median price.`,
	);
	const url = paths.categories(lang);
	return {
		title: name,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name,
					description,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, name, rows),
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: CATEGORIES_LABEL[lang], url },
				]),
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
 *
 * The `WebSite` and `Organization` nodes are declared on page 1 only, and they
 * are byte-identical in both locales, so the two documents that carry them
 * describe one entity rather than two. There is no `BreadcrumbList` here at all:
 * the home page renders no visible trail, and markup for a breadcrumb a reader
 * cannot see is the rule that made the old FAQ block a liability.
 */
export const homeMeta = (
	lang: Lang,
	products: number,
	page = 1,
	rows?: ListRow[],
): Meta => {
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
	const url = paths.home(lang, page);
	const name = title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX);
	const clamped = clamp(description);
	return {
		title: name,
		description: clamped,
		canonical: abs(url),
		jsonLd: [
			graph([
				page === 1 ? websiteNode() : null,
				page === 1 ? organizationNode() : null,
				{
					...pageNode({
						url,
						lang,
						name,
						description: clamped,
						type: "CollectionPage",
						mainEntity:
							rows && rows.length > 0 ? nodeId(url, "list") : undefined,
					}),
					// The home page has no visible breadcrumb, so it claims none.
					breadcrumb: undefined,
				},
				itemListNode(url, name, rows),
			]),
		],
	};
};

/**
 * The alternatives index — every open source project, paginated.
 *
 * No `aggregateRating` anywhere on this site: the votes are boolean "I switched"
 * events with no scale behind them, so emitting a rating would mean inventing a
 * number. `CollectionPage` plus `BreadcrumbList` is what these pages honestly
 * are.
 */
export const projectsMeta = (
	lang: Lang,
	projects: number,
	page = 1,
	rows?: ListRow[],
): Meta => {
	const title =
		lang === "fr"
			? page > 1
				? `Projets open source — page ${page}`
				: `Les ${projects} projets open source du catalogue (${YEAR})`
			: page > 1
				? `Open source projects — page ${page}`
				: `All ${projects} open source projects (${YEAR})`;
	const name =
		title.length <= TITLE_MAX ? title : title.replace(` (${YEAR})`, "");
	const url = paths.projects(lang, page);
	const description = clamp(
		lang === "fr"
			? `${projects} projets open source, avec ce que chacun remplace, sa licence, l'effort d'hébergement et l'activité du dépôt.${page > 1 ? ` Page ${page}.` : ""}`
			: `${projects} open source projects, each with what it replaces, its licence, the effort to run it and how alive the repo is.${page > 1 ? ` Page ${page}.` : ""}`,
	);
	return {
		title: name,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name,
					description,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, name, rows),
				// The last rung is THIS page, not page one of the series: the visible
				// trail's final crumb is `aria-current="page"`, and page 7 is not page 1.
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: PROJECTS_LABEL[lang], url },
				]),
			]),
		],
	};
};

/** The index of the derived collections. Thirteen of them; small, and a real hub. */
export const collectionsMeta = (
	lang: Lang,
	collections: number,
	rows?: ListRow[],
): Meta => {
	const title =
		lang === "fr"
			? "Collections — coupes transversales du catalogue"
			: "Collections — cross-sections of the catalogue";
	const description = clamp(
		lang === "fr"
			? `${collections} collections dérivées du catalogue : ce que vous pouvez auto-héberger, ce qui est open source, ce qui est libre sans contrepartie, ce qui est open core, ce qui n’est pas open source, et ce qui a une alternative payante moins chère.`
			: `${collections} collections derived from the catalogue: what you can self-host, what is open source, what is free with no strings, what is open core, what is not open source at all, and what has a cheaper paid alternative.`,
	);
	const url = paths.collections(lang);
	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name: title,
					description,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, title, rows),
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: COLLECTIONS_LABEL[lang], url },
				]),
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
	groupLabel: string,
	products: number,
	categories: number,
	lang: Lang,
	rows?: ListRow[],
): Meta => {
	const title =
		lang === "fr"
			? `${groupLabel} : ${products} produits et leurs alternatives open source`
			: `${groupLabel}: ${products} products and their open source alternatives`;
	const description =
		lang === "fr"
			? `${products} produits payants répartis sur ${categories} catégories, chacun avec un verdict honnête : le remplaçant open source tient-il la route, et que coûte la migration ?`
			: `${products} paid products across ${categories} categories, each with an honest verdict: is the open source replacement good enough yet, and what does switching cost?`;
	const url = paths.group(lang, group);
	const name = title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX);
	const clamped = clamp(description);
	return {
		title: name,
		description: clamped,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name,
					description: clamped,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, name, rows),
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: CATEGORIES_LABEL[lang], url: paths.categories(lang) },
					{ name: groupLabel, url },
				]),
			]),
		],
	};
};

/**
 * The collection's title phrase, for the page's own `<h1>`.
 *
 * The page used to head itself "FOSS" under a title reading "Free and open
 * source: 3,056 projects…", which gave Google nothing to confirm the title
 * against. The short word survives as the eyebrow above it.
 */
export const collectionHeading = (
	slug: string,
	lang: Lang,
	members: number,
): string | null => {
	const copy = COLLECTION_COPY[slug]?.[lang];
	return copy ? copy.title.replace("{n}", String(members)) : null;
};

export const collectionMeta = (
	slug: string,
	lang: Lang,
	members: number,
	page = 1,
	rows?: ListRow[],
): Meta => {
	const copy = COLLECTION_COPY[slug]?.[lang];
	const name = copy
		? copy.title.replace("{n}", String(members))
		: `${slug} (${members})`;
	const title = page > 1 ? `${name} — page ${page}` : name;
	const url = paths.collection(lang, slug, page);
	const description = clamp(
		(copy?.description ?? "").replace("{n}", String(members)) +
			(page > 1 ? ` Page ${page}.` : ""),
	);
	const clamped = title.length <= TITLE_MAX ? title : clamp(title, TITLE_MAX);
	return {
		title: clamped,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({
					url,
					lang,
					name: clamped,
					description,
					type: "CollectionPage",
					mainEntity: rows && rows.length > 0 ? nodeId(url, "list") : undefined,
				}),
				itemListNode(url, clamped, rows),
				// The visible last crumb is the collection's SHORT name — "The
				// expensive ones", not the 46-word title phrase — and on page 7 it is
				// page 7, not page 1.
				breadcrumbNode(url, [
					{ name: HOME_LABEL[lang], url: paths.home(lang) },
					{ name: COLLECTIONS_LABEL[lang], url: paths.collections(lang) },
					{ name: label(lang, `collection.${slug}.title`), url },
				]),
			]),
		],
	};
};

/* ------------------------------------------------------------------ */
/* Standing and legal pages                                            */
/* ------------------------------------------------------------------ */

/**
 * The crumb each standing page actually renders as its last rung, read from the
 * table the page reads.
 *
 * `null` means the page renders NO visible breadcrumb, so it emits none either:
 * contact hides its whole heading block, and the three session-gated pages have
 * never had a trail. A `BreadcrumbList` over a trail nobody can see is the same
 * hidden-content rule as the FAQ block, eight pages instead of 1,184.
 */
const STANDING_CRUMB: Record<string, string | null> = {
	sponsor: "nav.sponsor",
	submit: "nav.submit",
	stats: "nav.stats",
	features: "nav.features",
	glossary: "glossary.title",
	gaps: "gaps.title",
	contact: null,
	signin: null,
	dashboard: null,
	admin: null,
};

/**
 * The standing pages. Each one is a page because it needs to be linkable,
 * shareable and indexable — which means each one needs its own title and
 * description, not the home page's.
 */
export const standingMeta = (
	page:
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
): Meta => {
	const copy = {
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
				"Sixteen terms defined once and applied the same way to all products: what “almost” means, what “open core” costs you, and when a repo counts as archived.",
			],
			fr: [
				"Ce que les mots veulent dire — le vocabulaire du catalogue",
				"Seize termes définis une fois et appliqués de la même façon à tous les produits : ce que veut dire « presque », ce que coûte l’open core, et quand un dépôt est considéré comme archivé.",
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
		// No postal address and no phone number in the markup: neither exists on
		// this page, and inventing one to satisfy a schema validator would be the
		// same class of lie as an unpriced slot rendering as free. The publisher's
		// real details are on the legal notice and in the `Organization` node the
		// home page carries.
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
	const title =
		copy[0].length <= TITLE_MAX ? copy[0] : clamp(copy[0], TITLE_MAX);
	const description = clamp(copy[1]);
	const crumb = STANDING_CRUMB[page];

	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				{
					...pageNode({ url, lang, name: title, description }),
					breadcrumb: crumb ? { "@id": nodeId(url, "breadcrumb") } : undefined,
					mainEntity:
						page === "glossary"
							? { "@id": nodeId(url, "glossary") }
							: undefined,
				},
				page === "glossary" ? definedTermSetNode(lang) : null,
				crumb
					? breadcrumbNode(url, [
							{ name: HOME_LABEL[lang], url: paths.home(lang) },
							{ name: label(lang, crumb), url },
						])
					: null,
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
	// These pages are the one place the visible trail does NOT start at "All
	// products" — `LegalPage` heads it "Home". The markup follows the page.
	const trail = [
		{ name: lang === "fr" ? "Accueil" : "Home", url: paths.home(lang) },
		{ name: legalCopy(undefined, lang).title, url: paths.legal(lang) },
	];
	if (doc) trail.push({ name: copy.title, url });
	const title =
		copy.title.length <= TITLE_MAX ? copy.title : clamp(copy.title, TITLE_MAX);
	const description = clamp(copy.description);
	return {
		title,
		description,
		canonical: abs(url),
		jsonLd: [
			graph([
				pageNode({ url, lang, name: title, description }),
				breadcrumbNode(url, trail),
			]),
		],
	};
};

/* ------------------------------------------------------------------ */
/* Applying it to a live document                                      */
/* ------------------------------------------------------------------ */

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
