// Pager emits real crawlable URLs; filters stay client-only React state (no
// query string) so the combinatorial filter space never mints indexable pages.

import {
	bestOpenness,
	easiestEffort,
	OPENNESS,
	type Openness,
	openness,
	opennessRank,
} from "core/src/collections";
import {
	EFFORT_RANK,
	EFFORTS,
	type Effort,
	type Project,
	priceState,
	VERDICTS,
} from "core/src/content";
import { ChevronLeft, ChevronRight, SlidersHorizontal, X } from "lucide-react";
import { useRef, useState } from "react";
import type { Category, ListedProduct } from "./api";
import type { Key } from "./i18n";
import { Link } from "./nav";

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

/**
 * How many pages either side of the current one the strip names.
 *
 * It was 1, which on a 72-page series left `/en/tools/page/37/` at a measured
 * depth of 39 from the home page: first, last, and one neighbour each way is a
 * strip you can only walk one hop at a time. Three cuts that walk by two thirds
 * and costs four anchors a page.
 */
const ADJACENT_PAGE_COUNT = 3;

/**
 * The long-range rungs: page 10, 20, 30 and so on, named on every page.
 *
 * Neighbours alone are a walk, not a jump. First / current ±3 / last let a
 * reader move three pages per click, so `/en/tools/page/37/` sat 13 clicks from
 * page 1 — better than the ±1 it replaced, and still a linear crawl. The rungs
 * cost one anchor per ten pages and turn the walk into two hops for seven pages
 * in ten (1 → 40 → 37), three for the rest (1 → 30 → 33 → 35).
 */
const DECADE_STRIDE = 10;

function pageNumbers(page: number, pages: number): (number | "gap")[] {
	const wanted = new Set<number>([1, pages, page]);
	for (let d = 1; d <= ADJACENT_PAGE_COUNT; d++) {
		if (page - d >= 1) wanted.add(page - d);
		if (page + d <= pages) wanted.add(page + d);
	}
	for (let n = DECADE_STRIDE; n < pages; n += DECADE_STRIDE) wanted.add(n);
	const sorted = [...wanted].sort((a, b) => a - b);
	const out: (number | "gap")[] = [];
	let previous = 0;
	for (const n of sorted) {
		// Show a single skipped page instead of eliding it (saves a click).
		if (n - previous === 2) out.push(previous + 1);
		else if (n - previous > 2) out.push("gap");
		out.push(n);
		previous = n;
	}
	return out;
}

// Real <a href> links so a crawler can walk pagination; filters above emit none.
export function Pager({
	page,
	pages,
	href,
	t,
}: {
	page: number;
	pages: number;
	href: (n: number) => string;
	t: T;
}) {
	if (pages <= 1) return null;
	const step =
		"inline-flex items-center gap-1 rounded-[calc(var(--radius))] border border-border px-2.5 py-1.5 text-sm transition hover:border-brand";

	return (
		<nav
			aria-label={t("page.pagination")}
			className="mt-8 flex flex-wrap items-center justify-center gap-1.5"
		>
			{page > 1 ? (
				<Link href={href(page - 1)} className={step}>
					<ChevronLeft className="size-3.5" aria-hidden />
					{t("page.previous")}
				</Link>
			) : (
				<span className={`${step} opacity-40`}>
					<ChevronLeft className="size-3.5" aria-hidden />
					{t("page.previous")}
				</span>
			)}

			<ol className="flex flex-wrap items-center gap-1">
				{pageNumbers(page, pages).map((n, i) =>
					n === "gap" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: an ellipsis has no id
						<li key={`gap-${i}`} className="px-1 text-sm text-muted">
							…
						</li>
					) : (
						<li key={n}>
							{n === page ? (
								<span
									aria-current="page"
									className="nums inline-block rounded-[calc(var(--radius))] border border-brand px-2.5 py-1.5 text-sm font-medium text-brand"
								>
									{n}
								</span>
							) : (
								<Link
									href={href(n)}
									className="nums inline-block rounded-[calc(var(--radius))] border border-border px-2.5 py-1.5 text-sm transition hover:border-brand"
								>
									{n}
								</Link>
							)}
						</li>
					),
				)}
			</ol>

			{page < pages ? (
				<Link href={href(page + 1)} className={step}>
					{t("page.next")}
					<ChevronRight className="size-3.5" aria-hidden />
				</Link>
			) : (
				<span className={`${step} opacity-40`}>
					{t("page.next")}
					<ChevronRight className="size-3.5" aria-hidden />
				</span>
			)}
		</nav>
	);
}

/**
 * How many rows the current filter leaves, announced.
 *
 * The pills are correctly `aria-pressed`, so a screen-reader user hears the
 * control change — and then nothing at all about the list underneath, which is
 * the only thing that actually changed. Same mechanic as the route announcer in
 * nav.tsx: one polite, atomic region that is present from first paint, so a
 * later change to its text is what gets read out.
 */
export function ResultsLive({ n, t }: { n: number; t: T }) {
	return (
		<p className="sr-only" aria-live="polite" aria-atomic="true">
			{t("a11y.results").replace("{n}", String(n))}
		</p>
	);
}

export function PageCount({
	page,
	pages,
	total,
	unit,
	t,
}: {
	page: number;
	pages: number;
	total: number;
	unit: string;
	t: T;
}) {
	return (
		<p className="nums mt-3 text-center text-xs text-muted">
			{t("page.pageOf")
				.replace("{n}", String(page))
				.replace("{of}", String(pages))}{" "}
			· {total} {unit}
		</p>
	);
}

// Numeric bands must never silently absorb products with no comparable price;
// `no-public` and `unchecked` are their own explicit bands instead.
export const PRICE_BANDS = [
	"free",
	"under-25",
	"25-100",
	"over-100",
	"no-public",
	"unchecked",
] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];

export type ProductFilters = {
	q: string;
	category: string;
	verdict: string;
	/** "at most this much work", read off the easiest alternative a product has. */
	effort: "" | Effort;
	/** "at least this open", read off the freest alternative a product has. */
	openness: "" | Openness;
	price: "" | PriceBand;
	sort: ProductSort;
};

// `weight` matches the paginated spine's order, so a page keeps its contents
// until the reader picks another sort.
export const PRODUCT_SORTS = ["weight", "switched", "price", "name"] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const NO_FILTERS: ProductFilters = {
	q: "",
	category: "",
	verdict: "",
	effort: "",
	openness: "",
	price: "",
	sort: "weight",
};

/**
 * The filters as a query string, and back.
 *
 * Filters were deliberately client-only state so the combinatorial filter space
 * could never mint indexable URLs — the right call, and it stays: every
 * parameterised state is `noindex` and canonicalises to the bare path (see
 * seo.ts). But it also meant a filtered view could not be sent to anybody, on a
 * site whose whole job is helping someone decide something and then tell a
 * colleague. Shareable and crawlable are different problems; this solves the
 * first without reopening the second.
 *
 * `sort` is included: a list in an unexpected order is as confusing to receive
 * as one missing rows.
 */
export const filtersToQuery = (f: ProductFilters): string => {
	const q = new URLSearchParams();
	if (f.q.trim()) q.set("q", f.q.trim());
	if (f.category) q.set("category", f.category);
	if (f.verdict) q.set("verdict", f.verdict);
	if (f.openness) q.set("openness", f.openness);
	if (f.effort) q.set("effort", f.effort);
	if (f.price) q.set("price", f.price);
	if (f.sort !== "weight") q.set("sort", f.sort);
	return q.toString();
};

/**
 * Reads them back, rejecting anything not in the vocabulary. A hand-edited
 * `?effort=banana` must land on the unfiltered list rather than an empty one —
 * an empty page reads as "we have nothing", which would be a lie told by a
 * typo.
 */
export const filtersFromQuery = (search: string): ProductFilters => {
	const q = new URLSearchParams(search);
	const pick = <T extends string>(
		key: string,
		allowed: readonly T[],
	): T | "" => {
		const v = q.get(key);
		return v && (allowed as readonly string[]).includes(v) ? (v as T) : "";
	};
	return {
		q: q.get("q") ?? "",
		category: q.get("category") ?? "",
		verdict: pick("verdict", VERDICTS),
		openness: pick("openness", OPENNESS),
		effort: pick("effort", EFFORTS),
		price: pick("price", PRICE_BANDS),
		sort: pick("sort", PRODUCT_SORTS) || "weight",
	};
};

export const isFiltered = (f: ProductFilters): boolean =>
	f.q.trim() !== "" ||
	f.category !== "" ||
	f.verdict !== "" ||
	f.effort !== "" ||
	f.openness !== "" ||
	f.price !== "" ||
	f.sort !== "weight";

const inBand = (p: ListedProduct, band: PriceBand): boolean => {
	const state = priceState(p);
	if (band === "no-public") return state === "no-price";
	if (band === "unchecked") return state === "unverified";
	const n = p.priceMonthly;
	if (n === null) return false;
	if (band === "free") return n === 0;
	if (band === "under-25") return n > 0 && n < 25;
	if (band === "25-100") return n >= 25 && n <= 100;
	return n > 100;
};

export type FilterResult = {
	shown: ListedProduct[];
	// Split by reason: "no public price" and "unchecked" are different admissions.
	hiddenNoPublic: number;
	hiddenUnchecked: number;
};

export function applyProductFilters(
	products: ListedProduct[],
	f: ProductFilters,
): FilterResult {
	const needle = f.q.trim().toLowerCase();
	const numeric =
		f.price !== "" && f.price !== "no-public" && f.price !== "unchecked";

	let hiddenNoPublic = 0;
	let hiddenUnchecked = 0;

	const shown = products.filter((p) => {
		if (f.category && p.category !== f.category) return false;
		if (f.verdict && p.verdict !== f.verdict) return false;
		if (
			needle &&
			!p.name.toLowerCase().includes(needle) &&
			!p.alternatives.some((a) => a.name.toLowerCase().includes(needle))
		) {
			return false;
		}
		if (f.effort) {
			const easiest = easiestEffort(p);
			if (easiest === null || EFFORT_RANK[easiest] > EFFORT_RANK[f.effort]) {
				return false;
			}
		}
		if (f.openness) {
			const best = bestOpenness(p);
			if (best === null || opennessRank(best) < opennessRank(f.openness)) {
				return false;
			}
		}
		if (f.price) {
			if (inBand(p, f.price)) return true;
			// Only a numeric band hides unchecked/no-public entries; picking those
			// bands directly is asking for them on purpose.
			if (numeric) {
				const state = priceState(p);
				if (state === "no-price") hiddenNoPublic++;
				else if (state === "unverified") hiddenUnchecked++;
			}
			return false;
		}
		return true;
	});

	shown.sort((a, b) => {
		if (f.sort === "switched") {
			return b.switchedCount - a.switchedCount || b.priority - a.priority;
		}
		if (f.sort === "price")
			return (b.priceMonthly ?? 0) - (a.priceMonthly ?? 0);
		if (f.sort === "name") return a.name.localeCompare(b.name);
		// `weight` keeps the order it arrived in, which is the spine's order.
		return 0;
	});

	return { shown, hiddenNoPublic, hiddenUnchecked };
}

export type ProjectFilters = {
	q: string;
	openness: "" | Openness;
	effort: "" | Effort;
};

export const NO_PROJECT_FILTERS: ProjectFilters = {
	q: "",
	openness: "",
	effort: "",
};

export const isProjectFiltered = (f: ProjectFilters): boolean =>
	f.q.trim() !== "" || f.openness !== "" || f.effort !== "";

export function applyProjectFilters(
	projects: Project[],
	f: ProjectFilters,
): Project[] {
	const needle = f.q.trim().toLowerCase();
	return projects.filter((p) => {
		if (
			needle &&
			!p.name.toLowerCase().includes(needle) &&
			!p.replaces.some((r) => r.name.toLowerCase().includes(needle))
		) {
			return false;
		}
		if (f.effort && EFFORT_RANK[p.effort] > EFFORT_RANK[f.effort]) return false;
		// A project has its own openness directly, unlike a product's best-of-alternatives.
		if (f.openness && opennessRank(openness(p)) < opennessRank(f.openness)) {
			return false;
		}
		return true;
	});
}

// `min-h-10` matches the search input beside it: a filter bar whose select is
// 4px shorter than its text field reads as misaligned at every width.
const select =
	"min-h-10 min-w-0 rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2 text-sm transition hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--color-border))]";

/** One labelled `<select>`. The label is visually hidden but always announced. */
export function Choice({
	label,
	value,
	onChange,
	children,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	children: React.ReactNode;
}) {
	return (
		<label className="min-w-0 flex-1 sm:flex-none">
			<span className="sr-only">{label}</span>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className={`${select} w-full`}
			>
				{children}
			</select>
		</label>
	);
}

// The sheet's tappable replacement for an <option>.
//
// The pressed look is `.pill[aria-pressed="true"]` in index.css rather than an
// inline style, so the state a screen reader announces and the state a sighted
// reader sees are driven by the same attribute and cannot come apart.
export function Pill({
	label,
	active,
	onClick,
}: {
	// A node, not a string: the features page appends a match count to the label.
	label: React.ReactNode;
	active: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			className="pill"
		>
			{label}
		</button>
	);
}

// <fieldset>/<legend> gives the group its accessible name natively, no ARIA needed.
export function PillGroup({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (v: string) => void;
}) {
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="mb-1.5 block text-xs font-medium text-muted uppercase tracking-wide">
				{label}
			</legend>
			<div className="flex flex-wrap gap-1.5">
				{options.map((o) => (
					<Pill
						key={o.value}
						label={o.label}
						active={value === o.value}
						onClick={() => onChange(o.value)}
					/>
				))}
			</div>
		</fieldset>
	);
}

// Verdict filter, promoted out of the sheet into the trigger row; legend is
// sr-only since the row already reads visually as a filter bar.
export function VerdictPills({
	t,
	value,
	onChange,
}: {
	t: T;
	value: string;
	onChange: (v: string) => void;
}) {
	const seg =
		"px-3 text-sm text-muted transition first:border-l-0 border-l border-border hover:text-text aria-pressed:bg-[color-mix(in_srgb,var(--brand)_10%,var(--surface))] aria-pressed:font-medium aria-pressed:text-brand";
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="sr-only">{t("filter.verdict")}</legend>
			<div className="flex h-10 items-stretch overflow-hidden rounded-[calc(var(--radius))] border border-border bg-surface">
				{(["", ...VERDICTS] as const).map((v) => (
					<button
						key={v || "all"}
						type="button"
						aria-pressed={value === v}
						onClick={() => onChange(v)}
						className={seg}
					>
						{v === "" ? t("filter.verdictAll") : t(`verdict.${v}` as Key)}
					</button>
				))}
			</div>
		</fieldset>
	);
}

// Categories are searchable rather than a flat pill grid: too many options
// for pills alone, so a text input narrows a scrollable list instead.
export function CategoryPicker({
	t,
	tc,
	cats,
	value,
	onChange,
}: {
	t: T;
	tc: TC;
	cats: Category[];
	value: string;
	onChange: (v: string) => void;
}) {
	const [q, setQ] = useState("");
	const needle = q.trim().toLowerCase();
	const shown = needle
		? cats.filter((c) => tc(c.name).toLowerCase().includes(needle))
		: cats;
	return (
		<fieldset className="m-0 min-w-0 border-0 p-0">
			<legend className="mb-1.5 block text-xs font-medium text-muted uppercase tracking-wide">
				{t("filter.category")}
			</legend>
			<Pill
				label={t("filter.allCategories")}
				active={value === ""}
				onClick={() => onChange("")}
			/>
			<input
				value={q}
				onChange={(e) => setQ(e.target.value)}
				placeholder={t("filter.categorySearch")}
				aria-label={t("filter.categorySearch")}
				className={`${select} mt-1.5 w-full`}
			/>
			<div className="mt-1.5 flex max-h-44 flex-wrap content-start gap-1.5 overflow-y-auto rounded-[calc(var(--radius))] border border-border p-1.5">
				{shown.map((c) => (
					<Pill
						key={c.slug}
						label={tc(c.name)}
						active={value === c.slug}
						onClick={() => onChange(c.slug)}
					/>
				))}
			</div>
		</fieldset>
	);
}

/**
 * The filters currently narrowing the list, each one removable on its own.
 *
 * Without this the reader can only discover what they have set by opening the
 * sheet and reading five groups — the same problem the six-select bar had, just
 * hidden behind a button. A chip row is the half of that bar worth keeping: it
 * shows state, it doesn't ask for it.
 *
 * `sort` is included even though it reorders rather than filters, because a
 * list in an unexpected order is exactly as confusing as one that is missing
 * rows, and the cause is just as invisible.
 */
export function ActiveFilters({
	t,
	tc,
	cats,
	filters,
	setFilters,
}: {
	t: T;
	tc: TC;
	cats: Category[];
	filters: ProductFilters;
	setFilters: (f: ProductFilters) => void;
}) {
	const chips: { key: string; label: string; clear: ProductFilters }[] = [];
	const add = (key: string, label: string, patch: Partial<ProductFilters>) =>
		chips.push({ key, label, clear: { ...filters, ...patch } });

	if (filters.q.trim()) add("q", `“${filters.q.trim()}”`, { q: "" });
	if (filters.category) {
		const c = cats.find((x) => x.slug === filters.category);
		// Falls back to the slug: a category the API hasn't sent yet is still a
		// filter the reader can see and remove, which beats an unexplained gap.
		add("category", c ? tc(c.name) : filters.category, { category: "" });
	}
	if (filters.verdict)
		add("verdict", t(`verdict.${filters.verdict}` as Key), { verdict: "" });
	if (filters.openness)
		add("openness", t(`openness.atLeast.${filters.openness}` as Key), {
			openness: "",
		});
	if (filters.effort)
		add("effort", t(`effort.atMost.${filters.effort}` as Key), { effort: "" });
	if (filters.price)
		add("price", t(`price.band.${filters.price}` as Key), { price: "" });
	if (filters.sort !== "weight") {
		const SORT_KEY: Record<string, Key> = {
			switched: "filter.sortVotes",
			price: "filter.sortPrice",
			name: "filter.sortName",
		};
		add("sort", t(SORT_KEY[filters.sort]), { sort: "weight" });
	}

	if (chips.length === 0) return null;

	return (
		<div className="mt-2 flex flex-wrap items-center gap-1.5">
			{chips.map((c) => (
				<button
					key={c.key}
					type="button"
					onClick={() => setFilters(c.clear)}
					// The chip IS the remove control — there is no second target to hit,
					// which is what makes it work on a phone.
					aria-label={`${t("filter.clear")}: ${c.label}`}
					className="inline-flex items-center gap-1 rounded-[calc(var(--radius))] border border-brand px-2 py-1 text-brand text-xs transition hover:bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]"
				>
					{c.label}
					<X className="size-3" aria-hidden />
				</button>
			))}
			{chips.length > 1 && (
				<button
					type="button"
					onClick={() => setFilters(NO_FILTERS)}
					className="px-1 text-muted text-xs underline underline-offset-2 hover:text-text"
				>
					{t("filter.clear")}
				</button>
			)}
		</div>
	);
}

// The one filter control, at every width. Was phone-only, with a six-select bar
// taking over at `lg` — which is the width where six selects wrap onto two rows
// and became the thing readers complained about. A native <dialog> via
// showModal() for built-in focus trapping, Escape-to-close, and focus restore:
// a bottom sheet on a phone, a centred modal from `sm` up.
export function FilterSheet({
	t,
	tc,
	cats,
	filters,
	setFilters,
	resultCount,
}: {
	t: T;
	tc: TC;
	cats: Category[];
	filters: ProductFilters;
	setFilters: (f: ProductFilters) => void;
	resultCount: number;
}) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const close = () => dialogRef.current?.close();

	// Verdict lives in the trigger row, not this sheet, so it's excluded here.
	const sheetCount =
		[filters.category, filters.effort, filters.openness, filters.price].filter(
			Boolean,
		).length + (filters.sort !== "weight" ? 1 : 0);

	return (
		<>
			<button
				ref={triggerRef}
				type="button"
				onClick={() => dialogRef.current?.showModal()}
				className="inline-flex h-10 items-center gap-1.5 rounded-[calc(var(--radius))] border border-border bg-surface px-3 text-sm hover:border-brand"
			>
				<SlidersHorizontal className="size-4" aria-hidden />
				{t("filter.open")}
				{sheetCount > 0 && <span className="nums">{sheetCount}</span>}
			</button>

			{/* biome-ignore lint/a11y/useKeyWithClickEvents: this onClick detects a
			    backdrop click to dismiss, not an interaction the dialog itself
			    performs — the keyboard equivalent is Escape, which a native
			    `<dialog>` already handles without any handler here. */}
			<dialog
				ref={dialogRef}
				aria-labelledby="filter-sheet-title"
				onClose={() => triggerRef.current?.focus()}
				// e.target === e.currentTarget only when the backdrop, not the sheet
				// content, was clicked.
				onClick={(e) => {
					if (e.target === e.currentTarget) close();
				}}
				// Overrides showModal()'s default auto-centering to render as a bottom
				// sheet on a phone, then hands centering back at `sm` — `inset-0` plus
				// `m-auto` is what the UA stylesheet does, and `h-fit` stops the dialog
				// stretching to full viewport height once it has four sides.
				className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85vh] w-full max-w-full rounded-t-[16px] border-t border-border bg-surface p-0 text-text backdrop:bg-black/40 sm:inset-0 sm:m-auto sm:h-fit sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-[16px] sm:border"
			>
				<div className="flex max-h-[85vh] flex-col">
					<div className="flex items-center justify-between border-b border-border px-4 py-3">
						<h2
							id="filter-sheet-title"
							className="font-display font-semibold text-base"
						>
							{t("filter.open")}
						</h2>
						<button
							type="button"
							aria-label={t("filter.close")}
							onClick={close}
							className="rounded-[calc(var(--radius))] p-1.5 hover:bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]"
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>

					<div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
						<CategoryPicker
							t={t}
							tc={tc}
							cats={cats}
							value={filters.category}
							onChange={(v) => setFilters({ ...filters, category: v })}
						/>
						<PillGroup
							label={t("filter.openness")}
							value={filters.openness}
							options={[
								{ value: "", label: t("filter.anyOpenness") },
								...opennessPillOptions(t),
							]}
							onChange={(v) =>
								setFilters({
									...filters,
									openness: v as ProductFilters["openness"],
								})
							}
						/>
						<PillGroup
							label={t("filter.effort")}
							value={filters.effort}
							options={[
								{ value: "", label: t("filter.anyEffort") },
								...effortPillOptions(t),
							]}
							onChange={(v) =>
								setFilters({
									...filters,
									effort: v as ProductFilters["effort"],
								})
							}
						/>
						<PillGroup
							label={t("filter.price")}
							value={filters.price}
							options={[
								{ value: "", label: t("filter.anyPrice") },
								...pricePillOptions(t),
							]}
							onChange={(v) =>
								setFilters({ ...filters, price: v as ProductFilters["price"] })
							}
						/>

						{/* Sort reorders results, it doesn't filter them, so it's set apart. */}
						<div className="border-t border-border pt-4">
							<PillGroup
								label={t("filter.sort")}
								value={filters.sort}
								options={[
									{ value: "weight", label: t("filter.sortWeight") },
									{ value: "switched", label: t("filter.sortVotes") },
									{ value: "price", label: t("filter.sortPrice") },
									{ value: "name", label: t("filter.sortName") },
								]}
								onChange={(v) =>
									setFilters({ ...filters, sort: v as ProductFilters["sort"] })
								}
							/>
						</div>
					</div>

					<div className="flex items-center gap-2 border-t border-border px-4 py-3">
						<button
							type="button"
							onClick={() =>
								setFilters({
									...filters,
									category: "",
									effort: "",
									openness: "",
									price: "",
									sort: "weight",
								})
							}
							className="rounded-[calc(var(--radius))] border border-border px-3 py-2 text-sm hover:border-brand"
						>
							{t("filter.clear")}
						</button>
						<button
							type="button"
							onClick={close}
							className="flex-1 rounded-[calc(var(--radius))] bg-brand px-3 py-2 text-center font-medium text-sm text-white"
						>
							{t(
								resultCount === 1 ? "filter.show" : "filter.showPlural",
							).replace("{n}", String(resultCount))}
						</button>
					</div>
				</div>
			</dialog>
		</>
	);
}

export function Hidden({ result, t }: { result: FilterResult; t: T }) {
	const { hiddenNoPublic, hiddenUnchecked } = result;
	if (hiddenNoPublic + hiddenUnchecked === 0) return null;
	const parts: string[] = [];
	if (hiddenNoPublic)
		parts.push(`${hiddenNoPublic} ${t("filter.hiddenNoPublic")}`);
	if (hiddenUnchecked)
		parts.push(`${hiddenUnchecked} ${t("filter.hiddenUnchecked")}`);
	return (
		<p className="nums mt-2 text-xs text-muted">
			{t("filter.hiddenPrefix")} {parts.join(" · ")}
		</p>
	);
}

export const opennessOptions = (t: T) =>
	// Freest first, since the control reads "at least this open".
	[...OPENNESS].reverse().map((o) => (
		<option key={o} value={o}>
			{t(`openness.atLeast.${o}` as Key)}
		</option>
	));

export const effortOptions = (t: T) =>
	EFFORTS.filter((e) => e !== "ops").map((e) => (
		<option key={e} value={e}>
			{t(`effort.atMost.${e}` as Key)}
		</option>
	));

export const priceOptions = (t: T) =>
	PRICE_BANDS.map((b) => (
		<option key={b} value={b}>
			{t(`price.band.${b}` as Key)}
		</option>
	));

// Same three axes as above, as {value,label} pairs for PillGroup instead of <option>.
export const opennessPillOptions = (t: T) =>
	[...OPENNESS].reverse().map((o) => ({
		value: o as string,
		label: t(`openness.atLeast.${o}` as Key),
	}));

export const effortPillOptions = (t: T) =>
	EFFORTS.filter((e) => e !== "ops").map((e) => ({
		value: e as string,
		label: t(`effort.atMost.${e}` as Key),
	}));

export const pricePillOptions = (t: T) =>
	PRICE_BANDS.map((b) => ({
		value: b as string,
		label: t(`price.band.${b}` as Key),
	}));
