/**
 * The page frame every route shares.
 *
 * WHY THIS EXISTS. There were three different page tops on this site. The
 * product and project pages opened with a bare "← The list"; the category,
 * collection and index pages opened with a breadcrumb; the standing pages
 * (features, stats, sponsor, submit, contact) opened with an `<h1>` and nothing
 * at all. So a reader two clicks deep could not tell where they were, and the
 * three tops had three different vertical rhythms — which is most of why the
 * site read as a set of documents rather than as one place.
 *
 * One frame now: a trail, an optional eyebrow, the title, a lede, and a meta row
 * for the facts that qualify the title. Every one of them is optional and the
 * block collapses cleanly to just an `<h1>`, so the smallest page pays nothing
 * for the largest page's structure.
 *
 * The band behind it is a wash, not a panel — it is full-bleed while its
 * contents stay on the same measure as the body, which is the only way a header
 * can span the window without the title drifting off the column the content
 * below it lines up with.
 */

import { ChevronRight, Home } from "lucide-react";
import { Link } from "./nav";

/** One source of truth for the main column's width. Re-exported from listShared
 *  so a page importing the frame does not also have to import the list's file. */
export { MEASURE } from "./listShared";

/** The reading measure for pages that are prose rather than rows. */
export const PROSE = "max-w-4xl";

export type Crumb = { label: string; href?: string };

/**
 * The visible breadcrumb, matching the `BreadcrumbList` JSON-LD in seo.ts one
 * for one. Google's guidance is that the markup describe a trail the page
 * actually shows; two different trails is worse than none.
 *
 * The first crumb carries a house icon and its label is hidden below `sm` — on a
 * 375px phone a four-level trail wrapped to three lines, and the word "Home" is
 * the one crumb whose meaning survives being an icon.
 */
export function Trail({ items }: { items: Crumb[] }) {
	return (
		<nav aria-label="Breadcrumb" className="min-w-0 text-muted text-sm">
			<ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
				{items.map((item, i) => (
					<li key={item.label} className="flex min-w-0 items-center gap-1.5">
						{i > 0 && (
							<ChevronRight
								className="size-3.5 shrink-0 opacity-60"
								aria-hidden
							/>
						)}
						{item.href ? (
							<Link
								href={item.href}
								className="flex min-w-0 items-center gap-1.5 transition hover:text-text hover:underline"
							>
								{i === 0 && <Home className="size-3.5 shrink-0" aria-hidden />}
								<span className={i === 0 ? "hidden sm:inline" : "truncate"}>
									{item.label}
								</span>
							</Link>
						) : (
							// The current page is not a link, and is allowed to be the one
							// crumb that wraps rather than truncates — it is the longest and
							// it is the one the reader actually needs to read.
							<span aria-current="page" className="text-text">
								{item.label}
							</span>
						)}
					</li>
				))}
			</ol>
		</nav>
	);
}

/** The small mono label over a block. `.eyebrow` is defined once in index.css. */
export const Heading = ({ children }: { children: React.ReactNode }) => (
	<h2 className="eyebrow mb-2">{children}</h2>
);

/**
 * A titled block of content, with an optional count beside the title and
 * optional controls on the right. Every "heading, then a grid" pair on the site
 * is this, and they had four different gaps between the two.
 */
export function Section({
	title,
	count,
	actions,
	children,
	className = "",
}: {
	title: string;
	/** How many rows are under it. Worth knowing before scrolling past. */
	count?: number;
	actions?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section className={`mt-10 ${className}`}>
			<div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<h2 className="font-display font-semibold text-lg">
					{title}
					{count !== undefined && (
						<span className="nums ml-2 font-normal text-muted text-sm">
							{count}
						</span>
					)}
				</h2>
				{actions}
			</div>
			{children}
		</section>
	);
}

/**
 * The page frame.
 *
 * `measure` is for the pages that sit in the same column as the list: the width
 * the list lays its rows out at is the width its category pages have to line up
 * with, or the site reads as two unrelated columns. Prose pages keep the
 * narrower reading measure.
 */
export function PageShell({
	trail,
	eyebrow,
	title,
	lede,
	meta,
	aside,
	icon,
	measure = PROSE,
	children,
}: {
	trail?: Crumb[];
	/** A word above the title saying what KIND of page this is. */
	eyebrow?: React.ReactNode;
	title?: React.ReactNode;
	/** One or two sentences under the title. Never a third — that is the body. */
	lede?: React.ReactNode;
	/** The facts that qualify the title: a verdict, a licence, a count. */
	meta?: React.ReactNode;
	/** The one action the page offers, pulled to the right of the title on wide
	 *  screens and dropped under it on narrow ones. */
	aside?: React.ReactNode;
	icon?: React.ReactNode;
	measure?: string;
	children?: React.ReactNode;
}) {
	const hasHead = Boolean(trail || title || eyebrow || lede || meta);
	return (
		<>
			{hasHead && (
				<div className="page-head">
					<div className={`mx-auto ${measure} px-4 pt-5 pb-7 sm:pt-6 sm:pb-9`}>
						{trail && <Trail items={trail} />}
						{(title || eyebrow || aside || icon) && (
							<div
								className={`flex flex-wrap items-start justify-between gap-x-6 gap-y-4 ${trail ? "mt-4" : ""}`}
							>
								<div className="flex min-w-0 items-start gap-3.5">
									{icon}
									<div className="min-w-0">
										{eyebrow && <p className="eyebrow mb-1.5">{eyebrow}</p>}
										{/* Clamped rather than sized once: at 30 characters a
										    product title is a headline, and at 90 (some category
										    names in French) the same size is a wall. */}
										{title && (
											<h1 className="text-balance font-display font-bold text-[clamp(1.65rem,1.15rem+2vw,2.4rem)] leading-[1.15]">
												{title}
											</h1>
										)}
									</div>
								</div>
								{aside && <div className="shrink-0">{aside}</div>}
							</div>
						)}
						{lede && (
							<p className="mt-3 max-w-2xl text-pretty text-muted leading-relaxed">
								{lede}
							</p>
						)}
						{meta && <div className="mt-4">{meta}</div>}
					</div>
				</div>
			)}
			<main id="main" className={`mx-auto ${measure} px-4 pt-8 pb-20`}>
				{children}
			</main>
		</>
	);
}
