import { paths } from "core/src/routes";
import {
	discountPct,
	limitFor,
	ORDER_MAX_SLOTS,
	orderTotalCents,
	orderUndiscountedCents,
	PLACEMENT_LIMITS,
	SPONSOR_TERMS,
} from "core/src/sponsorship";
import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AdStats, api, type CreativeSlot, money, type Slot } from "./api";
import { CreativeForm, SlotPreviews } from "./Creative";
import { CONTACT_EMAIL, REPO } from "./contribute";
import type { Key, Lang } from "./i18n";
import { Link } from "./nav";
import { SponsorStats } from "./SponsorStats";

const TERMS = SPONSOR_TERMS.map((term) => ({
	...term,
	discountPct: discountPct(term),
}));

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

// Not every deploy carries every placement; AdsSection filters this against
// the placements actually present in `slots`, so it only fixes tab order.
const TAB_ORDER = ["hero", "rail", "category"] as const;

const PLACEMENT_LABEL: Record<string, Key> = {
	rail: "ads.chipRail",
	hero: "ads.chipHero",
	category: "ads.chipCategory",
};

const tabLabel = (placement: string): Key =>
	placement === "rail"
		? "ads.tabRail"
		: placement === "category"
			? "ads.tabCategory"
			: PLACEMENT_LABEL[placement];

// A taken or unpriced slot is disabled and muted rather than dropped, so a
// buyer can still see what exists and when it frees up.
const SlotRow = ({
	slot,
	selected,
	onToggle,
	t,
	tc,
	lang,
}: {
	slot: Slot;
	selected: boolean;
	onToggle: (slot: Slot) => void;
	t: T;
	tc: TC;
	lang: Lang;
}) => {
	const sellable = slot.available && slot.priceCents !== null;
	return (
		<li>
			<button
				type="button"
				disabled={!sellable}
				onClick={() => onToggle(slot)}
				aria-pressed={selected}
				className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition disabled:opacity-50"
				style={{
					background: selected
						? "color-mix(in srgb, var(--accent) 12%, transparent)"
						: undefined,
				}}
			>
				<span className="min-w-0 truncate">
					{selected && (
						<span aria-hidden style={{ color: "var(--accent)" }}>
							✓{" "}
						</span>
					)}
					{tc(slot.label)}
				</span>
				<span
					className="nums shrink-0 text-xs"
					style={{ color: sellable ? "var(--accent)" : "var(--muted)" }}
				>
					{slot.priceCents === null
						? t("ads.priceOnRequest")
						: `${money(slot.priceCents, lang)}/30d`}
					{" · "}
					{slot.priceCents === null
						? t("ads.notPricedYet")
						: slot.available
							? t("ads.available")
							: `${t("ads.taken")}${slot.takenUntil ? ` — ${new Date(slot.takenUntil).toLocaleDateString(lang)}` : ""}`}
				</span>
			</button>
		</li>
	);
};

const field =
	"w-full rounded-[calc(var(--radius))] border border-border bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-muted focus:border-[color-mix(in_srgb,var(--accent)_60%,var(--color-border))]";

const button =
	"rounded-[calc(var(--radius))] px-5 py-2.5 text-sm font-semibold transition hover:brightness-110 disabled:opacity-40";

function useSubmit<R>(fn: (body: Record<string, unknown>) => Promise<R>) {
	const [state, setState] = useState<"idle" | "sending" | "done" | "error">(
		"idle",
	);
	const send = async (body: Record<string, unknown>) => {
		setState("sending");
		try {
			await fn(body);
			setState("done");
		} catch {
			setState("error");
		}
	};
	return [state, send] as const;
}

const Section = ({
	id,
	eyebrow,
	title,
	blurb,
	children,
	tinted,
	headingHidden,
	headingLevel = "h2",
}: {
	id: string;
	eyebrow: string;
	title: string;
	/** Optional: the contact page carries its channels and no preamble. */
	blurb?: string;
	children: React.ReactNode;
	tinted?: boolean;
	/** Hides the eyebrow/heading visually but keeps them in the DOM for a11y/SEO. */
	headingHidden?: boolean;
	/** "h1" for callers that own the whole document (sponsor, submit, contact). */
	headingLevel?: "h1" | "h2";
}) => (
	<section
		id={id}
		className={tinted ? "border-y border-border bg-surface" : undefined}
	>
		<div
			className={`mx-auto max-w-4xl px-4 ${headingHidden ? "py-12" : "py-20"}`}
		>
			<div className={headingHidden ? "sr-only" : undefined}>
				<p
					className="font-mono text-[10px] uppercase tracking-[0.2em]"
					style={{ color: "var(--accent)" }}
				>
					{eyebrow}
				</p>
				{headingLevel === "h1" ? (
					<h1 className="mt-3 font-bold font-display text-3xl tracking-tight">
						{title}
					</h1>
				) : (
					<h2 className="mt-3 font-bold font-display text-3xl tracking-tight">
						{title}
					</h2>
				)}
			</div>
			{blurb && !headingHidden && (
				<p className="mt-3 max-w-2xl text-pretty text-muted">{blurb}</p>
			)}
			{children}
		</div>
	</section>
);

export function AdsSection({
	onPurchased,
	slots,
	adStats,
	preselect,
	t,
	tc,
	lang,
}: {
	/** Re-read the board once a purchase settles, so the page shows it at once. */
	onPurchased: () => void;
	slots: Slot[];
	/** Null until the API answers. `SponsorStats` renders nothing until then. */
	adStats: AdStats | null;
	/** Slot id from `/en/sponsor?slot=L2` — preselects the clicked slot. */
	preselect?: string;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	// A Set of slot ids: order carries no meaning, membership is all that
	// matters. `?slot=X` seeds it rather than being the whole order.
	const [basket, setBasket] = useState<Set<string>>(() =>
		preselect ? new Set([preselect]) : new Set(),
	);
	const [months, setMonths] = useState<number>(1);
	const [waitState, sendWait] = useSubmit(api.waitlist);
	/** The slots the creative token covers — fetched once the token exists. */
	const [creativeSlots, setCreativeSlots] = useState<CreativeSlot[]>([]);
	/** The ad, collected before payment. Null gates the email + pay step. */
	const [creative, setCreative] = useState<Record<string, unknown> | null>(
		null,
	);
	const [payEmail, setPayEmail] = useState("");
	const [payOpen, setPayOpen] = useState(false);
	/** The slot `toggle` most recently dropped to enforce a cap, or null if the
	 *  last toggle did not need to. Replaced on every toggle, never accumulated. */
	const [swapped, setSwapped] = useState<{
		placement: string;
		label: string;
	} | null>(null);

	// Seeded from `?slot=` so a buyer who clicked an open slot on a category
	// page lands on that placement's tab already showing it.
	const [tab, setTab] = useState<string>(
		() =>
			slots.find((s) => s.id === preselect)?.placement ??
			TAB_ORDER.find((p) => slots.some((s) => s.placement === p)) ??
			"hero",
	);
	const [categoryQuery, setCategoryQuery] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: fires once per collected creative
	useEffect(() => {
		if (!payOpen || !creative) return;
		setPayOpen(false);
		void startPurchase(payEmail);
	}, [payOpen, creative]);

	// Cap-swap rule: when a placement's slot cap is full, a new pick REPLACES
	// the oldest chosen slot of that placement rather than being refused (the
	// API enforces the same cap independently, but the buyer must never see it
	// as a refusal).
	const toggle = (slot: Slot) =>
		setBasket((prev) => {
			const next = new Set(prev);
			if (next.has(slot.id)) {
				next.delete(slot.id);
				setSwapped(null);
				return next;
			}
			const limit = limitFor(slot.placement);
			let dropped: Slot | undefined;
			if (Number.isFinite(limit)) {
				const same = [...next].filter(
					(id) => byId.get(id)?.placement === slot.placement,
				);
				const toDrop = same.slice(0, same.length - limit + 1);
				dropped = byId.get(toDrop[0]);
				for (const id of toDrop) next.delete(id);
			}
			// Named so the buyer sees why their earlier pick vanished.
			setSwapped(
				dropped
					? { placement: slot.placement, label: tc(dropped.label) }
					: null,
			);
			next.add(slot.id);
			return next;
		});

	// reserve records the intent and prices it; checkout hands it to whichever
	// payment provider is configured; a settled checkout returns the single-use
	// token that unlocks the creative form. Nothing reserves the slot along the
	// way — whoever pays first wins.
	const [buy, setBuy] = useState<
		| { step: "idle" }
		| { step: "sending" }
		| {
				step: "creative";
				token: string;
				amountCents: number;
				months: number;
				slots: number;
		  }
		| { step: "done" }
		| { step: "error"; message: string }
	>({ step: "idle" });

	// showModal() gives this the browser's own focus trap and Escape handling.
	// The dialog stays in the tree; only showModal/close toggle it, so a buyer
	// who dismisses it still sees the confirmation text below it.
	const doneDialogRef = useRef<HTMLDialogElement>(null);
	const doneNoticeRef = useRef<HTMLParagraphElement>(null);
	useEffect(() => {
		if (buy.step === "done") doneDialogRef.current?.showModal();
	}, [buy.step]);

	// Stripe returns the buyer to `?paid=<session_id>`. Polls because the
	// redirect usually beats the webhook; gives up after 10 tries a second
	// apart rather than spinning forever — the money is safe either way.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs once, on mount
	useEffect(() => {
		const sessionId = new URLSearchParams(location.search).get("paid");
		if (!sessionId) return;

		let cancelled = false;
		let tries = 0;
		setBuy({ step: "sending" });

		const poll = async () => {
			if (cancelled) return;
			try {
				const res = await api.bySession(sessionId);
				if (cancelled) return;
				if (res.settled && res.detailsToken) {
					// The session id is not a secret and sits in browser history; drop it
					// from the URL now that it has been exchanged for the real token.
					history.replaceState(null, "", location.pathname);
					setBuy({
						step: "creative",
						token: res.detailsToken,
						amountCents: 0,
						months: 0,
						slots: 0,
					});
					return;
				}
			} catch {
				// Fall through to the retry — a transient failure here is not a
				// failed payment, and saying so would be a lie.
			}
			if (++tries >= 10) {
				setBuy({ step: "error", message: t("ads.paidPending") });
				return;
			}
			setTimeout(poll, 1000);
		};
		void poll();

		return () => {
			cancelled = true;
		};
	}, []);

	/**
	 * `/{lang}/sponsor?token=…` — the link in the "send us your creative" email.
	 *
	 * This is the ONLY route back to the form for a buyer who closed the tab after
	 * paying, and it did not exist: the parameter was in the email, in the server
	 * log and in the docs, and the page ignored it and rendered the rate card. The
	 * two other ways in (the in-page purchase, and Stripe's `?paid=` return) both
	 * set the step from a response, so nothing caught it.
	 *
	 * The token is validated by the API on submit; entering the step on its
	 * presence only decides which form to draw.
	 */
	useEffect(() => {
		const token = new URLSearchParams(location.search).get("token");
		if (!token) return;
		setBuy({ step: "creative", token, amountCents: 0, months: 0, slots: 0 });
	}, []);

	// The token arrives from three places (reserve response, Stripe return poll,
	// email link), so this watches the state rather than being called from each.
	useEffect(() => {
		if (buy.step !== "creative") return;
		let cancelled = false;
		api
			.creativeSlots(buy.token)
			.then((r) => {
				if (!cancelled) setCreativeSlots(r.slots);
			})
			// A failure here costs the previews, not the form: the buyer can still
			// submit, they just do not get to see the units first.
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [buy]);

	// Reserve, then pay, with the ad already attached — a settled payment is a
	// complete order and the API takes it straight to `live`.
	const startPurchase = async (email: string) => {
		setBuy({ step: "sending" });
		try {
			const reserved = await api.reserveOrder({
				email,
				months,
				slotIds: [...basket],
				...(creative ? { creative } : {}),
			});
			const checkout = await api.checkoutOrder(reserved.orderId, lang);
			// A provider that redirects (a real one) sends the buyer away; the fake
			// one settles here and hands back the creative token immediately.
			if (checkout.redirectUrl) {
				location.href = checkout.redirectUrl;
				return;
			}
			if (!checkout.settled) {
				setBuy({ step: "error", message: t("ads.payFailed") });
				return;
			}
			// Settled with a creative attached means it is already running. The old
			// path dropped the buyer into a form here; there is nothing left to ask.
			if (creative) {
				// The slot is live now; refresh the board so the rails, the wall and
				// the rate card all stop showing it as available.
				setBasket(new Set());
				onPurchased();
				setBuy({ step: "done" });
				return;
			}
			if (!checkout.detailsToken) {
				setBuy({ step: "error", message: t("ads.payFailed") });
				return;
			}
			setBuy({
				step: "creative",
				token: checkout.detailsToken,
				amountCents: reserved.amountCents,
				months: reserved.months,
				slots: reserved.lines.length,
			});
		} catch (e) {
			// The API's own message is used where it has one, since it is more
			// specific than anything derivable here.
			const raw = String((e as Error)?.message ?? "");
			const apiMessage = /"error"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
			setBuy({
				step: "error",
				message: /503|no payment provider/i.test(raw)
					? t("ads.payUnavailable")
					: /429|too many/i.test(raw)
						? t("ads.payRateLimited")
						: (apiMessage ?? t("form.error")),
			});
		}
	};

	// Only slots somebody can actually buy today. Counting the unpriced hero
	// positions here would advertise inventory the checkout would then refuse.
	const open = slots.filter((s) => s.available && s.priceCents !== null).length;
	const unpriced = slots.filter((s) => s.priceCents === null).length;

	// The placements actually present in this deploy's slot data, in the fixed
	// display order — see TAB_ORDER above.
	const tabPlacements = TAB_ORDER.filter((p) =>
		slots.some((s) => s.placement === p),
	);

	// An unpriced slot cannot enter the basket (SlotRow refuses it), so it only
	// ever prices as 0 here.
	const price = (s: Slot) => s.priceCents ?? 0;
	/** Which cap explanation applies to a swapped-out slot's placement. */
	const swapKey = (placement: string): Key =>
		placement === "rail"
			? "ads.capSwappedRail"
			: placement === "category"
				? "ads.capSwappedCategory"
				: "ads.capSwappedLanding";
	const byId = useMemo(() => new Map(slots.map((s) => [s.id, s])), [slots]);

	const chosen = useMemo(
		() => [...basket].map((id) => byId.get(id)).filter((s): s is Slot => !!s),
		[basket, byId],
	);
	const rates = chosen.map(price);

	// One chip per slot an order may hold, expanded from PLACEMENT_LIMITS so a
	// changed cap changes the strip with it.
	const chips = useMemo(() => {
		const chosenByPlacement = new Map<string, number>();
		for (const s of chosen)
			chosenByPlacement.set(
				s.placement,
				(chosenByPlacement.get(s.placement) ?? 0) + 1,
			);
		return Object.entries(PLACEMENT_LIMITS).flatMap(([placement, limit]) =>
			Array.from({ length: limit }, (_, i) => ({
				placement,
				filled: i < (chosenByPlacement.get(placement) ?? 0),
			})),
		);
	}, [chosen]);

	// orderTotalCents applies the multiplier to the summed rate once, matching
	// the API — multiplying each slot separately would round differently.
	const totalCents = orderTotalCents(rates, months);
	const undiscountedCents = orderUndiscountedCents(rates, months);
	const saving = undiscountedCents - totalCents;

	return (
		<Section
			id="sponsor"
			eyebrow={t("ads.eyebrow")}
			title={t("ads.title")}
			blurb={t("ads.blurb")}
			tinted
			headingLevel="h1"
		>
			<p className="mt-4 font-mono text-sm" style={{ color: "var(--accent)" }}>
				{open}/{slots.length} {t("ads.availableCount")}
			</p>
			{unpriced > 0 && (
				<p className="mt-1 text-xs text-muted">
					{unpriced} {t("ads.unpricedNote")}
				</p>
			)}

			<SponsorStats stats={adStats} t={t} lang={lang} />

			<p className="mt-6 text-sm text-muted">{t("ads.pickRule")}</p>
			{swapped && (
				<p className="mt-1 text-xs" style={{ color: "var(--accent)" }}>
					{t(swapKey(swapped.placement)).replace("{label}", swapped.label)}
				</p>
			)}

			<div className="mt-4 flex flex-wrap items-center gap-2">
				{chips.map((chip, i) => (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: two category chips are identical and unordered — the index is the only thing that tells them apart.
						key={`${chip.placement}-${i}`}
						className="rounded-full border px-2.5 py-1 text-xs"
						style={{
							borderColor: chip.filled
								? "var(--accent)"
								: "var(--color-border)",
							color: chip.filled ? "var(--accent)" : "var(--muted)",
						}}
					>
						{chip.filled ? "✓" : "+"} {t(PLACEMENT_LABEL[chip.placement])}
					</span>
				))}
				<span className="nums text-xs text-muted">
					{t("ads.chosenCount")
						.replace("{n}", String(chosen.length))
						.replace("{max}", String(ORDER_MAX_SLOTS))}
				</span>
			</div>

			<div
				role="tablist"
				aria-label={t("ads.tabListLabel")}
				className="mt-4 flex flex-wrap gap-1 border-border border-b"
			>
				{tabPlacements.map((p) => {
					// Same "sellable" test SlotRow uses; a sold-out placement reads
					// "(0)" rather than the tab vanishing.
					const count = slots.filter(
						(s) => s.placement === p && s.available && s.priceCents !== null,
					).length;
					return (
						<button
							key={p}
							type="button"
							role="tab"
							id={`ads-tab-${p}`}
							aria-selected={tab === p}
							aria-controls={`ads-panel-${p}`}
							onClick={() => setTab(p)}
							className="border-b-2 px-3 py-2 text-sm transition"
							style={{
								borderColor: tab === p ? "var(--accent)" : "transparent",
								color: tab === p ? "var(--accent)" : undefined,
							}}
						>
							{t(tabLabel(p))} <span className="text-muted">({count})</span>
						</button>
					);
				})}
			</div>

			{tabPlacements.map((p) => {
				if (p !== tab) return null;
				const rows =
					p === "category"
						? slots
								.filter((s) => s.placement === "category")
								.filter((s) =>
									tc(s.categoryName ?? s.label)
										.toLowerCase()
										.includes(categoryQuery.toLowerCase()),
								)
						: slots.filter((s) => s.placement === p);
				return (
					<div
						key={p}
						id={`ads-panel-${p}`}
						role="tabpanel"
						aria-labelledby={`ads-tab-${p}`}
						className="mt-3"
					>
						{p === "category" && (
							<input
								type="search"
								value={categoryQuery}
								onChange={(e) => setCategoryQuery(e.currentTarget.value)}
								placeholder={t("ads.categorySearch")}
								className={`${field} mb-2`}
							/>
						)}
						{rows.length === 0 ? (
							<p className="text-sm text-muted">{t("ads.noCategoryMatches")}</p>
						) : (
							<ul className="max-h-[200px] divide-y divide-border overflow-y-auto rounded-[calc(var(--radius))] border border-border">
								{rows.map((s) => (
									<SlotRow
										key={s.id}
										slot={s}
										selected={basket.has(s.id)}
										onToggle={toggle}
										t={t}
										tc={tc}
										lang={lang}
									/>
								))}
							</ul>
						)}
					</div>
				);
			})}

			{/* Lock-in term. The slot prices are the 30-day rate; three and twelve
			    months are paid up front and discounted for it. */}
			<div className="mt-6">
				<p className="text-sm text-muted">{t("ads.termHeading")}</p>
				<div className="mt-2 flex flex-wrap gap-2">
					{TERMS.map((term) => (
						<button
							key={term.months}
							type="button"
							onClick={() => setMonths(term.months)}
							className="rounded-[calc(var(--radius))] border px-3 py-2 text-left text-sm"
							style={{
								borderColor:
									months === term.months
										? "var(--accent)"
										: "var(--color-border)",
							}}
						>
							<span className="block font-medium">
								{term.months}{" "}
								{t(term.months === 1 ? "ads.month" : "ads.months")}
							</span>
							<span className="nums block text-xs text-muted">
								{chosen.length > 0
									? money(orderTotalCents(rates, term.months), lang)
									: `×${term.multiplier}`}
								{term.discountPct > 0 && (
									<span style={{ color: "var(--accent)" }}>
										{" "}
										−{term.discountPct}%
									</span>
								)}
							</span>
						</button>
					))}
				</div>
			</div>

			{chosen.length > 0 && (
				<div
					className="mt-6 rounded-[calc(var(--radius))] border p-4"
					style={{ borderColor: "var(--accent)" }}
				>
					<p className="font-mono text-[10px] uppercase tracking-widest text-muted">
						{t("ads.basket")} · {chosen.length}
					</p>
					<ul className="mt-3 divide-y divide-border">
						{chosen.map((s) => (
							<li key={s.id} className="flex items-center gap-3 py-2 text-sm">
								<span className="min-w-0 flex-1 truncate">{tc(s.label)}</span>
								<span className="nums shrink-0 text-xs text-muted">
									{money(price(s), lang)}/30d
								</span>
								<button
									type="button"
									onClick={() => toggle(s)}
									aria-label={`${t("ads.remove")} — ${tc(s.label)}`}
									className="shrink-0 rounded-[calc(var(--radius))] border border-border px-2 py-0.5 text-xs text-muted transition hover:text-text"
								>
									×
								</button>
							</li>
						))}
					</ul>
					<div className="mt-3 flex items-baseline justify-between border-t border-border pt-3">
						<span className="text-sm text-muted">
							{t("ads.totalFor")} {months}{" "}
							{t(months === 1 ? "ads.month" : "ads.months")}
						</span>
						<span
							className="nums text-lg font-bold"
							style={{ color: "var(--accent)" }}
						>
							{money(totalCents, lang)}
						</span>
					</div>
					{saving > 0 && (
						<p className="nums mt-1 text-right text-xs text-muted">
							{t("ads.saving").replace("{amount}", money(saving, lang))}
						</p>
					)}

					{/* Same preview components the creative form uses after payment, with
					    empty copy, so the shape a buyer sees is the shape that goes live. */}
					<div className="mt-5 border-border border-t pt-4">
						<p className="font-mono text-[10px] text-muted uppercase tracking-widest">
							{t("ads.previewTitle")}
						</p>
						<div className="mt-3 grid gap-3">
							{chosen.map((s) => (
								<SlotPreviews
									key={s.id}
									slot={{ id: s.id, placement: s.placement, label: s.label }}
									t={t}
									tc={tc}
								/>
							))}
						</div>
					</div>
				</div>
			)}

			{buy.step === "done" ? (
				<p
					ref={doneNoticeRef}
					// The dialog's own trigger is an effect, not a click, so there is no
					// button on screen for the browser to hand focus back to — this is
					// what it lands on instead, once the buyer dismisses it.
					tabIndex={-1}
					className="mt-6 rounded-[calc(var(--radius))] border p-5 text-sm outline-none"
					style={{ borderColor: "var(--accent)" }}
				>
					{t("ads.done")}
				</p>
			) : buy.step === "creative" ? (
				// The token is single-use and minted by the payment step, so this
				// form cannot be reached by anyone who did not pay.
				<>
					<p className="mt-6 text-sm" style={{ color: "var(--accent)" }}>
						{buy.amountCents > 0
							? t("ads.paid")
									.replace("{amount}", money(buy.amountCents, lang))
									.replace("{months}", String(buy.months))
									.replace("{slots}", String(buy.slots))
							: t("ads.paidReturn")}
					</p>
					<CreativeForm
						token={buy.token}
						slots={creativeSlots}
						t={t}
						tc={tc}
						onDone={() => {
							onPurchased();
							setBuy({ step: "done" });
						}}
					/>
				</>
			) : chosen.length === 0 ? null : (
				// The creative form doubles as the pay form: email + pay controls are
				// its footer, so submitting once buys the slot and supplies the ad.
				<CreativeForm
					slots={chosen.map((s) => ({
						id: s.id,
						placement: s.placement,
						label: s.label,
					}))}
					t={t}
					tc={tc}
					submitLabel={t(
						chosen.length === 1 ? "ads.submit" : "ads.submitPlural",
					).replace("{n}", String(chosen.length))}
					onCollect={(draft) => {
						const { perSlot, ...shared } = draft;
						setCreative({
							name: shared.name,
							tagline: shared.tagline,
							url: shared.url,
							...(shared.nameFr ? { nameFr: shared.nameFr } : {}),
							...(shared.taglineFr ? { taglineFr: shared.taglineFr } : {}),
							...(shared.logoUrl ? { logoUrl: shared.logoUrl } : {}),
							...(shared.tint ? { tint: shared.tint } : {}),
						});
						setPayOpen(true);
					}}
				>
					<div className="grid gap-2">
						<span className="block font-medium text-muted text-xs">
							{t("ads.billingEmail")}
						</span>
						<input
							type="email"
							required
							value={payEmail}
							onChange={(e) => setPayEmail(e.currentTarget.value)}
							placeholder={t("ads.billingEmail")}
							className={field}
						/>
					</div>
					{buy.step === "error" && (
						<p className="text-sm" style={{ color: "var(--v-no)" }}>
							{buy.message}
						</p>
					)}
				</CreativeForm>
			)}

			{/* Nothing open? Capture the intent rather than losing it. */}
			<form
				className="mt-6 flex flex-wrap gap-2 border-t border-border pt-6"
				onSubmit={(e) => {
					e.preventDefault();
					const f = new FormData(e.currentTarget);
					sendWait({ email: f.get("email"), slotId: chosen[0]?.id });
				}}
			>
				<p className="w-full text-sm text-muted">{t("ads.waitlist")}</p>
				<input
					name="email"
					type="email"
					required
					placeholder={t("ads.billingEmail")}
					className={`${field} max-w-xs flex-1`}
				/>
				<button
					type="submit"
					className="rounded-[calc(var(--radius))] border border-border px-4 text-sm"
				>
					{waitState === "done" ? "✓" : t("ads.waitlistCta")}
				</button>
			</form>

			{/* biome-ignore lint/a11y/useKeyWithClickEvents: detects a backdrop
			    click to dismiss; the keyboard equivalent is Escape, which a
			    native `<dialog>` already handles on its own. */}
			<dialog
				ref={doneDialogRef}
				aria-labelledby="paid-dialog-title"
				className="m-auto max-w-md rounded-[calc(var(--radius))] border border-border bg-surface p-0 text-text backdrop:bg-black/40"
				onClose={() => doneNoticeRef.current?.focus()}
				onClick={(e) => {
					if (e.target === e.currentTarget) doneDialogRef.current?.close();
				}}
			>
				<div className="p-5">
					<div className="flex items-start justify-between gap-4">
						<h2
							id="paid-dialog-title"
							className="font-display font-semibold text-base"
						>
							{t("ads.popupTitle")}
						</h2>
						<button
							type="button"
							aria-label={t("filter.close")}
							onClick={() => doneDialogRef.current?.close()}
							className="shrink-0 rounded-[calc(var(--radius))] p-1.5 hover:bg-[color-mix(in_srgb,var(--brand)_10%,transparent)]"
						>
							<X className="size-4" aria-hidden />
						</button>
					</div>
					<p className="mt-2 text-sm text-muted">{t("ads.popupBody")}</p>
					<button
						type="button"
						onClick={() => doneDialogRef.current?.close()}
						className="mt-5 w-full rounded-[calc(var(--radius))] bg-brand px-3 py-2 text-center font-medium text-sm text-white"
					>
						{t("ads.popupOk")}
					</button>
				</div>
			</dialog>
		</Section>
	);
}

/** One way in, with its own heading. Four of them, in order of usefulness. */
const Channel = ({
	title,
	body,
	children,
}: {
	title: string;
	body: string;
	children?: React.ReactNode;
}) => (
	<section className="border-t border-border pt-6">
		{/* h3: the Section above already owns the h2 on this page. */}
		<h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
		<p className="mt-2 max-w-2xl text-pretty text-sm text-muted">{body}</p>
		{children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
	</section>
);

const contactLink =
	"rounded-[calc(var(--radius))] border border-border px-4 py-2 text-sm hover:border-[color-mix(in_srgb,var(--brand)_50%,var(--color-border))]";

// `/{lang}/contact`. Routes to the repo and existing sponsor/submit pages
// rather than a form — there is no message endpoint that isn't a sales lead.
export function ContactSection({ t, lang }: { t: T; lang: Lang }) {
	return (
		<Section
			id="contact"
			eyebrow={t("contact.eyebrow")}
			title={t("contact.title")}
			headingHidden
			headingLevel="h1"
		>
			<div className="grid gap-8">
				{/* First, and longest, on purpose: this is the honest-corrections
				    channel, and it is the most valuable thing on the page. */}
				<Channel
					title={t("contact.wrong.title")}
					body={t("contact.wrong.body")}
				>
					<a
						href={`${REPO}/tree/main/data/products`}
						target="_blank"
						rel="noopener"
						className={`${contactLink} text-brand`}
					>
						{t("contact.wrong.edit")}
					</a>
					<a
						href={`${REPO}/issues/new?labels=correction`}
						target="_blank"
						rel="noopener"
						className={contactLink}
					>
						{t("contact.wrong.issue")}
					</a>
					<a
						href={`${REPO}/blob/main/CONTRIBUTING.md`}
						target="_blank"
						rel="noopener"
						className={contactLink}
					>
						{t("contact.wrong.contributing")}
					</a>
				</Channel>

				<Channel
					title={t("contact.submit.title")}
					body={t("contact.submit.body")}
				>
					<Link href={paths.submit(lang)} className={contactLink}>
						{t("nav.submit")} →
					</Link>
				</Channel>

				<Channel
					title={t("contact.sponsor.title")}
					body={t("contact.sponsor.body")}
				>
					<Link href={paths.sponsor(lang)} className={contactLink}>
						{t("nav.sponsor")} →
					</Link>
				</Channel>

				{/* No invented address. See CONTACT_EMAIL in contribute.tsx. */}
				<Channel
					title={t("contact.email.title")}
					body={
						CONTACT_EMAIL ? t("contact.email.body") : t("contact.email.none")
					}
				>
					{CONTACT_EMAIL && (
						<a href={`mailto:${CONTACT_EMAIL}`} className={contactLink}>
							{CONTACT_EMAIL}
						</a>
					)}
				</Channel>

				<Channel
					title={t("contact.privacy.title")}
					body={t("contact.privacy.body")}
				/>
			</div>
		</Section>
	);
}

/** Contributions go through GitHub, so there is no moderation queue to build. */
export function SubmitSection({ t }: { t: T }) {
	return (
		<Section
			id="submit"
			eyebrow={t("submit.eyebrow")}
			title={t("submit.title")}
			blurb={t("submit.blurb")}
			headingLevel="h1"
		>
			<div className="mt-6 flex flex-wrap gap-3">
				<a
					href={`${REPO}/new/main/data/products`}
					target="_blank"
					rel="noopener"
					className={button}
					style={{ background: "var(--v-yes)", color: "var(--bg)" }}
				>
					{t("submit.addProduct")}
				</a>
				<a
					href={`${REPO}/issues/new?labels=suggestion`}
					target="_blank"
					rel="noopener"
					className="rounded-[calc(var(--radius))] border border-border px-5 py-2.5 text-sm"
				>
					{t("submit.openIssue")}
				</a>
				<a
					href={`${REPO}/blob/main/CONTRIBUTING.md`}
					target="_blank"
					rel="noopener"
					className="rounded-[calc(var(--radius))] border border-border px-5 py-2.5 text-sm"
				>
					{t("submit.contributing")}
				</a>
			</div>
			<p className="mt-4 text-xs text-muted">{t("submit.prNote")}</p>
		</Section>
	);
}
