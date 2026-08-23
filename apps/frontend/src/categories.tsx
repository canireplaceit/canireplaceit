/**
 * Category navigation and the pieces the category pages share.
 *
 * Two rules shape everything here.
 *
 * Every link is a real `<a href>` built from `paths` in core. These pages are
 * prerendered and crawled, so a menu that needs JavaScript to reveal its links is
 * a menu that does not exist for Googlebot and does not exist for a reader whose
 * bundle has not landed yet. The menu below is a `<details>` disclosure and not a
 * `<select>` or a JavaScript popover for exactly that reason: all 84 `<a href>`s
 * are in the document whether it is open or shut, a crawler reads them, and the
 * browser opens and closes it with no bundle at all. The client-side code here
 * only adds the manners a native disclosure lacks — Escape, click-away, and an
 * `aria-expanded` that tracks the panel.
 *
 * Every number is derived. `categoryStats` in core computes counts, the ladder
 * split, the median price and the lowest-effort escape from the product files
 * themselves. Nothing on a category row is authored, so nothing on it can drift.
 */

import type { CategoryStat, Rung } from "core/src/content";
import { projectSlug, RUNGS } from "core/src/content";
import type { Lang } from "core/src/index";
import { paths } from "core/src/routes";
import { ArrowRight, ChevronDown, LayoutGrid } from "lucide-react";
import { money } from "./api";
import { categoryIcon } from "./categoryIcons";
import { GRID_1COL } from "./components";
import type { Key } from "./i18n";
import { Link } from "./nav";
import { useDisclosure } from "./navMenu";

export type Cat = {
	slug: string;
	name: { en: string };
	icon: string;
	/**
	 * Authored ordering, 0–83. It is the lookup order in the menu below and the
	 * adjacency "nearby categories" reads — NOT the theme, which is the `group`
	 * field on `Category` in core, and not a ranking, which is `byWeight`.
	 */
	position: number;
};

type T = (k: Key) => string;
type Tc = (v: { en: string }) => string;

/**
 * Biggest first. The authored `position` is an editorial ordering and `group` is
 * an editorial theme; neither is a ranking, and this is the ranking.
 *
 * Generic over the row, so a caller that has the full `Category` — with its
 * theme on it — gets the full `Category` back and does not have to cast.
 */
export const byWeight = <T extends Cat>(
	cats: T[],
	stats: Map<string, CategoryStat>,
): T[] =>
	[...cats].sort(
		(a, b) =>
			(stats.get(b.slug)?.products ?? 0) - (stats.get(a.slug)?.products ?? 0) ||
			a.name.en.localeCompare(b.name.en),
	);

const item =
	"flex items-center gap-2 rounded-[calc(var(--radius))] px-2 py-1.5 text-sm hover:bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]";

function Item({
	cat,
	count,
	lang,
	tc,
	current,
}: {
	cat: Cat;
	count: number;
	lang: Lang;
	tc: Tc;
	current: boolean;
}) {
	const Icon = categoryIcon(cat.icon);
	const body = (
		<>
			<Icon className="size-3.5 shrink-0" aria-hidden />
			{/* `min-w-0` and not just `truncate`: a flex child's default minimum is
			    its content, so "Bookings, property and events" widens the column and
			    the panel instead of ending in an ellipsis. */}
			<span className="min-w-0 flex-1 truncate">{tc(cat.name)}</span>
			<span className="nums shrink-0 text-xs text-muted">{count}</span>
		</>
	);

	// The category being read is not a link to itself. It wears the brand blue
	// rather than a verdict colour: "you are here" is not a judgement about it.
	return current ? (
		<span
			aria-current="page"
			className={`${item} bg-[color-mix(in_srgb,var(--brand)_10%,transparent)] font-medium text-brand`}
		>
			{body}
		</span>
	) : (
		<Link href={paths.category(lang, cat.slug)} className={item}>
			{body}
		</Link>
	);
}

/**
 * The menu: one trigger, and a panel holding every category the site has.
 *
 * This is the INDEX menu — all 85, and on a category page it renders AFTER
 * `</main>`, beside the footer, because a directory of every other category is
 * site navigation and not this page's content. See `CategoryPage` in pages.tsx
 * for what that was measured to be costing. The header's row is a different
 * thing and deliberately shorter; see navMenu.tsx.
 *
 * The order is `position`, the authored ordering, and not the product count. A
 * count ranking is the right spine for the index page, which argues about size;
 * it is the wrong one for a lookup list, where a reader who wants "Containers"
 * should find it beside "Build & delivery" rather than at whatever rank it holds
 * this week. The counts are still on every row, because a category with two
 * products in it is worth knowing about before the click, not after.
 *
 * The panel is absolutely positioned, so opening it covers the page rather than
 * pushing 84 rows into the flow, and it scrolls inside itself: at 375px an open
 * menu is a 60vh list that scrolls, with `overscroll-contain` so reaching its end
 * does not hand the scroll to the document underneath.
 *
 * Hover opens it too, but only as an enhancement and only where hovering means
 * anything. `(hover: hover) and (pointer: fine)` is the whole guard: on a touch
 * screen a tap synthesises a hover that never ends, so a hover-driven menu opens
 * and stays open under the reader's thumb. Click, Enter, Space and Escape are the
 * base behaviour on every device, and they are what the panel is built on.
 */
export function CategoryMenu({
	cats,
	stats,
	lang,
	t,
	tc,
	current,
	footer = false,
}: {
	cats: Cat[];
	stats: Map<string, CategoryStat>;
	lang: Lang;
	t: T;
	tc: Tc;
	/** The category being read, marked in the list. Absent on the home page. */
	current?: string;
	/**
	 * The footer-adjacent copy: it names itself rather than the page it is on,
	 * and it unrolls upward. A 60vh panel this close to the bottom would
	 * otherwise open over the footer, and a trigger reading "Analytics" under
	 * the Analytics page is a control nobody can guess the purpose of.
	 */
	footer?: boolean;
}) {
	// Escape, click-away, close-on-navigation and hover-as-enhancement, shared
	// with the header dropdowns. See `useDisclosure` in navMenu.tsx.
	const { open, ref, setOpen } = useDisclosure();

	if (cats.length === 0) return null;
	const here =
		current && !footer ? cats.find((c) => c.slug === current) : undefined;
	const ordered = [...cats].sort((a, b) => a.position - b.position);
	const TriggerIcon = here ? categoryIcon(here.icon) : LayoutGrid;

	return (
		<nav aria-label={t("nav.categories")} className="relative min-w-0">
			<details
				ref={ref}
				open={open}
				onToggle={(e) => setOpen(e.currentTarget.open)}
				className="group"
			>
				{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: a <summary> is exposed as a disclosure button and the expanded state is the one thing a trigger must announce; browsers derive it from the `open` attribute, this mirrors it for the readers that do not. */}
				<summary
					aria-expanded={open}
					className="flex w-full cursor-pointer list-none items-center gap-2 rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2 text-sm outline-none hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--line))] focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)] sm:w-72 [&::-webkit-details-marker]:hidden"
				>
					<TriggerIcon className="size-4 shrink-0 text-brand" aria-hidden />
					<span className="min-w-0 flex-1 truncate text-left">
						{here ? tc(here.name) : t("cats.browse")}
					</span>
					<span className="nums shrink-0 text-xs text-muted">
						{cats.length}
					</span>
					<ChevronDown
						className="size-4 shrink-0 text-muted transition-transform group-open:rotate-180"
						aria-hidden
					/>
				</summary>

				{/* `top-full` with the 4px offset as PADDING and not a margin: a gap
				    between the trigger and the panel is a strip the pointer falls
				    through on the way down, and the panel closes under it. */}
				<div
					className={`absolute right-0 left-0 z-20 ${footer ? "bottom-full pb-1" : "top-full pt-1"}`}
				>
					<div className="max-h-[60vh] overflow-y-auto overscroll-contain rounded-[calc(var(--radius))] border border-border bg-surface p-2 shadow-lg">
						<ul
							className={`${GRID_1COL} gap-x-3 sm:grid-cols-2 lg:grid-cols-3`}
						>
							{ordered.map((c) => (
								<li key={c.slug} className="min-w-0">
									<Item
										cat={c}
										count={stats.get(c.slug)?.products ?? 0}
										lang={lang}
										tc={tc}
										current={c.slug === current}
									/>
								</li>
							))}
						</ul>
						{/* The index is a different page, not a longer version of this one:
						    it ranks, counts and shows the exit ladder per category. */}
						<Link
							href={paths.categories(lang)}
							className={`${item} mt-1 border-border border-t pt-2.5 font-medium text-brand`}
						>
							<span className="min-w-0 flex-1 truncate">{t("cats.all")}</span>
							<ArrowRight className="size-3.5 shrink-0" aria-hidden />
						</Link>
					</div>
				</div>
			</details>
		</nav>
	);
}

/**
 * A ramp from "no way out" to "walk away today", not four unrelated colours.
 *
 * `--brand` is deliberately not used: the wordmark's blue must not turn into a
 * fifth verdict, which is the exact confusion index.css already calls out. The
 * two middle rungs are mixes of the same two verdict tokens, so the bar reads as
 * one scale under all eight designs and both themes.
 */
const RUNG_FILL: Record<Rung, string> = {
	"locked-in": "var(--v-no)",
	partial: "var(--v-almost)",
	"self-hostable": "color-mix(in srgb, var(--v-yes) 45%, var(--surface))",
	"drop-in": "var(--v-yes)",
};

export const rungLabel = (rung: Rung, t: T) => t(`rung.${rung}` as Key);

/**
 * The ladder split for one category, as four proportional segments.
 *
 * The accessible name carries the same figures as the bar, because a colour ramp
 * is not information for a screen reader and "68%" of nothing is not either.
 */
export function RungBar({ stat, t }: { stat: CategoryStat; t: T }) {
	const total = stat.products;
	if (total === 0) return null;
	const label = RUNGS.filter((r) => stat.rungs[r] > 0)
		.map((r) => `${stat.rungs[r]} ${rungLabel(r, t)}`)
		.join(", ");

	return (
		<>
			{/*
			 * The reading as text, in the document.
			 *
			 * It used to live only in an `aria-label` on a `role="img"`, which no
			 * parser reads and which is not `<meter>`-shaped either — this is four
			 * proportions, not one value, so a `<meter>` would have to invent a
			 * figure the data does not hold. Real text says the same thing to a
			 * screen reader and to a crawler.
			 */}
			<span className="sr-only">
				{t("cats.ladder")}: {label}
			</span>
			<span
				aria-hidden="true"
				className="flex h-1.5 w-full overflow-hidden rounded-full bg-border"
			>
				{RUNGS.map((rung) =>
					stat.rungs[rung] === 0 ? null : (
						<span
							key={rung}
							style={{
								width: `${(stat.rungs[rung] / total) * 100}%`,
								background: RUNG_FILL[rung],
							}}
						/>
					),
				)}
			</span>
		</>
	);
}

/** The bar plus a written-out key, for a page that has room for one. */
export function RungLegend({ stat, t }: { stat: CategoryStat; t: T }) {
	return (
		<div className="space-y-2">
			<RungBar stat={stat} t={t} />
			<ul className="nums flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
				{RUNGS.filter((r) => stat.rungs[r] > 0).map((rung) => (
					<li key={rung} className="flex items-center gap-1.5">
						<span
							aria-hidden
							className="size-2 shrink-0 rounded-full"
							style={{ background: RUNG_FILL[rung] }}
						/>
						{stat.rungs[rung]} {rungLabel(rung, t)}
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The median monthly price, or an honest absence.
 *
 * A category whose products are all usage-priced has no median, and rendering
 * that as "$0" would be the same lie `priceLabel` was fixed to stop telling.
 */
export const medianLabel = (stat: CategoryStat, lang: Lang, t: T): string =>
	stat.medianPrice === null
		? t("cats.noMedian")
		: `${money(stat.medianPrice * 100, lang)}${t("row.perMonth")}`;

/** The lowest-effort project whose free build is the whole product. */
export function CheapestEscape({
	stat,
	lang,
	t,
	projectSlugs,
}: {
	stat: CategoryStat;
	lang: Lang;
	t: T;
	/** Forge id → pretty slug, so the name can link to the project's own page. */
	projectSlugs: Map<string, string>;
}) {
	const exit = stat.cheapestEscape;
	if (!exit) return <span className="text-muted">{t("cats.noEscape")}</span>;

	const pretty = projectSlugs.get(projectSlug(exit.source));
	const name = pretty ? (
		<Link href={paths.project(lang, pretty)} className="hover:underline">
			{exit.name}
		</Link>
	) : (
		exit.name
	);

	return (
		<span>
			{name}{" "}
			<span className="text-muted">— {t(`effort.${exit.effort}` as Key)}</span>
		</span>
	);
}
