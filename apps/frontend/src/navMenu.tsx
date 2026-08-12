/**
 * The header's dropdowns, and the disclosure manners they share with the big
 * category menu on the pages.
 *
 * WHAT THIS IS AND WHAT IT IS NOT. `CategoryMenu` in categories.tsx is an INDEX:
 * all 84 categories, in the document, in editorial order, for a reader who is
 * already on a category page and wants a different one. The menus here are
 * SHORTCUTS: a short list of links with the way to the full one underneath.
 * Making the header carry all 84 was tried and it was wrong — a nav dropdown
 * that is taller than the viewport is not navigation, it is the index rendered
 * in the wrong place.
 *
 * Everything is still a real `<a href>` inside a native `<details>`, so the
 * links are in the prerendered document whether the panel is open or shut and a
 * reader with no bundle can open it. The complete category link graph does not
 * depend on this component at all: the footer carries all 84 on every page, and
 * the category pages carry `CategoryMenu`. This is a convenience laid over a
 * graph that is already whole.
 */

import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "./nav";

/** Long enough to cross from the trigger to the panel, short enough not to hang. */

/**
 * The manners a native `<details>` lacks, and nothing else.
 *
 * Native `<details>` closes on none of Escape, a click elsewhere, or the
 * navigation one of its own links just performed — `navigate` in nav.tsx is a
 * pushState, so nothing unmounts and the panel would sit open over the page it
 * just went to. None of that is needed for the links to WORK, which is why it
 * all lives here, after hydration, and the no-JS document is a plain disclosure
 * that opens and shuts on its own.
 *
 * Hover opens it too, but only as an enhancement and only where hovering means
 * anything. `(hover: hover) and (pointer: fine)` is the whole guard: on a touch
 * screen a tap synthesises a hover that never ends, so a hover-driven menu opens
 * and stays open under the reader's thumb. Click, Enter, Space and Escape are
 * the base behaviour on every device.
 */
export function useDisclosure() {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDetailsElement>(null);
	useEffect(() => {
		if (!open) return;
		const shut = () => setOpen(false);
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			shut();
			// Focus goes back to the trigger it came from, or it lands on <body> and
			// the next Tab starts the page over.
			ref.current?.querySelector("summary")?.focus();
		};
		const onDown = (e: MouseEvent) => {
			if (!ref.current?.contains(e.target as Node)) shut();
		};
		addEventListener("keydown", onKey);
		addEventListener("mousedown", onDown);
		addEventListener("popstate", shut);
		return () => {
			removeEventListener("keydown", onKey);
			removeEventListener("mousedown", onDown);
			removeEventListener("popstate", shut);
		};
	}, [open]);

	return {
		open,
		ref,
		setOpen,
	};
}

export type NavItem = {
	key: string;
	href: string;
	label: string;
	icon: ComponentType<{ className?: string }>;
	/** How many entries are behind the link. Worth knowing before the click. */
	count?: number;
};

// `min-h-11` is the reason this is not just padding: below `lg` these rows ARE
// the site's navigation and they are tapped with a thumb, so every one of them
// clears the 44px target regardless of how short its label is.
export const navRow =
	"flex min-h-11 items-center gap-2.5 rounded-[calc(var(--radius))] px-2.5 py-2 text-sm hover:bg-[color-mix(in_srgb,var(--brand)_10%,transparent)] aria-[current=page]:bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] aria-[current=page]:font-medium aria-[current=page]:text-brand";

export function NavRow({ item }: { item: NavItem }) {
	const Icon = item.icon;
	return (
		<Link href={item.href} className={navRow}>
			<Icon className="size-4 shrink-0 text-brand" />
			{/* `min-w-0` and not just `truncate`: a flex child's default minimum is
			    its content, so one long name widens the panel instead of ellipsing. */}
			<span className="min-w-0 flex-1 truncate">{item.label}</span>
			{item.count !== undefined && (
				<span className="nums shrink-0 text-xs text-muted">{item.count}</span>
			)}
		</Link>
	);
}

/**
 * One header dropdown: a short list of links, and the way to the full one under
 * them.
 *
 * The panel is absolutely positioned so opening it covers the page instead of
 * shoving the header's own row apart, and it is anchored to its own TRIGGER so
 * it opens where the reader clicked.
 *
 * It was anchored to the header's `max-w-6xl` column instead, which could not
 * overflow at any width — but pinned every panel to the right edge of the page,
 * so "Categories" opened a list floating above "Submit". Correct, and useless.
 *
 * The overflow that motivated it is real, and is handled two ways now: `align`
 * flips the panel to the other side for a trigger near the right edge, and the
 * panel is clamped to `calc(100vw-2rem)` so it can never widen the document
 * even if a future trigger ends up somewhere unexpected.
 */
export function NavMenu({
	label,
	items,
	allHref,
	allLabel,
	current = false,
	align = "left",
}: {
	label: string;
	items: NavItem[];
	allHref: string;
	allLabel: string;
	/** The reader is on a page under this menu. Marked the same way a plain nav
	 *  link is, so the row has one rule for "you are here" and not two. */
	current?: boolean;
	/**
	 * Which edge of the panel meets the trigger.
	 *
	 * `left` hangs the panel to the right of the trigger, which is what reads as
	 * "underneath" for anything in the first half of the row. A trigger near the
	 * right edge needs `right`, or a 320px panel starting at its left edge runs
	 * off the viewport — the sideways scroll this file has warned about since it
	 * shipped.
	 */
	align?: "left" | "right";
}) {
	const { open, ref, setOpen } = useDisclosure();

	return (
		// `relative`, not `static`. It was static so the panel resolved against the
		// sticky <header> and could be pinned to the header's own max-w-6xl column
		// — which never overflowed, but put the Categories panel hard against the
		// right edge of the page, nowhere near the word "Categories". A dropdown
		// that opens on the other side of the header is not a dropdown.
		//
		// Anchoring to the trigger instead is what "underneath the menu" means; the
		// overflow that motivated the original approach is handled by `align`
		// above and the width clamp on the panel.
		<details
			ref={ref}
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
			className="group relative"
		>
			{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: a <summary> is exposed as a disclosure button and the expanded state is the one thing a trigger must announce; browsers derive it from the `open` attribute, this mirrors it for the readers that do not. */}
			<summary
				aria-expanded={open}
				data-current={current}
				className="nav-link flex cursor-pointer list-none items-center gap-1 outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)] group-open:text-text [&::-webkit-details-marker]:hidden"
			>
				{label}
				<ChevronDown
					className="size-3.5 shrink-0 transition-transform group-open:rotate-180"
					aria-hidden
				/>
			</summary>

			{/* The 12px offset is PADDING and not a margin: a gap between the trigger
			    and the panel is a strip the pointer falls through on the way down,
			    and the panel closes under it. */}
			<div
				className={`absolute top-full z-50 pt-3 ${align === "right" ? "right-0" : "left-0"}`}
			>
				{/* `w-72`, and clamped to the viewport: it reads as a menu rather than a
				    mega-menu — a shortcut into the index, not a copy of it — and the
				    clamp means even a badly-placed trigger cannot widen the document. */}
				<ul className="w-72 max-w-[calc(100vw-2rem)] rounded-[calc(var(--radius))] border border-border bg-surface p-2 text-text shadow-lg">
					{items.map((i) => (
						<li key={i.key} className="min-w-0">
							<NavRow item={i} />
						</li>
					))}
					{/* Under the items and ruled off from them: the full list is a
						    different page, not the eleventh row of this one. */}
					<li className="min-w-0">
						<Link
							href={allHref}
							className={`${navRow} mt-1 border-border border-t pt-2.5 font-medium text-brand`}
						>
							<span className="min-w-0 flex-1 truncate">{allLabel}</span>
							<ArrowRight className="size-3.5 shrink-0" aria-hidden />
						</Link>
					</li>
				</ul>
			</div>
		</details>
	);
}

/**
 * The same nav, for every width the dropdowns are too wide for.
 *
 * WHY THIS EXISTS. The header's link row was `hidden md:flex`, which meant that
 * from 768px up it rendered seven links, a language switch and a theme toggle
 * beside the wordmark — about 803px of content in a 768px viewport. It
 * overflowed at the exact breakpoint that turned it on, and that was true
 * BEFORE any dropdown was added to it. Two chevrons would have made it worse.
 *
 * So the row now waits for `lg`, where it genuinely fits, and everything below
 * `lg` gets this instead: one trigger, and a sheet holding every nav link plus
 * the same shortcuts the dropdowns carry. Nothing is dropped on a phone — the
 * previous behaviour below `md` was no nav at all.
 *
 * It is the same `<details>` as the dropdowns, so it works with no JavaScript
 * and its links are in the prerendered document either way.
 */
export function NavSheet({
	label,
	links,
	groups,
}: {
	label: string;
	links: { href: string; label: string; current?: boolean }[];
	groups: {
		title: string;
		items: NavItem[];
		allHref: string;
		allLabel: string;
	}[];
}) {
	const { open, ref, setOpen } = useDisclosure();

	return (
		// `static`, so the panel below resolves against the sticky <header> and can
		// span the full window rather than the width of this button.
		<details
			ref={ref}
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
			className="static lg:hidden"
		>
			{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: a <summary> is exposed as a disclosure button; browsers derive the expanded state from `open`, this mirrors it for the readers that do not. */}
			<summary
				aria-expanded={open}
				aria-label={label}
				className="flex cursor-pointer list-none items-center rounded-[calc(var(--radius))] border border-border p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)] [&::-webkit-details-marker]:hidden"
			>
				{open ? (
					<X className="size-4" aria-hidden />
				) : (
					<Menu className="size-4" aria-hidden />
				)}
			</summary>

			<div className="absolute inset-x-0 top-full max-h-[calc(100dvh-3.5rem)] overflow-y-auto overscroll-contain border-border border-b bg-surface shadow-lg">
				<div className="mx-auto max-w-6xl space-y-5 px-4 py-4">
					<ul className="grid grid-cols-1 gap-0.5">
						{links.map((l) => (
							<li key={l.href} className="min-w-0">
								<Link
									href={l.href}
									aria-current={l.current ? "page" : undefined}
									className={`${navRow} font-medium`}
								>
									<span className="min-w-0 flex-1 truncate">{l.label}</span>
								</Link>
							</li>
						))}
					</ul>

					{/* One disclosure per group, shut by default — NOT the flat expanded
					    list this shipped as. Rendering every group open put ten
					    categories, six collections and the plain links in one column:
					    roughly 30 rows, so on a 375px phone the sheet opened onto a wall
					    of category names and the actual nav was somewhere below the fold.
					    Collapsed, the whole nav is one screen and each group opens into
					    the same shortcut list the desktop dropdown shows.

					    Nested `<details>` is native, so this still works with no
					    JavaScript and every link stays in the prerendered document —
					    which is the only reason the sheet was built on `<details>` in the
					    first place. */}
					{groups.map((g) => (
						<details
							key={g.title}
							className="group border-border border-t pt-2"
						>
							<summary
								className={`${navRow} cursor-pointer list-none font-medium [&::-webkit-details-marker]:hidden`}
							>
								<span className="min-w-0 flex-1 truncate">{g.title}</span>
								<ChevronDown
									className="size-3.5 shrink-0 text-muted transition-transform group-open:rotate-180"
									aria-hidden
								/>
							</summary>
							{/* `grid-cols-1` is not redundant: with no explicit track the grid
							    sizes auto columns to max-content, and one long category name
							    scrolls the document sideways at 375px. */}
							<ul className="mt-1 grid grid-cols-1 gap-x-3 pl-1 sm:grid-cols-2">
								{g.items.map((i) => (
									<li key={i.key} className="min-w-0">
										<NavRow item={i} />
									</li>
								))}
							</ul>
							<Link
								href={g.allHref}
								className={`${navRow} mt-1 ml-1 font-medium text-brand`}
							>
								<span className="min-w-0 flex-1 truncate">{g.allLabel}</span>
								<ArrowRight className="size-3.5 shrink-0" aria-hidden />
							</Link>
						</details>
					))}
				</div>
			</div>
		</details>
	);
}
