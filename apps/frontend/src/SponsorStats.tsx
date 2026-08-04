import { parseRoute } from "core/src/routes";
import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import type { AdStats } from "./api";
import { formatDate } from "./api";
import type { Key, Lang } from "./i18n";

type T = (k: Key) => string;

const pinnedSlotId = (): string | undefined => {
	if (typeof location === "undefined") return undefined;
	const route = parseRoute(new URL(location.href));
	return route.name === "sponsor" ? route.slot : undefined;
};

const PAGE_KEY: Record<string, Key> = {
	home: "adstats.page.home",
	product: "adstats.page.product",
	category: "adstats.page.category",
	project: "adstats.page.project",
	other: "adstats.page.other",
};

const num = (n: number, lang: Lang) =>
	new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(n);

const pct = (v: number | null, lang: Lang) =>
	v === null
		? "—"
		: `${new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 2 }).format(v)}%`;

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<div className="bg-surface px-3 py-4">
			<dd className="nums text-xl font-bold">{value}</dd>
			<dt className="mt-1 text-[10px] uppercase tracking-widest text-muted">
				{label}
			</dt>
		</div>
	);
}

type TabKey = "slot" | "page" | "category";

type Row = {
	key: string;
	impressions: number;
	cells: (string | number)[];
	pinned?: boolean;
};

const byImpressions = (rows: Row[]) =>
	[...rows].sort((a, b) => b.impressions - a.impressions);

function AudienceTabs({
	stats,
	t,
	lang,
	pinned,
}: {
	stats: AdStats;
	t: T;
	lang: Lang;
	pinned?: string;
}) {
	const hasCategory = stats.byCategory.length > 0;
	const tabs: TabKey[] = hasCategory
		? ["slot", "page", "category"]
		: ["slot", "page"];
	const [tab, setTab] = useState<TabKey>(() =>
		pinned ? "slot" : hasCategory ? "category" : "slot",
	);
	const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});

	const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
		if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
		e.preventDefault();
		const i = tabs.indexOf(tab);
		const next =
			tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
		setTab(next);
		tabRefs.current[next]?.focus();
	};

	let slotRows = byImpressions(
		stats.slots.map((s) => ({
			key: s.slotId,
			impressions: s.impressions,
			pinned: s.slotId === pinned,
			cells: [
				s.slotId,
				num(s.impressions, lang),
				num(s.clicks, lang),
				pct(s.ctr, lang),
			],
		})),
	);
	if (pinned) {
		const i = slotRows.findIndex((r) => r.pinned);
		if (i > 0) {
			const [row] = slotRows.splice(i, 1);
			slotRows = [row, ...slotRows];
		}
	}

	const pageRows = byImpressions(
		stats.byPage.map((p) => ({
			key: p.page,
			impressions: p.impressions,
			cells: [
				t(PAGE_KEY[p.page] ?? "adstats.page.other"),
				num(p.impressions, lang),
				num(p.clicks, lang),
			],
		})),
	);

	const categoryRows = byImpressions(
		stats.byCategory.map((c) => ({
			key: c.category,
			impressions: c.impressions,
			cells: [c.category, num(c.impressions, lang), num(c.clicks, lang)],
		})),
	);

	const panels: Record<TabKey, { label: string; head: string[]; rows: Row[] }> =
		{
			slot: {
				label: t("adstats.bySlot"),
				head: [
					t("adstats.slot"),
					t("adstats.impressions"),
					t("adstats.clicks"),
					t("adstats.ctr"),
				],
				rows: slotRows,
			},
			page: {
				label: t("adstats.byPage"),
				head: [
					t("adstats.page"),
					t("adstats.impressions"),
					t("adstats.clicks"),
				],
				rows: pageRows,
			},
			category: {
				label: t("adstats.byCategory"),
				head: [
					t("adstats.category"),
					t("adstats.impressions"),
					t("adstats.clicks"),
				],
				rows: categoryRows,
			},
		};

	return (
		<div className="mt-6">
			<div
				role="tablist"
				aria-label={t("adstats.eyebrow")}
				className="flex gap-2 overflow-x-auto"
				onKeyDown={onKeyDown}
			>
				{tabs.map((k) => (
					<button
						key={k}
						ref={(el) => {
							tabRefs.current[k] = el;
						}}
						type="button"
						role="tab"
						id={`adstats-tab-${k}`}
						aria-selected={tab === k}
						aria-controls={`adstats-panel-${k}`}
						tabIndex={tab === k ? 0 : -1}
						onClick={() => setTab(k)}
						className="shrink-0 whitespace-nowrap rounded-[calc(var(--radius))] border px-3 py-1.5 text-sm transition"
						style={{
							borderColor: tab === k ? "var(--accent)" : "var(--color-border)",
							background:
								tab === k
									? "color-mix(in srgb, var(--accent) 8%, transparent)"
									: "var(--surface)",
						}}
					>
						{panels[k].label}{" "}
						<span className="text-muted">{panels[k].rows.length}</span>
					</button>
				))}
			</div>

			{tabs.map((k) => {
				const panel = panels[k];
				return (
					<div
						key={k}
						role="tabpanel"
						id={`adstats-panel-${k}`}
						aria-labelledby={`adstats-tab-${k}`}
						hidden={tab !== k}
						className="mt-3 max-h-[190px] overflow-auto rounded-[calc(var(--radius))] border border-border"
					>
						<table className="w-full min-w-[28rem] border-collapse text-sm">
							<thead>
								<tr>
									{panel.head.map((h, i) => (
										<th
											key={h}
											className={`sticky top-0 border-b border-border bg-bg py-2 font-mono text-[10px] uppercase tracking-widest text-muted ${i === 0 ? "pl-3 text-left" : "pr-3 text-right"}`}
										>
											{h}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{panel.rows.map((row) => (
									// zero-impression rows stay visible, muted rather than hidden.
									<tr
										key={row.key}
										className={row.impressions === 0 ? "text-muted" : undefined}
									>
										{row.cells.map((cell, i) => (
											<td
												key={panel.head[i]}
												className={`border-b border-border py-2 ${i === 0 ? "pl-3" : "pr-3 nums text-right"}`}
											>
												{cell}
												{i === 0 && row.pinned && (
													<span
														className="ml-2 rounded-full border px-1.5 py-0.5 text-[9px] uppercase tracking-widest"
														style={{
															borderColor: "var(--accent)",
															color: "var(--accent)",
														}}
													>
														{t("adstats.pinned")}
													</span>
												)}
											</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				);
			})}
		</div>
	);
}

export function SponsorStats({
	stats,
	t,
	lang,
}: {
	stats: AdStats | null;
	t: T;
	lang: Lang;
}) {
	if (!stats) return null;

	const since = stats.measuringSince
		? formatDate(stats.measuringSince, lang)
		: null;

	if (!stats.reportable) {
		return (
			<div
				className="mt-6 rounded-[calc(var(--radius))] border border-dashed p-5 text-sm"
				style={{
					borderColor: "color-mix(in srgb, var(--accent) 45%, transparent)",
				}}
			>
				<p className="font-mono text-[10px] text-muted uppercase tracking-widest">
					{t("adstats.eyebrow")}
				</p>
				<p className="mt-2 font-medium">{t("adstats.yoursTitle")}</p>
				<p className="mt-2 max-w-2xl text-muted">{t("adstats.yoursBody")}</p>
			</div>
		);
	}

	return (
		<div className="mt-6">
			<p className="font-mono text-[10px] uppercase tracking-widest text-muted">
				{t("adstats.eyebrow")}
			</p>
			<dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-[calc(var(--radius))] border border-border bg-border sm:grid-cols-4">
				<Figure
					label={t("adstats.impressions")}
					value={num(stats.impressions, lang)}
				/>
				<Figure label={t("adstats.clicks")} value={num(stats.clicks, lang)} />
				<Figure label={t("adstats.ctr")} value={pct(stats.ctr, lang)} />
				<Figure
					label={t("adstats.daysWithData")}
					value={num(stats.days, lang)}
				/>
			</dl>

			<p className="mt-2 text-xs text-muted">
				{since && `${t("adstats.measuringSince")} ${since}. `}
				{t("adstats.method")}
				{stats.discarded > 0 &&
					` ${t("adstats.discarded").replace("{n}", num(stats.discarded, lang))}`}
			</p>

			<AudienceTabs stats={stats} t={t} lang={lang} pinned={pinnedSlotId()} />
		</div>
	);
}
