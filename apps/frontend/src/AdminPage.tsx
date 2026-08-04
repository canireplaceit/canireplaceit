/**
 * The platform operator's own screen: the review queue, every campaign, and the
 * whole board.
 *
 * ## Why the queue shows the entire creative rather than a summary
 *
 * Approving is a decision about what may appear beside our verdicts, and it is
 * irreversible in the way that matters — the ad ships. So every field the buyer
 * wrote is on screen, in both locales, next to a preview drawn with `tintStyle`
 * from ads.tsx: the same helper the rails, the wall and the in-list card use. A
 * preview with its own idea of styling is a preview of something that will never
 * exist, which is worse than no preview at all.
 *
 * ## Why it holds no clock of its own
 *
 * Every duration here — hours waiting, days running, days left — is computed by
 * the API against the request's own clock and arrives as a number. Nothing on
 * this page reads `Date.now()`, so the prerendered shell and the first client
 * render are identical and there is no second opinion about what "today" is.
 *
 * ## Signed out, and signed in as somebody else
 *
 * The document is prerendered with no session, exactly like the dashboard, so it
 * renders an empty <main> until the API answers and then resolves to one of four
 * states. 401 and 403 are deliberately different sentences: "sign in" is useless
 * advice to somebody already signed in, and "you are not an admin" is alarming
 * to somebody who simply has no cookie yet.
 */

import { paths } from "core/src/routes";
import { useCallback, useEffect, useState } from "react";
import { AdBadge, tintStyle } from "./ads";
import type { AdminCampaigns, AdminQueue, AdminSlots } from "./api";
import { ApiError, api, formatDate, money } from "./api";
import { CARD, GRID_1COL, Logo } from "./components";
import { num, pct } from "./Dashboard";
import type { Key, Lang } from "./i18n";
import { Link } from "./nav";

type T = (k: Key) => string;
type TC = (v: { en: string }) => string;

type Loaded = {
	queue: AdminQueue;
	campaigns: AdminCampaigns;
	slots: AdminSlots;
};

/** Which of the five things the API can be telling us. */
type Gate =
	| "loading"
	| "ok"
	| "signedOut"
	| "forbidden"
	| "unconfigured"
	| "error";

const GATE_BY_STATUS: Record<number, Gate> = {
	401: "signedOut",
	403: "forbidden",
	503: "unconfigured",
};

const EYEBROW = "font-mono text-[10px] text-muted uppercase tracking-[0.2em]";
const SECTION_TITLE = "font-bold font-display text-lg tracking-tight";
const TH =
	"border-border border-b pb-2 font-mono text-[10px] text-muted uppercase tracking-widest";
const TD = "border-border border-b py-2.5";
const FIELD =
	"w-full rounded-[calc(var(--radius))] border border-border bg-bg px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--brand)_35%,transparent)]";

/** Timestamps are ISO instants; `formatDate` wants the date part alone. */
const day = (iso: string | null, lang: Lang) =>
	iso ? formatDate(iso.slice(0, 10), lang) : null;

/**
 * One unit, drawn the way the live ones are.
 *
 * Not a link, and carrying no `data-ad-purchase`: there is nothing to click
 * during a review, and the impression observer must not count a card that is
 * only being looked at by the reviewer.
 */
function Preview({
	tint,
	logoUrl,
	name,
	tagline,
	t,
}: {
	tint: string | null;
	logoUrl: string | null;
	name: string;
	tagline: string | null;
	t: T;
}) {
	return (
		<div
			className="flex flex-col rounded-[calc(var(--radius))] border p-3.5"
			style={tintStyle(tint)}
		>
			<span className="flex items-center gap-2.5">
				<Logo src={logoUrl} name={name} size={40} />
				<span className="min-w-0 flex-1 truncate font-semibold text-[15px] tracking-tight">
					{name}
				</span>
			</span>
			{tagline && (
				<span className="mt-2.5 block text-[13px] text-muted leading-snug">
					{tagline}
				</span>
			)}
			<AdBadge t={t} className="mt-auto pt-2.5" />
		</div>
	);
}

/** One stored field, and what an empty one means rather than a blank cell. */
function Field({
	label,
	value,
	empty,
	children,
}: {
	label: string;
	value?: string | null;
	empty: string;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex flex-wrap items-baseline gap-x-3 border-border border-b py-1.5 last:border-0">
			<dt className="min-w-[9rem] font-mono text-[10px] text-muted uppercase tracking-widest">
				{label}
			</dt>
			<dd className="min-w-0 flex-1 break-words text-sm">
				{children ??
					(value ? value : <span className="text-muted italic">{empty}</span>)}
			</dd>
		</div>
	);
}

function QueueItem({
	item,
	t,
	tc,
	lang,
	onDone,
}: {
	item: AdminQueue["queue"][number];
	t: T;
	tc: TC;
	lang: Lang;
	onDone: () => void;
}) {
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [done, setDone] = useState("");

	const approve = async () => {
		setBusy(true);
		setError("");
		try {
			await api.siteAdmin.approve(item.id);
			setDone(t("admin.approved"));
			onDone();
		} catch {
			setError(t("admin.actionFailed"));
		} finally {
			setBusy(false);
		}
	};

	const reject = async (e: React.FormEvent) => {
		e.preventDefault();
		setBusy(true);
		setError("");
		try {
			const out = await api.siteAdmin.reject(item.id, reason.trim());
			setDone(
				out.alreadyRefunded
					? `${t("admin.rejectedDone")} ${t("admin.alreadyRefunded")}`
					: t("admin.rejectedDone"),
			);
			onDone();
		} catch (err) {
			// 502 means the refund provider refused and the API left the row exactly
			// as it was — still `submitted`, still in this queue. Saying anything
			// softer here would tell the operator a refund happened that did not.
			setError(
				err instanceof ApiError && err.status === 502
					? t("admin.refundFailed")
					: t("admin.actionFailed"),
			);
		} finally {
			setBusy(false);
		}
	};

	const en = item.name?.en ?? item.slotId;
	const fr = item.name?.fr ?? en;
	const stamps: [string, string | null][] = [
		[t("admin.at.created"), item.createdAt],
		[t("admin.at.paid"), item.paidAt],
		[t("admin.at.submitted"), item.submittedAt],
	];

	return (
		<li className={`${CARD} ${GRID_1COL} gap-4`}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
				<div>
					<p className={EYEBROW}>
						{item.slotId}
						{item.slotLabel ? ` · ${tc(item.slotLabel)}` : ""}
						{item.placement ? ` · ${item.placement}` : ""}
					</p>
					<p className="mt-1 font-medium text-sm">
						{t("admin.buyer")}: {item.email}
					</p>
				</div>
				<p className="nums text-muted text-xs">
					{money(item.amountCents, lang)} · {item.months} {t("dash.months")} ·{" "}
					{t("admin.queue.waiting").replace("{h}", String(item.waitingHours))}
				</p>
			</div>

			<div>
				<p className={EYEBROW}>{t("admin.preview")}</p>
				<div className="mt-2 grid gap-3 sm:grid-cols-2">
					{/* Both locales, side by side. The French card is what a French
					    reader gets whether or not anybody wrote French copy. */}
					<div>
						<p className="mb-1.5 text-muted text-xs">{t("admin.previewEn")}</p>
						<Preview
							tint={item.tint}
							logoUrl={item.logoUrl}
							name={en}
							tagline={item.tagline?.en ?? null}
							t={t}
						/>
					</div>
					<div>
						<p className="mb-1.5 text-muted text-xs">{t("admin.previewFr")}</p>
						<Preview
							tint={item.tint}
							logoUrl={item.logoUrl}
							name={fr}
							tagline={item.tagline?.fr ?? null}
							t={t}
						/>
					</div>
				</div>
			</div>

			<div>
				<p className={EYEBROW}>{t("admin.fields")}</p>
				<dl className="mt-2">
					<Field
						label={t("admin.field.name")}
						value={item.raw.name}
						empty={t("admin.notSet")}
					/>
					<Field
						label={t("admin.field.nameFr")}
						value={item.raw.nameFr}
						empty={t("admin.inherited")}
					/>
					<Field
						label={t("admin.field.tagline")}
						value={item.raw.tagline}
						empty={t("admin.notSet")}
					/>
					<Field
						label={t("admin.field.taglineFr")}
						value={item.raw.taglineFr}
						empty={t("admin.inherited")}
					/>
					<Field label={t("admin.field.url")} empty={t("admin.notSet")}>
						{item.url ? (
							// The reviewer has to be able to open what they are approving.
							<a
								href={item.url}
								target="_blank"
								rel="noopener nofollow"
								className="break-all text-brand hover:underline"
							>
								{item.url}
							</a>
						) : null}
					</Field>
					<Field label={t("admin.field.logo")} empty={t("admin.notSet")}>
						{item.logoUrl ? (
							<span className="flex items-center gap-2">
								<Logo src={item.logoUrl} name={en} size={24} />
								<span className="min-w-0 break-all text-muted text-xs">
									{item.logoUrl}
								</span>
							</span>
						) : null}
					</Field>
					<Field label={t("admin.field.tint")} empty={t("admin.defaultTint")}>
						{item.tint ? (
							<span className="flex items-center gap-2">
								<span
									aria-hidden
									className="size-4 shrink-0 rounded-full border border-border"
									style={{ background: item.tint }}
								/>
								<span className="font-mono text-xs">{item.tint}</span>
							</span>
						) : null}
					</Field>
				</dl>
			</div>

			<div>
				<p className={EYEBROW}>{t("admin.timeline")}</p>
				<p className="nums mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-muted text-xs">
					{stamps.map(([label, iso]) =>
						iso ? (
							<span key={label}>
								{label} {day(iso, lang)}
							</span>
						) : null,
					)}
				</p>
			</div>

			<form onSubmit={reject} className="grid gap-2 sm:flex sm:items-end">
				<label className="min-w-[14rem] flex-1">
					<span className="mb-1.5 block font-medium text-muted text-xs">
						{t("admin.rejectReason")}
					</span>
					<input
						type="text"
						maxLength={1000}
						value={reason}
						onChange={(e) => setReason(e.currentTarget.value)}
						placeholder={t("admin.rejectPlaceholder")}
						className={FIELD}
					/>
				</label>
				<button
					type="submit"
					disabled={busy}
					className="rounded-[calc(var(--radius))] border px-3 py-2 font-medium text-sm disabled:opacity-50"
					style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
				>
					{busy ? t("admin.working") : t("admin.reject")}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={() => void approve()}
					className="rounded-[calc(var(--radius))] px-4 py-2 font-medium text-sm disabled:opacity-50"
					style={{ background: "var(--brand)", color: "#fff" }}
				>
					{busy ? t("admin.working") : t("admin.approve")}
				</button>
			</form>

			{error && (
				<p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
					{error}
				</p>
			)}
			{done && !error && (
				<p role="status" className="text-brand text-sm">
					{done}
				</p>
			)}
		</li>
	);
}

/** How close to its end a run has to be before the board flags it. */
const EXPIRING_DAYS = 7;

function Campaigns({
	data,
	t,
	lang,
}: {
	data: AdminCampaigns;
	t: T;
	lang: Lang;
}) {
	const site = data.site;
	return (
		<section className="mt-12">
			<h2 className={SECTION_TITLE}>{t("admin.campaigns.title")}</h2>

			{/* The comparison, published first: a campaign's rate means nothing on its
			    own. Below the site's own thresholds there is no site-wide CTR either,
			    and the same refusal applies — no number is better than an invented one. */}
			<p className="nums mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
				<span className={EYEBROW}>{t("admin.site")}</span>
				<span>
					{num(site.impressions, lang)} {t("adstats.impressions")}
				</span>
				<span>
					{num(site.clicks, lang)} {t("adstats.clicks")}
				</span>
				<span className="font-medium">
					{t("adstats.ctr")} {pct(site.reportable ? site.ctr : null, lang)}
				</span>
			</p>
			<p className="mt-1.5 max-w-2xl text-muted text-xs">
				{t("admin.compare")}
			</p>

			{data.campaigns.length === 0 ? (
				<p className="mt-4 text-muted text-sm">{t("admin.campaigns.empty")}</p>
			) : (
				<div className="mt-4 overflow-x-auto">
					<table className="w-full min-w-[44rem] border-collapse text-sm">
						<thead>
							<tr>
								{[
									[t("dash.slot"), true],
									[t("dash.state"), true],
									[t("admin.running"), false],
									[t("admin.left"), false],
									[t("adstats.impressions"), false],
									[t("adstats.clicks"), false],
									[t("adstats.ctr"), false],
								].map(([label, left]) => (
									<th
										key={String(label)}
										className={`${TH} ${left ? "text-left" : "text-right"}`}
									>
										{label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{data.campaigns.map((c) => (
								<tr key={c.id}>
									<td className={TD}>
										<span className="font-medium">{c.slotId}</span>
										<span className="block text-muted text-xs">
											{c.name?.en ?? c.email}
										</span>
									</td>
									<td className={`${TD} text-muted text-xs`}>
										{t(`dash.status.${c.status}` as Key)}
									</td>
									<td className={`nums ${TD} text-right`}>
										{c.metrics.daysRunning}
										{t("admin.days")}
									</td>
									<td className={`nums ${TD} text-right`}>
										{c.metrics.daysRemaining === null
											? "—"
											: `${c.metrics.daysRemaining}${t("admin.days")}`}
									</td>
									<td className={`nums ${TD} text-right`}>
										{num(c.metrics.impressions, lang)}
									</td>
									<td className={`nums ${TD} text-right`}>
										{num(c.metrics.clicks, lang)}
									</td>
									{/* Never a computed rate below the thresholds — the API's own
									    reason is printed instead of a figure nobody should act on. */}
									<td className={`${TD} text-right`}>
										{c.metrics.reportable ? (
											<span className="nums">{pct(c.metrics.ctr, lang)}</span>
										) : (
											<span className="text-muted text-xs">
												{c.metrics.note}
											</span>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}

function Board({
	data,
	t,
	tc,
	lang,
}: {
	data: AdminSlots;
	t: T;
	tc: TC;
	lang: Lang;
}) {
	const taken = data.slots.filter((s) => !s.available).length;
	return (
		<section className="mt-12">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<h2 className={SECTION_TITLE}>{t("admin.slots.title")}</h2>
				<p className="nums font-mono text-muted text-xs">
					{t("admin.slots.occupancy")
						.replace("{taken}", String(taken))
						.replace("{total}", String(data.slots.length))}
				</p>
			</div>

			<div className="mt-4 overflow-x-auto">
				<table className="w-full min-w-[40rem] border-collapse text-sm">
					<thead>
						<tr>
							{[
								[t("dash.slot"), true],
								[t("admin.slots.price"), false],
								[t("admin.slots.occupant"), true],
								[t("admin.left"), false],
							].map(([label, left]) => (
								<th
									key={String(label)}
									className={`${TH} ${left ? "text-left" : "text-right"}`}
								>
									{label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{data.slots.map((s) => {
							const days = s.occupant?.daysRemaining ?? null;
							const expiring = days !== null && days <= EXPIRING_DAYS;
							return (
								<tr key={s.id}>
									<td className={TD}>
										<span className="font-medium">{s.id}</span>
										<span className="block text-muted text-xs">
											{tc(s.label)}
										</span>
									</td>
									<td className={`nums ${TD} text-right`}>
										{s.priceCents === null ? "—" : money(s.priceCents, lang)}
									</td>
									<td className={TD}>
										{s.occupant ? (
											<>
												<span>{s.occupant.name?.en ?? s.occupant.email}</span>
												<span className="block text-muted text-xs">
													{s.occupant.email}
													{s.occupant.endsAt
														? ` · ${t("dash.until")} ${day(s.occupant.endsAt, lang)}`
														: ""}
												</span>
											</>
										) : (
											<span className="text-muted">
												{t("admin.slots.free")}
											</span>
										)}
									</td>
									<td className={`nums ${TD} text-right`}>
										{days === null ? (
											"—"
										) : (
											<span
												style={
													expiring ? { color: "var(--accent)" } : undefined
												}
											>
												{days}
												{t("admin.days")}
												{expiring && (
													<span className="block text-[10px]">
														{t("admin.slots.expiring")}
													</span>
												)}
											</span>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</section>
	);
}

/** The three refusals, and the one that has a link worth following. */
function Card({
	title,
	body,
	t,
	lang,
	signin,
}: {
	title: string;
	body: string;
	t: T;
	lang: Lang;
	signin?: boolean;
}) {
	return (
		<main className="mx-auto max-w-md px-4 py-16">
			<p className={EYEBROW}>{t("admin.eyebrow")}</p>
			<h1 className="mt-2 font-bold font-display text-2xl tracking-tight">
				{title}
			</h1>
			<p className="mt-2 text-muted text-sm">{body}</p>
			{signin && (
				<Link
					href={paths.signin(lang)}
					className="mt-5 inline-block rounded-[calc(var(--radius))] bg-brand px-4 py-2 font-medium text-sm text-white"
				>
					{t("signin.submit")}
				</Link>
			)}
		</main>
	);
}

export function AdminPage({ t, tc, lang }: { t: T; tc: TC; lang: Lang }) {
	const [gate, setGate] = useState<Gate>("loading");
	const [data, setData] = useState<Loaded | null>(null);

	const load = useCallback(() => {
		// One `Promise.all`: the three views are one screen, and half of it is not
		// a state worth rendering — a queue with no board beside it cannot answer
		// "is this slot even free".
		Promise.all([
			api.siteAdmin.queue(),
			api.siteAdmin.campaigns(),
			api.siteAdmin.slots(),
		])
			.then(([queue, campaigns, slots]) => {
				setData({ queue, campaigns, slots });
				setGate("ok");
			})
			.catch((err: unknown) => {
				setGate(
					err instanceof ApiError
						? (GATE_BY_STATUS[err.status] ?? "error")
						: "error",
				);
			});
	}, []);

	useEffect(() => load(), [load]);

	// The prerendered document has no session, so it ships this and nothing else.
	if (gate === "loading")
		return <main className="mx-auto max-w-5xl px-4 py-16" />;
	if (gate === "signedOut") {
		return (
			<Card
				title={t("admin.signedOutTitle")}
				body={t("admin.signedOutBody")}
				t={t}
				lang={lang}
				signin
			/>
		);
	}
	// Signed in, and it is simply not this address. No sign-in link: they already
	// did that, and offering it again reads as "try harder".
	if (gate === "forbidden") {
		return (
			<Card
				title={t("admin.forbiddenTitle")}
				body={t("admin.forbiddenBody")}
				t={t}
				lang={lang}
			/>
		);
	}
	if (gate === "unconfigured") {
		return (
			<Card
				title={t("admin.unconfiguredTitle")}
				body={t("admin.unconfiguredBody")}
				t={t}
				lang={lang}
			/>
		);
	}
	if (gate === "error" || !data) {
		return (
			<main className="mx-auto max-w-md px-4 py-16">
				<p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
					{t("admin.loadError")}
				</p>
				<button
					type="button"
					onClick={load}
					className="mt-4 rounded-[calc(var(--radius))] border border-border px-3 py-1.5 text-sm"
				>
					{t("admin.retry")}
				</button>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-5xl px-4 py-12">
			<p className={EYEBROW}>{t("admin.eyebrow")}</p>
			<h1 className="mt-1.5 font-bold font-display text-2xl tracking-tight">
				{t("admin.title")}
			</h1>

			<section className="mt-8">
				<h2 className={SECTION_TITLE}>{t("admin.queue.title")}</h2>
				{data.queue.queue.length === 0 ? (
					<p className="mt-3 text-muted text-sm">{t("admin.queue.empty")}</p>
				) : (
					<ul className={`mt-4 ${GRID_1COL} gap-4`}>
						{data.queue.queue.map((item) => (
							<QueueItem
								key={item.id}
								item={item}
								t={t}
								tc={tc}
								lang={lang}
								onDone={load}
							/>
						))}
					</ul>
				)}
			</section>

			<Campaigns data={data.campaigns} t={t} lang={lang} />
			<Board data={data.slots} t={t} tc={tc} lang={lang} />
		</main>
	);
}
