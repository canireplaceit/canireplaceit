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
import { isLang, type Lang } from "core/src/index";
import {
	alternateUrls,
	buildProjectSlugs,
	parseRoute,
	paths,
	type Route,
} from "core/src/routes";
import {
	BookOpen,
	FileLock2,
	Heart,
	Languages,
	Moon,
	PackageOpen,
	PiggyBank,
	ServerCog,
	ShieldCheck,
	Sun,
	UserRound,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import { AdminPage } from "./AdminPage";
import { isHouseSlot } from "./ads";
import { startAdTracking } from "./adTracking";
import {
	type AdStats,
	api,
	type Campaigns,
	type Category,
	type ListedProduct,
	type SiteStats,
	type Slot,
	type Stats,
	type Team,
} from "./api";
import {
	applyProductFilters,
	Choice,
	effortOptions,
	FilterSheet,
	Hidden,
	isFiltered,
	NO_FILTERS,
	opennessOptions,
	PageCount,
	Pager,
	type ProductFilters,
	priceOptions,
	VerdictPills,
} from "./browse";
import { byWeight as byCategoryWeight } from "./categories";
import { categoryIcon } from "./categoryIcons";
import { GRID_1COL, SponsorSlot, VerdictMark } from "./components";
import { REPO } from "./contribute";
import { Dashboard } from "./Dashboard";
import { ProductList } from "./designs";
import { EstimatePage } from "./Estimate";
import { AdsSection, ContactSection, SubmitSection } from "./Forms";
import { detectLang, type Key, useI18n, useTheme } from "./i18n";
import { MEASURE } from "./listShared";
import { Mark } from "./Mark";
import { Link, navigate } from "./nav";
import { type NavItem, NavMenu, NavSheet } from "./navMenu";
import {
	CategoriesPage,
	CategoryPage,
	CollectionPage,
	CollectionsPage,
	type PageCtx,
	ProductPage,
	ProjectPage,
	ProjectsIndexPage,
} from "./pages";
import { SignInPage } from "./SignInPage";
import { SponsorRails, SponsorTape } from "./SponsorRails";
import { StatsPage } from "./StatsPage";
import {
	applyMeta,
	categoriesMeta,
	categoryMeta,
	collectionMeta,
	collectionsMeta,
	homeMeta,
	productMeta,
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
	/** Forge id → pretty slug, computed over the FULL catalogue at build time
	 *  so collisions resolve the same way regardless of which page's slice loads. */
	projectSlugs: [string, string][];
	/** Over the FULL catalogue — the footer line is a claim about the whole site. */
	freshness?: PriceFreshness;
	/** Per-category counts over the FULL catalogue, for the category menu. */
	categoryStats?: [string, CategoryStat][];
	/** Repo liveness for the repos THIS page cites, not all of them. Read
	 *  through `healthOf` in api.ts, which falls back to disk when absent. */
	health?: HealthFile;
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

// How many categories the header's dropdown shows — a shortcut, not the
// index, so it has to fit above the fold. Chosen as the ten with the most
// reviewed products (derived from `categoryStats`, so it can't go stale),
// not the authored `position` order or a hand-picked list.
const NAV_CATEGORIES = 10;

/**
 * An icon per collection. The collections are derived, but their icons are not
 * derivable from anything — four slugs, four pictures, named here so the
 * dropdown and the sheet cannot disagree about them.
 */
const COLLECTION_ICONS: Record<
	string,
	ComponentType<{ className?: string }>
> = {
	"self-hostable": ServerCog,
	"open-source": BookOpen,
	foss: ShieldCheck,
	"open-core": PackageOpen,
	"source-available": FileLock2,
	cheaper: PiggyBank,
};

function Header({
	t,
	tc,
	route,
	theme,
	toggleTheme,
	cats,
	catStats,
	collectionCounts,
	signedIn,
}: {
	t: (k: Key) => string;
	tc: (v: { en: string }) => string;
	route: Route;
	theme: string;
	toggleTheme: () => void;
	cats: Category[];
	catStats: Map<string, CategoryStat>;
	collectionCounts: Map<string, number>;
	/** The signed-in advertiser's email, or null. */
	signedIn: string | null;
}) {
	const lang = route.lang;
	const other: Lang = lang === "fr" ? "en" : "fr";

	// Both baked into every page's payload by prerender.ts, so these render the
	// same on the server and on the first client pass — which is what hydration
	// requires of anything in the header.
	const topCats: NavItem[] = byCategoryWeight(cats, catStats)
		.slice(0, NAV_CATEGORIES)
		.map((c) => ({
			key: c.slug,
			href: paths.category(lang, c.slug),
			label: tc(c.name),
			icon: categoryIcon(c.icon),
			count: catStats.get(c.slug)?.products ?? 0,
		}));

	const collectionItems: NavItem[] = COLLECTIONS.map((c) => ({
		key: c.slug,
		href: paths.collection(lang, c.slug),
		label: t(`collection.${c.slug}.title` as Key),
		icon: COLLECTION_ICONS[c.slug] ?? PackageOpen,
		count: collectionCounts.get(c.slug),
	}));

	/** The links that are just links. Shared by the row and the sheet. */
	const plainLinks = [
		{ href: paths.home(lang), label: t("nav.list") },
		{ href: paths.projects(lang), label: t("nav.projects") },
		{ href: paths.stats(lang), label: t("nav.stats") },
		{
			href: signedIn ? paths.dashboard(lang) : paths.signin(lang),
			label: signedIn ?? t("nav.signin"),
		},
		{ href: paths.sponsor(lang), label: t("nav.sponsor") },
		{ href: paths.submit(lang), label: t("nav.submit") },
	];

	return (
		<header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur">
			<div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
				<Link
					href={paths.home(lang)}
					className="group flex items-center gap-2 font-display text-base font-bold tracking-tight"
				>
					<Mark className="size-6 shrink-0" />
					{/* "replace" is the verb the whole site is about, so it carries the
					    colour; the question around it stays in the text colour. */}
					<span>
						can<span className="text-muted">i</span>
						<span style={{ color: "var(--brand)" }}>replace</span>it
					</span>
				</Link>
				{/* `lg` and not `md`: seven links, a language switch and a theme
				    toggle beside the wordmark don't fit the 768px `md:` viewport.
				    Below `lg` the sheet beside this carries the same links and more. */}
				<nav
					aria-label={t("nav.menu")}
					className="ml-auto hidden items-center gap-4 text-muted text-sm lg:flex xl:gap-5"
				>
					<Link href={paths.home(lang)} className="hover:text-text">
						{t("nav.list")}
					</Link>
					<Link href={paths.projects(lang)} className="hover:text-text">
						{t("nav.projects")}
					</Link>
					<NavMenu
						label={t("nav.categories")}
						items={topCats}
						allHref={paths.categories(lang)}
						allLabel={t("cats.all")}
					/>
					<NavMenu
						label={t("nav.collections")}
						items={collectionItems}
						allHref={paths.collections(lang)}
						allLabel={t("collections.all")}
					/>
					<Link href={paths.stats(lang)} className="hover:text-text">
						{t("nav.stats")}
					</Link>
					<Link href={paths.sponsor(lang)} className="hover:text-text">
						{t("nav.sponsor")}
					</Link>
					<Link href={paths.submit(lang)} className="hover:text-text">
						{t("nav.submit")}
					</Link>
				</nav>
				{/* An advertiser has no other way in — the dashboard URL is not
				    something anyone guesses — so this lives on every page. */}
				<Link
					href={signedIn ? paths.dashboard(lang) : paths.signin(lang)}
					className="ml-auto hidden max-w-[14rem] items-center gap-1.5 truncate rounded-[calc(var(--radius))] border border-border px-2.5 py-1.5 text-xs lg:flex"
					title={signedIn ?? undefined}
				>
					<UserRound className="size-3.5 shrink-0" aria-hidden />
					<span className="min-w-0 truncate">
						{signedIn ?? t("nav.signin")}
					</span>
				</Link>
				{/* The locale lives in the path, so switching it is a navigation to the
				    same page under the other language — never a state flip. */}
				<a
					href={alternateUrls(route)[other]}
					onClick={(e) => {
						if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
						e.preventDefault();
						// The query carries page state the path does not (e.g. the estimate
						// page's `?plan=`); `href` stays bare so prerender and first client
						// render agree, and only the click preserves the query.
						navigate(alternateUrls(route)[other] + location.search);
					}}
					aria-label={t("ui.language")}
					className="flex items-center gap-1.5 rounded-[calc(var(--radius))] border border-border px-2.5 py-1.5 text-xs uppercase lg:ml-0"
				>
					<Languages className="size-3.5" aria-hidden />
					{other}
				</a>
				<button
					type="button"
					onClick={toggleTheme}
					aria-label={t("theme.toggle")}
					className="rounded-[calc(var(--radius))] border border-border p-1.5"
				>
					{theme === "dark" ? (
						<Sun className="size-4" aria-hidden />
					) : (
						<Moon className="size-4" aria-hidden />
					)}
				</button>
				{/* Everything the row above holds, for every width the row does not
				    fit. Below `lg` this is the whole nav; there used to be none. */}
				<NavSheet
					label={t("nav.menu")}
					links={plainLinks}
					groups={[
						{
							title: t("nav.categories"),
							items: topCats,
							allHref: paths.categories(lang),
							allLabel: t("cats.all"),
						},
						{
							title: t("nav.collections"),
							items: collectionItems,
							allHref: paths.collections(lang),
							allLabel: t("collections.all"),
						},
					]}
				/>
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

function Hero({
	names,
	stats,
	t,
	lang,
}: {
	names: string[];
	stats: Stats | null;
	t: (k: Key) => string;
	lang: string;
}) {
	const [i, setI] = useState(0);
	useEffect(() => {
		if (names.length === 0) return;
		// 2s is too fast to read a name and register the question around it.
		const id = setInterval(() => setI((n) => (n + 1) % names.length), 2800);
		return () => clearInterval(id);
	}, [names.length]);

	return (
		<section
			id="top"
			className="mx-auto max-w-4xl px-4 pt-16 pb-10 text-center"
		>
			<h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
				{t("hero.title")}{" "}
				{/* All names stack in one grid cell, hidden but the current one, so
				    the cell is always as wide as the longest and cycling can't reflow. */}
				<span
					className="inline-grid border-b-2 px-1 align-baseline"
					style={{ color: "var(--brand)", borderColor: "var(--brand)" }}
				>
					{names.map((n, k) => (
						<span
							key={n}
							aria-hidden={k !== i}
							className={`col-start-1 row-start-1 ${k === i ? "" : "invisible"}`}
						>
							{n}
						</span>
					))}
				</span>
				{/* French puts a non-breaking space before a question mark; English does not. */}
				{lang === "fr" ? " ?" : "?"}
			</h1>
			<p className="mx-auto mt-4 max-w-2xl text-pretty text-muted">
				{t("hero.blurb")}
			</p>

			{/* A published 0 would read as "broken", not "new", so the switches
			    tile only exists once there's a switch to report. */}
			<dl
				className={`mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border ${stats?.switches ? "sm:grid-cols-4" : "grid-cols-3"}`}
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
					<div key={key} className="bg-surface px-3 py-4">
						<dd className="nums text-xl font-bold">{value ?? "—"}</dd>
						<dt className="mt-1 text-[10px] uppercase tracking-widest text-muted">
							{t(key)}
						</dt>
					</div>
				))}
			</dl>
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
		case "categories":
			return <CategoriesPage ctx={ctx} />;
		case "projects":
			return <ProjectsIndexPage ctx={ctx} page={route.page} />;
		case "collections":
			return <CollectionsPage ctx={ctx} />;
		case "collection":
			return <CollectionPage ctx={ctx} slug={route.slug} page={route.page} />;
		case "estimate":
			return (
				<EstimatePage
					products={ctx.products}
					categories={ctx.categories}
					t={ctx.t}
					tc={ctx.tc}
					lang={ctx.lang}
				/>
			);
		case "sponsor":
			return (
				<main>
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
				<main>
					<SubmitSection t={ctx.t} />
				</main>
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
				<main>
					<ContactSection t={ctx.t} lang={ctx.lang} />
				</main>
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
			<h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-text">
				{title}
			</h2>
			<ul className={`mt-3 ${GRID_1COL} gap-2 text-sm`}>{children}</ul>
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
		<footer className="border-t border-border">
			<div className={`mx-auto ${MEASURE} px-4 py-12`}>
				{/* The positioning statement. It is the promise the whole catalogue
				    rests on, so it is the first thing in the footer and the only line
				    here at reading size. */}
				<p
					className="max-w-3xl border-l-2 pl-4 text-base font-medium text-pretty sm:text-lg"
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

				<div className="mt-10 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
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
						{/* The planner's only inbound link. */}
						<li>
							<Link href={paths.estimate(lang)} className={fLink}>
								{t("plan.eyebrow")}
							</Link>
						</li>
						{COLLECTIONS.map((c) => (
							<li key={c.slug}>
								<Link href={paths.collection(lang, c.slug)} className={fLink}>
									{t(`collection.${c.slug}.title` as Key)}
								</Link>
							</li>
						))}
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
							<Link href={paths.contact(lang)} className={fLink}>
								{t("nav.contact")}
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
				</div>

				<div className="mt-10 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-6 text-xs text-muted">
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
	const [slots, setSlots] = useState<Slot[]>([]);
	const [stats, setStats] = useState<Stats | null>(null);
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
	const [filters, setFilters] = useState<ProductFilters>(NO_FILTERS);
	const [voted, setVoted] = useState<Set<string>>(new Set());
	const [error, setError] = useState(false);

	// Impressions. Started once, outside the data effect, because it observes the
	// DOM rather than the data — the rails are `position: fixed` and never
	// unmount, so nothing about them is render-shaped. See adTracking.ts.
	useEffect(() => startAdTracking(), []);

	useEffect(() => {
		// Fire and forget: gets the voter cookie in place before anyone clicks,
		// so a vote is never the request that also mints the identity.
		void api.session().catch(() => {});

		Promise.all([api.products(), api.categories(), api.slots(), api.stats()])
			.then(([p, c, s, st]) => {
				setProducts(p);
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
	const pageProducts = wholeCatalogue ? pageSlice(ordered, homePage) : ordered;

	// A filtered view searches the whole catalogue, not this page — "no
	// results" has to mean "nowhere", not "not on page 3".
	const filtering = isFiltered(filters);
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
							)
						: null;
				}
				case "project": {
					const pr = projectBySlug.get(route.slug);
					return pr ? projectMeta(pr, lang, route.slug) : null;
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
				case "categories":
					return categoriesMeta(lang, cats.length, products.length);
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
				case "estimate":
				case "sponsor":
				case "submit":
				case "stats":
				case "signin":
				// dashboard/admin are noindex; without this they'd fall through to
				// the home page's meta and lose the noindex tag on hydration.
				case "dashboard":
				case "admin":
					return standingMeta(route.name, route.lang, products.length);
				case "contact":
					return standingMeta(route.name, lang, products.length);
				default:
					return homeMeta(
						lang,
						catalogueTotal,
						route.name === "home" ? (route.page ?? 1) : 1,
					);
			}
		})();
		if (meta) applyMeta(meta, alternateUrls(route));
	}, [route, products, projects, cats, projectBySlug, lang, catalogueTotal]);

	// An unknown route still shows the list: a blank screen is worse than the
	// index, for a reader and for a crawler that followed a stale link.
	const isHome = route.name === "home" || route.name === "unknown";

	return (
		<>
			<Header
				t={t}
				tc={tc}
				route={route}
				theme={theme}
				toggleTheme={toggle}
				cats={cats}
				catStats={catStats}
				collectionCounts={ctx.collectionCounts}
				signedIn={campaigns?.email ?? null}
			/>
			{/* Rails on wide screens, a scrolling tape on everything narrower. */}
			<SponsorRails slots={slots} t={t} tc={tc} lang={lang} />
			<SponsorTape slots={slots} t={t} tc={tc} lang={lang} position="top" />
			{isHome ? (
				<main>
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
								className={`mx-auto ${MEASURE} mb-4 font-display text-2xl font-bold tracking-tight`}
							>
								{t("home.pagedTitle").replace("{n}", String(homePage))}
							</h1>
						)}

						{/* Below `lg` the six-control bar doesn't fit, so this is a trigger
						    row instead: full-width search, verdict pills, and the rest
						    behind one button that opens a sheet. See `FilterSheet` in
						    browse.tsx. */}
						<div className={`mx-auto ${MEASURE} mb-2 lg:hidden`}>
							<input
								value={filters.q}
								onChange={(e) => setFilters({ ...filters, q: e.target.value })}
								placeholder={t("hero.searchPlaceholder")}
								aria-label={t("hero.searchPlaceholder")}
								className="w-full rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
							/>
							<div className="mt-2 flex flex-wrap items-center gap-2">
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
									// page's slice, which would undercount the true match total.
									resultCount={filtering ? shown.length : ordered.length}
								/>
							</div>
						</div>

						{/* Search owns the first row; the six controls share the next. */}
						<div
							className={`mx-auto ${MEASURE} mb-2 hidden flex-wrap items-center gap-2 lg:flex`}
						>
							<input
								value={filters.q}
								onChange={(e) => setFilters({ ...filters, q: e.target.value })}
								placeholder={t("hero.searchPlaceholder")}
								aria-label={t("hero.searchPlaceholder")}
								className="w-full min-w-0 rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand sm:w-auto sm:min-w-52 sm:flex-1"
							/>
							<Choice
								label={t("filter.category")}
								value={filters.category}
								onChange={(v) => setFilters({ ...filters, category: v })}
							>
								<option value="">{t("filter.allCategories")}</option>
								{cats.map((c) => (
									<option key={c.slug} value={c.slug}>
										{tc(c.name)}
									</option>
								))}
							</Choice>
							<Choice
								label={t("filter.verdict")}
								value={filters.verdict}
								onChange={(v) => setFilters({ ...filters, verdict: v })}
							>
								<option value="">{t("filter.anyVerdict")}</option>
								{VERDICTS.map((v) => (
									<option key={v} value={v}>
										{t(`verdict.${v}` as Key)}
									</option>
								))}
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
								label={t("filter.price")}
								value={filters.price}
								onChange={(v) =>
									setFilters({
										...filters,
										price: v as ProductFilters["price"],
									})
								}
							>
								<option value="">{t("filter.anyPrice")}</option>
								{priceOptions(t)}
							</Choice>
							<Choice
								label={t("filter.sort")}
								value={filters.sort}
								onChange={(v) =>
									setFilters({ ...filters, sort: v as ProductFilters["sort"] })
								}
							>
								<option value="weight">{t("filter.sortWeight")}</option>
								{/* "most switched", never "most popular" — most products sit
								    at zero or one, and "popular" would overclaim. */}
								<option value="switched">{t("filter.sortVotes")}</option>
								<option value="price">{t("filter.sortPrice")}</option>
								<option value="name">{t("filter.sortName")}</option>
							</Choice>
						</div>

						<div className={`mx-auto ${MEASURE} mb-5`}>
							{/* What a filter had to set aside, and why. Never silent. */}
							<Hidden result={result} t={t} />
							{filtering && (
								<p className="nums mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
									<span>
										{result.shown.length} {t("stats.products")} ·{" "}
										{t("filter.filteredNote")}
									</span>
									<button
										type="button"
										onClick={() => setFilters(NO_FILTERS)}
										className="rounded-[calc(var(--radius))] border border-border px-2 py-0.5 hover:border-brand"
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

						<div
							className={`mx-auto ${MEASURE} mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-muted`}
						>
							<p className="max-w-2xl">{t("list.disclaimer")}</p>
							<p className="flex items-center gap-3">
								{VERDICTS.map((v) => (
									<VerdictMark key={v} verdict={v} t={t} />
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

			<SponsorTape slots={slots} t={t} tc={tc} lang={lang} position="bottom" />

			<SiteFooter route={route} t={t} />
		</>
	);
}
