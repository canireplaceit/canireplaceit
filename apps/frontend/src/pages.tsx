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
	CategoryStat,
	Project,
} from "core/src/content";
import { byGroup, projectSlug } from "core/src/content";
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
	CARD,
	FactMarks,
	GRID_1COL,
	hostOf,
	OpenCorePanel,
	PriceBlock,
	ProductLogo,
	RepoFreshness,
	Tag,
	VerdictMark,
	WhatYouLose,
} from "./components";
import { CATEGORY_FILE, EditThisPage, productFile } from "./contribute";
import type { Key } from "./i18n";
import { ForgeIcon } from "./icons";
import { MEASURE, priceLabel } from "./listShared";
import { Link } from "./nav";

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

/**
 * `measure` is for the pages that sit in the same column as the list: the width
 * a design lays its rows out at is the width its category pages have to line up
 * with, or the site reads as two unrelated columns. The article pages keep their
 * own narrower reading measure.
 */
const Shell = ({
	children,
	measure = "max-w-4xl",
}: {
	children: React.ReactNode;
	measure?: string;
}) => <main className={`mx-auto ${measure} px-4 pt-10 pb-16`}>{children}</main>;

const Heading = ({ children }: { children: React.ReactNode }) => (
	<h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
		{children}
	</h2>
);

/** Always present, so no page is ever a dead end for a reader or a crawler. */
const HomeLink = ({ ctx }: { ctx: PageCtx }) => (
	<Link
		href={paths.home(ctx.lang)}
		className="text-sm text-muted hover:underline"
	>
		← {ctx.t("page.home")}
	</Link>
);

/**
 * The visible breadcrumb, matching the `BreadcrumbList` JSON-LD in seo.ts one
 * for one. Google's guidance is that the markup describe a trail the page
 * actually shows; two different trails is worse than none.
 */
const Trail = ({ items }: { items: { label: string; href?: string }[] }) => (
	<nav aria-label="Breadcrumb" className="text-sm text-muted">
		<ol className="flex flex-wrap items-center gap-1">
			{items.map((item, i) => (
				<li key={item.label} className="flex items-center gap-1">
					{i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
					{item.href ? (
						<Link href={item.href} className="hover:underline">
							{item.label}
						</Link>
					) : (
						<span aria-current="page">{item.label}</span>
					)}
				</li>
			))}
		</ol>
	</nav>
);

/** The data arrives after the first paint; say nothing rather than "not found". */
function Pending({ ctx, empty }: { ctx: PageCtx; empty: boolean }) {
	return (
		<Shell>
			<HomeLink ctx={ctx} />
			<p className="py-16 text-center text-sm text-muted">
				{ctx.t(empty ? "page.notFound" : "page.loading")}
			</p>
		</Shell>
	);
}

export function ProductPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, tc, lang, products, categories } = ctx;
	const product = products.find((p) => p.slug === slug);
	if (!product) return <Pending ctx={ctx} empty={products.length > 0} />;

	const category = categories.find((c) => c.slug === product.category);

	// An open source alternative is also a project with a page of its own; that
	// link is the only inbound one most project pages will ever get.
	const projectHref = (alt: Alternative): string | undefined => {
		if (alt.kind !== "oss") return undefined;
		const pretty = ctx.projectSlugs.get(projectSlug(alt.source));
		return pretty ? paths.project(lang, pretty) : undefined;
	};

	return (
		<Shell>
			<HomeLink ctx={ctx} />
			<article className="mt-4 space-y-6">
				<header className="flex items-start gap-4">
					<ProductLogo product={product} size={48} eager />
					<div className="min-w-0 flex-1">
						<h1 className="font-display text-3xl font-bold tracking-tight">
							{t("hero.title")} {product.name}
							{lang === "fr" ? " ?" : "?"}
						</h1>
						<p className="nums mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
							<VerdictMark verdict={product.verdict} t={t} />
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
								// A published 0 reads as "broken"; the report-a-switch
								// button below is the real flow, so link straight to it.
								<a href="#report-switch" className="hover:underline">
									{t("stats.switchesNone")}
								</a>
							)}
							{category && (
								<Link
									href={paths.category(lang, category.slug)}
									className="hover:underline"
								>
									<span style={{ color: "var(--accent)" }}>
										{tc(category.name)}
									</span>
								</Link>
							)}
						</p>
					</div>
				</header>

				{/* Out of the meta row and into a block of its own: the price is the
				    claim this site is judged on, so it shows its working. */}
				<section className={CARD}>
					<Heading>{t("price.heading")}</Heading>
					<PriceBlock product={product} t={t} lang={lang} />
				</section>

				<p className="max-w-3xl leading-relaxed">{tc(product.why)}</p>

				<WhatYouLose product={product} t={t} tc={tc} />

				<AlternativeList
					product={product}
					t={t}
					tc={tc}
					lang={lang}
					projectHref={projectHref}
				/>

				<button
					id="report-switch"
					type="button"
					disabled={ctx.voted.has(product.slug)}
					onClick={() => ctx.onVote(product.slug)}
					aria-label={`${t("row.switched")} — ${product.name}`}
					className="rounded-[calc(var(--radius))] border px-3 py-1.5 text-sm transition disabled:opacity-50"
					style={{ borderColor: "var(--v-yes)", color: "var(--v-yes)" }}
				>
					↺{" "}
					{t(ctx.voted.has(product.slug) ? "row.switchedDone" : "row.switched")}
				</button>

				{/* One product, one file. This is the whole admin panel. */}
				<EditThisPage file={productFile(product.slug)} t={t} />
			</article>
		</Shell>
	);
}

export function ProjectPage({ ctx, slug }: { ctx: PageCtx; slug: string }) {
	const { t, tc, lang } = ctx;
	const project = ctx.projectBySlug.get(slug);
	if (!project) return <Pending ctx={ctx} empty={ctx.products.length > 0} />;
	const health = healthOf(project.source);
	const homepage = homepageOf(project.source);

	return (
		<Shell>
			<HomeLink ctx={ctx} />
			<article className="mt-4 space-y-6">
				<header>
					<h1 className="font-display text-3xl font-bold tracking-tight">
						{project.name}
					</h1>
					<p className="mt-2 flex flex-wrap items-center gap-3 text-sm text-muted">
						{/* The licence moved down into the fact row, where it sits beside
						    the other things the reader is checking rather than alone. */}
						<span>{t(`effort.${project.effort}` as Key)}</span>
						{/* External, so a real target and rel — not a client transition. */}
						<a
							href={outboundUrl(project.source.url, "repo")}
							target="_blank"
							rel="noopener"
							className="inline-flex items-center gap-1 hover:underline"
							style={{ color: "var(--accent)" }}
						>
							<ForgeIcon host={project.source.host} />
							{project.source.host}/{project.source.path}
							<ExternalLink className="size-3.5" aria-hidden />
						</a>
						{/* The docs and the install instructions are usually here rather
						    than on the forge. Absent when the repo declares no site, or
						    declares the repo itself — see `homepageOf`. */}
						{homepage && (
							<a
								href={outboundUrl(homepage, "homepage")}
								target="_blank"
								rel="noopener"
								className="inline-flex items-center gap-1 hover:underline"
								style={{ color: "var(--accent)" }}
							>
								<Globe className="size-3.5" aria-hidden />
								{hostOf(homepage)}
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
					<p className="mt-2 flex flex-wrap items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-muted">
						<FactMarks
							facts={project.facts}
							license={project.license}
							vary={project.factsVary}
							t={t}
							full
						/>
						<RepoFreshness source={project.source} t={t} lang={lang} full />
					</p>
				</header>

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

				{/* Above the argument, not beside it: somebody has to see this before
				    they read a paragraph recommending it. */}
				{health?.archived && (
					<p
						className="rounded-[calc(var(--radius))] border p-3.5 text-sm"
						style={{ borderColor: "var(--v-no)", color: "var(--v-no)" }}
					>
						<strong>{t("repo.archived")}.</strong> {t("repo.archivedNote")}
					</p>
				)}

				<section>
					<Heading>
						{t("page.replaces")} · {project.replaces.length}
					</Heading>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{project.replaces.map((r) => (
							<li key={r.slug} className={CARD}>
								<Link
									href={paths.product(lang, r.slug)}
									className="font-medium hover:underline"
								>
									{r.name}
								</Link>
								<p className="mt-1.5 text-sm text-muted">{tc(r.note)}</p>
							</li>
						))}
					</ul>
				</section>

				{/*
				 * A project page is derived from every product that cites it, so there
				 * is no one file behind it — except when exactly one product does, in
				 * which case that file IS the page and we can open it directly.
				 */}
				<EditThisPage
					file={
						project.replaces.length === 1
							? productFile(project.replaces[0].slug)
							: null
					}
					t={t}
				/>
			</article>
		</Shell>
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
		<li className="rounded-[calc(var(--radius))] border border-border bg-surface transition hover:border-[color-mix(in_srgb,var(--accent)_50%,var(--color-border))]">
			<Link
				href={paths.product(lang, product.slug)}
				className="flex items-center gap-3 p-3.5"
			>
				<ProductLogo product={product} size={28} />
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium">{product.name}</span>
					<span className="nums block truncate text-xs text-muted">
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
	<div>
		<dd className="nums text-lg font-bold">{value}</dd>
		<dt className="mt-0.5 text-[10px] uppercase tracking-widest text-muted">
			{label}
		</dt>
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
		<Shell measure={MEASURE}>
			<Trail
				items={[
					{ label: t("page.home"), href: paths.home(lang) },
					{ label: t("page.categories"), href: paths.categories(lang) },
					{ label: name },
				]}
			/>

			<header className="mt-4 flex items-start gap-3">
				<Icon className="mt-1 size-8 shrink-0 text-brand" aria-hidden />
				<h1 className="font-display text-3xl font-bold tracking-tight">
					{name}
				</h1>
			</header>

			{/* Everything in this block is computed from the entries below it, so the
			    page cannot claim a figure the list does not support. */}
			{stat && (
				<section className="mt-6 space-y-4 rounded-[calc(var(--radius))] border border-border bg-surface p-4">
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
								<span className="text-sm font-medium">
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
					<div>
						<Heading>{t("cats.ladder")}</Heading>
						<RungLegend stat={stat} t={t} />
					</div>
				</section>
			)}

			<div className="mt-6">
				<CategoryMenu
					cats={categories}
					stats={stats}
					lang={lang}
					t={t}
					tc={tc}
					current={slug}
				/>
			</div>

			{/*
			 * SPONSORSHIP MOUNT POINT — owned by the sponsorship work, not this file's
			 * author. The per-category slot (`placement: "category"`, `category: slug`)
			 * belongs here, between the menu and the product list: above the fold on a
			 * phone, and clearly separated from the entries so a paid unit never reads
			 * as a verdict. Drop a <SponsorSlot slot={…} /> in and nothing else on this
			 * page has to move.
			 */}

			<section className="mt-8">
				<Heading>
					{t("cats.inThis")} · {inCat.length}
				</Heading>
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
					<p className="mt-3 text-sm text-muted">{t("cats.smallNote")}</p>
				)}
			</section>

			{neighbours.length > 0 && (
				<section className="mt-8">
					<Heading>{t("cats.nearby")}</Heading>
					<ul className={`${GRID_1COL} gap-2 sm:grid-cols-2`}>
						{neighbours.map((c) => {
							const s = stats.get(c.slug);
							const NIcon = categoryIcon(c.icon);
							return (
								<li key={c.slug}>
									<Link
										href={paths.category(lang, c.slug)}
										className="flex items-center gap-3 rounded-[calc(var(--radius))] border border-border bg-surface p-3 hover:border-brand"
									>
										<NIcon className="size-4 shrink-0 text-muted" aria-hidden />
										<span className="min-w-0 flex-1 truncate text-sm font-medium">
											{tc(c.name)}
										</span>
										<span className="nums text-xs text-muted">
											{s?.products ?? 0}
										</span>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			)}

			<EditThisPage file={CATEGORY_FILE} t={t} className="mt-8" />
		</Shell>
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
		<li className={CARD}>
			{/* The name is the link; the figures beside it are text, so a reader is
			    never made to click a number to read it. */}
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<Link
					href={paths.category(lang, cat.slug)}
					className="flex min-w-0 items-center gap-2 font-medium hover:underline"
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
		<Shell measure={MEASURE}>
			<Trail
				items={[
					{ label: t("page.home"), href: paths.home(lang) },
					{ label: t("page.categories") },
				]}
			/>

			<h1 className="mt-4 font-display text-3xl font-bold tracking-tight">
				{t("cats.title")}
			</h1>
			<p className="mt-2 max-w-2xl text-pretty text-sm text-muted">
				{t("cats.blurb")}
			</p>

			<nav aria-label={t("cats.themes")} className="mt-6">
				<h2 className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
					{t("cats.themes")}
				</h2>
				<ul className="mt-2 flex flex-wrap gap-2">
					{groups.map((g) => (
						<li key={g.group}>
							<a
								href={`#${GROUP_ID}${g.group}`}
								className="flex items-center gap-2 rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-1.5 text-sm hover:border-brand"
							>
								{t(`catGroup.${g.group}` as Key)}
								<span className="nums text-xs text-muted">{g.cats.length}</span>
							</a>
						</li>
					))}
				</ul>
			</nav>

			{groups.map((g) => (
				<section key={g.group} id={`${GROUP_ID}${g.group}`} className="mt-10">
					<div className="flex flex-wrap items-baseline gap-x-3">
						<h2 className="font-display text-xl font-bold tracking-tight">
							{t(`catGroup.${g.group}` as Key)}
						</h2>
						<p className="nums text-xs text-muted">
							{g.cats.length} {t("cats.inGroup")} ·{" "}
							{g.cats.reduce(
								(n, c) => n + (stats.get(c.slug)?.products ?? 0),
								0,
							)}{" "}
							{t("stats.products")}
						</p>
					</div>
					<ul className="mt-3 space-y-2">
						{g.cats.map((c) => (
							<CategoryRow key={c.slug} cat={c} ctx={ctx} />
						))}
					</ul>
				</section>
			))}

			<EditThisPage file={CATEGORY_FILE} t={t} className="mt-10" />
		</Shell>
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
		<li className={CARD}>
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
				<RepoFreshness source={project.source} t={t} lang={lang} full />
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
		<Shell measure={MEASURE}>
			<Trail
				items={[
					{ label: t("page.home"), href: paths.home(lang) },
					{ label: t("page.projects") },
				]}
			/>

			<h1 className="mt-4 font-display text-3xl font-bold tracking-tight">
				{t("projects.title")}
			</h1>
			<p className="mt-2 max-w-2xl text-pretty text-sm text-muted">
				{t("projects.blurb")}
			</p>

			<div className="mt-6 flex flex-wrap items-center gap-2">
				<input
					value={filters.q}
					onChange={(e) => setFilters({ ...filters, q: e.target.value })}
					placeholder={t("projects.searchPlaceholder")}
					aria-label={t("projects.searchPlaceholder")}
					className="min-w-0 flex-1 rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand sm:min-w-52"
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

			{filtering && (
				<p className="nums mt-2 text-xs text-muted">
					{shown.length} {t("projects.unit")} · {t("filter.filteredNote")}
				</p>
			)}

			<ul className={`mt-6 ${GRID_1COL} gap-2 sm:grid-cols-2`}>
				{shown.map((p) => (
					<ProjectRow key={p.slug} project={p} ctx={ctx} />
				))}
			</ul>

			{shown.length === 0 && (
				<p className="py-12 text-center text-sm text-muted">
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
		</Shell>
	);
}

/** The index of the derived collections. Six rows, each a real slice. */
export function CollectionsPage({ ctx }: { ctx: PageCtx }) {
	const { t, lang } = ctx;
	return (
		<Shell measure={MEASURE}>
			<Trail
				items={[
					{ label: t("page.home"), href: paths.home(lang) },
					{ label: t("page.collections") },
				]}
			/>

			<h1 className="mt-4 font-display text-3xl font-bold tracking-tight">
				{t("collections.title")}
			</h1>
			<p className="mt-2 max-w-2xl text-pretty text-sm text-muted">
				{t("collections.blurb")}
			</p>

			<ul className={`mt-8 ${GRID_1COL} gap-2 sm:grid-cols-2`}>
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
						<li
							key={c.slug}
							className="rounded-[calc(var(--radius))] border border-border bg-surface p-4"
						>
							<Link
								href={paths.collection(lang, c.slug)}
								className="font-display font-semibold hover:underline"
							>
								{t(`collection.${c.slug}.title` as Key)}
							</Link>
							<p className="mt-1.5 text-sm text-muted">
								{t(`collection.${c.slug}.blurb` as Key)}
							</p>
							{/* Counted from the catalogue in hand, so it says nothing at all
							    rather than a wrong number before the API answers. */}
							{count !== null && (
								<p className="nums mt-2 text-xs text-muted">
									{count}{" "}
									{c.of === "product"
										? t("stats.products")
										: t("projects.unit")}
								</p>
							)}
						</li>
					);
				})}
			</ul>

			{/* The one the owner asked for and that is not here. Saying so on the page
			    is cheaper than letting somebody re-derive the same dead end. */}
			<p className="mt-6 max-w-2xl text-xs text-muted">
				{t("collections.rejectedNote")}{" "}
				<Link
					href={paths.projects(lang)}
					className="text-brand hover:underline"
				>
					{t("projects.title")}
				</Link>
				.
			</p>
		</Shell>
	);
}

/** One collection, paginated. Products or projects, depending on the slug. */
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
		<Shell measure={MEASURE}>
			<Trail
				items={[
					{ label: t("page.home"), href: paths.home(lang) },
					{ label: t("page.collections"), href: paths.collections(lang) },
					{ label: title },
				]}
			/>

			<h1 className="mt-4 font-display text-3xl font-bold tracking-tight">
				{title}
			</h1>
			<p className="mt-2 max-w-2xl text-pretty text-sm text-muted">
				{t(`collection.${slug}.blurb` as Key)}
			</p>
			{/* How the membership is derived, in one line, on the page itself. A
			    collection nobody can check is a list somebody could have made up. */}
			<p className="mt-2 max-w-2xl text-xs text-muted">
				{t(`collection.${slug}.derivation` as Key)}
			</p>

			<div className="mt-6 flex flex-wrap items-center gap-2">
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
				<section className="mt-10">
					<Heading>
						{t("collection.unresolved")} · {unresolved.length}
					</Heading>
					<p className="mb-3 max-w-2xl text-xs text-muted">
						{t(`collection.${slug}.unresolvedNote` as Key)}
					</p>
					<ul className="flex flex-wrap gap-2">
						{unresolved.map((p) => {
							const s = ctx.projectSlugs.get(p.slug);
							return (
								<li key={p.slug}>
									{s ? (
										<Link
											href={paths.project(lang, s)}
											className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-xs hover:border-brand"
										>
											{p.name}
										</Link>
									) : (
										<span className="inline-block rounded-full border border-border bg-surface px-3 py-1.5 text-xs">
											{p.name}
										</span>
									)}
								</li>
							);
						})}
					</ul>
				</section>
			)}
		</Shell>
	);
}
