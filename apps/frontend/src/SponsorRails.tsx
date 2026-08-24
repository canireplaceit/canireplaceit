// Two vertical sponsor rails flanking the page, five slots each. An empty slot renders as "sponsor this project"
// rather than blank space, so the rails are never empty. Prices live on the rate card, not on the ambient ask.
// Every ad unit carries `data-ad-slot` (and `data-ad-purchase` when sold) — `adTracking.ts` finds these via
// MutationObserver, since the rails never unmount and the marquee renders each slot twice, so nothing render-shaped
// can count a view without double-counting.

import { paths } from "core/src/routes";
import { useEffect, useState } from "react";
import {
	AdBadge,
	adLabel,
	HOUSE,
	isHouseSlot,
	tintStyle,
	useAdPreview,
} from "./ads";
import { type Slot, sponsorClickUrl } from "./api";
import { Logo } from "./components";
import type { Key, Lang } from "./i18n";

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

function RailSlot({
	slot,
	t,
	tc,
	lang,
	house,
}: {
	slot: Slot;
	/** True only for the one position that carries the house ad. */
	house: boolean;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	// Live preview of what's being composed on the rate card right now, shown instead of the open-slot pitch. Not a
	// link and carries no `data-ad-purchase`, so the impression observer ignores it.
	const preview = useAdPreview();
	const composing =
		preview.draft && preview.ids.has(slot.id) ? preview.draft : null;

	const frame =
		"flex h-full min-h-0 flex-1 flex-col rounded-[calc(var(--radius))] border bg-surface p-3.5 transition";

	if (composing) {
		return (
			<div
				data-ad-slot={slot.id}
				className={`${frame} animate-[pulse_2.5s_ease-in-out_infinite]`}
				style={tintStyle(composing.tint || null)}
			>
				<span className="flex items-center gap-2.5">
					<Logo
						src={composing.logoUrl || null}
						name={composing.name || "?"}
						size={40}
					/>
					<span className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
						{composing.name || t("creative.yourName")}
					</span>
				</span>
				<span className="mt-2.5 block text-[13px] text-muted leading-snug">
					{composing.tagline || t("creative.yourTagline")}
				</span>
				<span
					className="mt-auto pt-2.5 font-mono text-[9px] uppercase tracking-[0.16em]"
					style={{ color: composing.tint || "var(--accent)" }}
				>
					{slot.id} · {t("ads.previewing")}
				</span>
			</div>
		);
	}

	if (slot.sponsor) {
		const s = slot.sponsor;
		return (
			<a
				href={sponsorClickUrl(s.purchaseId, slot.id)}
				data-ad-slot={slot.id}
				data-ad-purchase={s.purchaseId}
				target="_blank"
				rel="sponsored noopener"
				aria-label={adLabel(t, tc(s.name), s.tagline ? tc(s.tagline) : null)}
				className={`${frame} hover:brightness-[1.03]`}
				style={tintStyle(s.tint)}
			>
				<span className="flex items-center gap-2.5">
					<Logo src={s.logoUrl} name={tc(s.name)} size={40} />
					<span className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
						{tc(s.name)}
					</span>
				</span>
				{s.tagline && (
					<span className="mt-2.5 block text-[13px] text-muted leading-snug">
						{tc(s.tagline)}
					</span>
				)}
				{/* mt-auto pins it to the foot of a card taller than its own text. */}
				<AdBadge t={t} className="mt-auto pt-2.5" />
			</a>
		);
	}

	if (house) {
		return (
			<a
				href={HOUSE.url}
				target="_blank"
				rel="noopener"
				data-ad-slot={slot.id}
				aria-label={`${HOUSE.name} — ${t("ads.houseLabel")}. ${t("ads.houseBody")}`}
				className={`${frame} hover:brightness-110`}
				style={{
					borderColor: "color-mix(in srgb, var(--brand) 40%, transparent)",
					background:
						"linear-gradient(180deg, color-mix(in srgb, var(--brand) 9%, var(--surface)), var(--surface))",
				}}
			>
				<span className="flex items-center gap-2.5">
					<Logo src={HOUSE.logoUrl} name={HOUSE.name} size={40} />
					<span className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
						{HOUSE.name}
					</span>
				</span>
				<span className="mt-2.5 block text-[13px] text-muted leading-snug">
					{t("ads.houseBody")}
				</span>
				{/* Deliberately NOT the sponsored badge: nobody paid for this one. */}
				<span
					aria-hidden
					className="mt-auto pt-2.5 font-mono text-[9px] uppercase tracking-[0.16em]"
					style={{ color: "var(--brand)" }}
				>
					{t("ads.houseLabel")}
				</span>
			</a>
		);
	}

	return (
		<a
			href={paths.sponsor(lang, slot.id)}
			data-ad-slot={slot.id}
			className={`${frame} justify-center border-dashed text-center hover:bg-[var(--surface-2)]`}
			style={{
				borderColor: "color-mix(in srgb, var(--accent) 40%, transparent)",
			}}
		>
			{/* Prints the slot id so a buyer can match a position on the rate card to a dashed box on the page. */}
			<span className="block font-mono text-[9px] text-muted uppercase tracking-[0.16em]">
				{slot.id} · {t("ads.openSlot")}
			</span>
			{/* No price here: the ask sits on the page all day, the rate card is one click away. */}
			<span
				className="mt-1 block font-semibold text-[15px] leading-snug"
				style={{ color: "var(--accent)" }}
			>
				{t("ads.yourProductHere")} →
			</span>
			<span className="sr-only">{tc(slot.label)}</span>
		</a>
	);
}

// A sponsor that sits in the flow of the list as a row of its own. Keeps the list's rhythm (logo size, padding,
// horizontal structure) so the page doesn't jump as slots come and go, but stays visually distinct from a verdict —
// dashed border, accent colour, no verdict mark, visible "sponsored" label.
export function InListSponsor({
	slot,
	t,
	tc,
	lang,
}: {
	slot: Slot;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const size = 34;
	const edge = "color-mix(in srgb, var(--accent) 50%, transparent)";
	const preview = useAdPreview();
	const composing =
		preview.draft && preview.ids.has(slot.id) ? preview.draft : null;
	const frame =
		"flex h-full w-full items-start gap-3 rounded-[calc(var(--radius))] border border-dashed bg-surface p-3.5 transition hover:bg-[var(--surface-2)]";
	const body = "min-w-0 flex-1";
	const meta =
		"mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted";
	const name = "block truncate font-display font-semibold";
	const label = (
		<span
			className="shrink-0 rounded-[calc(var(--radius))] border px-1.5 py-px font-mono text-[9px] leading-relaxed uppercase tracking-[0.14em]"
			style={{ borderColor: edge, color: "var(--accent)" }}
		>
			{t(slot.sponsor ? "ads.sponsored" : "ads.openSlot")}
		</span>
	);

	if (composing) {
		return (
			<div
				data-ad-slot={slot.id}
				className={`${frame} animate-[pulse_2.5s_ease-in-out_infinite]`}
				// Solid, not the dashed open-slot frame — this is what the ad will look like.
				style={{ ...tintStyle(composing.tint || null), borderStyle: "solid" }}
			>
				<Logo
					src={composing.logoUrl || null}
					name={composing.name || "?"}
					size={size}
				/>
				<span className={body}>
					<span className={name}>
						{composing.name || t("creative.yourName")}
					</span>
					<span className={meta}>
						<span
							className="shrink-0 rounded-[calc(var(--radius))] border px-1.5 py-px font-mono text-[9px] leading-relaxed uppercase tracking-[0.14em]"
							style={{
								borderColor: composing.tint || "var(--accent)",
								color: composing.tint || "var(--accent)",
							}}
						>
							{slot.id} · {t("ads.previewing")}
						</span>
						<span className="min-w-0 truncate text-xs text-muted">
							{composing.tagline || t("creative.yourTagline")}
						</span>
					</span>
				</span>
			</div>
		);
	}

	if (slot.sponsor) {
		const s = slot.sponsor;
		return (
			<a
				href={sponsorClickUrl(s.purchaseId, slot.id)}
				data-ad-slot={slot.id}
				data-ad-purchase={s.purchaseId}
				target="_blank"
				rel="sponsored noopener"
				className={frame}
				style={{ borderColor: edge }}
			>
				<Logo src={s.logoUrl} name={tc(s.name)} size={size} />
				<span className={body}>
					<span className={name}>{tc(s.name)}</span>
					<span className={meta}>
						{label}
						{s.tagline && (
							<span className="min-w-0 truncate text-xs text-muted">
								{tc(s.tagline)}
							</span>
						)}
					</span>
				</span>
			</a>
		);
	}

	return (
		<a
			href={paths.sponsor(lang, slot.id)}
			data-ad-slot={slot.id}
			className={frame}
			style={{ borderColor: edge }}
			aria-label={`${tc(slot.label)} — ${t("ads.yourProductHere")}`}
		>
			<span
				className="grid shrink-0 place-items-center rounded-[calc(var(--radius))] border border-dashed text-sm"
				style={{
					width: size,
					height: size,
					borderColor: edge,
					color: "var(--accent)",
				}}
			>
				+
			</span>
			<span className={body}>
				<span className={name} style={{ color: "var(--accent)" }}>
					{t("ads.yourProductHere")}
				</span>
				<span className={meta}>
					{label}
					<span className="min-w-0 truncate text-xs text-muted">
						{tc(slot.label)}
					</span>
				</span>
			</span>
			<span className="shrink-0 text-sm" style={{ color: "var(--accent)" }}>
				→
			</span>
		</a>
	);
}

/** One rail, a real grid column at ≥1560px, sticky within its own lane. */
export function SponsorRail({
	slots,
	side: which,
	t,
	tc,
	lang,
}: {
	slots: Slot[];
	side: "left" | "right";
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const side = slots
		.filter((s) => s.placement === "rail" && s.rail === which)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	if (side.length === 0) return null;

	return (
		<aside
			aria-label={t(which === "left" ? "ads.railLeft" : "ads.railRight")}
			// Below 1560px the rails are gone entirely and the tapes carry the same inventory instead — no cramped middle state.
			className="sticky top-20 hidden h-[calc(100dvh-6.5rem)] flex-col gap-2.5 self-start min-[1560px]:flex"
		>
			{side.map((s, i) => (
				<RailSlot
					key={s.id}
					slot={s}
					t={t}
					tc={tc}
					lang={lang}
					house={which === "right" && isHouseSlot(s, i, side.length)}
				/>
			))}
		</aside>
	);
}

// On phones and tablets there's no room for side rails, so the same inventory runs as a marquee top and bottom.
function TapeItem({
	slot,
	t,
	tc,
	lang,
}: {
	slot: Slot;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const chip =
		"flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs";

	if (slot.sponsor) {
		const s = slot.sponsor;
		return (
			<a
				href={sponsorClickUrl(s.purchaseId, slot.id)}
				data-ad-slot={slot.id}
				data-ad-purchase={s.purchaseId}
				target="_blank"
				rel="sponsored noopener"
				className={`${chip} border-border bg-surface`}
			>
				<Logo src={s.logoUrl} name={tc(s.name)} size={16} />
				<span className="font-medium">{tc(s.name)}</span>
				{s.tagline && (
					<span className="hidden text-muted sm:inline">{tc(s.tagline)}</span>
				)}
				<span className="font-mono text-[9px] uppercase tracking-widest text-muted">
					{t("ads.sponsored")}
				</span>
			</a>
		);
	}

	return (
		<a
			href={paths.sponsor(lang, slot.id)}
			data-ad-slot={slot.id}
			className={`${chip} border-dashed bg-surface`}
			style={{
				borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
			}}
		>
			<span
				className="grid size-4 place-items-center rounded-full text-[10px]"
				style={{ background: "var(--accent)", color: "var(--bg)" }}
			>
				+
			</span>
			<span className="text-muted">{t("ads.yourProductHere")}</span>
		</a>
	);
}

export function SponsorTape({
	slots,
	t,
	tc,
	lang,
	position,
}: {
	slots: Slot[];
	t: T;
	tc: TC;
	lang: Lang;
	position: "top" | "bottom";
}) {
	/**
	 * The cells are drawn by the browser, never by the prerenderer.
	 *
	 * Baking them in is what fixed the home page's 0.5514 CLS: the band had a
	 * height from the first paint, so /api/slots arriving could not move the
	 * whole page down. It cost 8.5 kB of chip markup on every one of 8,868
	 * documents, ten "Sponsor this project" links above the reader's own
	 * breadcrumb, and 148 ms of the product page's LCP.
	 *
	 * The height is the thing that mattered, not the cells — so the track
	 * reserves it in CSS instead and the board hydrates into a box that is
	 * already the right size. Both renders agree on empty, so there is no
	 * hydration mismatch; the effect runs after and fills it in.
	 */
	const [hydrated, setHydrated] = useState(false);
	useEffect(() => setHydrated(true), []);

	// Left five run along the top, right five along the bottom, so a slot keeps the same neighbours at every width.
	const items = slots
		.filter(
			(s) =>
				s.placement === "rail" &&
				s.rail === (position === "top" ? "left" : "right"),
		)
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
	if (items.length === 0) return null;

	const edge = position === "top" ? "border-b" : "border-t";

	return (
		<aside
			aria-label={t(position === "top" ? "ads.tapeTop" : "ads.tapeBottom")}
			className={`marquee-mask overflow-hidden border-border bg-bg py-2 min-[1560px]:hidden ${edge}`}
		>
			{/*
			 * 1.875rem is exactly what a chip measures (12px label + 2×6px padding
			 * + 2×1px border), so the reserved band and the filled one are the same
			 * height to the pixel. `min-h`, not `h`: under `prefers-reduced-motion`
			 * the track becomes a real horizontal scroller and is allowed to grow
			 * for a scrollbar, exactly as it does today.
			 */}
			<div className="marquee flex min-h-[1.875rem] w-max gap-2 px-2">
				{hydrated && (
					<>
						{items.map((s) => (
							<TapeItem key={`a-${s.id}`} slot={s} t={t} tc={tc} lang={lang} />
						))}
						{/*
						 * The loop translates by half the track and restarts, so the same
						 * items have to be here twice for the seam to be invisible. The
						 * second set is decoration: without this a keyboard lands on every
						 * sponsor a second time, on a copy that is sliding out of view, and
						 * a screen reader reads the whole rail twice. `display: contents`
						 * keeps the flex layout identical to the flat list it replaces.
						 */}
						<div className="contents" aria-hidden="true" inert>
							{items.map((s) => (
								<TapeItem
									key={`b-${s.id}`}
									slot={s}
									t={t}
									tc={tc}
									lang={lang}
								/>
							))}
						</div>
					</>
				)}
			</div>
		</aside>
	);
}
