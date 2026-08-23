/**
 * The disclosure manners the header's dropdowns and the big category menu on the
 * category pages shared.
 *
 * WHAT LEFT AND WHY. This file also held `NavMenu` (three header dropdowns —
 * ten themes, ten categories, thirteen collections) and `NavSheet` (the same
 * links again, for narrow viewports). Both rendered in full on every one of
 * 8,864 documents and hid each other with CSS, which is how 43 unique hrefs
 * became 88 anchors per page and 88.7% of the whole link graph became
 * boilerplate. The grids live on `/categories/` and `/collections/` now — the
 * hubs that already carried all 85 categories, all ten theme hubs and all
 * thirteen collections — and the header is one row of eight links rendered once.
 *
 * What is left is what `CategoryMenu` in categories.tsx still needs.
 */

import { useEffect, useRef, useState } from "react";

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
