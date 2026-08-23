// The pieces every ad unit shares: the paid disclosure, the house ad, and the tint applied to a sponsor's card.

import { useSyncExternalStore } from "react";
import type { Slot } from "./api";
import type { Key } from "./i18n";

type T = (k: Key) => string;

// The paid disclosure. Always rendered, never hover-only — there's no hover on a touch screen. Shortens to "Ad" on a
// phone, "Sponsored" from `sm` up, both strings in the DOM and swapped with CSS (a JS-measured breakpoint would
// mismatch between the prerendered and hydrated pass). Both spans are aria-hidden; the real disclosure for assistive
// tech is the link's aria-label (see `adLabel`), announced before the destination.
export function AdBadge({ t, className = "" }: { t: T; className?: string }) {
	return (
		<span
			aria-hidden
			className={`inline-flex shrink-0 items-center gap-1.5 font-mono text-[9px] text-muted uppercase tracking-[0.16em] ${className}`}
		>
			<span
				className="size-1 rounded-full"
				style={{ background: "var(--accent)" }}
			/>
			<span className="sm:hidden">{t("ads.adShort")}</span>
			<span className="hidden sm:inline">{t("ads.sponsored")}</span>
		</span>
	);
}

// The disclosure sits second, immediately after the name, so it's heard before the reader decides whether to follow the link.
export const adLabel = (t: T, name: string, tagline?: string | null) =>
	`${name} — ${t("ads.sponsored")}.${tagline ? ` ${tagline}` : ""}`;

// The house ad, run in place of unsold inventory's own pitch on one position per surface — see `isHouseSlot`.
// Not labelled "sponsored": nobody paid for it.
export const HOUSE = {
	name: "hadesdev",
	url: "https://hadesdev.com",
	// Inlined rather than linked. It used to be `https://hadesdev.com/favicon.svg`,
	// which is 649 bytes on the wire and a whole extra DNS lookup and TLS
	// handshake — the site's only third-party request — for a 24px mark. As a data
	// URI it costs 470 bytes inside the bundle and no request at all.
	logoUrl:
		"data:image/svg+xml,<svg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%20width='24'%20height='24'><rect%20x='1'%20y='1'%20width='22'%20height='22'%20rx='5'%20fill='%2324273a'/><path%20d='M6%208.5%20L10%2012%20L6%2015.5'%20fill='none'%20stroke='%23c6a0f6'%20stroke-width='2.2'%20stroke-linecap='round'%20stroke-linejoin='round'/><line%20x1='12'%20y1='15.5'%20x2='18'%20y2='15.5'%20stroke='%23c6a0f6'%20stroke-width='2.2'%20stroke-linecap='round'/></svg>",
	/** Shown by `Logo` if that ever stops resolving. */
	initial: "H",
} as const;

// A bold outline in the sponsor's colour plus a wash background. 12% over --surface is the strongest mix that still
// passes text contrast in both themes; null tint falls back to the site's own accent.
export const tintStyle = (tint: string | null | undefined) => {
	const c = tint || "var(--accent)";
	return {
		borderColor: c,
		borderWidth: 2,
		background: `color-mix(in srgb, ${c} 12%, var(--color-surface))`,
	};
};

// The rate card and the ad units live in different subtrees (App renders the rails/hero wall beside the page, not
// inside the form), so a draft can't be passed down as a prop. This is a two-field external store instead: the form
// writes, the units read. `useSyncExternalStore` (not context) so only the units that care re-render on a keystroke.
// The server snapshot is a frozen empty value so the prerendered document matches the first client render.
export type AdDraft = {
	name: string;
	tagline: string;
	logoUrl: string;
	tint: string;
};

type PreviewState = { ids: ReadonlySet<string>; draft: AdDraft | null };

const EMPTY_PREVIEW: PreviewState = { ids: new Set(), draft: null };
let previewState: PreviewState = EMPTY_PREVIEW;
const previewListeners = new Set<() => void>();

/** Called by the form on every change; clears with `(new Set(), null)`. */
export function setAdPreview(ids: ReadonlySet<string>, draft: AdDraft | null) {
	previewState = draft && ids.size ? { ids, draft } : EMPTY_PREVIEW;
	for (const l of previewListeners) l();
}

export function useAdPreview(): PreviewState {
	return useSyncExternalStore(
		(cb) => {
			previewListeners.add(cb);
			return () => previewListeners.delete(cb);
		},
		() => previewState,
		() => EMPTY_PREVIEW,
	);
}

// Exactly one house-ad position per surface (the last one), never displacing a paying sponsor.
export const isHouseSlot = (
	slot: Slot,
	index: number,
	total: number,
): boolean => !slot.sponsor && index === total - 1;
