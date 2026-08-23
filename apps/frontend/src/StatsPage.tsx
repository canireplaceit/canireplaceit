import { paths } from "core/src/routes";
import type { SiteStats } from "./api";
import { formatDate } from "./api";
import type { Key, Lang } from "./i18n";
import { PageShell } from "./shell";

type T = (k: Key) => string;

const num = (n: number, lang: Lang) =>
	new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(n);

// null stays a dash — 0/0 is not a duration.
const dur = (s: number | null) =>
	s === null ? "—" : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

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

// Fewer bars render as one solid rectangle, not a chart.
const CHART_MIN_DAYS = 3;

function ChartPending({
	since,
	t,
	lang,
}: {
	since: string | null;
	t: T;
	lang: Lang;
}) {
	return (
		<p className="mt-4 text-sm text-muted">
			{since
				? t("sitestats.chartPending").replace(
						"{date}",
						formatDate(since.slice(0, 10), lang),
					)
				: t("sitestats.chartPendingNoDate")}
		</p>
	);
}

// aria-hidden here; the real figures are in the table below for screen readers.
function Spark({ series }: { series: { day: string; pageviews: number }[] }) {
	const max = series.reduce((m, p) => Math.max(m, p.pageviews), 0);
	if (max === 0) return null;
	return (
		<div className="mt-4 flex h-16 items-end gap-[3px]" aria-hidden>
			{series.map((p) => (
				<div
					key={p.day}
					title={`${p.day}: ${p.pageviews}`}
					className="flex-1 rounded-t-[2px]"
					style={{
						// 2% floor keeps single-view days visible instead of absent.
						height: `${Math.max(2, (p.pageviews / max) * 100)}%`,
						background: "color-mix(in srgb, var(--brand) 55%, transparent)",
					}}
				/>
			))}
		</div>
	);
}

function Table({
	head,
	rows,
}: {
	head: string[];
	rows: (string | number)[][];
}) {
	if (rows.length === 0) return null;
	return (
		<div className="mt-3 overflow-x-auto">
			<table className="w-full min-w-[24rem] border-collapse text-sm">
				<thead>
					<tr>
						{head.map((h, i) => (
							<th
								key={h}
								className={`border-border border-b pb-2 font-mono text-[10px] text-muted uppercase tracking-widest ${i === 0 ? "text-left" : "text-right"}`}
							>
								{h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={String(row[0])}>
							{row.map((cell, i) => (
								<td
									key={head[i]}
									className={`border-border border-b py-2 ${i === 0 ? "" : "nums text-right"}`}
								>
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function TopPages({
	rows,
	t,
	lang,
}: {
	rows: { name: string; count: number }[];
	t: T;
	lang: Lang;
}) {
	if (rows.length === 0) return null;
	return (
		<>
			<ul className="mt-3 divide-y divide-border sm:hidden">
				{rows.map((p) => (
					<li key={p.name} className="py-2">
						<div className="break-all text-sm">{p.name}</div>
						<div className="nums mt-1 text-right text-muted text-xs">
							{num(p.count, lang)} {t("sitestats.visitors").toLowerCase()}
						</div>
					</li>
				))}
			</ul>
			<div className="hidden sm:block">
				<Table
					head={[t("sitestats.path"), t("sitestats.visitors")]}
					rows={rows.map((p) => [p.name, num(p.count, lang)])}
				/>
			</div>
		</>
	);
}

export function StatsPage({
	stats,
	t,
	lang,
}: {
	stats: SiteStats | { unavailable: true } | null;
	t: T;
	lang: Lang;
}) {
	const body = () => {
		if (!stats) return null;

		if ("unavailable" in stats) {
			return (
				<div
					className="mt-6 rounded-[calc(var(--radius))] border border-dashed p-5 text-sm"
					style={{
						borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
					}}
				>
					<p className="font-medium">{t("sitestats.unavailableTitle")}</p>
					<p className="mt-2 max-w-2xl text-muted">
						{t("sitestats.unavailable")}
					</p>
				</div>
			);
		}

		// On day one, pageviews and best day are the same number, so only show
		// best day once there's more than one day to compare it against.
		const showBestDay = stats.series.length >= 2;

		return (
			<>
				<dl
					className={`mt-6 grid gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border ${showBestDay ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}
				>
					<Figure
						label={t("sitestats.pageviews")}
						value={num(stats.pageviews, lang)}
					/>
					<Figure
						label={t("sitestats.sessions")}
						value={num(stats.visits, lang)}
					/>
					{showBestDay && (
						<Figure
							label={t("sitestats.bestDay")}
							value={num(stats.bestDay, lang)}
						/>
					)}
					<Figure
						label={t("sitestats.avgTime")}
						value={dur(stats.avgSeconds)}
					/>
				</dl>

				{stats.series.length >= CHART_MIN_DAYS ? (
					<Spark series={stats.series} />
				) : (
					<ChartPending since={stats.since} t={t} lang={lang} />
				)}

				<p className="mt-3 max-w-2xl text-muted text-xs">
					{t("sitestats.method")}{" "}
					{stats.since &&
						`${t("sitestats.since")} ${formatDate(stats.since.slice(0, 10), lang)}. `}
					{t("sitestats.sessionsNote")}
				</p>

				<h2 className="mt-8 font-medium text-sm">{t("sitestats.topPages")}</h2>
				<TopPages rows={stats.pages} t={t} lang={lang} />

				<h2 className="mt-8 font-medium text-sm">{t("sitestats.sources")}</h2>
				<Table
					head={[t("sitestats.source"), t("sitestats.visitors")]}
					rows={stats.referrers.map((r) => [
						r.name || t("sitestats.direct"),
						num(r.count, lang),
					])}
				/>

				{stats.pages.length === 0 && stats.pageviews === 0 && (
					<p className="mt-6 text-muted text-sm">{t("sitestats.noneYet")}</p>
				)}
			</>
		);
	};

	return (
		<PageShell
			measure="max-w-3xl"
			trail={[
				{ label: t("page.home"), href: paths.home(lang) },
				{ label: t("nav.stats") },
			]}
			eyebrow={t("sitestats.eyebrow")}
			title={t("sitestats.title")}
			lede={t("sitestats.blurb")}
		>
			{body()}
		</PageShell>
	);
}
