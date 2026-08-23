/**
 * The pages behind the URLs. Every one of them is prerendered at build time and
 * hydrated here, so what a crawler reads and what a reader sees are the same
 * document.
 *
 * The one rule: every internal href comes from `paths` in core, never from a
 * template literal. The prerenderer builds its links the same way, so a link
 * written here can never point at a URL that was not generated.
 */

import {
	byWeight,
	COLLECTIONS,
	collectionBySlug,
	collectionMembers,
	memberCount,
	type Openness,
	openness,
	pageBounds,
	pageSlice,
} from "core/src/collections";
import type {
	Alternative,
	Category,
	CategoryGroup,
	CategoryStat,
	Project,
} from "core/src/content";
import {
	byGroup,
	CATEGORY_GROUPS,
	priceState,
	projectSlug,
	stackCover,
} from "core/src/content";
import type { Lang } from "core/src/index";
import { paths } from "core/src/routes";
import { ChevronRight, ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import {
	type AdStats,
	type Campaigns,
	healthOf,
	homepageOf,
	type ListedProduct,
	outboundUrl,
	type SiteStats,
	type Slot,
	type Team,
} from "./api";
import {
	applyProductFilters,
	applyProjectFilters,
	Choice,
	effortOptions,
	Hidden,
	isFiltered,
	isProjectFiltered,
	NO_FILTERS,
	NO_PROJECT_FILTERS,
	opennessOptions,
	PageCount,
	Pager,
	type ProductFilters,
	type ProjectFilters,
	priceOptions,
	ResultsLive,
} from "./browse";
import {
	byWeight as byProductCount,
	CategoryMenu,
	CheapestEscape,
	medianLabel,
	RungBar,
	RungLegend,
} from "./categories";
import { categoryIcon } from "./categoryIcons";
import {
	AlternativeList,
	DefaultsTable,
	ExitLadder,
	FactMarks,
	GRID_1COL,
	hostOf,
	OpenCorePanel,
	PriceBlock,
	ProductEscapeStats,
	ProductFaq,
	ProductLogo,
	RepoFreshness,
	SpecStrip,
	Tag,
	VerdictMark,
	VerdictSentence,
	VerdictStamp,
	WhatYouLose,
} from "./components";
import { CATEGORY_FILE, EditThisPage, productFile, REPO } from "./contribute";
import type { Key } from "./i18n";
import { ForgeIcon } from "./icons";
import { legalCopy } from "./legal";
import { MEASURE, priceLabel } from "./listShared";
import { Link } from "./nav";
import { ProjectFeatures } from "./ProjectFeatures";
import { ReplaceMatrix } from "./ReplaceMatrix";
import {
	collectionHeading,
	distinctNames,
	GLOSSARY_GROUPS,
	glossaryAnchor,
} from "./seo";
import { type Crumb, Heading, PageShell, Section } from "./shell";

export type PageCtx = {
	lang: Lang;
	t: (k: Key) => string;
	tc: (v: { en: string }) => string;
	products: ListedProduct[];
	categories: Category[];
	/**
	 * Every project, derived from `products` and ordered most-cited first. Holds
	 * only what this page's slice of the catalogue cites until the API answers —
	 * `wholeCatalogue` below is how a page knows which of the two it has.
	 */
	projects: Project[];
	/**
	 * True once `products` is the entire catalogue rather than one page's payload.
	 *
	 * The index pages need this. They paginate, and slicing page 3 out of a
	 * 48-entry payload that IS page 3 would render nothing — so when it is false
	 * they render what they were given, and when it is true they slice. Both
	 * produce the same rows for the URL that was loaded, which is what hydration
	 * requires.
	 */
	wholeCatalogue: boolean;
	/**
	 * The other products in this product's category, on a product page only.
	 *
	 * Not derivable in the browser: a product page's payload is one product, so
	 * before this the page linked to eighteen projects, one category, one theme
	 * and zero other products — 0 of 592 pages had a lateral path through the
	 * catalogue. Built by `relatedProducts` in listShared.tsx at build time.
	 */
	related: ListedProduct[];
	/** `[slug, name, category]` for every product, on the products index only. */
	productIndex: [string, string, string][];
	/** Pre-derived rows for an index whose rows are projects, before the API answers. */
	projectRows: Project[];
	/** How many projects exist in total, so a partial payload can still paginate. */
	projectTotal: number;
	/** Members per collection over the whole catalogue, so its pager can exist. */
	collectionCounts: Map<string, number>;
	/** Projects whose citations disagree, baked for page 1 of a collection. */
	unresolvedRows: Project[];
	/** Derived from the products, keyed by the pretty slug the URLs use. */
	projectBySlug: Map<string, Project>;
	/** Forge id → pretty slug, so an alternative can link to its project page. */
	projectSlugs: Map<string, string>;
	onVote: (slug: string) => void;
	voted: Set<string>;
	/** Ad inventory, for the standing sponsor page. Empty until the API answers. */
	slots: Slot[];
	/** Audience numbers, or null while they are still loading. */
	adStats: AdStats | null;
	/**
	 * Site traffic from our own Umami, `{ unavailable: true }` when analytics is
	 * off or unreachable, and null until the request answers. Three states, and
	 * the stats page must render a different thing for each — a zero is never one
	 * of them.
	 */
	siteStats: SiteStats | { unavailable: true } | null;
	/** The signed-in advertiser's placements, or null when nobody is signed in. */
	campaigns: Campaigns | null;
	campaignsLoading: boolean;
	/** Re-read the board after a purchase, so every ad unit updates in place. */
	onPurchased: () => void;
	team: Team | null;
	onTeamChanged: () => void;
	onSignOut: () => void;
	/**
	 * Counts, ladder split, median price and cheapest escape per category — all
	 * derived from the products by `categoryStats` in core, never authored.
	 */
	stats: Map<string, CategoryStat>;
};

/** The trail every page starts from. Spread, never mutated. */
const homeCrumb = (ctx: PageCtx): Crumb => ({
	label: ctx.t("page.home"),
	href: paths.home(ctx.lang),
});

/** The data arrives after the first paint; say nothing rather than "not found". */
function Pending({ ctx, empty }: { ctx: PageCtx; empty: boolean }) {
	return (
		<PageShell trail={[homeCrumb(ctx)]}>
			<p className="py-16 text-center text-muted text-sm">
				{ctx.t(empty ? "page.notFound" : "page.loading")}
			</p>
		</PageShell>
	);
}

/**
 * Themes whose products are accounts-and-teams shaped, so the crosscutting
 * feature vocabulary (auth, collab, data) actually applies to them.
 */
const MATRIX_GROUPS = new Set<string>([
	"work",
	"growth",
	"commerce",
	"operations",
]);

/** Themes holding both hosted services and local tools; each block self-suppresses. */
const BOTH_GROUPS = new Set<string>(["infra", "ai-data", "security"]);

export function ProductPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, tc, lang, products, categories } = ctx;
	const product = products.find((p) => p.slug === slug);
	// `empty` is "we have the whole catalogue and it is not in it", not "we have
	// some products": a client-side navigation can land here with only the slice
	// the previous document shipped, and that is loading, not a 404.
	if (!product) return <Pending ctx={ctx} empty={ctx.wholeCatalogue} />;

	const category = categories.find((c) => c.slug === product.category);

	// An open source alternative is also a project with a page of its own; that
	// link is the only inbound one most project pages will ever get.
	const projectHref = (alt: Alternative): string | undefined => {
		if (alt.kind !== "oss") return undefined;
		const pretty = ctx.projectSlugs.get(projectSlug(alt.source));
		return pretty ? paths.project(lang, pretty) : undefined;
	};

	/**
	 * The other products filed under the same category.
	 *
	 * Baked into the payload by `relatedProducts`, because a product page ships
	 * exactly one product and this cannot be derived from it. The measured state
	 * before this was 0 product-to-product links across all 592 pages: there was
	 * no way to travel sideways through the catalogue at all, so every journey
	 * had to go back up through the nav. The filter below is the dev-server and
	 * post-API path, where the whole catalogue is in hand.
	 */
	const siblings =
		ctx.related.length > 0
			? ctx.related
			: category
				? products.filter(
						(p) => p.category === category.slug && p.slug !== slug,
					)
				: [];

	/**
	 * The collections this product qualifies for.
	 *
	 * Membership was one-way: collection pages emit 11,607 product links and got
	 * none back. Answered by `collectionMembers` itself, run over this one
	 * product, so a page can never claim a membership the collection would
	 * refuse — or miss one it would grant.
	 */
	const inCollections = COLLECTIONS.filter(
		(c) =>
			c.of === "product" &&
			collectionMembers(c.slug, [product], []).products.length > 0,
	);

	return (
		<PageShell
			trail={[
				homeCrumb(ctx),
				// The one path prefix this URL actually contains. The trail walked
				// `/themes/` and `/categories/`, neither of which appears in
				// `/en/alternatives/1password`, and skipped the segment that does —
				// which is also the directory that answered 403 to path-trimming.
				{ label: t("page.products"), href: paths.products(lang) },
				// The theme sits between the index and the category, which is the
				// shape the taxonomy always had — a reader on Claude Code is under
				// AI, and AI is under AI & data. One more real rung for a reader and
				// for a crawler, now that the hub exists to point at.
				...(category
					? [
							{
								label: t(`catGroup.${category.group}` as Key),
								href: paths.group(lang, category.group),
							},
							{
								label: tc(category.name),
								href: paths.category(lang, category.slug),
							},
						]
					: []),
				{ label: product.name },
			]}
			icon={<ProductLogo product={product} size={52} eager />}
			/**
			 * The phrase people search, not the phrase the brand says.
			 *
			 * "Can I replace Notion?" occupied the strongest element on all 592
			 * money pages and matches no query anyone types; the `<title>` above it
			 * already said "open source Notion alternatives" and the heading gave
			 * Google nothing to confirm it against. Same treatment the category,
			 * theme and collection pages already had. The slogan is one line below
			 * and still the sentence the page answers.
			 */
			title={t("product.h1").replace("{name}", product.name)}
			lede={
				<>
					{t("hero.title")} {product.name}
					{lang === "fr" ? " ?" : "?"}
				</>
			}
			aside={<VerdictStamp verdict={product.verdict} t={t} />}
			meta={
				<p className="nums flex flex-wrap items-center gap-x-4 gap-y-2 text-muted text-sm">
					<VerdictMark verdict={product.verdict} t={t} lang={lang} />
					{product.switchedCount > 0 ? (
						<span>
							{product.switchedCount}{" "}
							{t(
								product.switchedCount === 1
									? "stats.switchesOne"
									: "stats.switches",
							)}
						</span>
					) : (
						// A published 0 reads as "broken"; the report-a-switch button in
						// the rail is the real flow, so link straight to it.
						<a href="#report-switch" className="hover:underline">
							{t("stats.switchesNone")}
						</a>
					)}
					{category && (
						<Link
							href={paths.category(lang, category.slug)}
							className="pill text-[var(--accent)]"
						>
							{tc(category.name)}
						</Link>
					)}
				</p>
			}
		>
			{/*
			 * Two columns above `lg`: the argument reads down the left, and the two
			 * things a reader acts on — what it costs today, and the button that says
			 * they left — stay in view beside it rather than being scrolled past.
			 * Below `lg` it is the same single stack it always was, price first.
			 */}
			<article className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_17rem] lg:gap-10">
				<div className="min-w-0 space-y-8">
					{/* The answer first, then the argument. */}
					<div className="space-y-3">
						<VerdictSentence product={product} t={t} tc={tc} />
						<p className="text-pretty leading-relaxed">{tc(product.why)}</p>
					</div>

					<WhatYouLose product={product} t={t} tc={tc} />

					<ExitLadder
						product={product}
						t={t}
						tc={tc}
						lang={lang}
						projectHref={projectHref}
					/>

					{/* The shape of the escape, before the cards. The category page has
					    had a strip like this for a while and it is the clearest thing on
					    the site; the product page — which is where the organic traffic
					    actually lands — had nothing equivalent. */}
					<ProductEscapeStats product={product} t={t} />

					<AlternativeList
						product={product}
						t={t}
						tc={tc}
						lang={lang}
						projectHref={projectHref}
					/>

					{/* The four questions the deleted FAQPage markup used to describe to
					    a machine and to nobody else. Same questions, real DOM, no
					    schema — see `ProductFaq`. */}
					<ProductFaq product={product} t={t} tc={tc} lang={lang} />

					{/*
					 * Which comparison this category earns.
					 *
					 * The 137-key vocabulary asks about SSO, roles and teams. Those are
					 * real questions for hosted, multi-user SaaS and category errors for
					 * a terminal tool or a 3D package — asking a CLI whether it does
					 * SAML is how the Claude Code page ended up publishing
					 * "Has AI features: ● ● ● ●".
					 *
					 * So: themes whose products are accounts-and-teams shaped get the
					 * feature matrix; the rest get the spec strip, which compares on
					 * licence, effort, language and strings — all populated for
					 * everyone. `infra` and `ai-data` get both: they contain hosted
					 * services AND local tools, and each block suppresses itself when
					 * it has nothing to say.
					 */}
					{(category === undefined ||
						MATRIX_GROUPS.has(category.group) ||
						BOTH_GROUPS.has(category.group)) && (
						<ReplaceMatrix product={product} lang={lang} t={t} tc={tc} />
					)}
					{category !== undefined && !MATRIX_GROUPS.has(category.group) && (
						<SpecStrip alternatives={product.alternatives} t={t} />
					)}
				</div>

				<aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start">
					{/* The price is the claim this site is judged on, so it shows its
					    working rather than sitting in a meta row. */}
					<section className="card p-4">
						<Heading>{t("price.heading")}</Heading>
						<PriceBlock product={product} t={t} lang={lang} />
					</section>

					<button
						id="report-switch"
						type="button"
						disabled={ctx.voted.has(product.slug)}
						onClick={() => ctx.onVote(product.slug)}
						aria-label={`${t("row.switched")} — ${product.name}`}
						className="w-full rounded-[calc(var(--radius))] border px-3 py-2.5 text-sm transition disabled:opacity-50"
						style={{ borderColor: "var(--v-yes)", color: "var(--v-yes)" }}
					>
						↺{" "}
						{t(
							ctx.voted.has(product.slug) ? "row.switchedDone" : "row.switched",
						)}
					</button>

					{/* One product, one file. This is the whole admin panel. */}
					<EditThisPage file={productFile(product.slug)} t={t} />
				</aside>
			</article>

			{/* Sideways, not just back. Capped at six so it stays a suggestion rather
			    than a second copy of the category page it links to. */}
			{category && siblings.length > 0 && (
				<Section
					title={t("product.related").replace("{category}", tc(category.name))}
					actions={
						<Link
							href={paths.category(lang, category.slug)}
							className="text-brand text-sm hover:underline"
						>
							{tc(category.name)} →
						</Link>
					}
				>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{siblings.slice(0, 6).map((p) => (
							<ProductCard key={p.slug} product={p} ctx={ctx} />
						))}
					</ul>
				</Section>
			)}

			{/* The way back up into the derived slices this product belongs to. */}
			{inCollections.length > 0 && (
				<section className="mt-10">
					<Heading>{t("product.inCollections")}</Heading>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{inCollections.map((c) => (
							<li key={c.slug}>
								<Link href={paths.collection(lang, c.slug)} className="pill">
									{t(`collection.${c.slug}.title` as Key)}
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</PageShell>
	);
}

export function ProjectPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, tc, lang } = ctx;
	const project = ctx.projectBySlug.get(slug);
	if (!project) return <Pending ctx={ctx} empty={ctx.wholeCatalogue} />;
	const health = healthOf(project.source);
	const homepage = homepageOf(project.source);
	// The categories of the products citing this project — gates which vertical
	// feature domains apply. `Project` carries `replaces`, not categories, so the
	// join happens here rather than in core.
	const projectCategories = [
		...new Set(
			project.replaces
				.map((r) => ctx.products.find((p) => p.slug === r.slug)?.category)
				.filter((c): c is string => Boolean(c)),
		),
	];

	// A link out is a link out: styled as a chip so the three of them read as one
	// row of destinations rather than three differently-shaped sentences.
	const outLink =
		"pill max-w-full min-w-0 hover:border-[var(--accent)] hover:text-[var(--accent)]";

	return (
		<PageShell
			trail={[
				homeCrumb(ctx),
				{ label: t("page.projects"), href: paths.projects(lang) },
				{ label: project.name },
			]}
			eyebrow={t(`effort.${project.effort}` as Key)}
			// "2fa" told a searcher nothing and told Google nothing about the title
			// it sits under. The name still leads the phrase.
			//
			// Two names, and never the same product twice: `replaces` holds both
			// "Autodesk Flow Production Tracking" and "Autodesk Flow Production
			// Tracking (ShotGrid)" — one product under its old and new names — which
			// is what put the same words twice in a 106-character heading.
			title={t("project.h1")
				.replace("{name}", project.name)
				.replace(
					"{replaces}",
					distinctNames(project.replaces.map((r) => r.name))
						.slice(0, 2)
						.join(", "),
				)}
			meta={
				<div className="space-y-3">
					<p className="flex flex-wrap items-center gap-2 text-sm">
						{/* External, so a real target and rel — not a client transition. */}
						<a
							href={outboundUrl(project.source.url, "repo")}
							target="_blank"
							rel="noopener"
							className={outLink}
						>
							<ForgeIcon host={project.source.host} />
							<span className="truncate">
								{project.source.host}/{project.source.path}
							</span>
							<ExternalLink className="size-3 shrink-0" aria-hidden />
						</a>
						{/* The docs and the install instructions are usually here rather
						    than on the forge. Absent when the repo declares no site, or
						    declares the repo itself — see `homepageOf`. */}
						{homepage && (
							<a
								href={outboundUrl(homepage, "homepage")}
								target="_blank"
								rel="noopener"
								className={outLink}
							>
								<Globe className="size-3.5 shrink-0" aria-hidden />
								<span className="truncate">{hostOf(homepage)}</span>
								<ExternalLink className="size-3 shrink-0" aria-hidden />
							</a>
						)}
					</p>
					{/* What the project IS, in one scannable row: licence, self-hosting,
					    SSO, residency, then the repo readings. `full` so the facts nobody
					    has checked say so here — this is the page with room for it, and
					    "not checked" is a different answer from "no".

					    `RepoFreshness` renders nothing at all when there is no reading —
					    a repo we cannot see is not a repo with no activity — so the row
					    can shorten to the editorial facts without leaving a gap. */}
					<p className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted uppercase tracking-wider">
						<FactMarks
							facts={project.facts}
							license={project.license}
							vary={project.factsVary}
							t={t}
							lang={lang}
							full
						/>
						<RepoFreshness
							source={project.source}
							t={t}
							lang={lang}
							archived={project.archived}
							full
						/>
					</p>
				</div>
			}
		>
			<article className="space-y-2">
				{/* Above everything, not beside it: somebody has to see this before
				    they read a page recommending it. */}
				{(health?.archived ?? project.archived) && (
					<p
						className="mb-6 rounded-[calc(var(--radius))] border p-4 text-sm"
						style={{
							borderColor: "var(--v-no)",
							color: "var(--v-no)",
							background: "color-mix(in srgb, var(--v-no) 7%, transparent)",
						}}
					>
						<strong>{t("repo.archived")}.</strong> {t("repo.archivedNote")}
					</p>
				)}

				{/* The one distinction the whole site turns on, given its own block
				    rather than a place in the row above. */}
				<section>
					<Heading>{t("facts.heading")}</Heading>
					<OpenCorePanel
						facts={project.facts}
						t={t}
						tc={tc}
						vary={project.factsVary}
					/>
				</section>

				{/* Sibling projects, which is the whole point of this addition.
			    2069 of the 3257 project pages replace exactly one product, so they
			    repeat what the product page already said and are `noindex` for it.
			    These two blocks are the only things such a page can say that the
			    product page cannot: what else is written in this language, and what
			    else does this job. */}
				<Siblings project={project} ctx={ctx} />

				{/* Where this project sits. A project page carried 4.8 content links,
				    composed of one product, the home page and the tools index — zero
				    category, collection or theme links, so nothing here belonged to
				    anything. */}
				<ProjectPlaces
					project={project}
					categories={projectCategories}
					ctx={ctx}
				/>

				<Section title={t("page.replaces")} count={project.replaces.length}>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{project.replaces.map((r) => (
							<li key={r.slug} className="card card-link">
								<Link href={paths.product(lang, r.slug)} className="block p-4">
									<span className="font-display font-semibold">{r.name}</span>
									{r.note && (
										<span className="mt-1.5 block text-muted text-sm">
											{tc(r.note)}
										</span>
									)}
								</Link>
							</li>
						))}
					</ul>
				</Section>

				<ProjectFeatures
					source={project.source}
					name={project.name}
					categories={projectCategories}
					lang={lang}
					t={t}
					tc={tc}
				/>

				{/*
				 * A project page is derived from every product that cites it, so there
				 * is no one file behind it — except when exactly one product does, in
				 * which case that file IS the page and we can open it directly.
				 */}
				<div className="mt-10">
					<EditThisPage
						file={
							project.replaces.length === 1
								? productFile(project.replaces[0].slug)
								: null
						}
						t={t}
					/>
				</div>
			</article>
		</PageShell>
	);
}

/**
 * The compact product row, shared by the category pages and the collections.
 *
 * Every figure on it comes off the entry itself — the price it carries and the
 * alternatives it lists — so the card can never claim something the product page
 * behind it does not.
 */
export function ProductCard({
	product,
	ctx,
}: {
	product: ListedProduct;
	ctx: PageCtx;
}) {
	const { t, lang } = ctx;
	const oss = product.alternatives.filter((a) => a.kind === "oss").length;
	return (
		<li className="card card-link">
			<Link
				href={paths.product(lang, product.slug)}
				className="flex items-center gap-3 p-3.5"
			>
				<ProductLogo product={product} size={32} />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-display font-semibold">
						{product.name}
					</span>
					<span className="nums block truncate text-muted text-xs">
						{priceLabel(product, lang, t)} · {oss} {t("row.alternatives")}
					</span>
				</span>
				<VerdictMark verdict={product.verdict} t={t} />
			</Link>
		</li>
	);
}

/** One derived figure, labelled. Never rendered when the figure is unknown. */
const Figure = ({
	value,
	label,
}: {
	value: React.ReactNode;
	label: string;
}) => (
	/* dt before dd, per the content model; column-reverse keeps the figure on
	   top where the design puts it. */
	<div className="flex flex-col-reverse">
		<dt className="mt-0.5 text-[10px] uppercase tracking-widest text-muted">
			{label}
		</dt>
		<dd className="nums text-lg font-bold">{value}</dd>
	</div>
);

/**
 * The categories filed either side of this one by the authored `position`.
 *
 * Position is the editorial grouping — the infrastructure categories run
 * together, then the business ones, then the creative ones — so a neighbour is a
 * genuinely adjacent subject rather than a random other page. That is the whole
 * test for a cross-link: it has to be somewhere a reader might actually want to
 * go next, or it is link padding.
 */
const NEIGHBOURS = 4;

function neighboursOf(categories: Category[], slug: string): Category[] {
	const ordered = [...categories].sort((a, b) => a.position - b.position);
	const i = ordered.findIndex((c) => c.slug === slug);
	if (i === -1) return [];
	const half = NEIGHBOURS / 2;
	// Slide the window at the ends rather than returning a short one.
	const start = Math.max(
		0,
		Math.min(i - half, ordered.length - NEIGHBOURS - 1),
	);
	return ordered
		.slice(start, start + NEIGHBOURS + 1)
		.filter((c) => c.slug !== slug);
}

export function CategoryPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, tc, lang, products, categories, stats } = ctx;
	const category = categories.find((c) => c.slug === slug);
	const inCat = products.filter((p) => p.category === slug);
	if (!category) return <Pending ctx={ctx} empty={categories.length > 0} />;

	const stat = stats.get(slug);
	const Icon = categoryIcon(category.icon);
	const name = tc(category.name);
	const neighbours = neighboursOf(categories, slug);

	return (
		<PageShell
			measure={MEASURE}
			trail={[
				homeCrumb(ctx),
				{ label: t("page.categories"), href: paths.categories(lang) },
				{ label: name },
			]}
			eyebrow={t("page.categories")}
			icon={
				<span
					className="grid size-11 shrink-0 place-items-center rounded-[calc(var(--radius))] border border-border"
					style={{
						background: "color-mix(in srgb, var(--brand) 10%, var(--surface))",
					}}
				>
					<Icon className="size-5 text-brand" aria-hidden />
				</span>
			}
			/**
			 * The title phrase, not the bare category word.
			 *
			 * `<h1>AI</h1>` under `<title>8 open source AI alternatives</title>` gave
			 * Google nothing to confirm the title against, which is what makes a
			 * rewritten SERP title likely. The category word is still the first thing
			 * a reader sees — it is inside the phrase, and the icon and the trail
			 * carry it too.
			 */
			title={t("cats.h1").replace("{name}", name)}
			meta={
				// Everything here is computed from the entries below it, so the page
				// cannot claim a figure the list does not support.
				stat && (
					<div className="panel space-y-4 p-4">
						<dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
							<Figure value={stat.products} label={t("stats.products")} />
							<Figure value={stat.projects} label={t("cats.projects")} />
							<Figure
								value={medianLabel(stat, lang, t)}
								label={
									stat.medianPrice === null
										? t("cats.medianPrice")
										: `${t("cats.medianOver")} ${stat.pricedProducts}`
								}
							/>
							<Figure
								value={
									<span className="font-medium text-sm">
										<CheapestEscape
											stat={stat}
											lang={lang}
											t={t}
											projectSlugs={ctx.projectSlugs}
										/>
									</span>
								}
								label={t("cats.cheapest")}
							/>
						</dl>
						<div className="border-border border-t pt-3">
							<Heading>{t("cats.ladder")}</Heading>
							<RungLegend stat={stat} t={t} />
						</div>
					</div>
				)
			}
		>
			<CategoryMenu
				cats={categories}
				stats={stats}
				lang={lang}
				t={t}
				tc={tc}
				current={slug}
			/>

			{/*
			 * SPONSORSHIP MOUNT POINT — owned by the sponsorship work, not this file's
			 * author. The per-category slot (`placement: "category"`, `category: slug`)
			 * belongs here, between the menu and the product list: above the fold on a
			 * phone, and clearly separated from the entries so a paid unit never reads
			 * as a verdict. Drop a <SponsorSlot slot={…} /> in and nothing else on this
			 * page has to move.
			 */}

			{/* For a category of things that ship with the system, the mapping IS
			    the page: "cd → zoxide" is one line and should take one line.
			    Self-suppresses everywhere else. */}
			<DefaultsTable products={inCat} t={t} tc={tc} lang={lang} />

			<Section title={t("cats.inThis")} count={inCat.length}>
				<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
					{inCat.map((p) => (
						<ProductCard key={p.slug} product={p} ctx={ctx} />
					))}
				</ul>
				{/* Honest orientation for the 17 categories holding two products or
				    fewer, which stay `noindex` by the rule in prerender.ts. It tells a
				    reader who landed here where to go next instead of padding the page
				    with text to game a threshold. */}
				{inCat.length > 0 && inCat.length < 3 && (
					<p className="mt-3 text-muted text-sm">{t("cats.smallNote")}</p>
				)}
			</Section>

			{neighbours.length > 0 && (
				<Section
					title={t("cats.nearby")}
					actions={
						<Link
							href={paths.categories(lang)}
							className="text-brand text-sm hover:underline"
						>
							{t("cats.all")} →
						</Link>
					}
				>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{neighbours.map((c) => {
							const s = stats.get(c.slug);
							const NIcon = categoryIcon(c.icon);
							return (
								<li key={c.slug} className="card card-link">
									<Link
										href={paths.category(lang, c.slug)}
										className="flex items-center gap-3 p-3.5"
									>
										<NIcon className="size-4 shrink-0 text-brand" aria-hidden />
										<span className="min-w-0 flex-1 truncate font-medium text-sm">
											{tc(c.name)}
										</span>
										<span className="nums text-muted text-xs">
											{s?.products ?? 0}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</Section>
			)}

			<EditThisPage file={CATEGORY_FILE} t={t} className="mt-10" />
		</PageShell>
	);
}

/** Prefix for the section ids the jump bar points at. Namespaced, because a
 *  theme slug like "home" would otherwise collide with anything else on the page. */
const GROUP_ID = "theme-";

/** One category's row: the link, the figures, the ladder, the cheapest way out. */
function CategoryRow({ cat, ctx }: { cat: Category; ctx: PageCtx }) {
	const { t, tc, lang, stats } = ctx;
	const stat = stats.get(cat.slug) as CategoryStat;
	const Icon = categoryIcon(cat.icon);
	return (
		<li className="card p-4">
			{/* The name is the link; the figures beside it are text, so a reader is
			    never made to click a number to read it. */}
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<Link
					href={paths.category(lang, cat.slug)}
					className="flex min-w-0 items-center gap-2 font-display font-semibold hover:underline"
				>
					<Icon className="size-4 shrink-0 text-brand" aria-hidden />
					{tc(cat.name)}
				</Link>
				<p className="nums text-xs text-muted">
					{stat.products} {t("stats.products")} · {stat.projects}{" "}
					{t("cats.projects")} · {medianLabel(stat, lang, t)}
				</p>
			</div>

			<div className="mt-2.5 grid gap-2.5 sm:grid-cols-[1fr_auto] sm:items-center">
				<RungBar stat={stat} t={t} />
				<p className="truncate text-xs">
					<span className="text-muted">{t("cats.cheapest")}: </span>
					<CheapestEscape
						stat={stat}
						lang={lang}
						t={t}
						projectSlugs={ctx.projectSlugs}
					/>
				</p>
			</div>
		</li>
	);
}

/**
 * All 84, one row each, in ten themed sections.
 *
 * WHAT CHANGED AND WHY. This was one flat ranking of 84 rows. Every figure on it
 * was right and the page was still hard to use: a reader who came for "the
 * infrastructure ones" had to read all of it, because a ranking answers "which
 * is biggest" and nothing else. It is now sectioned by the authored `group` — a
 * field on the category, not a slice of `position`, so a category cannot be
 * moved between themes by somebody inserting a row above it, and `bun run
 * validate` refuses a category that has no theme at all.
 *
 * Inside a theme the order is still the product count, which is the honest
 * ranking: it says where the reading actually is rather than where an editor
 * thinks it should be. Every column the flat page had is still on every row —
 * the derived figures are the reason this page is worth reading and a themed
 * link farm is not.
 *
 * The jump bar at the top is the table of contents ten sections need. It is
 * real `<a href="#…">` anchors, so it works with no JavaScript.
 */
export function CategoriesPage({ ctx }: { ctx: PageCtx }) {
	const { t, lang, categories, stats } = ctx;
	// Only the ones that hold something: an empty category has no page.
	const live = byProductCount(categories, stats).filter(
		(c) => (stats.get(c.slug)?.products ?? 0) > 0,
	);
	if (live.length === 0) return <Pending ctx={ctx} empty={false} />;
	const groups = byGroup(live);

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("page.categories") }]}
			eyebrow={t("cats.browse")}
			title={t("cats.title")}
			lede={t("cats.blurb")}
			meta={
				// The table of contents ten sections need. Real `<a href="#…">`
				// anchors, so it works with no JavaScript; `scroll-padding-top` in
				// index.css keeps the target clear of the sticky header.
				<nav aria-label={t("cats.themes")}>
					<h2 className="eyebrow">{t("cats.themes")}</h2>
					<ul className="mt-2 flex flex-wrap gap-2">
						{groups.map((g) => (
							<li key={g.group}>
								<a href={`#${GROUP_ID}${g.group}`} className="pill">
									{t(`catGroup.${g.group}` as Key)}
									<span className="nums text-muted text-xs">
										{g.cats.length}
									</span>
								</a>
							</li>
						))}
					</ul>
				</nav>
			}
		>
			{groups.map((g) => (
				<section
					key={g.group}
					id={`${GROUP_ID}${g.group}`}
					className="mt-12 first:mt-0"
				>
					<div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-border border-b pb-2">
						<h2 className="font-display font-bold text-xl">
							{/* The heading is the link to the theme's own hub — without
							    this the ten group pages would have no inbound link at
							    all, which is the exact problem they exist to fix. */}
							<Link
								href={paths.group(lang, g.group)}
								className="hover:underline"
							>
								{t(`catGroup.${g.group}` as Key)}
							</Link>
						</h2>
						<p className="nums text-muted text-xs">
							{g.cats.length} {t("cats.inGroup")} ·{" "}
							{g.cats.reduce(
								(n, c) => n + (stats.get(c.slug)?.products ?? 0),
								0,
							)}{" "}
							{t("stats.products")}
						</p>
					</div>
					<ul className="space-y-2">
						{g.cats.map((c) => (
							<CategoryRow key={c.slug} cat={c} ctx={ctx} />
						))}
					</ul>
				</section>
			))}

			<EditThisPage file={CATEGORY_FILE} t={t} className="mt-10" />
		</PageShell>
	);
}

/**
 * The fewest projects that replace the most products.
 *
 * Not a ranking — a cover. ERPNext replaces 30 things, but the second row is not
 * "the project that replaces the second-most", it is "the project that replaces
 * the most of what ERPNext does NOT". That is a different and much more useful
 * question, and it is only answerable because this catalogue has the replaces
 * graph, which is the one thing here nobody else has.
 */
function StackCover({ ctx }: { ctx: PageCtx }) {
	const { t, lang, projects, projectSlugs, products } = ctx;
	if (!ctx.wholeCatalogue) return null;
	const cover = stackCover(projects);
	if (cover.length < 3) return null;
	const reached = cover[cover.length - 1]?.total ?? 0;

	return (
		<section className="mb-6">
			<h2 className="eyebrow">{t("cover.heading")}</h2>
			<p className="mt-1 max-w-2xl text-muted text-sm">
				{t("cover.blurb")
					.replace("{n}", String(cover.length))
					.replace("{covered}", String(reached))
					.replace("{total}", String(products.length))}
			</p>
			<ol className="mt-3 space-y-1">
				{cover.map(({ project, adds, total }, i) => {
					const pretty = projectSlugs.get(project.slug);
					return (
						<li
							key={project.slug}
							className="nums flex flex-wrap items-baseline gap-x-2 text-sm"
						>
							<span className="w-5 text-muted text-xs">{i + 1}.</span>
							{pretty ? (
								<Link
									href={paths.project(lang, pretty)}
									className="font-medium hover:underline"
								>
									{project.name}
								</Link>
							) : (
								<span className="font-medium">{project.name}</span>
							)}
							<span className="text-muted text-xs">
								+{adds} {t("cover.more")}
							</span>
							<span className="ml-auto text-muted text-xs">{total}</span>
						</li>
					);
				})}
			</ol>
		</section>
	);
}

/**
 * The projects that kill the most invoices./**
 * The projects that kill the most invoices.
 *
 * `replaces` is already sorted longest-first by `collectProjects`, so this is a
 * slice rather than a computation. It is here because the alternatives index is
 * 3257 rows of equal visual weight and nothing on it says where to start —
 * ERPNext replacing 30 products is the single most useful fact the page holds
 * and it was invisible.
 */
function MostReplacing({ ctx }: { ctx: PageCtx }) {
	const { t, lang, projects, projectSlugs } = ctx;
	// Needs the whole catalogue to be a ranking rather than a ranking of page 1.
	if (!ctx.wholeCatalogue) return null;
	const top = projects.filter((p) => p.replaces.length > 1).slice(0, 6);
	if (top.length < 3) return null;

	return (
		<section className="mb-6">
			<h2 className="eyebrow">{t("projects.mostReplacing")}</h2>
			<ul className="mt-2 flex flex-wrap gap-2">
				{top.map((p) => {
					const pretty = projectSlugs.get(p.slug);
					const label = (
						<>
							{p.name}
							<span className="nums ml-1.5 text-muted text-xs">
								{p.replaces.length}
							</span>
						</>
					);
					return (
						<li key={p.slug}>
							{pretty ? (
								<Link href={paths.project(lang, pretty)} className="pill">
									{label}
								</Link>
							) : (
								<span className="pill">{label}</span>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}

/**
 * The products with no credible open source replacement, and what each one
 * actually withholds.
 *
 * This is the honest counterweight to a catalogue of 6000-odd recommendations,
 * and it is the page nobody else in this space will publish. It is also
 * entirely derived: `verdict: "not-yet"` is the editorial judgement already
 * made on every product, and `whatYouLose` is already written per entry.
 *
 * NOT an aggregate of recurring themes, which is what this page was first
 * sketched as. Measured: 1661 `whatYouLose` entries across the catalogue reduce
 * to 1625 distinct strings, and only six repeat three times or more. There are
 * no themes to cluster — the phrases are specific because the losses are
 * specific, and inventing categories over them would be the one thing this
 * catalogue must not do.
 */
export function GapsPage({ ctx }: { ctx: PageCtx }) {
	const { t, tc, lang, products, categories } = ctx;
	const gaps = byWeight(products.filter((p) => p.verdict === "not-yet"));
	if (gaps.length === 0)
		return <Pending ctx={ctx} empty={products.length > 0} />;

	const nameOf = (slug: string) =>
		categories.find((c) => c.slug === slug)?.name;

	// Prices we could not confirm on the vendor's own page. `low` first: those
	// are the ones a reader should treat as a hint rather than a quote.
	const unsure = products
		.filter((p) => p.pricing && p.pricing.confidence !== "high")
		.sort((a, b) =>
			a.pricing?.confidence === b.pricing?.confidence
				? a.name.localeCompare(b.name)
				: a.pricing?.confidence === "low"
					? -1
					: 1,
		);
	// Never looked at, which is a different admission from "we looked and were
	// unsure" and must not be folded into it.
	const unchecked = products.filter(
		(p) => priceState(p) === "unverified",
	).length;

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("gaps.title") }]}
			eyebrow={t("gaps.eyebrow")}
			// The count, derived from the list below it rather than written down:
			// "What open source still cannot do" is a thesis statement and nobody's
			// query, on the page with the least competition on the whole site.
			title={t("gaps.h1").replace("{n}", String(gaps.length))}
			lede={t("gaps.blurb")}
			meta={
				<p className="nums text-muted text-sm">
					{gaps.length} {t("stats.products")}
				</p>
			}
		>
			<ul className="space-y-3">
				{gaps.map((p) => {
					const cat = nameOf(p.category);
					return (
						<li key={p.slug} className="card p-4">
							<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
								{/* A real heading, not a bare link in a bullet: 43 entries
								    with one h2 between them gave a crawler nothing to key a
								    passage on and a screen-reader user nothing to jump
								    between. */}
								<h2 className="font-display font-semibold">
									<Link
										href={paths.product(lang, p.slug)}
										className="hover:underline"
									>
										{p.name}
									</Link>
								</h2>
								{cat && (
									<Link
										href={paths.category(lang, p.category)}
										className="text-muted text-xs hover:underline"
									>
										{tc(cat)}
									</Link>
								)}
								<span className="nums ml-auto text-muted text-sm">
									{priceLabel(p, lang, t)}
								</span>
							</div>
							{/* The specific thing that cannot be replaced. This is the whole
							    point of the page: "no alternative" is a claim, and these are
							    the reasons behind it. */}
							{p.whatYouLose.length > 0 && (
								<ul className="mt-2 flex flex-wrap gap-1.5">
									{p.whatYouLose.map((l) => (
										<li key={tc(l)} className="pill text-xs">
											{tc(l)}
										</li>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ul>

			<p className="mt-8 max-w-2xl text-muted text-xs">{t("gaps.footnote")}</p>

			{/*
			 * The second half of being honest: not just what we cannot replace, but
			 * what we are least sure of.
			 *
			 * This was first sketched as a "price freshness" page ranked by how
			 * stale each check was. Measured: every priced product carries the same
			 * `checkedOn` — the catalogue was priced in one sweep — so an age
			 * ranking would be 389 rows of one date. Confidence is the axis that
			 * actually varies, and it is the one a reader should discount for.
			 */}
			{unsure.length > 0 && (
				<section className="mt-12">
					<Heading>{t("gaps.unsureHeading")}</Heading>
					<p className="mt-1 max-w-2xl text-muted text-sm">
						{t("gaps.unsureBlurb")}
					</p>
					<ul className="mt-3 flex flex-wrap gap-1.5">
						{unsure.map((p) => (
							<li key={p.slug}>
								<Link href={paths.product(lang, p.slug)} className="pill">
									{p.name}
									<span className="ml-1.5 text-muted text-xs">
										{t(`price.confidence.${p.pricing?.confidence}` as Key)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			{unchecked > 0 && (
				<p className="mt-6 max-w-2xl text-muted text-sm">
					{t("gaps.uncheckedNote").replace("{n}", String(unchecked))}
				</p>
			)}
		</PageShell>
	);
}

/**
 * The other projects a reader of this one should know about.
 *
 * Two axes, both from data already held and neither available on the product
 * page: projects written in the same language, and projects that replace one of
 * the same products. A project page that only repeats its own product's copy is
 * the reason two-thirds of them are `noindex`; this is what a page needs before
 * that rule is worth revisiting.
 */
/**
 * The collections and categories a project belongs to.
 *
 * Every one of these is answered from the project itself and from the products
 * that cite it, both of which a project page's payload already holds — so this
 * is in the prerendered document rather than appearing after the API answers.
 * Membership goes through `collectionMembers` for the same reason the product
 * page's does: one predicate, so a page and a collection cannot disagree.
 */
function ProjectPlaces({
	project,
	categories,
	ctx,
}: {
	project: Project;
	categories: string[];
	ctx: PageCtx;
}) {
	const { t, tc, lang } = ctx;
	const cats = categories
		.map((slug) => ctx.categories.find((c) => c.slug === slug))
		.filter((c): c is Category => c !== undefined);
	const collections = COLLECTIONS.filter(
		(c) =>
			c.of === "project" &&
			collectionMembers(c.slug, [], [project]).projects.length > 0,
	);
	if (cats.length === 0 && collections.length === 0) return null;

	return (
		<section className="mt-6 space-y-5">
			{cats.length > 0 && (
				<div>
					<Heading>{t("project.inCategories")}</Heading>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{cats.map((c) => (
							<li key={c.slug}>
								<Link href={paths.category(lang, c.slug)} className="pill">
									{tc(c.name)}
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
			{collections.length > 0 && (
				<div>
					<Heading>{t("project.inCollections")}</Heading>
					<ul className="mt-2 flex flex-wrap gap-1.5">
						{collections.map((c) => (
							<li key={c.slug}>
								<Link href={paths.collection(lang, c.slug)} className="pill">
									{t(`collection.${c.slug}.title` as Key)}
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}

function Siblings({ project, ctx }: { project: Project; ctx: PageCtx }) {
	const { t, lang, projects, projectSlugs } = ctx;

	const href = (p: Project) => {
		const pretty = projectSlugs.get(p.slug);
		return pretty ? paths.project(lang, pretty) : undefined;
	};

	/**
	 * "Also written in Rust" is a claim about the whole catalogue, so it waits
	 * for the whole catalogue. The language COLLECTION link that `ProjectPlaces`
	 * renders is the complete answer to the same question and it is baked in.
	 */
	const sameLanguage =
		ctx.wholeCatalogue && project.language
			? projects
					.filter(
						(p) => p.slug !== project.slug && p.language === project.language,
					)
					.slice(0, 8)
			: [];

	/**
	 * Complete from this page's own payload, which is why it is not gated on the
	 * whole catalogue: a project page ships exactly the products it replaces, so
	 * the projects derived from them are exactly the projects that replace one of
	 * the same products. Nothing wider could add a row.
	 */
	const replacedSlugs = new Set(project.replaces.map((r) => r.slug));
	const doesTheSameJob = projects
		.filter(
			(p) =>
				p.slug !== project.slug &&
				p.replaces.some((r) => replacedSlugs.has(r.slug)),
		)
		.slice(0, 8);

	if (sameLanguage.length === 0 && doesTheSameJob.length === 0) return null;

	const row = (items: Project[]) => (
		<ul className="mt-2 flex flex-wrap gap-1.5">
			{items.map((p) => {
				const to = href(p);
				return (
					<li key={p.slug}>
						{to ? (
							<Link href={to} className="pill">
								{p.name}
							</Link>
						) : (
							<span className="pill">{p.name}</span>
						)}
					</li>
				);
			})}
		</ul>
	);

	return (
		<section className="mt-6 space-y-5">
			{doesTheSameJob.length > 0 && (
				<div>
					<Heading>{t("siblings.sameJob")}</Heading>
					{row(doesTheSameJob)}
				</div>
			)}
			{sameLanguage.length > 0 && project.language && (
				<div>
					<Heading>
						{t("siblings.sameLanguage").replace("{lang}", project.language)}
					</Heading>
					{row(sameLanguage)}
				</div>
			)}
		</section>
	);
}

/**
 * The terms this catalogue runs on, defined once./**
 * The terms this catalogue runs on, defined once.
 *
 * Every one of these was a precise word whose meaning lived in a code comment
 * and nowhere a reader could reach: "hosted option", "open core", "mostly
 * open", "almost". The tooltips added alongside this page are the short form of
 * these entries; this is the long form, and it is where a reader on a phone —
 * which has no hover — can still find out what a word means.
 *
 * Rendered from the same `def.*` keys the tooltips read, so the page and the
 * hover text cannot drift apart.
 */
/**
 * The page Google's raters are told to open first.
 *
 * The Quality Rater Guidelines put Trust above every other part of E-E-A-T and
 * name the About page as the starting point for assessing it — "look at the
 * 'About us' page on the website … as a starting point" — and this site did not
 * have one. Nothing on this page is new: the verdict scale is the glossary, the
 * price receipt is what every product page already prints, and the money section
 * is the disclosure notice in the words it already uses. What was missing was a
 * single URL that says all of it, signed.
 *
 * No derived numbers. The standing pages prerender with an empty payload, so a
 * figure here would render as a zero for a crawler and as the truth for a
 * reader, which is worse than not printing one.
 */
export function AboutPage({ ctx }: { ctx: PageCtx }) {
	const { t, lang } = ctx;

	const sections: { h: Key; p: Key[]; after?: React.ReactNode }[] = [
		{
			h: "about.who.h",
			p: ["about.who.p1", "about.who.p2"],
			after: (
				<p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					<Link
						href={paths.legal(lang, "notice")}
						className="text-brand hover:underline"
					>
						{legalCopy("notice", lang).title}
					</Link>
					<a
						href={REPO}
						target="_blank"
						rel="noopener"
						className="text-brand hover:underline"
					>
						{t("footer.repo")}
					</a>
				</p>
			),
		},
		{
			h: "about.verdict.h",
			p: ["about.verdict.p1", "about.verdict.p2", "about.verdict.p3"],
			after: (
				<p className="mt-3 text-sm">
					<Link
						href={paths.glossary(lang)}
						className="text-brand hover:underline"
					>
						{t("glossary.title")} →
					</Link>
				</p>
			),
		},
		{ h: "about.price.h", p: ["about.price.p1", "about.price.p2"] },
		{
			h: "about.gaps.h",
			p: ["about.gaps.p1"],
			after: (
				<p className="mt-3 text-sm">
					<Link href={paths.gaps(lang)} className="text-brand hover:underline">
						{t("gaps.title")} →
					</Link>
				</p>
			),
		},
		{
			h: "about.money.h",
			p: [
				"about.money.p1",
				"about.money.p2",
				"about.money.p3",
				"about.money.p4",
			],
			after: (
				<p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					<Link
						href={paths.legal(lang, "disclosure")}
						className="text-brand hover:underline"
					>
						{legalCopy("disclosure", lang).title}
					</Link>
					<Link
						href={paths.sponsor(lang)}
						className="text-brand hover:underline"
					>
						{t("nav.sponsor")}
					</Link>
				</p>
			),
		},
		{
			h: "about.fix.h",
			p: ["about.fix.p1"],
			after: (
				<p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
					<Link
						href={paths.contact(lang)}
						className="text-brand hover:underline"
					>
						{t("nav.contact")}
					</Link>
					<Link
						href={paths.submit(lang)}
						className="text-brand hover:underline"
					>
						{t("nav.submit")}
					</Link>
				</p>
			),
		},
	];

	return (
		<PageShell
			trail={[homeCrumb(ctx), { label: t("about.title") }]}
			eyebrow={t("about.eyebrow")}
			title={t("about.h1")}
			lede={t("about.blurb")}
		>
			{sections.map((section) => (
				<section key={section.h} className="mt-9 first:mt-0">
					<h2 className="font-display font-semibold text-lg">{t(section.h)}</h2>
					{section.p.map((key) => (
						<p key={key} className="mt-2.5 text-pretty leading-relaxed">
							{t(key)}
						</p>
					))}
					{section.after}
				</section>
			))}
		</PageShell>
	);
}

export function GlossaryPage({ ctx }: { ctx: PageCtx }) {
	const { t, lang } = ctx;

	// The term list lives in seo.ts, because the `DefinedTermSet` in the head has
	// to name exactly the terms this page defines and point at exactly the
	// anchors it renders. Two copies drifted the moment one of them was edited.
	const groups = GLOSSARY_GROUPS.map((g) => ({
		heading: t(g.heading as Key),
		terms: g.terms as { label: Key; def: Key }[],
	}));

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("glossary.title") }]}
			eyebrow={t("glossary.eyebrow")}
			title={t("glossary.title")}
			lede={t("glossary.blurb")}
		>
			{groups.map((g) => (
				<section key={g.heading} className="mt-8 first:mt-0">
					<Heading>{g.heading}</Heading>
					<dl className="mt-2 space-y-3">
						{g.terms.map((term) => (
							<div key={term.label} className="border-border border-l-2 pl-3">
								{/* The anchor every verdict pill and effort tag now links to,
								    and `<dfn>` because this IS the defining instance of the
								    term — see `glossaryAnchor` in seo.ts. */}
								<dt
									id={glossaryAnchor(term.label)}
									className="font-mono text-[11px] text-text uppercase tracking-[0.12em]"
								>
									<dfn>{t(term.label)}</dfn>
								</dt>
								<dd className="mt-0.5 text-muted text-sm">{t(term.def)}</dd>
							</div>
						))}
					</dl>
				</section>
			))}

			<p className="mt-10 text-muted text-sm">
				{t("glossary.ladderNote")}{" "}
				<Link
					href={paths.collections(lang)}
					className="text-brand hover:underline"
				>
					{t("nav.collections")}
				</Link>
				.
			</p>
		</PageShell>
	);
}

/**
 * One theme: the categories filed under it, and every product across them.
 *
 * The taxonomy has carried a `group` on every category since it was written and
 * nothing routed it. Meanwhile 50 of the 85 categories hold five products or
 * fewer and six hold exactly one — a category page with one product is a dead
 * end for a reader and for a crawler. The group is the browsable middle level
 * the data already had.
 */
export function GroupPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, lang, categories, products, stats } = ctx;
	if (!(CATEGORY_GROUPS as readonly string[]).includes(slug)) {
		return <Pending ctx={ctx} empty={categories.length > 0} />;
	}
	const group = slug as CategoryGroup;

	const cats = byProductCount(
		categories.filter((c) => c.group === group),
		stats,
	).filter((c) => (stats.get(c.slug)?.products ?? 0) > 0);
	if (cats.length === 0)
		return <Pending ctx={ctx} empty={categories.length > 0} />;

	const slugs = new Set(cats.map((c) => c.slug));
	const inGroup = byWeight(products.filter((p) => slugs.has(p.category)));

	return (
		<PageShell
			measure={MEASURE}
			trail={[
				homeCrumb(ctx),
				{ label: t("page.categories"), href: paths.categories(lang) },
				{ label: t(`catGroup.${group}` as Key) },
			]}
			eyebrow={t("cats.themes")}
			// Same reason as the category page: the theme's own word is a breadcrumb,
			// not a heading Google can match a title against.
			title={t("group.h1").replace("{label}", t(`catGroup.${group}` as Key))}
			lede={t(`catGroupBlurb.${group}` as Key)}
		>
			<Section title={t("page.categories")} count={cats.length}>
				<ul className="space-y-2">
					{cats.map((c) => (
						<CategoryRow key={c.slug} cat={c} ctx={ctx} />
					))}
				</ul>
			</Section>

			{/* Every product across the theme, so the hub is a destination rather
			    than a menu pointing at ten thin pages. */}
			<Section title={t("group.allProducts")} count={inGroup.length}>
				<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
					{inGroup.map((p) => (
						<li key={p.slug} className="card card-link">
							<Link href={paths.product(lang, p.slug)} className="block p-3.5">
								<span className="flex items-baseline justify-between gap-2">
									<span className="truncate font-display font-semibold">
										{p.name}
									</span>
									<span className="nums shrink-0 text-muted text-sm">
										{priceLabel(p, lang, t)}
									</span>
								</span>
								<span className="mt-1.5 flex items-center gap-3">
									<VerdictMark verdict={p.verdict} t={t} />
									<span className="nums text-muted text-xs">
										{p.alternatives.length} {t("group.alternatives")}
									</span>
								</span>
							</Link>
						</li>
					))}
				</ul>
			</Section>

			<EditThisPage file={CATEGORY_FILE} t={t} className="mt-10" />
		</PageShell>
	);
}

/**
 * The freest-to-least-free chip that sits on every project row.
 *
 * Colour is not the signal — the word is. `--brand` is deliberately not used:
 * openness is a judgement about a project and the wordmark's blue must never
 * read as one.
 */
function OpennessChip({
	level,
	t,
}: {
	level: Openness;
	t: (k: Key) => string;
}) {
	const tone: Record<Openness, string> = {
		"fully-open": "var(--v-yes)",
		"mostly-open": "color-mix(in srgb, var(--v-yes) 60%, var(--muted))",
		"open-core": "var(--v-almost)",
		"source-available": "var(--v-no)",
		"hosted-only": "var(--v-no)",
	};
	return (
		<span
			className="shrink-0 rounded-[calc(var(--radius))] border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.12em]"
			style={{ borderColor: tone[level], color: tone[level] }}
		>
			{t(`openness.${level}` as Key)}
		</span>
	);
}

/**
 * One project, as a reader scanning for a replacement needs it: what it
 * replaces, on what licence, how much work, and whether the repo is alive.
 *
 * The repo readings come from `RepoFreshness`, unchanged — whatever that
 * component decides to show is what shows here, so this row cannot drift from
 * the project page's version of the same facts.
 */
function ProjectRow({ project, ctx }: { project: Project; ctx: PageCtx }) {
	const { t, lang } = ctx;
	const slug = ctx.projectSlugs.get(project.slug);
	const shown = project.replaces.slice(0, 3);
	const rest = project.replaces.length - shown.length;

	return (
		<li className="card p-4">
			<div className="flex items-baseline justify-between gap-2">
				{slug ? (
					<Link
						href={paths.project(lang, slug)}
						className="min-w-0 truncate font-display font-semibold hover:underline"
					>
						{project.name}
					</Link>
				) : (
					<span className="min-w-0 truncate font-display font-semibold">
						{project.name}
					</span>
				)}
				<OpennessChip level={openness(project)} t={t} />
			</div>

			{/* The whole reason the index exists: 545 project pages replace exactly
			    one product and are `noindex, follow`, so this is where a reader — and
			    a crawler — finds them. Every name is a real link. */}
			<p className="mt-1.5 text-sm text-muted">
				<span className="text-muted">{t("page.replaces")}: </span>
				{shown.map((r, i) => (
					<span key={r.slug}>
						{i > 0 && ", "}
						<Link
							href={paths.product(lang, r.slug)}
							className="hover:underline"
						>
							{r.name}
						</Link>
					</span>
				))}
				{rest > 0 && <span className="nums"> +{rest}</span>}
			</p>

			<p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
				<Tag>{project.license}</Tag>
				<Tag>{t(`effort.${project.effort}` as Key)}</Tag>
				<RepoFreshness
					source={project.source}
					t={t}
					lang={lang}
					archived={project.archived}
					full
				/>
			</p>
		</li>
	);
}

/**
 * All 871 open source projects, paginated.
 *
 * This is the index over `/{lang}/tools/{slug}`, and it is also the fix for a
 * structural problem the site had: 545 of those pages replace exactly one
 * product, are thin enough to ship `noindex, follow`, and had no inbound
 * internal link anywhere. `follow` was always the right half of that rule — they
 * pass authority to the products they cite — but a page nothing links to is a
 * page nothing follows. Eighteen crawlable pages give all 871 a home.
 */
export function ProjectsIndexPage({
	ctx,
	page = 1,
}: {
	ctx: PageCtx;
	page?: number;
}) {
	const { t, lang } = ctx;
	const [filters, setFilters] = useState<ProjectFilters>(NO_PROJECT_FILTERS);

	// Before the API answers, the payload IS this page's rows; after it, the whole
	// catalogue is in hand and this page is a slice of it. Both give the same rows
	// for the URL that was loaded, which is what hydration needs.
	const all = ctx.wholeCatalogue ? ctx.projects : ctx.projectRows;
	const total = ctx.wholeCatalogue ? all.length : ctx.projectTotal;
	const { page: current, pages } = pageBounds(total, page);
	const rows = ctx.wholeCatalogue ? pageSlice(all, current) : all;

	const filtering = isProjectFiltered(filters);
	// A filtered view searches everything in hand, not just this page — otherwise
	// "no results" would mean "not on page 3", which is not what it looks like.
	const shown = filtering
		? applyProjectFilters(ctx.wholeCatalogue ? all : rows, filters)
		: rows;

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("page.projects") }]}
			eyebrow={t("nav.projects")}
			title={t("projects.title")}
			lede={t("projects.blurb")}
			meta={
				<p className="nums text-muted text-sm">
					{total} {t("projects.unit")}
				</p>
			}
		>
			{/* Page 1 only: it is a claim about the whole catalogue, and repeating
			    it on all eighteen pages would make eighteen pages that each open
			    with the same six links. */}
			{current === 1 && <MostReplacing ctx={ctx} />}
			{current === 1 && <StackCover ctx={ctx} />}

			{/* The filter bar is a panel, not a loose row of controls: it belongs to
			    the list under it, and the same treatment is used on every index so a
			    reader recognises "these narrow what is below" without reading them. */}
			<div className="panel flex flex-wrap items-center gap-2 p-2.5">
				<input
					value={filters.q}
					onChange={(e) => setFilters({ ...filters, q: e.target.value })}
					placeholder={t("projects.searchPlaceholder")}
					aria-label={t("projects.searchPlaceholder")}
					className="min-w-0 flex-1 rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand sm:min-w-52"
				/>
				<Choice
					label={t("filter.openness")}
					value={filters.openness}
					onChange={(v) =>
						setFilters({
							...filters,
							openness: v as ProjectFilters["openness"],
						})
					}
				>
					<option value="">{t("filter.anyOpenness")}</option>
					{opennessOptions(t)}
				</Choice>
				<Choice
					label={t("filter.effort")}
					value={filters.effort}
					onChange={(v) =>
						setFilters({ ...filters, effort: v as ProjectFilters["effort"] })
					}
				>
					<option value="">{t("filter.anyEffort")}</option>
					{effortOptions(t)}
				</Choice>
			</div>

			<ResultsLive n={shown.length} t={t} />
			{filtering && (
				<p className="nums mt-2 text-muted text-xs">
					{shown.length} {t("projects.unit")} · {t("filter.filteredNote")}
				</p>
			)}

			<ul className={`mt-6 ${GRID_1COL} gap-2 sm:grid-cols-2`}>
				{shown.map((p) => (
					<ProjectRow key={p.slug} project={p} ctx={ctx} />
				))}
			</ul>

			{shown.length === 0 && (
				<p className="py-12 text-center text-muted text-sm">
					{t("empty.none")}
				</p>
			)}

			{/* The pager belongs to the URL, not to the filtered view: a filter is a
			    reading aid on top of page 3 and does not repaginate the catalogue. */}
			{!filtering && (
				<>
					<Pager
						page={current}
						pages={pages}
						href={(n) => paths.projects(lang, n)}
						t={t}
					/>
					<PageCount
						page={current}
						pages={pages}
						total={total}
						unit={t("projects.unit")}
						t={t}
					/>
				</>
			)}
		</PageShell>
	);
}

/** The index of the derived collections. Six rows, each a real slice. */
/**
 * The index over every product, at `/<lang>/alternatives/`.
 *
 * WHY THIS EXISTS. `parseRoute` had no case for a bare `alternatives` segment,
 * so the URL prefix holding all 592 money pages resolved to `unknown` and the
 * directory answered 403 — to a reader trimming the path, and to Googlebot,
 * which trims paths on discovery as a matter of course.
 *
 * It is not a second home page. The home page is a ranked, filterable, 48-at-a-
 * time list; this is every product at once, grouped by the category it is filed
 * under, which is the shape that puts all 592 within two clicks of one URL and
 * gives the 85 category hubs another honest inbound link each.
 *
 * The payload is `[slug, name, category]` per product — three strings, not the
 * ~7 kB a full list row costs, because the only thing this page prints is the
 * name.
 */
export function ProductsIndexPage({ ctx }: { ctx: PageCtx }) {
	const { t, tc, lang, categories, stats } = ctx;

	// Baked at build time. The fallback is the dev server and any client-side
	// navigation onto this route, where the catalogue arrives over the API.
	const rows: [string, string, string][] =
		ctx.productIndex.length > 0
			? ctx.productIndex
			: ctx.products.map((p) => [p.slug, p.name, p.category]);

	if (rows.length === 0)
		return <Pending ctx={ctx} empty={ctx.wholeCatalogue} />;

	const byCategory = new Map<string, [string, string][]>();
	for (const [slug, name, cat] of rows) {
		const list = byCategory.get(cat);
		if (list) list.push([slug, name]);
		else byCategory.set(cat, [[slug, name]]);
	}
	for (const list of byCategory.values())
		list.sort((a, b) =>
			a[1].toLowerCase() < b[1].toLowerCase()
				? -1
				: a[1].toLowerCase() > b[1].toLowerCase()
					? 1
					: 0,
		);

	// The authored `position`, the same editorial ordering the categories index
	// uses, so the infrastructure ones run together rather than by whichever
	// happens to hold the most rows.
	const sections = [...categories]
		.sort((a, b) => a.position - b.position)
		.map((c) => ({ cat: c, items: byCategory.get(c.slug) ?? [] }))
		.filter((x) => x.items.length > 0);

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("page.products") }]}
			eyebrow={t("products.browse")}
			title={t("products.title")}
			lede={t("products.blurb").replace("{n}", String(rows.length))}
		>
			{sections.map(({ cat, items }) => (
				<section key={cat.slug} className="mt-10 first:mt-0">
					<div className="mb-3 flex flex-wrap items-baseline gap-x-3 border-border border-b pb-2">
						<h2 className="font-display font-bold text-lg">
							<Link
								href={paths.category(lang, cat.slug)}
								className="hover:underline"
							>
								{tc(cat.name)}
							</Link>
						</h2>
						<p className="nums text-muted text-xs">
							{items.length} {t("stats.products")}
							{stats.get(cat.slug) !== undefined &&
								` · ${medianLabel(stats.get(cat.slug) as CategoryStat, lang, t)}`}
						</p>
					</div>
					<ul className="flex flex-wrap gap-1.5">
						{items.map(([slug, name]) => (
							<li key={slug}>
								<Link href={paths.product(lang, slug)} className="pill">
									{name}
								</Link>
							</li>
						))}
					</ul>
				</section>
			))}
		</PageShell>
	);
}

export function CollectionsPage({ ctx }: { ctx: PageCtx }) {
	const { t, lang } = ctx;

	/**
	 * The note that explains why `open-source` and `foss` are both here carried
	 * three numbers written into the translation ("844 of 871 … 642"). The
	 * catalogue has since quadrupled, so all three were wrong in both locales —
	 * on a page whose whole promise is that nothing here can quietly go stale.
	 * Read them from the same counts the cards above use instead.
	 */
	const membersOf = (slug: string): number | null =>
		ctx.collectionCounts.get(slug) ??
		(ctx.wholeCatalogue
			? memberCount(collectionMembers(slug, ctx.products, ctx.projects))
			: null);

	const openCount = membersOf("open-source");
	const fossCount = membersOf("foss");
	// Same rule as the cards: with nothing baked and only a slice in hand, the
	// sentence is dropped rather than printed with a placeholder showing.
	const rejectedNote =
		openCount === null || fossCount === null
			? null
			: t("collections.rejectedNote")
					.replace("{all}", String(ctx.projectTotal))
					.replace("{open}", String(openCount))
					.replaceAll("{foss}", String(fossCount));

	return (
		<PageShell
			measure={MEASURE}
			trail={[homeCrumb(ctx), { label: t("page.collections") }]}
			eyebrow={t("nav.collections")}
			title={t("collections.title")}
			lede={t("collections.blurb")}
		>
			<ul className={`${GRID_1COL} gap-3 sm:grid-cols-2`}>
				{COLLECTIONS.map((c) => {
					// Baked at build time, so the static document a crawler reads carries
					// the same six numbers a reader sees. Null only on the dev server,
					// where nothing is baked and saying nothing beats saying a wrong one.
					const count =
						ctx.collectionCounts.get(c.slug) ??
						(ctx.wholeCatalogue
							? memberCount(
									collectionMembers(c.slug, ctx.products, ctx.projects),
								)
							: null);
					return (
						<li key={c.slug} className="card card-link">
							{/* The whole cell is the link — a 2cm-wide card with a 4-word
							    hit area in the corner is a card that misses on a phone. */}
							<Link
								href={paths.collection(lang, c.slug)}
								className="flex h-full flex-col p-5"
							>
								<span className="flex items-baseline justify-between gap-3">
									<span className="font-display font-semibold text-lg">
										{t(`collection.${c.slug}.title` as Key)}
									</span>
									<ChevronRight
										className="size-4 shrink-0 text-muted"
										aria-hidden
									/>
								</span>
								<span className="mt-2 flex-1 text-muted text-sm leading-relaxed">
									{t(`collection.${c.slug}.blurb` as Key)}
								</span>
								{/* Counted from the catalogue in hand, so it says nothing at
								    all rather than a wrong number before the API answers. */}
								{count !== null && (
									<span className="nums mt-4 text-brand text-xs">
										{count}{" "}
										{c.of === "product"
											? t("stats.products")
											: t("projects.unit")}
									</span>
								)}
							</Link>
						</li>
					);
				})}
			</ul>

			{/*
			 * The counterweight to the thirteen cards above, and the page with one
			 * inbound link on the entire site before this one. A reader who has
			 * just read thirteen slices of what open source DOES replace is
			 * exactly the reader for the list of what it does not.
			 */}
			<p className="mt-8 text-sm">
				<Link href={paths.gaps(lang)} className="text-brand hover:underline">
					{t("gaps.link")} →
				</Link>
			</p>

			{/* The one the owner asked for and that is not here. Saying so on the page
			    is cheaper than letting somebody re-derive the same dead end. */}
			{rejectedNote && (
				<p className="mt-8 max-w-2xl text-muted text-xs">
					{rejectedNote}{" "}
					<Link
						href={paths.projects(lang)}
						className="text-brand hover:underline"
					>
						{t("projects.title")}
					</Link>
					.
				</p>
			)}
		</PageShell>
	);
}

/** One collection, paginated. Products or projects, depending on the slug. */
/**
 * Projects whose repo went read-only most recently.
 *
 * `bun run health` runs weekly and commits `health.json`; when it flips a
 * project to archived, that is the most newsworthy thing the catalogue learns
 * all week and it currently lands silently in a JSON file. `lastPush` on an
 * archived repo is the date the work stopped, which is the closest thing to
 * "when did this die" the forges will give us.
 *
 * Only rendered on the graveyard, where the framing is already right.
 */
function RecentlyArchived({
	projects,
	ctx,
}: {
	projects: Project[];
	ctx: PageCtx;
}) {
	const { t, lang, projectSlugs } = ctx;
	const dated = projects
		.map((p) => ({ p, last: healthOf(p.source)?.lastPush }))
		.filter((x): x is { p: Project; last: string } => Boolean(x.last))
		.sort((a, b) => b.last.localeCompare(a.last))
		.slice(0, 8);
	// Health covers about a third of cited repos, so this can legitimately be
	// empty — and an empty "recently" block is worse than none.
	if (dated.length < 3) return null;

	return (
		<section className="mb-8">
			<Heading>{t("archived.recent")}</Heading>
			<ul className="mt-2 flex flex-wrap gap-1.5">
				{dated.map(({ p, last }) => {
					const pretty = projectSlugs.get(p.slug);
					const label = (
						<>
							{p.name}
							<span className="nums ml-1.5 text-muted text-xs">
								{last.slice(0, 7)}
							</span>
						</>
					);
					return (
						<li key={p.slug}>
							{pretty ? (
								<Link href={paths.project(lang, pretty)} className="pill">
									{label}
								</Link>
							) : (
								<span className="pill">{label}</span>
							)}
						</li>
					);
				})}
			</ul>
			<p className="mt-2 text-muted text-xs">{t("archived.recentNote")}</p>
		</section>
	);
}

export function CollectionPage({
	ctx,
	slug,
	page = 1,
}: {
	ctx: PageCtx;
	slug: string;
	page?: number;
}) {
	const { t, tc, lang } = ctx;
	const def = collectionBySlug.get(slug);
	const [filters, setFilters] = useState<ProductFilters>(NO_FILTERS);
	const [projectFilters, setProjectFilters] =
		useState<ProjectFilters>(NO_PROJECT_FILTERS);

	if (!def) return <Pending ctx={ctx} empty={ctx.products.length > 0} />;

	const members = collectionMembers(slug, ctx.products, ctx.projects);
	const ofProducts = def.of === "product";

	// `byWeight` for products, so a collection page is cut from the same spine the
	// home list is; projects arrive from `collectProjects` already ordered
	// most-cited first, which is the order that matters for them.
	const allProducts = ofProducts
		? byWeight(members.products as ListedProduct[])
		: [];
	// A project collection cannot be re-derived from a product payload — the
	// products citing 48 projects also cite dozens of others — so before the API
	// answers the rows come from the payload, exactly as the project index's do.
	const allProjects = ofProducts
		? []
		: ctx.wholeCatalogue
			? members.projects
			: ctx.projectRows;
	// The baked figure wins whenever there is one: this page ships 48 rows, so
	// counting them would collapse a four-page collection to one.
	const derived = ofProducts ? allProducts.length : allProjects.length;
	const total = ctx.wholeCatalogue
		? derived
		: (ctx.collectionCounts.get(slug) ?? derived);
	// Same rule: derived when the whole catalogue is in hand, baked before that.
	const unresolved = ctx.wholeCatalogue
		? members.unresolved
		: ctx.unresolvedRows;
	const { page: current, pages } = pageBounds(total, page);

	// Same rule as the project index: slice only when the whole catalogue is here,
	// because before the API answers the payload IS this page.
	const slice = <X,>(all: X[]): X[] =>
		ctx.wholeCatalogue ? pageSlice(all, current) : all;

	const filtering = ofProducts
		? isFiltered(filters)
		: isProjectFiltered(projectFilters);

	// A filtered view searches the whole collection, not this page — "no results"
	// has to mean "nowhere in this collection", not "not on page 3".
	const filtered = ofProducts
		? applyProductFilters(filtering ? allProducts : slice(allProducts), filters)
		: null;
	const productRows = filtered?.shown ?? [];
	const projectRows = ofProducts
		? []
		: filtering
			? applyProjectFilters(allProjects, projectFilters)
			: slice(allProjects);

	const title = t(`collection.${slug}.title` as Key);

	return (
		<PageShell
			measure={MEASURE}
			trail={[
				homeCrumb(ctx),
				{ label: t("page.collections"), href: paths.collections(lang) },
				{ label: title },
			]}
			// The short word moves up to the eyebrow and the title phrase becomes
			// the heading — same reason as the category and theme pages.
			eyebrow={title}
			title={collectionHeading(slug, lang, total) ?? title}
			lede={t(`collection.${slug}.blurb` as Key)}
			meta={
				// How the membership is derived, in one line, on the page itself. A
				// collection nobody can check is a list somebody could have made up.
				<p className="max-w-2xl border-border border-l-2 pl-3 text-muted text-xs leading-relaxed">
					{t(`collection.${slug}.derivation` as Key)}
				</p>
			}
		>
			{/* The graveyard's own headline: what died most recently. */}
			{slug === "archived" && (
				<RecentlyArchived projects={projectRows} ctx={ctx} />
			)}

			<div className="panel flex flex-wrap items-center gap-2 p-2.5">
				{ofProducts ? (
					<>
						<Choice
							label={t("filter.effort")}
							value={filters.effort}
							onChange={(v) =>
								setFilters({
									...filters,
									effort: v as ProductFilters["effort"],
								})
							}
						>
							<option value="">{t("filter.anyEffort")}</option>
							{effortOptions(t)}
						</Choice>
						<Choice
							label={t("filter.openness")}
							value={filters.openness}
							onChange={(v) =>
								setFilters({
									...filters,
									openness: v as ProductFilters["openness"],
								})
							}
						>
							<option value="">{t("filter.anyOpenness")}</option>
							{opennessOptions(t)}
						</Choice>
						<Choice
							label={t("filter.price")}
							value={filters.price}
							onChange={(v) =>
								setFilters({ ...filters, price: v as ProductFilters["price"] })
							}
						>
							<option value="">{t("filter.anyPrice")}</option>
							{priceOptions(t)}
						</Choice>
						<Choice
							label={t("filter.category")}
							value={filters.category}
							onChange={(v) => setFilters({ ...filters, category: v })}
						>
							<option value="">{t("filter.allCategories")}</option>
							{ctx.categories.map((c) => (
								<option key={c.slug} value={c.slug}>
									{tc(c.name)}
								</option>
							))}
						</Choice>
					</>
				) : (
					<>
						<Choice
							label={t("filter.openness")}
							value={projectFilters.openness}
							onChange={(v) =>
								setProjectFilters({
									...projectFilters,
									openness: v as ProjectFilters["openness"],
								})
							}
						>
							<option value="">{t("filter.anyOpenness")}</option>
							{opennessOptions(t)}
						</Choice>
						<Choice
							label={t("filter.effort")}
							value={projectFilters.effort}
							onChange={(v) =>
								setProjectFilters({
									...projectFilters,
									effort: v as ProjectFilters["effort"],
								})
							}
						>
							<option value="">{t("filter.anyEffort")}</option>
							{effortOptions(t)}
						</Choice>
					</>
				)}
			</div>

			<ResultsLive
				n={ofProducts ? productRows.length : projectRows.length}
				t={t}
			/>
			{filtered && <Hidden result={filtered} t={t} />}

			<ul className={`mt-6 ${GRID_1COL} gap-2 sm:grid-cols-2`}>
				{ofProducts
					? productRows.map((p) => (
							<ProductCard key={p.slug} product={p} ctx={ctx} />
						))
					: projectRows.map((p) => (
							<ProjectRow key={p.slug} project={p} ctx={ctx} />
						))}
			</ul>

			{!filtering && (
				<>
					<Pager
						page={current}
						pages={pages}
						href={(n) => paths.collection(lang, slug, n)}
						t={t}
					/>
					<PageCount
						page={current}
						pages={pages}
						total={total}
						unit={ofProducts ? t("stats.products") : t("projects.unit")}
						t={t}
					/>
				</>
			)}

			{/*
			 * The projects this collection cannot make a claim about.
			 *
			 * `facts` live on the alternative, not the project, so a project cited
			 * against several products carries several opinions of what it withholds
			 * — and 27 of them disagree about exactly the field this page is built
			 * from. `source-available` has the same problem one field over: its rows
			 * are decided by the licence, and OpenReplay's five citations do not
			 * agree about whether that licence is open source. They are excluded from
			 * the list above, because the heading is a claim about every row under
			 * it. They are NAMED here, because a site that drops them silently is
			 * hiding a disagreement it already knows about. The note is per
			 * collection, since "the citations disagree" means a different thing
			 * about a fact than it does about a licence. Page 1 only: repeating it
			 * under all four pages would be the same block on four URLs.
			 */}
			{current === 1 && unresolved.length > 0 && (
				<Section title={t("collection.unresolved")} count={unresolved.length}>
					<p className="mb-3 max-w-2xl text-muted text-xs leading-relaxed">
						{t(`collection.${slug}.unresolvedNote` as Key)}
					</p>
					<ul className="flex flex-wrap gap-2">
						{unresolved.map((p) => {
							const s = ctx.projectSlugs.get(p.slug);
							return (
								<li key={p.slug}>
									{s ? (
										<Link href={paths.project(lang, s)} className="pill">
											{p.name}
										</Link>
									) : (
										<span className="pill text-muted">{p.name}</span>
									)}
								</li>
							);
						})}
					</ul>
				</Section>
			)}
		</PageShell>
	);
}
