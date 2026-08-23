import {
	byWeight,
	COLLECTIONS,
	collectionMembers,
	memberCount,
	pageBounds,
	pageSlice,
} from "core/src/collections";
import type {
	CategoryStat,
	HealthFile,
	PriceFreshness,
	Project,
	Verdict,
} from "core/src/content";
import { categoryStats, collectProjects } from "core/src/content";
import type { FeatureFile } from "core/src/features";
import { isLang, type Lang } from "core/src/index";
import {
	alternateUrls,
	buildProjectSlugs,
	LEGAL_DOCS,
	parseRoute,
	paths,
	type Route,
} from "core/src/routes";
import { Heart, Languages, Moon, Sun, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminPage } from "./AdminPage";
import { isHouseSlot } from "./ads";
import { startAdTracking } from "./adTracking";
import {
	type AdStats,
	api,
	type Campaigns,
	type Category,
	healthOf,
	type ListedProduct,
	type SiteStats,
	type Slot,
	type Stats,
	type Team,
} from "./api";
import {
	ActiveFilters,
	applyProductFilters,
	FilterSheet,
	filtersFromQuery,
	filtersToQuery,
	Hidden,
	isFiltered,
	NO_FILTERS,
	PageCount,
	Pager,
	type ProductFilters,
	ResultsLive,
	VerdictPills,
} from "./browse";
import { GRID_1COL, SponsorSlot, VerdictMark } from "./components";
import { REPO } from "./contribute";
import { Dashboard } from "./Dashboard";
import { ProductList } from "./designs";
import { FeaturesPage } from "./FeaturesPage";
import { AdsSection, ContactSection, SubmitSection } from "./Forms";
import { detectLang, type Key, useI18n, useTheme } from "./i18n";
import { LegalIndexPage, LegalPage, legalCopy } from "./legal";
import { MEASURE } from "./listShared";
import { Mark } from "./Mark";
import { Link, navigate } from "./nav";
import {
	AboutPage,
	CategoriesPage,
	CategoryPage,
	CollectionPage,
	CollectionsPage,
	GapsPage,
	GlossaryPage,
	GroupPage,
	type PageCtx,
	ProductPage,
	ProductsIndexPage,
	ProjectPage,
	ProjectsIndexPage,
} from "./pages";
import { SignInPage } from "./SignInPage";
import { SponsorRail, SponsorTape } from "./SponsorRails";
import { StatsPage } from "./StatsPage";
import {
	applyMeta,
	categoriesMeta,
	categoryMeta,
	collectionMeta,
	collectionsMeta,
	groupMeta,
	homeMeta,
	legalMeta,
	productMeta,
	productsMeta,
	projectMeta,
	projectsMeta,
	standingMeta,
} from "./seo";

const VERDICTS: Verdict[] = ["yes", "almost", "not-yet"];

// What the prerendered document shipped with, inlined by scripts/prerender.ts.
// Every page carries exactly the slice it renders (one product, or the
// products in one category); the API call afterwards widens it to the whole
// catalogue. Absent (dev server, plain `rsbuild build`) means a normal client
// render from empty state.
type Boot = {
	products: ListedProduct[];
	categories: Category[];
	/** The ten hero positions and the ten rail ones, with their occupancy as at
	 *  build time — no creative, see `slotBoard` in prerender.ts. Here so the
	 *  sponsor wall and the marquee are part of the first paint: waiting for
	 *  /api/slots was 0.549 of the home page's 0.551 CLS, because the marquee is
	 *  a sibling above the entire main column and its arrival moved everything
	 *  under it. The per-category inventory still arrives with the API. */
	slots?: Slot[];
	/** Forge id → pretty slug, computed over the FULL catalogue at build time
	 *  so collisions resolve the same way regardless of which page's slice loads. */
	projectSlugs: [string, string][];
	/** Over the FULL catalogue — the footer line is a claim about the whole site. */
	freshness?: PriceFreshness;
	/**
	 * The other products in this product's category, card-shaped.
	 *
	 * A product page ships only its own entry, so the neighbours it links to
	 * sideways cannot be derived in the browser. Built by `relatedProducts` in
	 * listShared.tsx at prerender time. Absent everywhere else.
	 */
	related?: ListedProduct[];
	/**
	 * `[slug, name, category]` for every product, on the products index and
	 * nowhere else. That index names all 592, so it carries three strings each
	 * rather than the ~7 kB a full list row costs.
	 */
	productIndex?: [string, string, string][];
	/** Per-category counts over the FULL catalogue, for the category menu. */
	categoryStats?: [string, CategoryStat][];
	/** Repo liveness for the repos THIS page cites, not all of them. Read
	 *  through `healthOf` in api.ts, which falls back to disk when absent. */
	health?: HealthFile;
	/** The feature values for THIS page's projects only, same slicing rule as
	 *  `health`. Present so the block is in the prerendered HTML rather than
	 *  appearing after hydration — on an SEO-driven site a fact only a browser
	 *  can see is a fact crawlers and LLM answers never quote. */
	features?: FeatureFile;
	/** Pre-derived rows for an index page whose rows are PROJECTS (the
	 *  alternatives index, the open-core collection) — cannot be reconstructed
	 *  from a product payload since products cite projects outside the set. */
	projectRows?: Project[];
	projectTotal?: number;
	/** Member counts per collection over the WHOLE catalogue, so a collection
	 *  page's own slice doesn't make the pager think there's only one page. */
	collectionCounts?: [string, number][];
	/** Projects a collection can't make a claim about, because their own
	 *  citations disagree about the field it's built from. */
	unresolvedRows?: Project[];
	/** The headline counts, on the home pages only — the one place they render.
	 *  They used to arrive with /api/stats, so every prerendered home page shipped
	 *  three em dashes where 592, 6485 and 43 belong. Every figure is known at
	 *  build time; see `siteStats` in scripts/prerender.ts. */
	stats?: Stats;
};

/** Read at render time, not at import time: the prerenderer reuses one module
 *  instance across every page and swaps this between them. */
const boot = (): Boot | undefined =>
	(globalThis as { __DATA__?: Boot }).__DATA__;

// The hero showcase — ten positions, under the headline, each either a sold
// sponsor or an open one advertising itself. All ten are priced in
// `data/sponsors/slots.json`; an unpriced slot still renders as "price on
// request" rather than $0, since `priceCents: null` is a supported state.
function HeroShowcase({
	slots,
	t,
	tc,
	lang,
}: {
	slots: Slot[];
	t: (k: Key) => string;
	tc: (v: { en: string }) => string;
	lang: Lang;
}) {
	return (
		<section className={`mx-auto ${MEASURE} px-4 pt-6 pb-10`}>
			{/* `gap-px` over a border-coloured background makes one shared 1px grid
			    instead of stacked card borders. Column counts (2, then 5) are
			    divisors of ten so no row is left with a dangling trailing cell. */}
			<div className="grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border sm:grid-cols-5">
				{slots.map((s, i) => (
					<SponsorSlot
						key={s.id}
						slot={s}
						t={t}
						tc={tc}
						lang={lang}
						compact
						house={isHouseSlot(s, i, slots.length)}
					/>
				))}
			</div>
			<p className="mt-3 text-center text-muted text-xs">
				{t("hero.sponsorsIntro")}{" "}
				<Link href={paths.sponsor(lang)} className="text-brand hover:underline">
					{t("hero.sponsorsCta")}
				</Link>
			</p>
		</section>
	);
}

/**
 * Which nav entry owns each route.
 *
 * A detail page belongs to its index — a reader on `/en/tools/appflowy` is in
 * "Alternatives" — so the header marks the section they are browsing rather than
 * only the eight URLs that are themselves nav destinations. Routes with no entry
 * in the nav (the dashboard, the legal pages) map to nothing on purpose: marking
 * a link the reader is not under is worse than marking none.
 */
const SECTION_OF: Record<Route["name"], string> = {
	home: "list",
	product: "list",
	products: "list",
	// An unknown URL renders the list, so the header has to agree with the body.
	unknown: "list",
	project: "projects",
	projects: "projects",
	category: "categories",
	categories: "categories",
	group: "categories",
	collection: "collections",
	collections: "collections",
	features: "features",
	glossary: "glossary",
	gaps: "list",
	about: "",
	stats: "stats",
	sponsor: "sponsor",
	submit: "submit",
	contact: "",
	signin: "",
	dashboard: "",
	admin: "",
	legal: "",
};

function Header({
	t,
	route,
	theme,
	toggleTheme,
	signedIn,
}: {
	t: (k: Key) => string;
	route: Route;
	theme: string;
	toggleTheme: () => void;
	/** The signed-in advertiser's email, or null. */
	signedIn: string | null;
}) {
	const lang = route.lang;
	const other: Lang = lang === "fr" ? "en" : "fr";

	/** Which nav entry the current URL belongs under. */
	const section = SECTION_OF[route.name];

	/**
	 * The whole sitewide nav: eight links, rendered exactly once.
	 *
	 * WHAT THIS USED TO BE. Ten themes, ten categories and thirteen collections
	 * in three dropdowns, plus a mobile sheet that rendered every one of them a
	 * second time and hid it with CSS — 88 anchors for 43 unique URLs, on all
	 * 8,864 documents. The measured result was that `/en/legal/cookies/` carried
	 * the same inbound authority as the home page and a twelve-product category
	 * carried three hundred times more than `/en/alternatives/notion/`.
	 *
	 * The grids were not deleted, they were moved to the two hubs that already
	 * existed for them: `/categories/` carries all 85 categories AND all ten
	 * theme hubs, `/collections/` carries all thirteen collections. Both are one
	 * click from here.
	 *
	 * No counts in the labels either: "Open source 3420" changes on every build,
	 * so the anchor text of 8,864 links churned on every deploy.
	 */
	const links = [
		{ href: paths.home(lang), label: t("nav.list"), section: "list" },
		{
			href: paths.projects(lang),
			label: t("nav.projects"),
			section: "projects",
		},
		{
			href: paths.categories(lang),
			label: t("nav.categories"),
			section: "categories",
		},
		{
			href: paths.collections(lang),
			label: t("nav.collections"),
			section: "collections",
		},
		// Beside Alternatives on purpose: the feature explorer's rows ARE the
		// projects, so the reader who wants "which of these does SSO" is the reader
		// who just came from that index.
		{
			href: paths.features(lang),
			label: t("nav.features"),
			section: "features",
		},
		// The catalogue's own vocabulary, and the destination every jargon tooltip
		// points at — including on a phone, where there is no hover.
		{
			// "Glossary" here, "What the words mean" in the footer: one URL, two
			// honest anchors, and the nav row stays a row.
			href: paths.glossary(lang),
			label: t("nav.glossary"),
			section: "glossary",
		},
	];

	// The two icon-only controls in the action cluster. Same box, so they read as
	// a pair rather than as two unrelated buttons that happen to be adjacent.
	const iconBtn =
		"grid size-9 shrink-0 place-items-center rounded-[calc(var(--radius))] border border-border bg-surface text-muted transition hover:border-brand hover:text-text";

	return (
		<header className="sticky top-0 z-40 border-border border-b bg-bg/80 backdrop-blur-md">
			<div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 lg:py-2.5 xl:gap-x-5">
				<Link
					href={paths.home(lang)}
					className="group flex shrink-0 items-center gap-2 font-bold font-display text-base tracking-tight"
				>
					<Mark className="size-6 shrink-0" />
					{/* "replace" is the verb the whole site is about, so it carries the
					    colour; the question around it stays in the text colour. */}
					<span>
						can<span className="text-muted">i</span>
						<span style={{ color: "var(--brand)" }}>replace</span>it
					</span>
				</Link>

				{/*
				 * One row, rendered once, reflowed by CSS.
				 *
				 * The desktop `<nav>` and a mobile `<details>` sheet used to BOTH
				 * render in full and hide each other with `hidden`/`lg:hidden`, which
				 * is how 43 unique hrefs became 88 anchors in every document. There is
				 * one subtree now: inline beside the wordmark from `lg` up, and below
				 * it a second row that scrolls sideways on a phone. Eight short labels
				 * fit that row; the three dropdown grids that did not are on
				 * /categories/ and /collections/.
				 */}
				<nav
					aria-label={t("nav.menu")}
					className="-mx-4 order-last flex w-full items-center gap-4 overflow-x-auto whitespace-nowrap px-4 pb-0.5 text-muted text-sm [scrollbar-width:none] lg:order-none lg:mx-0 lg:ml-auto lg:w-auto lg:overflow-x-visible lg:px-0 lg:pb-0 xl:gap-5 [&::-webkit-scrollbar]:hidden"
				>
					{links.map((l) => (
						<Link
							key={l.href}
							href={l.href}
							className="nav-link"
							data-current={section === l.section}
						>
							{l.label}
						</Link>
					))}
					{/* Ruled off from the six: this is what a reader can GIVE the site,
					    not another part of the catalogue to read. */}
					<span className="h-5 w-px shrink-0 bg-border" aria-hidden />
					<Link
						href={paths.sponsor(lang)}
						className="btn-primary shrink-0 px-3 py-1.5 text-xs"
						data-current={section === "sponsor"}
					>
						{t("nav.sponsor")}
					</Link>
				</nav>

				<div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
					{/* An advertiser has no other way in — the dashboard URL is not
					    something anyone guesses — so this lives on every page. */}
					<Link
						href={signedIn ? paths.dashboard(lang) : paths.signin(lang)}
						className="flex max-w-[12rem] items-center gap-1.5 truncate rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-2 text-xs transition hover:border-brand"
						title={signedIn ?? undefined}
						aria-label={signedIn ?? t("nav.signin")}
					>
						<UserRound className="size-3.5 shrink-0" aria-hidden />
						<span className="hidden min-w-0 truncate lg:inline">
							{signedIn ?? t("nav.signin")}
						</span>
					</Link>
					{/* The locale lives in the path, so switching it is a navigation to
					    the same page under the other language — never a state flip. */}
					<a
						href={alternateUrls(route)[other]}
						onClick={(e) => {
							if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
							e.preventDefault();
							// The query carries page state the path does not; `href` stays
							// bare so prerender and first client render agree, and only the
							// click preserves it.
							navigate(alternateUrls(route)[other] + location.search);
						}}
						aria-label={t("ui.language")}
						className="flex h-9 shrink-0 items-center gap-1.5 rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 text-muted text-xs uppercase transition hover:border-brand hover:text-text"
					>
						<Languages className="size-3.5" aria-hidden />
						{other}
					</a>
					<button
						type="button"
						onClick={toggleTheme}
						// The control is a two-state switch, so it says which state it is
						// in — both as a pressed state and in the name itself, since
						// "Toggle theme" alone never told anyone which theme was on.
						aria-pressed={theme === "dark"}
						aria-label={`${t("theme.toggle")} — ${t(
							theme === "dark" ? "theme.dark" : "theme.light",
						)}`}
						className={iconBtn}
					>
						{theme === "dark" ? (
							<Sun className="size-4" aria-hidden />
						) : (
							<Moon className="size-4" aria-hidden />
						)}
					</button>
				</div>
			</div>
		</header>
	);
}

/**
 * The names that cycle in the headline. Fixed, not the top of the list: whatever
 * sorts first is often something the reader has never bought, and the headline
 * only works if it names a bill they actually pay. Ten one-word products with a
 * narrow length spread, so the reserved width stays close to the rendered one.
 */
const HERO_NAMES = [
	"Notion",
	"Figma",
	"Slack",
	"Datadog",
	"Airtable",
	"Zendesk",
	"Postman",
	"Calendly",
	"Tailscale",
	"Jira",
];

/**
 * The name the swap cell reserves its width for.
 *
 * Width is what stops the reflow, not character count: "Postman" draws 136.1px
 * where "Tailscale" — the longest string — draws 132.3px at the headline's size,
 * so sizing on `.length` would under-reserve and let the heading jump.
 *
 * It reaches the page as `data-sizer` and is drawn by `.hero-swap::before`, so
 * the cell keeps the exact geometry the ten stacked spans used to give it
 * without putting nine extra brand names in the document. Re-measure if
 * HERO_NAMES changes.
 */
const HERO_SIZER = "Postman";

/** Counts up after hydration; prerender and reduced motion get the final figure. */
function CountUp({ value }: { value: number }) {
	const [shown, setShown] = useState(value);
	useEffect(() => {
		if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const t0 = performance.now();
		const dur = 900;
		let raf = 0;
		const tick = (now: number) => {
			const p = Math.min(1, (now - t0) / dur);
			// ease-out cubic: fast start, settles on the real figure.
			setShown(Math.round(value * (1 - (1 - p) ** 3)));
			if (p < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [value]);
	return <>{shown}</>;
}

function Hero({
	names,
	stats,
	t,
	lang,
}: {
	names: string[];
	stats: Stats | null;
	t: (k: Key) => string;
	lang: Lang;
}) {
	const [i, setI] = useState(0);
	useEffect(() => {
		if (names.length === 0) return;
		// 2s is too fast to read a name and register the question around it.
		const id = setInterval(() => setI((n) => (n + 1) % names.length), 2800);
		return () => clearInterval(id);
	}, [names.length]);

	return (
		<section id="top" className="page-head">
			<div className="mx-auto max-w-4xl px-4 pt-14 pb-12 text-center sm:pt-20 sm:pb-16">
				{/* Clamped rather than two breakpoints: the headline holds a cycling
			    product name, so its length changes while the reader is looking at it,
			    and a step change in size at 640px is the one thing that would make
			    that obvious. */}
				<h1 className="text-balance font-bold font-display text-[clamp(2rem,1.2rem+3.6vw,3.25rem)] leading-[1.1]">
					{t("hero.title")} {/*
					 * One name in the DOM, not ten.
					 *
					 * All ten used to stack in this cell — nine of them `aria-hidden`
					 * and `invisible` — so the cell was always as wide as the widest
					 * and cycling could not reflow the heading. It also made
					 * `h1.textContent` read "Can I replace NotionFigmaSlack…Jira?",
					 * which is a keyword list in the one heading the site is ranked on.
					 * The width reservation now comes from `.hero-swap::before`, which
					 * draws HERO_SIZER in the same grid cell and is not document text.
					 */}
					<span
						className="hero-swap border-b-[3px] px-1 align-baseline"
						data-sizer={HERO_SIZER}
						style={{ color: "var(--brand)", borderColor: "var(--brand)" }}
					>
						{/* Keyed by index so React remounts the span and `name-swap`
						    replays, rather than mutating text in place. */}
						<span key={i} className="name-swap">
							{names[i]}
						</span>
					</span>
					{/* French puts a non-breaking space before a question mark; English does not. */}
					{lang === "fr" ? " ?" : "?"}
				</h1>
				<p className="mx-auto mt-5 max-w-2xl text-pretty text-lg text-muted leading-relaxed">
					{t("hero.blurb")}
				</p>

				<div className="mt-7 flex flex-wrap items-center justify-center gap-3">
					<a href="#list" className="btn-primary">
						{t("nav.list")}
					</a>
				</div>

				{/* A published 0 would read as "broken", not "new", so the switches
			    tile only exists once there's a switch to report. */}
				<dl
					className={`mx-auto mt-10 grid max-w-2xl gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border shadow-[var(--shadow-sm)] ${stats?.switches ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}
				>
					{(
						[
							["stats.products", stats?.products],
							["stats.alternatives", stats?.ossAlternatives],
							["stats.noAnswer", stats?.notYet],
							...(stats?.switches
								? ([
										[
											stats.switches === 1
												? "stats.switchesOne"
												: "stats.switches",
											stats.switches,
										],
									] as const)
								: []),
						] as const
					).map(([key, value]) => (
						/* dt before dd, per the content model; column-reverse keeps the
						   figure above its label. */
						<div
							key={key}
							className="flex flex-col-reverse bg-surface px-3 py-4"
						>
							<dt className="mt-1 text-[10px] text-muted uppercase tracking-widest">
								{t(key)}
							</dt>
							<dd className="nums font-bold text-2xl">
								{value !== undefined && value !== null ? (
									<CountUp value={value} />
								) : (
									"—"
								)}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}

// A path with no locale can't be rendered, so pick a language once here and
// rewrite the address below.
const initialRoute = (): Route => {
	const route = parseRoute(new URL(location.href));
	return isLang(location.pathname.split("/")[1])
		? route
		: { name: "home", lang: detectLang() };
};

/** One route, one page. `home` and `unknown` are handled by App itself. */
function Page({ ctx, route }: { ctx: PageCtx; route: Route }) {
	switch (route.name) {
		case "product":
			return <ProductPage ctx={ctx} slug={route.slug} />;
		case "project":
			return <ProjectPage ctx={ctx} slug={route.slug} />;
		case "category":
			return <CategoryPage ctx={ctx} slug={route.slug} />;
		case "group":
			return <GroupPage ctx={ctx} slug={route.slug} />;
		case "glossary":
			return <GlossaryPage ctx={ctx} />;
		case "gaps":
			return <GapsPage ctx={ctx} />;
		case "about":
			return <AboutPage ctx={ctx} />;
		case "categories":
			return <CategoriesPage ctx={ctx} />;
		case "products":
			return <ProductsIndexPage ctx={ctx} />;
		case "projects":
			return <ProjectsIndexPage ctx={ctx} page={route.page} />;
		case "collections":
			return <CollectionsPage ctx={ctx} />;
		case "collection":
			return <CollectionPage ctx={ctx} slug={route.slug} page={route.page} />;
		case "sponsor":
			return (
				<main id="main">
					<AdsSection
						onPurchased={ctx.onPurchased}
						slots={ctx.slots}
						adStats={ctx.adStats}
						preselect={route.slot}
						t={ctx.t}
						tc={ctx.tc}
						lang={ctx.lang}
					/>
				</main>
			);
		case "submit":
			return (
				<main id="main">
					<SubmitSection t={ctx.t} lang={ctx.lang} />
				</main>
			);
		case "features":
			return (
				<FeaturesPage
					products={ctx.products}
					categories={ctx.categories}
					t={ctx.t}
					tc={ctx.tc}
					trail={[
						{ label: ctx.t("page.home"), href: paths.home(ctx.lang) },
						{ label: ctx.t("nav.features") },
					]}
				/>
			);
		case "stats":
			return <StatsPage stats={ctx.siteStats} t={ctx.t} lang={ctx.lang} />;
		case "signin":
			return <SignInPage t={ctx.t} />;
		case "dashboard":
			return (
				<Dashboard
					data={ctx.campaigns}
					team={ctx.team}
					loading={ctx.campaignsLoading}
					t={ctx.t}
					lang={ctx.lang}
					onSignOut={ctx.onSignOut}
					onTeamChanged={ctx.onTeamChanged}
				/>
			);
		// Fetches its own three endpoints after hydration — nothing else on the site
		// needs them, so they stay out of App's own data effect.
		case "admin":
			return <AdminPage t={ctx.t} tc={ctx.tc} lang={ctx.lang} />;
		case "contact":
			return (
				<main id="main">
					<ContactSection t={ctx.t} lang={ctx.lang} />
				</main>
			);
		case "legal":
			return route.doc ? (
				<LegalPage lang={ctx.lang} doc={route.doc} />
			) : (
				<LegalIndexPage lang={ctx.lang} />
			);
		default:
			return null;
	}
}

/** The home page's hand-off to the four standing pages. */
const fLink = "text-muted transition hover:text-text hover:underline";

/** One labelled column. A real heading, so the group survives a screen reader. */
function FooterColumn({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<h2 className="eyebrow text-text">{title}</h2>
			<ul className={`mt-3.5 ${GRID_1COL} gap-2.5 text-sm`}>{children}</ul>
		</div>
	);
}

/** External links leave for the forge, so they say so. */
function Out({ href, children }: { href: string; children: React.ReactNode }) {
	return (
		<a href={href} target="_blank" rel="noopener" className={fLink}>
			{children}
		</a>
	);
}

// Three labelled columns, grouped by what a reader came to do, plus the
// policy line. Every URL is built by `paths`, never a template literal — the
// segment table is localized and a hand-written `/fr/tools/x` is a silent 404.
function SiteFooter({ route, t }: { route: Route; t: (k: Key) => string }) {
	const lang = route.lang;
	const other: Lang = lang === "fr" ? "en" : "fr";

	return (
		<footer className="mt-auto border-border border-t">
			<div className={`mx-auto ${MEASURE} px-4 py-14`}>
				{/* The positioning statement. It is the promise the whole catalogue
				    rests on, so it is the first thing in the footer and the only line
				    here at reading size. */}
				<p
					className="max-w-3xl text-pretty border-l-[3px] pl-5 font-medium text-base leading-relaxed sm:text-lg"
					style={{ borderColor: "var(--brand)" }}
				>
					{t("footer.policy")}{" "}
					<Link
						href={paths.sponsor(lang)}
						className="text-brand hover:underline"
					>
						{t("footer.policyMore")} →
					</Link>
				</p>

				<div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 lg:grid-cols-5">
					<FooterColumn title={t("footer.browse")}>
						<li>
							<Link href={paths.home(lang)} className={fLink}>
								{t("nav.list")}
							</Link>
						</li>
						<li>
							<Link href={paths.projects(lang)} className={fLink}>
								{t("nav.projects")}
							</Link>
						</li>
						<li>
							<Link href={paths.categories(lang)} className={fLink}>
								{t("nav.categories")}
							</Link>
						</li>
						<li>
							<Link href={paths.collections(lang)} className={fLink}>
								{t("nav.collections")}
							</Link>
						</li>
						<li>
							{/* The glossary sits under Browse: it is a reference for the
						    catalogue's own vocabulary, and it is where a phone reader —
						    who has no hover — goes to find out what a tag means. */}
							<Link href={paths.glossary(lang)} className={fLink}>
								{t("glossary.title")}
							</Link>
						</li>
						<li>
							{/*
							 * The gaps page had exactly ONE inbound link on the whole
							 * site — the French twin's language switcher — while being
							 * indexable, in the sitemap, and the most quotable thing
							 * here. It is also the only page that argues against the
							 * catalogue, which is why it is worth a permanent link.
							 *
							 * The anchor says what the page holds rather than repeating
							 * its title, so this is not a fourteenth copy of an anchor
							 * string that already exists elsewhere.
							 */}
							<Link href={paths.gaps(lang)} className={fLink}>
								{t("gaps.link")}
							</Link>
						</li>
					</FooterColumn>

					<FooterColumn title={t("footer.contribute")}>
						<li>
							<Link href={paths.submit(lang)} className={fLink}>
								{t("nav.submit")}
							</Link>
						</li>
						<li>
							<Out href={`${REPO}/tree/main/data/products`}>
								{t("edit.suggest")}
							</Out>
						</li>
						<li>
							<Out href={`${REPO}/issues/new?labels=correction`}>
								{t("submit.openIssue")}
							</Out>
						</li>
						<li>
							<Out href={`${REPO}/blob/main/CONTRIBUTING.md`}>
								{t("submit.contributing")}
							</Out>
						</li>
					</FooterColumn>

					<FooterColumn title={t("footer.about")}>
						<li>
							{/* Who writes the verdicts, how one is decided, and what
							    sponsorship does not buy. Linked from every page because
							    the Quality Rater Guidelines treat it as the starting
							    point for assessing whether any of this is trustworthy. */}
							<Link href={paths.about(lang)} className={fLink}>
								{t("about.title")}
							</Link>
						</li>
						<li>
							<Link href={paths.contact(lang)} className={fLink}>
								{t("nav.contact")}
							</Link>
						</li>
						<li>
							<Link href={paths.stats(lang)} className={fLink}>
								{t("nav.stats")}
							</Link>
						</li>
						<li>
							<Link href={paths.sponsor(lang)} className={fLink}>
								{t("nav.sponsor")}
							</Link>
						</li>
						<li>
							<Out href={REPO}>{t("footer.repo")}</Out>
						</li>
						<li>
							{/* A real href, crawlable with no bundle — the header's copy
							    owns the query-preserving click. */}
							<a
								href={alternateUrls(route)[other]}
								hrefLang={other}
								className={fLink}
							>
								{t("ui.language")}: {other.toUpperCase()}
							</a>
						</li>
					</FooterColumn>
					{/* Required pages, so they are linked from every page rather than
					    buried on one. LEGAL_DOCS drives the list: adding a document is
					    one line in routes.ts and it appears here. */}
					<FooterColumn title={t("footer.legal")}>
						{LEGAL_DOCS.map((doc) => (
							<li key={doc}>
								<Link href={paths.legal(lang, doc)} className={fLink}>
									{legalCopy(doc, lang).title}
								</Link>
							</li>
						))}
					</FooterColumn>
				</div>

				<div className="mt-12 flex flex-wrap items-center justify-between gap-2 border-border border-t pt-6 text-muted text-xs">
					<p>canireplaceit — {t("footer.tagline")}</p>
					<p className="flex items-center gap-1">
						{t("footer.madeWith")}
						<Heart
							className="size-3 shrink-0"
							style={{ color: "var(--brand)" }}
							fill="currentColor"
							aria-hidden
						/>
						{t("footer.by")}{" "}
						<a
							href="https://x.com/hadesdevs"
							target="_blank"
							rel="noopener"
							className="text-brand hover:underline"
						>
							@hadesdevs
						</a>
					</p>
				</div>
			</div>
		</footer>
	);
}

export function App() {
	const [route, setRoute] = useState<Route>(initialRoute);
	const lang = route.lang;

	useEffect(() => {
		// One listener for both the back button and our own `navigate`.
		const onPop = () => setRoute(parseRoute(new URL(location.href)));
		addEventListener("popstate", onPop);
		return () => removeEventListener("popstate", onPop);
	}, []);

	useEffect(() => {
		// `/` is not a page: replace it with the localized home so every URL the
		// reader can bookmark or share is one we prerender.
		if (!isLang(location.pathname.split("/")[1])) {
			history.replaceState({}, "", paths.home(lang));
		}
	}, [lang]);

	const { t, tc } = useI18n(lang);
	const { theme, toggle } = useTheme();

	const [products, setProducts] = useState<ListedProduct[]>(
		() => boot()?.products ?? [],
	);
	const [cats, setCats] = useState<Category[]>(() => boot()?.categories ?? []);
	const [slots, setSlots] = useState<Slot[]>(() => boot()?.slots ?? []);
	const [stats, setStats] = useState<Stats | null>(() => boot()?.stats ?? null);
	const [adStats, setAdStats] = useState<AdStats | null>(null);
	const [siteStats, setSiteStats] = useState<
		SiteStats | { unavailable: true } | null
	>(null);
	/** Null means "not signed in" once `campaignsLoading` is false. */
	const [campaigns, setCampaigns] = useState<Campaigns | null>(null);
	const [campaignsLoading, setCampaignsLoading] = useState(true);
	const [team, setTeam] = useState<Team | null>(null);

	// Refetches rather than patching the one slot locally: the board is derived
	// server-side from occupancy, and a second buyer may have taken something
	// while this form was open.
	const reloadSlots = () => {
		void api
			.slots()
			.then(setSlots)
			.catch(() => {});
	};

	/** Re-read both after a membership change, so the panel and the ads agree. */
	const refreshAccount = () => {
		void api
			.campaigns()
			.then(setCampaigns)
			.catch(() => setCampaigns(null));
		void api
			.team()
			.then(setTeam)
			.catch(() => setTeam(null));
	};
	// Filters live in React state only, never the URL: the pager owns URLs, and
	// filters are a reading aid on top of whichever page the reader is on.
	// Seeded from the URL so a shared link opens the view that was shared. Read
	// once, at mount: after that the URL follows the state, not the other way
	// round, or typing in the search box would fight the address bar.
	const [filters, setFilters] = useState<ProductFilters>(() =>
		typeof window === "undefined"
			? NO_FILTERS
			: filtersFromQuery(window.location.search),
	);
	const [voted, setVoted] = useState<Set<string>>(new Set());
	const [error, setError] = useState(false);

	/**
	 * The whole catalogue, fetched at most once and never on first paint.
	 *
	 * `window.__DATA__` already carries the slice this document renders, so a
	 * product page, a category page or page one of the list reproduces itself
	 * without asking the API for anything. Three things need more:
	 *
	 *   - a client-side navigation, which lands on a route this document shipped
	 *     no data for;
	 *   - a filter, which searches the whole catalogue rather than this page;
	 *   - no payload at all — the dev server, and the locale-less shell at `/`.
	 *
	 * None of the three happens during a cold load of a prerendered URL, which is
	 * every load a crawler or a search visitor makes.
	 */
	const catalogueAsked = useRef(false);
	const loadCatalogue = useCallback(() => {
		if (catalogueAsked.current) return;
		catalogueAsked.current = true;
		api
			.products()
			.then(setProducts)
			.catch(() => setError(true));
	}, []);

	// The route this document was prerendered for. Compared by identity: every
	// `parseRoute` after it returns a fresh object, so any navigation differs.
	const firstRoute = useRef(route);
	useEffect(() => {
		if (!boot() || route !== firstRoute.current || isFiltered(filters)) {
			loadCatalogue();
		}
	}, [route, filters, loadCatalogue]);

	// Impressions. Started once, outside the data effect, because it observes the
	// DOM rather than the data — the rails are `position: fixed` and never
	// unmount, so nothing about them is render-shaped. See adTracking.ts.
	useEffect(() => startAdTracking(), []);

	useEffect(() => {
		// Fire and forget: gets the voter cookie in place before anyone clicks,
		// so a vote is never the request that also mints the identity.
		void api.session().catch(() => {});

		// The full catalogue is deliberately NOT here. It is 1.7 MB gzipped, every
		// page was fetching it on boot to render content the prerendered HTML
		// already carried, and it cost ten seconds of LCP and 0.63 of CLS on the
		// home page. `loadCatalogue` below fetches it only when something actually
		// needs more than this page's own slice. The other three are a few
		// kilobytes each and every page renders them.
		Promise.all([api.categories(), api.slots(), api.stats()])
			.then(([c, s, st]) => {
				setCats(c);
				setSlots(s);
				setStats(st);
			})
			.catch(() => setError(true));

		// Separate, and deliberately not part of the `Promise.all` above: the ad
		// numbers are for a buyer scrolling to the sponsor section, and a page must
		// never fail to render its list because the analytics query was slow.
		api
			.adStats()
			.then(setAdStats)
			.catch(() => {});

		// Same reasoning: the stats page's figures come from Umami over the network,
		// and every other page must render whether or not that answers.
		api
			.siteStats()
			.then(setSiteStats)
			.catch(() => setSiteStats({ unavailable: true }));

		// A 401 here is the normal case — most readers are not advertisers — so it
		// resolves to "not signed in" rather than being treated as an error.
		api
			.campaigns()
			.then(setCampaigns)
			.catch(() => setCampaigns(null))
			.finally(() => setCampaignsLoading(false));

		// A 401 here is the normal case for a reader who is not an advertiser.
		api
			.team()
			.then(setTeam)
			.catch(() => setTeam(null));
	}, []);

	// Ten hero positions, in the authored order. `position` is the sold order, so
	// it drives the layout rather than whatever order the API returned rows in.
	const heroSlots = slots
		.filter((s) => s.placement === "hero")
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	const vote = (slug: string) => {
		setVoted((prev) => new Set(prev).add(slug));
		api
			.vote(slug)
			.then(({ switchedCount }) =>
				setProducts((prev) =>
					prev.map((p) => (p.slug === slug ? { ...p, switchedCount } : p)),
				),
			)
			.catch(() => setError(true));
	};

	// Projects are derived from the products, exactly as the prerenderer derives
	// them, so the two can never disagree about what exists or what it is called.
	const projects = useMemo(() => collectProjects(products), [products]);
	const projectSlugs = useMemo(() => {
		const derived = buildProjectSlugs(
			projects,
			products.map((p) => p.slug),
		);
		// The baked map came from the whole catalogue, so it is right both before
		// the API answers (when `derived` only saw this page's slice) and after
		// (when the two agree anyway).
		for (const [id, slug] of boot()?.projectSlugs ?? []) derived.set(id, slug);
		return derived;
	}, [projects, products]);
	const projectBySlug = useMemo(
		() =>
			new Map(
				projects.map((p) => [projectSlugs.get(p.slug) as string, p] as const),
			),
		[projects, projectSlugs],
	);

	// The baked map wins whenever there is one, since it was computed over the
	// whole catalogue at build time; the dev server has no payload and falls
	// back to deriving it.
	const catStats = useMemo(() => {
		const baked = boot()?.categoryStats;
		return baked ? new Map(baked) : categoryStats(products);
	}, [products]);

	// Whole catalogue in hand, or just the slice this page shipped with?
	// Slicing page 3 out of a payload that already IS page 3 renders nothing.
	const catalogueTotal = boot()?.freshness?.total ?? products.length;
	const wholeCatalogue = products.length >= catalogueTotal;

	// byWeight is the spine: editorial priority, then a byte-wise name compare.
	// Votes are deliberately not in it — they change nightly, and a page whose
	// membership churns is a URL that means something different every week.
	const homeRequested = route.name === "home" ? (route.page ?? 1) : 1;
	const { page: homePage, pages: homePages } = pageBounds(
		catalogueTotal,
		homeRequested,
	);
	const ordered = useMemo(() => byWeight(products), [products]);
	// The catalogue size is a fact, not a string: it was hardcoded as "493" in
	// both locales and read 34 short next to a stat block saying 527.
	const searchPlaceholder = t("hero.searchPlaceholder").replace(
		"{n}",
		String(catalogueTotal),
	);

	const pageProducts = wholeCatalogue ? pageSlice(ordered, homePage) : ordered;

	// A filtered view searches the whole catalogue, not this page — "no
	// results" has to mean "nowhere", not "not on page 3".
	const filtering = isFiltered(filters);

	/**
	 * The URL follows the filters, on the home list only.
	 *
	 * `replaceState`, not `push`: a filter is a refinement of the page you are
	 * on, and pushing one history entry per keystroke would make Back unusable.
	 * Only on `home` — every other route owns its own query string (the sponsor
	 * page's `slot`, the features page's `cmp`), and stamping filters over those
	 * would clobber them.
	 */
	useEffect(() => {
		if (route.name !== "home" || typeof window === "undefined") return;
		const qs = filtersToQuery(filters);
		window.history.replaceState(
			null,
			"",
			qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
		);
	}, [filters, route.name]);
	const result = useMemo(
		() => applyProductFilters(filtering ? ordered : pageProducts, filters),
		[filtering, ordered, pageProducts, filters],
	);
	const shown = result.shown;

	const ctx: PageCtx = {
		lang,
		t,
		tc,
		products,
		categories: cats,
		projects,
		wholeCatalogue,
		related: boot()?.related ?? [],
		productIndex: boot()?.productIndex ?? [],
		projectRows: boot()?.projectRows ?? [],
		projectTotal: boot()?.projectTotal ?? projects.length,
		collectionCounts: new Map(boot()?.collectionCounts ?? []),
		unresolvedRows: boot()?.unresolvedRows ?? [],
		projectBySlug,
		projectSlugs,
		onVote: (slug) => vote(slug),
		voted,
		slots,
		adStats,
		siteStats,
		campaigns,
		campaignsLoading,
		onPurchased: reloadSlots,
		team,
		onTeamChanged: refreshAccount,
		onSignOut: () => {
			void api.signOut().finally(() => {
				setCampaigns(null);
				navigate(paths.home(route.lang));
			});
		},
		stats: catStats,
	};

	// The prerendered head is already correct for the URL we landed on; this keeps
	// it correct after a client-side navigation.
	useEffect(() => {
		if (products.length === 0) return;
		const meta = (() => {
			switch (route.name) {
				case "product": {
					const p = products.find((x) => x.slug === route.slug);
					return p
						? productMeta(
								p,
								lang,
								cats.find((c) => c.slug === p.category),
								{
									projectSlugs,
									// The same resolver the page's own components read through, so
									// the verdict sentence in the markup names the project the
									// article names.
									healthOf,
								},
							)
						: null;
				}
				case "project": {
					const pr = projectBySlug.get(route.slug);
					if (!pr) return null;
					// The same three things the prerenderer hands it: where this project
					// is filed, when the forge last saw a push, and the project's own
					// site. `healthOf` withholds the dates when the reading is stale,
					// which is the honest answer and simply omits `dateModified`.
					const cited = products.find((x) => x.slug === pr.replaces[0]?.slug);
					const health = healthOf(pr.source);
					return projectMeta(pr, lang, route.slug, {
						category: cited
							? cats.find((c) => c.slug === cited.category)
							: undefined,
						lastPush: health?.lastPush,
						homepage: health?.homepage,
					});
				}
				case "category": {
					const c = cats.find((x) => x.slug === route.slug);
					return c
						? categoryMeta(
								c,
								products.filter((p) => p.category === c.slug).length,
								lang,
							)
						: null;
				}
				case "group": {
					const inGroup = cats.filter((c) => c.group === route.slug);
					if (inGroup.length === 0) return null;
					const slugs = new Set(inGroup.map((c) => c.slug));
					return groupMeta(
						route.slug,
						t(`catGroup.${route.slug}` as Key),
						products.filter((p) => slugs.has(p.category)).length,
						inGroup.length,
						lang,
					);
				}
				case "categories":
					return categoriesMeta(lang, cats.length, products.length);
				case "products":
					return productsMeta(lang, catalogueTotal, cats.length);
				case "projects":
					return projectsMeta(lang, projects.length, route.page ?? 1);
				case "collections":
					return collectionsMeta(lang, COLLECTIONS.length);
				case "collection":
					return collectionMeta(
						route.slug,
						lang,
						memberCount(collectionMembers(route.slug, products, projects)),
						route.page ?? 1,
					);
				case "sponsor":
				case "submit":
				case "stats":
				// features, glossary and gaps used to fall through to the default and
				// get the HOME page's meta on a client-side navigation — its canonical,
				// its title, and now its `WebSite`/`Organization` nodes, which would
				// have made a second document claim the site entity.
				case "features":
				case "glossary":
				case "about":
				case "signin":
				// dashboard/admin are noindex; without this they'd fall through to
				// the home page's meta and lose the noindex tag on hydration.
				case "dashboard":
				case "admin":
					return standingMeta(route.name, route.lang);
				// The title carries the number of not-yet products, which is the
				// same set `GapsPage` lists, so the <title> and the <h1> agree.
				case "gaps":
					return standingMeta(route.name, route.lang, {
						gaps: products.filter((p) => p.verdict === "not-yet").length,
					});
				case "contact":
					return standingMeta(route.name, lang);
				case "legal":
					return legalMeta(route.doc, lang);
				default:
					return {
						...homeMeta(
							lang,
							catalogueTotal,
							route.name === "home" ? (route.page ?? 1) : 1,
						),
						// An unknown URL still renders the list (see `isHome` below), and
						// that is the right call for a reader who followed a stale link.
						// But it means any misspelling answers 200 with the index — a soft
						// 404, and an unbounded supply of them. The canonical already
						// points home; `noindex` is what stops them being indexed at all.
						// A filtered URL is a near-duplicate of the index with a subset
						// of the same rows, and there are thousands of combinations. It
						// is shareable, never crawlable: the canonical above already
						// points at the bare path, and this stops the parameterised
						// state being indexed alongside it.
						noindex: route.name === "unknown" || filtering,
					};
			}
		})();
		if (meta) applyMeta(meta, alternateUrls(route));
	}, [
		route,
		t,
		products,
		projects,
		cats,
		projectBySlug,
		projectSlugs,
		lang,
		catalogueTotal,
		filtering,
	]);

	// An unknown route still shows the list: a blank screen is worse than the
	// index, for a reader and for a crawler that followed a stale link.
	const isHome = route.name === "home" || route.name === "unknown";

	return (
		// A column the height of the window, so a short page (a 404, a one-product
		// category) still pins its footer to the bottom instead of leaving a band
		// of empty background under it.
		<div className="flex min-h-dvh flex-col">
			{/*
			 * The first focusable thing on every page.
			 *
			 * The header is 88 links wide, so a keyboard or switch user paid for it
			 * on every one of 8,865 documents before reaching a word of content.
			 * The other half of 2.4.1 — moving focus and announcing the route on a
			 * client-side navigation — is already done in nav.tsx.
			 */}
			<a
				href="#main"
				className="sr-only rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
			>
				{t("a11y.skip")}
			</a>
			<Header
				t={t}
				route={route}
				theme={theme}
				toggleTheme={toggle}
				signedIn={campaigns?.email ?? null}
			/>
			<SponsorTape slots={slots} t={t} tc={tc} lang={lang} position="top" />
			<div className="flex w-full flex-1 flex-col min-[1560px]:grid min-[1560px]:grid-cols-[232px_minmax(0,1fr)_232px] min-[1560px]:gap-6 min-[1560px]:px-6 min-[1560px]:pt-4">
				<SponsorRail slots={slots} side="left" t={t} tc={tc} lang={lang} />
				<div className="flex min-w-0 flex-1 flex-col">
					{isHome ? (
						<main id="main">
							{/* Showing the index for a dead URL is deliberate, but doing it
					    silently leaves the reader thinking they landed where they
					    meant to. One line, above the hero, says otherwise. */}
							{route.name === "unknown" && (
								<p
									className={`mx-auto ${MEASURE} px-4 pt-6 text-muted text-sm`}
									role="status"
								>
									{t("error.noSuchPage")}
								</p>
							)}
							{/* The headline runs on page 1 only, so it isn't repeated on every
					    paginated URL; the hero showcase below runs on every page. */}
							{homePage === 1 && (
								<Hero names={HERO_NAMES} stats={stats} t={t} lang={lang} />
							)}

							{heroSlots.length > 0 && (
								<HeroShowcase slots={heroSlots} t={t} tc={tc} lang={lang} />
							)}

							<section id="list" className="px-4 pb-16">
								{homePage > 1 && (
									<h1
										className={`mx-auto ${MEASURE} mb-4 font-bold font-display text-2xl`}
									>
										{t("home.pagedTitle").replace("{n}", String(homePage))}
									</h1>
								)}

								{/*
								 * Sticky, and the one piece of chrome on the page that is: the
								 * list is 48 rows deep and the controls that narrow it were at the
								 * top of a document the reader had already scrolled past. `top-14`
								 * clears the header, which is the only other sticky thing here.
								 *
								 * The wrapper carries the background because a sticky element with
								 * a transparent one lets rows scroll visibly underneath it.
								 */}
								<div className="-mx-4 sticky top-[6.1rem] z-30 mb-4 border-border border-b bg-bg/90 px-4 py-2.5 backdrop-blur-md lg:top-[3.4rem]">
									{/* One trigger row at every width: full-width search, verdict
							    pills, and the rest behind one button that opens a sheet,
							    with the filters actually in force listed underneath. This
							    replaced a six-`<select>` bar that appeared at `lg` — the
							    width where six controls wrap onto two rows and you have to
							    read all six to learn what you narrowed to. See
							    `FilterSheet` and `ActiveFilters` in browse.tsx. */}
									<div className={`mx-auto ${MEASURE}`}>
										<div className="flex flex-wrap items-center gap-2">
											<input
												value={filters.q}
												onChange={(e) =>
													setFilters({ ...filters, q: e.target.value })
												}
												placeholder={searchPlaceholder}
												aria-label={searchPlaceholder}
												className="h-10 min-w-[14rem] flex-1 rounded-[calc(var(--radius))] border border-border bg-surface px-3 text-sm outline-none focus:border-brand"
											/>
											<VerdictPills
												t={t}
												value={filters.verdict}
												onChange={(v) => setFilters({ ...filters, verdict: v })}
											/>
											<FilterSheet
												t={t}
												tc={tc}
												cats={cats}
												filters={filters}
												setFilters={setFilters}
												// Not `shown.length`: unfiltered, `result` is only this
												// page's slice, which would undercount the true match
												// total. `catalogueTotal` is the same number once the
												// catalogue is in hand, and the right one before it is.
												resultCount={filtering ? shown.length : catalogueTotal}
											/>
										</div>
										<ActiveFilters
											t={t}
											tc={tc}
											cats={cats}
											filters={filters}
											setFilters={setFilters}
										/>
									</div>
								</div>

								<div className={`mx-auto ${MEASURE} mb-5`}>
									{/* The pills say they were pressed; without this nothing
									    says what happened to the list under them. */}
									<ResultsLive n={shown.length} t={t} />
									{/* What a filter had to set aside, and why. Never silent. */}
									<Hidden result={result} t={t} />
									{filtering && (
										<p className="nums mt-2 flex flex-wrap items-center gap-2 text-muted text-xs">
											<span>
												{result.shown.length} {t("stats.products")} ·{" "}
												{t("filter.filteredNote")}
											</span>
											<button
												type="button"
												onClick={() => setFilters(NO_FILTERS)}
												className="pill px-2 py-0.5 text-xs"
											>
												{t("filter.clear")}
											</button>
										</p>
									)}
								</div>

								{error && (
									<p
										className="mx-auto max-w-2xl rounded-[calc(var(--radius))] border p-4 text-center text-sm"
										style={{ borderColor: "var(--v-no)", color: "var(--v-no)" }}
									>
										{t("error.api")}
									</p>
								)}

								{shown.length > 0 ? (
									<ProductList
										products={shown}
										slots={slots}
										lang={lang}
										t={t}
										tc={tc}
									/>
								) : (
									!error && (
										<p className="py-12 text-center text-sm text-muted">
											{t("empty.none")}{" "}
											<Link
												href={paths.submit(lang)}
												className="text-brand hover:underline"
											>
												{t("empty.submit")}
											</Link>
										</p>
									)
								)}

								{/* The pager belongs to the URL and the filters do not, so a
						    filtered view has no pager — it's a reading aid over page 3,
						    not a repagination of the catalogue. */}
								{!filtering && (
									<div className={`mx-auto ${MEASURE}`}>
										<Pager
											page={homePage}
											pages={homePages}
											href={(n) => paths.home(lang, n)}
											t={t}
										/>
										<PageCount
											page={homePage}
											pages={homePages}
											total={catalogueTotal}
											unit={t("stats.products")}
											t={t}
										/>
									</div>
								)}

								{/* The key to the three dots above it, and the caveat the whole
						    list is read under. A panel rather than two loose lines: it is
						    a legend, and a legend that reads as body copy gets skipped. */}
								<div
									className={`panel mx-auto ${MEASURE} mt-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 text-muted text-xs`}
								>
									<p className="max-w-2xl leading-relaxed">
										{t("list.disclaimer")}
									</p>
									<p className="flex flex-wrap items-center gap-x-4 gap-y-2">
										{VERDICTS.map((v) => (
											<VerdictMark key={v} verdict={v} t={t} lang={lang} />
										))}
									</p>
								</div>
							</section>
						</main>
					) : (
						<>
							{/* The sponsor wall runs on every page, not just home, since the
					    hero positions are the most valuable inventory on the site.
					    Renders after <Page>, above the footer, rather than ahead of
					    the reader's own h1. */}
							<Page ctx={ctx} route={route} />
							{heroSlots.length > 0 && (
								<HeroShowcase slots={heroSlots} t={t} tc={tc} lang={lang} />
							)}
						</>
					)}
					<SponsorTape
						slots={slots}
						t={t}
						tc={tc}
						lang={lang}
						position="bottom"
					/>
					<SiteFooter route={route} t={t} />
				</div>
				<SponsorRail slots={slots} side="right" t={t} tc={tc} lang={lang} />
			</div>
		</div>
	);
}
