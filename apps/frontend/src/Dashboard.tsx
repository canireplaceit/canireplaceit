import { resolveTranslation, type Translations } from "core/src/index";
import { paths } from "core/src/routes";
import { useEffect, useState } from "react";
import {
	api,
	type Campaign,
	type Campaigns,
	formatDate,
	money,
	type Team,
} from "./api";
import type { Key, Lang } from "./i18n";
import { Link } from "./nav";
import { TeamPanel } from "./Team";

type T = (k: Key) => string;

export const num = (n: number, lang: Lang) =>
	new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(n);

export const pct = (v: number | null, lang: Lang) =>
	v === null
		? "—"
		: `${new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
				maximumFractionDigits: 2,
			}).format(v)}%`;

// clicks:0 renders as a dash, not "0" — reads as "not measured yet", not "ad failed".
const clicksOrDash = (clicks: number, lang: Lang) =>
	clicks === 0 ? "—" : num(clicks, lang);

const ctrOrDash = (clicks: number, ctr: number | null, lang: Lang) =>
	clicks === 0 ? "—" : pct(ctr, lang);

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col-reverse bg-surface px-3 py-4">
			<dt className="mt-1 text-[10px] text-muted uppercase tracking-widest">
				{label}
			</dt>
			<dd className="nums font-bold text-xl">{value}</dd>
		</div>
	);
}

function StatusPill({ status, t }: { status: string; t: T }) {
	const tone =
		status === "live"
			? { bg: "var(--brand)", fg: "#fff" }
			: status === "paid"
				? { bg: "var(--accent)", fg: "var(--bg)" }
				: {
						bg: "color-mix(in srgb, var(--muted) 25%, transparent)",
						fg: "var(--muted)",
					};
	return (
		<span
			className="whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
			style={{ background: tone.bg, color: tone.fg }}
		>
			{t(`dash.status.${status}` as Key)}
		</span>
	);
}

const termText = (c: Campaign, t: T, lang: Lang) =>
	c.endsAt
		? `${t("dash.until")} ${formatDate(c.endsAt.slice(0, 10), lang)}`
		: `${c.months} ${t("dash.months")} · ${money(c.amountCents, lang)}`;

// startsAt/endsAt are set together on purchase approval; both null until then.
function TermProgress({ c, t, lang }: { c: Campaign; t: T; lang: Lang }) {
	if (!c.startsAt || !c.endsAt) return null;
	const start = Date.parse(c.startsAt);
	const end = Date.parse(c.endsAt);
	const totalDays = Math.round((end - start) / 86_400_000);
	if (!(totalDays > 0)) return null;
	const elapsedDays = Math.min(
		totalDays,
		Math.max(0, Math.round((Date.now() - start) / 86_400_000)),
	);
	const fillPct = (elapsedDays / totalDays) * 100;
	return (
		<div className="mt-2.5">
			<div
				className="h-1.5 w-full overflow-hidden rounded-full"
				style={{
					background: "color-mix(in srgb, var(--muted) 20%, transparent)",
				}}
			>
				<div
					className="h-full rounded-full"
					style={{ width: `${fillPct}%`, background: "var(--v-yes)" }}
				/>
			</div>
			<p className="mt-1 text-[11px] text-muted">
				{t("dash.termProgress")
					.replace("{elapsed}", String(elapsedDays))
					.replace("{total}", String(totalDays))}{" "}
				· {t("dash.endsOn")} {formatDate(c.endsAt.slice(0, 10), lang)}
			</p>
		</div>
	);
}

export function Dashboard({
	data,
	team,
	loading,
	t,
	lang,
	onSignOut,
	onTeamChanged,
}: {
	/** Null while loading, or when the session is not signed in. */
	data: Campaigns | null;
	team: Team | null;
	loading: boolean;
	t: T;
	lang: Lang;
	onSignOut: () => void;
	onTeamChanged: () => void;
}) {
	const [selectedOrgOwner, setSelectedOrgOwner] = useState<string | null>(null);
	// /api/me/campaigns doesn't include slot labels; fetch them from /api/slots.
	const [slotLabels, setSlotLabels] = useState<Record<string, Translations>>(
		{},
	);
	useEffect(() => {
		let cancelled = false;
		api
			.slots()
			.then((slots) => {
				if (cancelled) return;
				setSlotLabels(Object.fromEntries(slots.map((s) => [s.id, s.label])));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);
	const orgs = team?.orgs ?? [];
	const current =
		orgs.find((o) => o.owner === selectedOrgOwner) ??
		orgs.find((o) => o.purchases > 0) ??
		orgs[0] ??
		null;
	if (loading)
		return <main id="main" className="mx-auto max-w-4xl px-4 py-16" />;

	if (!data) {
		return (
			<main id="main" className="mx-auto max-w-md px-4 py-16">
				<p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
					{t("dash.eyebrow")}
				</p>
				<h1 className="mt-2 font-bold font-display text-2xl tracking-tight">
					{t("dash.signedOutTitle")}
				</h1>
				<p className="mt-2 text-muted text-sm">{t("dash.signedOutBody")}</p>
				<Link
					href={paths.signin(lang)}
					className="mt-5 inline-block rounded-[calc(var(--radius))] bg-brand px-4 py-2 font-medium text-sm text-white"
				>
					{t("signin.submit")}
				</Link>
			</main>
		);
	}

	return (
		<main id="main" className="mx-auto max-w-4xl px-4 py-12">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<p className="font-mono text-[10px] text-muted uppercase tracking-[0.2em]">
						{t("dash.eyebrow")} · {data.email}
					</p>
					<h1 className="mt-1.5 font-bold font-display text-2xl tracking-tight">
						{t("dash.title")}
					</h1>
				</div>
				<button
					type="button"
					onClick={onSignOut}
					className="rounded-[calc(var(--radius))] border border-border px-3 py-1.5 text-sm"
				>
					{t("dash.signOut")}
				</button>
			</div>

			{orgs.length > 1 && (
				<div className="mt-5 flex flex-wrap items-center gap-2">
					<span className="font-medium text-muted text-xs">
						{t("dash.orgSwitch")}
					</span>
					{orgs.map((o) => (
						<button
							key={o.owner}
							type="button"
							onClick={() => setSelectedOrgOwner(o.owner)}
							className="rounded-full border px-3 py-1 text-xs"
							style={
								o.owner === current?.owner
									? { borderColor: "var(--brand)", color: "var(--brand)" }
									: { borderColor: "var(--color-border)" }
							}
						>
							{o.isPayer ? t("dash.title") : o.owner}
						</button>
					))}
				</div>
			)}

			{data.campaigns.length === 0 ? (
				<div className="mt-8 rounded-[calc(var(--radius))] border border-dashed border-border p-6 text-sm">
					<p className="font-medium">{t("dash.emptyTitle")}</p>
					<p className="mt-2 text-muted">{t("dash.emptyBody")}</p>
					<Link
						href={paths.sponsor(lang)}
						className="mt-3 inline-block text-brand hover:underline"
					>
						{t("dash.emptyCta")} →
					</Link>
				</div>
			) : (
				<>
					<dl className="mt-7 grid grid-cols-3 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border">
						<Figure
							label={t("adstats.impressions")}
							value={num(data.totals.impressions, lang)}
						/>
						<Figure
							label={t("adstats.clicks")}
							value={clicksOrDash(data.totals.clicks, lang)}
						/>
						<Figure
							label={t("adstats.ctr")}
							value={ctrOrDash(data.totals.clicks, data.totals.ctr, lang)}
						/>
					</dl>
					{data.totals.clicks === 0 &&
						(() => {
							const earliestLiveDate = data.campaigns
								.map((c) => c.startsAt)
								.filter((d): d is string => d !== null)
								.sort()[0];
							return (
								<p className="mt-2.5 max-w-2xl text-muted text-xs">
									{earliestLiveDate
										? t("dash.noClicksSince").replace(
												"{date}",
												formatDate(earliestLiveDate.slice(0, 10), lang),
											)
										: t("dash.noClicksYet")}
								</p>
							);
						})()}
					<p className="mt-2.5 max-w-2xl text-muted text-xs">
						{t("dash.method")}
					</p>

					<h2 className="mt-9 font-medium text-sm">{t("dash.byPlacement")}</h2>

					<div className="mt-3 hidden overflow-x-auto sm:block">
						<table className="w-full min-w-[36rem] border-collapse text-sm">
							<thead>
								<tr>
									{[
										t("dash.slot"),
										t("dash.state"),
										t("dash.runs"),
										t("adstats.impressions"),
										t("adstats.clicks"),
										t("adstats.ctr"),
									].map((h, i) => (
										<th
											key={h}
											className={`border-border border-b pb-2 font-mono text-[10px] text-muted uppercase tracking-widest ${i < 3 ? "text-left" : "text-right"}`}
										>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{data.campaigns.map((c) => (
									<tr key={c.id}>
										<td className="border-border border-b py-2.5">
											<span className="font-medium">{c.slotId}</span>
											{c.name && (
												<span className="block text-muted text-xs">
													{c.name}
												</span>
											)}
										</td>
										<td className="border-border border-b py-2.5">
											<StatusPill status={c.status} t={t} />
										</td>
										<td className="nums border-border border-b py-2.5 text-muted text-xs">
											{termText(c, t, lang)}
											<div className="w-32">
												<TermProgress c={c} t={t} lang={lang} />
											</div>
										</td>
										<td className="nums border-border border-b py-2.5 text-right">
											{num(c.stats.impressions, lang)}
										</td>
										<td className="nums border-border border-b py-2.5 text-right">
											{clicksOrDash(c.stats.clicks, lang)}
										</td>
										<td className="nums border-border border-b py-2.5 text-right">
											{ctrOrDash(c.stats.clicks, c.stats.ctr, lang)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="mt-3 grid gap-3 sm:hidden">
						{data.campaigns.map((c) => {
							const label = slotLabels[c.slotId];
							return (
								<div
									key={c.id}
									className="rounded-[calc(var(--radius))] border border-border p-4 text-sm"
								>
									<div className="flex items-start justify-between gap-2">
										<div className="min-w-0">
											<p className="font-medium">{c.slotId}</p>
											{label && (
												<p className="text-muted text-xs">
													{resolveTranslation(label, lang)}
												</p>
											)}
										</div>
										<StatusPill status={c.status} t={t} />
									</div>
									{c.name && <p className="mt-2">{c.name}</p>}
									<dl className="mt-3 grid grid-cols-2 gap-3">
										<div>
											<dt className="text-[10px] text-muted uppercase tracking-widest">
												{t("adstats.impressions")}
											</dt>
											<dd className="nums font-medium">
												{num(c.stats.impressions, lang)}
											</dd>
										</div>
										<div>
											<dt className="text-[10px] text-muted uppercase tracking-widest">
												{t("adstats.clicks")}
											</dt>
											<dd className="nums font-medium">
												{clicksOrDash(c.stats.clicks, lang)}
											</dd>
										</div>
									</dl>
									<p className="mt-3 text-muted text-xs">
										{termText(c, t, lang)}
									</p>
									<TermProgress c={c} t={t} lang={lang} />
								</div>
							);
						})}
					</div>

					{data.campaigns.some((c) => c.status === "paid") && (
						<div
							className="mt-7 rounded-[calc(var(--radius))] border p-4 text-sm"
							style={{
								borderColor:
									"color-mix(in srgb, var(--accent) 50%, transparent)",
								background: "color-mix(in srgb, var(--accent) 8%, transparent)",
							}}
						>
							<p className="font-medium">{t("dash.needCreativeTitle")}</p>
							<p className="mt-1.5 text-muted">{t("dash.needCreativeBody")}</p>
						</div>
					)}
				</>
			)}

			{current && <TeamPanel org={current} t={t} onChanged={onTeamChanged} />}
		</main>
	);
}
