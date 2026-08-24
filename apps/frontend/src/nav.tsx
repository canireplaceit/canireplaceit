/**
 * Client-side navigation over the real URLs.
 *
 * Every link is a genuine `<a href>` built from `paths` in core: a crawler
 * follows it, middle-click opens a tab, ctrl-click and right-click behave, and
 * only a plain left-click is intercepted for a same-page transition.
 */

import type { ReactNode } from "react";

const ANNOUNCER_ID = "route-announcer";

/**
 * What a full page load does for free, and pushState does not.
 *
 * A reload moves focus to the top of the new document and a screen reader
 * announces its title. `history.pushState` does neither: focus stays on the
 * link that was just activated — which is often in a footer the new page no
 * longer shows — and nothing says the page changed at all. So a keyboard user
 * tabs on from wherever the old page left them, and a screen-reader user gets
 * silence.
 *
 * Both fixes wait a frame, because the title and the new tree are written by
 * React and by `applyMeta` after this function returns; reading `document.title`
 * synchronously here would announce the page just left.
 */
function restoreFocusAndAnnounce(): void {
	requestAnimationFrame(() => {
		const main = document.querySelector("main");
		if (main) {
			// Programmatic focus only — the -1 keeps <main> out of the tab order.
			main.setAttribute("tabindex", "-1");
			// Scrolling is already handled; focus must not fight it.
			main.focus({ preventScroll: true });
		}

		let region = document.getElementById(ANNOUNCER_ID);
		if (!region) {
			region = document.createElement("div");
			region.id = ANNOUNCER_ID;
			region.setAttribute("aria-live", "polite");
			region.setAttribute("aria-atomic", "true");
			region.className = "sr-only";
			document.body.appendChild(region);
		}
		// Re-announce even when the title is unchanged (page 2 of the same list).
		region.textContent = "";
		region.textContent = document.title;
	});
}

export function navigate(path: string): void {
	history.pushState({}, "", path);
	// One event for both kinds of navigation, so the app has a single listener.
	dispatchEvent(new PopStateEvent("popstate"));
	scrollTo(0, 0);
	restoreFocusAndAnnounce();
}

export function Link({
	href,
	className,
	children,
	title,
	// "You are here", in the two forms the site needs it: the assistive one, and
	// the styling hook the header's underline rule keys off. Both are opt-in —
	// most links are not a destination the reader is currently at.
	"aria-current": ariaCurrent,
	"data-current": dataCurrent,
	// The header's sign-in link passes one, because its own text is inside a
	// `lg:inline` span and disappears below 1024px, leaving an icon-only link with
	// no accessible name. It was silently dropped here for months: TypeScript does
	// not apply excess-property checking to hyphenated JSX attribute names, so the
	// call site type-checked and the attribute never reached the anchor.
	"aria-label": ariaLabel,
	rel,
}: {
	href: string;
	className?: string;
	children: ReactNode;
	title?: string;
	"aria-current"?: "page";
	"data-current"?: boolean;
	"aria-label"?: string;
	/** For the few internal links that should carry no weight, e.g. sign-in. */
	rel?: string;
}) {
	return (
		<a
			href={href}
			title={title}
			rel={rel}
			aria-current={ariaCurrent}
			data-current={dataCurrent}
			aria-label={ariaLabel}
			className={className}
			onClick={(e) => {
				// Anything but a plain left-click is the browser's business.
				if (e.defaultPrevented || e.button !== 0) return;
				if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
				e.preventDefault();
				navigate(href);
			}}
		>
			{children}
		</a>
	);
}
