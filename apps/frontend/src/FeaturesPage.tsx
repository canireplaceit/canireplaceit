/**
 * The feature explorer — search, filter, and compare what projects actually do.
 *
 * ONE URL, never one per filter combination. 137 feature keys would otherwise
 * mint a combinatorial space of near-duplicate indexable pages, which is the
 * thing that gets a catalogue site demoted rather than ranked. Filter state
 * lives in the query string, the parameterised states are noindex, and the
 * canonical points at the bare path — see `seo.ts` and `routes.ts`.
 *
 * The dataset is loaded on demand rather than imported at module scope. At the
 * current 14 projects it is 33 KB and would not matter; at the full 871 it is
 * megabytes, and this page is a small minority of traffic on a site whose
 * dominant case is a single organic landing. Splitting it now costs five lines
 * and avoids a cliff we can already see.
 */

import {
	CATEGORY_GROUPS,
	type Category,
	type CategoryGroup,
	healthKey,
	type Product,
} from "core/src/content";
import type { FeatureFile, FeatureValue } from "core/src/features";
import {
	compare as compareProjects,
	domainsFor,
	FEATURE_VALUES,
	featureName,
	featureValue,
	matching,
} from "core/src/features";
import type { Translations } from "core/src/index";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { altIcon } from "./api";
import { Pill } from "./browse";
import { CARD, Logo } from "./components";
import type { Key } from "./i18n";
import { MEASURE } from "./listShared";
import { type Crumb, PageShell } from "./shell";

type T = (k: Key) => string;

/** How each value reads. `unknown` is deliberately a dash, never a cross. */
const MARK: Record<FeatureValue, { glyph: string; cls: string; label: Key }> = {
	yes: { glyph: "●", cls: "text-yes", label: "features.val.yes" },
	paid: { glyph: "€", cls: "text-almost", label: "features.val.paid" },
	partial: { glyph: "◐", cls: "text-almost", label: "features.val.partial" },
	no: { glyph: "○", cls: "text-no", label: "features.val.no" },
	unknown: { glyph: "–", cls: "text-muted", label: "features.val.unknown" },
};

/** The micro-heading every other page labels its sections with. */
const H2 = "font-mono text-[10px] uppercase tracking-[0.16em] text-muted";

/** The dense chip used for the (many) feature toggles — Pill's little sibling. */
const chipStyle = (active: boolean) =>
	({
		borderColor: active ? "var(--brand)" : "var(--color-border)",
		background: active
			? "color-mix(in srgb, var(--brand) 8%, transparent)"
			: "var(--surface)",
	}) as const;

/** How many genre pills sit in the always-visible row; the rest fold away. */
const TOP_GENRES = 8;

type Row = {
	key: string;
	name: string;
	icon: string | null;
	categories: string[];
	decided: number;
};

/**
 * Projects, with the categories they are cited in — the join core deliberately
 * does not do, because `Project` carries `replaces` (products) and not
 * categories. Done once here rather than per render.
 */
function projectRows(products: Product[], file: FeatureFile | null): Row[] {
	if (!file) return [];
	const byKey = new Map<string, Row>();
	for (const p of products) {
		for (const a of p.alternatives) {
			if (a.kind !== "oss") continue;
			const key = healthKey(a.source);
			// Only projects we actually hold feature data for. A row of dashes is
			// not information, and padding the table with them would misrepresent
			// coverage as breadth.
			if (!file.projects[key]) continue;
			const row = byKey.get(key) ?? {
				key,
				name: a.name,
				icon: altIcon(a),
				categories: [],
				decided: Object.keys(file.projects[key]).length,
			};
			if (!row.categories.includes(p.category)) row.categories.push(p.category);
			byKey.set(key, row);
		}
	}
	return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function FeaturesPage({
	products,
	categories,
	t,
	tc,
	trail,
}: {
	products: Product[];
	categories: Category[];
	t: T;
	tc: (v: Translations) => string;
	/** The breadcrumb the shell renders. Built by the caller, which is the only
	 *  place that knows where this page sits in the nav. */
	trail: Crumb[];
}) {
	const [file, setFile] = useState<FeatureFile | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [query, setQuery] = useState("");
	const [need, setNeed] = useState<string[]>([]);
	const [acceptPaid, setAcceptPaid] = useState(false);
	const [genre, setGenre] = useState<string>("");
	const [picked, setPicked] = useState<string[]>([]);
	const [bothChecked, setBothChecked] = useState(false);
	const [allGenres, setAllGenres] = useState(false);

	// Read the filter state out of the URL so a shared link restores it, then
	// keep the URL in step without adding history entries per keystroke.
	useEffect(() => {
		const q = new URLSearchParams(window.location.search);
		const n = q.get("need");
		if (n) setNeed(n.split(",").filter(Boolean));
		if (q.get("paid") === "1") setAcceptPaid(true);
		const g = q.get("genre");
		if (g) setGenre(g);
		const c = q.get("cmp");
		if (c) setPicked(c.split(",").filter(Boolean));
		if (q.get("both") === "1") setBothChecked(true);
	}, []);

	useEffect(() => {
		const q = new URLSearchParams();
		if (need.length) q.set("need", need.join(","));
		if (acceptPaid) q.set("paid", "1");
		if (genre) q.set("genre", genre);
		// The comparison selection is shareable state too — a link to a filled
		// matrix is the thing somebody actually sends a colleague.
		if (picked.length) q.set("cmp", picked.join(","));
		if (bothChecked) q.set("both", "1");
		const qs = q.toString();
		window.history.replaceState(
			null,
			"",
			qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
		);
	}, [need, acceptPaid, genre, picked, bothChecked]);

	useEffect(() => {
		let live = true;
		import("../../../data/features.json")
			.then((m) => {
				if (live) setFile((m.default ?? m) as unknown as FeatureFile);
			})
			.catch(() => {
				if (live) setLoadFailed(true);
			});
		return () => {
			live = false;
		};
	}, []);

	const rows = useMemo(() => projectRows(products, file), [products, file]);

	const catBySlug = useMemo(
		() => new Map(categories.map((c) => [c.slug, c])),
		[categories],
	);
	// Slugs stay the URL value; only what the reader sees is translated.
	const genreLabel = (slug: string) => {
		const c = catBySlug.get(slug);
		return c ? tc(c.name) : slug;
	};

	const genres = useMemo(() => {
		const c = new Map<string, number>();
		for (const r of rows)
			for (const cat of r.categories) c.set(cat, (c.get(cat) ?? 0) + 1);
		return [...c.entries()].sort((a, b) => b[1] - a[1]);
	}, [rows]);

	// The always-visible row: the biggest genres, plus the chosen one so a
	// shared ?genre= link never lands on a page whose active filter is hidden.
	const topGenres = useMemo(() => {
		const top = genres.slice(0, TOP_GENRES);
		if (genre && !top.some(([g]) => g === genre)) {
			const active = genres.find(([g]) => g === genre);
			if (active) top.push(active);
		}
		return top;
	}, [genres, genre]);

	// The full list, folded behind a disclosure and sectioned by the authored
	// `group` — the same themes the categories index files everything under.
	const groupedGenres = useMemo(() => {
		const out: { group: CategoryGroup | null; items: [string, number][] }[] =
			CATEGORY_GROUPS.map((group) => ({
				group: group as CategoryGroup | null,
				items: genres.filter(([g]) => catBySlug.get(g)?.group === group),
			}));
		// Genres the category payload doesn't know (dev before the API answers):
		// shown unthemed rather than dropped.
		const orphans = genres.filter(([g]) => !catBySlug.get(g));
		if (orphans.length) out.push({ group: null, items: orphans });
		return out.filter((g) => g.items.length > 0);
	}, [genres, catBySlug]);

	const inGenre = useMemo(
		() => (genre ? rows.filter((r) => r.categories.includes(genre)) : rows),
		[rows, genre],
	);

	const matched = useMemo(() => {
		if (!file || need.length === 0) return inGenre;
		const ok = new Set(
			matching(
				file,
				need.map((key) => ({ key, acceptPaid })),
			),
		);
		return inGenre.filter((r) => ok.has(r.key));
	}, [file, inGenre, need, acceptPaid]);

	// The feature list shown as filter chips — scoped to the chosen genre, so a
	// note-taking vocabulary never appears while browsing VPNs. Kept grouped by
	// domain: a reader hunting for SSO starts at "Authentication", not at "M".
	const domainGroups = useMemo(() => {
		if (!file) return [];
		const q = query.trim().toLowerCase();
		return domainsFor(file, genre ? [genre] : [])
			.map((d) => ({
				key: d.key,
				name: d.name,
				shown: d.features.filter(
					(f) =>
						!q || tc(f.name).toLowerCase().includes(q) || f.key.includes(q),
				),
			}))
			.filter((d) => d.shown.length > 0);
	}, [file, genre, query, tc]);

	const comparison = useMemo(
		() =>
			file && picked.length >= 2
				? compareProjects(file, picked, {
						categories: genre ? [genre] : undefined,
						bothCheckedOnly: bothChecked,
					})
				: [],
		[file, picked, genre, bothChecked],
	);

	const toggle = (list: string[], v: string) =>
		list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

	if (loadFailed)
		return (
			<PageShell measure={MEASURE} trail={trail} title={t("features.title")}>
				<p className="text-muted">{t("features.loadFailed")}</p>
			</PageShell>
		);

	if (!file)
		return (
			<PageShell measure={MEASURE} trail={trail} title={t("features.title")}>
				<p className="text-muted">{t("features.loading")}</p>
			</PageShell>
		);

	const domainName = new Map(file.domains.map((d) => [d.key, d.name]));
	const requirementName = (key: string) => {
		const name = featureName(file, key);
		return name ? tc(name) : key;
	};

	return (
		<PageShell
			measure={MEASURE}
			trail={trail}
			eyebrow={t("nav.features")}
			title={t("features.title")}
			lede={t("features.blurb")}
			meta={
				<p className="nums text-muted text-xs">
					{rows.length} {t("features.coverage")} ·{" "}
					{file.domains.reduce((n, d) => n + d.features.length, 0)}{" "}
					{t("features.vocab")} · v{file.taxonomyVersion}
				</p>
			}
		>
			{/* ---- genre ---- */}
			<section>
				<h2 className={H2}>{t("features.genre")}</h2>
				<div className="mt-2 flex flex-wrap gap-1.5">
					<Pill
						label={
							<>
								{t("features.all")}{" "}
								<span className="nums text-xs text-muted">{rows.length}</span>
							</>
						}
						active={genre === ""}
						onClick={() => {
							setGenre("");
							setPicked([]);
						}}
					/>
					{topGenres.map(([g, n]) => (
						<Pill
							key={g}
							label={
								<>
									{genreLabel(g)}{" "}
									<span className="nums text-xs text-muted">{n}</span>
								</>
							}
							active={genre === g}
							onClick={() => {
								setGenre(g);
								setPicked([]);
							}}
						/>
					))}
					{genres.length > TOP_GENRES && (
						<button
							type="button"
							aria-expanded={allGenres}
							onClick={() => setAllGenres((v) => !v)}
							className="rounded-[calc(var(--radius))] border border-dashed border-border px-3 py-1.5 text-sm text-muted transition hover:border-brand hover:text-text"
						>
							{allGenres
								? t("features.lessGenres")
								: t("features.moreGenres").replace(
										"{n}",
										String(genres.length),
									)}
						</button>
					)}
				</div>
				{allGenres && (
					<div className="mt-3 space-y-4 rounded-[calc(var(--radius))] border border-border bg-surface p-3.5">
						{groupedGenres.map((g) => (
							<div key={g.group ?? "other"}>
								{g.group && (
									<h3 className={H2}>{t(`catGroup.${g.group}` as Key)}</h3>
								)}
								<div className="mt-1.5 flex flex-wrap gap-1.5">
									{g.items.map(([slug, n]) => (
										<Pill
											key={slug}
											label={
												<>
													{genreLabel(slug)}{" "}
													<span className="nums text-xs text-muted">{n}</span>
												</>
											}
											active={genre === slug}
											onClick={() => {
												setGenre(slug);
												setPicked([]);
											}}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</section>

			{/* ---- quick filters ----
			 * The four questions people arrive with, as one click each. They are
			 * ordinary requirements underneath — the chips below stay in step, and
			 * the URL is the same `?need=` either way. A shortcut, not a second
			 * filtering mechanism. */}
			<section className="mt-8">
				<h2 className={H2}>{t("features.quick")}</h2>
				<div className="mt-2 flex flex-wrap gap-1.5">
					{(
						[
							["ai.mcp.server", "features.quickMcp"],
							// Official is its own button, not a sub-toggle: "an MCP server
							// exists" and "the project maintains it" are different purchases,
							// and the second is the one worth building on.
							["ai.mcp.official", "features.quickMcpOfficial"],
							["ai.features", "features.quickAi"],
							["auth.sso.oidc", "features.quickSso"],
							["ops.sqlite", "features.quickSelfhost"],
						] as const
					).map(([key, label]) => (
						<Pill
							key={key}
							label={
								<>
									{t(label)}{" "}
									<span className="nums text-xs text-muted">
										{matching(file, [{ key, acceptPaid }]).length}
									</span>
								</>
							}
							active={need.includes(key)}
							onClick={() => setNeed(toggle(need, key))}
						/>
					))}
				</div>
			</section>

			{/* ---- search + requirements ---- */}
			<section className="mt-8">
				<h2 className={H2}>{t("features.require")}</h2>
				<div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
					<input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={t("features.searchPlaceholder")}
						aria-label={t("features.searchPlaceholder")}
						className="w-full max-w-md rounded-[calc(var(--radius))] border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-brand"
					/>
					<label className="flex items-center gap-2 text-xs text-muted">
						<input
							type="checkbox"
							checked={acceptPaid}
							onChange={(e) => setAcceptPaid(e.target.checked)}
						/>
						{t("features.acceptPaid")}
					</label>
				</div>

				{/* The active requirements, kept visible even when a search or a genre
				    change hides their chips below — an invisible filter is a page that
				    lies about why it is empty. */}
				{need.length > 0 && (
					<div className="mt-3 flex flex-wrap items-center gap-1.5">
						<span className={H2}>{t("features.required")}</span>
						{need.map((k) => (
							<button
								key={k}
								type="button"
								onClick={() => setNeed(need.filter((x) => x !== k))}
								className="inline-flex items-center gap-1 rounded-[calc(var(--radius))] border px-2 py-1 text-xs transition"
								style={chipStyle(true)}
							>
								{requirementName(k)}
								<X className="size-3 shrink-0 text-muted" aria-hidden />
							</button>
						))}
						<button
							type="button"
							onClick={() => setNeed([])}
							className="rounded-[calc(var(--radius))] border border-border px-2 py-1 text-xs text-muted transition hover:border-brand hover:text-text"
						>
							{t("filter.clear")}
						</button>
					</div>
				)}

				<div className="mt-4 space-y-4">
					{domainGroups.map((d) => (
						<div key={d.key}>
							<h3 className={H2}>
								{tc(d.name)}{" "}
								<span className="nums normal-case tracking-normal">
									{d.shown.length}
								</span>
							</h3>
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{d.shown.map((f) => (
									<button
										key={f.key}
										type="button"
										title={f.key}
										aria-pressed={need.includes(f.key)}
										onClick={() => setNeed(toggle(need, f.key))}
										className={`rounded-[calc(var(--radius))] border px-2 py-1 text-xs transition ${need.includes(f.key) ? "" : "text-muted"}`}
										style={chipStyle(need.includes(f.key))}
									>
										{tc(f.name)}
									</button>
								))}
							</div>
						</div>
					))}
				</div>
			</section>

			{/* ---- results ---- */}
			<section className="mt-10">
				<h2 className={H2}>{t("features.results")}</h2>
				<p className="nums mt-1 text-xs text-muted">
					{matched.length}{" "}
					{t(matched.length === 1 ? "features.matchOne" : "features.matchMany")}
					{need.length > 0 &&
						` · ${need.length} ${t(need.length === 1 ? "features.reqOne" : "features.reqMany")}`}
				</p>
				<div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
					{matched.map((r) => {
						const on = picked.includes(r.key);
						return (
							<button
								type="button"
								key={r.key}
								aria-pressed={on}
								onClick={() => setPicked(toggle(picked, r.key))}
								className={`${CARD} text-left transition`}
								style={
									on
										? {
												borderColor: "var(--brand)",
												background:
													"color-mix(in srgb, var(--brand) 6%, var(--surface))",
											}
										: undefined
								}
							>
								<span className="flex items-center gap-2.5">
									<Logo src={r.icon} name={r.name} size={26} />
									<span className="min-w-0 flex-1">
										<span className="block truncate font-medium">{r.name}</span>
										<span className="nums block truncate text-[11px] text-muted">
											{r.decided} {t("features.facts")} ·{" "}
											{r.categories.map(genreLabel).join(", ")}
										</span>
									</span>
								</span>
								{need.length > 0 && (
									<span className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
										{need.map((k) => (
											<span key={k} className="text-[11px] text-muted">
												<span
													className={MARK[featureValue(file, r.key, k)].cls}
												>
													{MARK[featureValue(file, r.key, k)].glyph}
												</span>{" "}
												{requirementName(k)}
											</span>
										))}
									</span>
								)}
							</button>
						);
					})}
				</div>
				{matched.length === 0 && (
					<p className="mt-2 max-w-2xl text-sm text-muted">
						{t("features.noMatch")}
					</p>
				)}
			</section>

			{/* ---- compare ---- */}
			<section className="mt-10">
				<h2 className={H2}>{t("features.compare")}</h2>
				{picked.length < 2 ? (
					<p className="mt-2 max-w-2xl text-sm text-muted">
						{t("features.pickTwo")}
					</p>
				) : (
					<>
						<label className="mt-2 flex items-center gap-2 text-xs text-muted">
							<input
								type="checkbox"
								checked={bothChecked}
								onChange={(e) => setBothChecked(e.target.checked)}
							/>
							{t("features.bothChecked")}
						</label>
						<p className="nums mt-2 text-xs text-muted">
							{t(
								comparison.length === 1
									? "features.diffOne"
									: "features.diffMany",
							).replace("{n}", String(comparison.length))}
						</p>
						<div className="mt-3 overflow-x-auto rounded-[calc(var(--radius))] border border-border bg-surface">
							<table className="w-full min-w-[520px] text-sm">
								<thead>
									<tr className="border-border border-b">
										<th className={`p-2.5 text-left ${H2}`}>
											{t("features.featureCol")}
										</th>
										{picked.map((k) => (
											<th
												key={k}
												className="p-2.5 text-left font-display text-xs"
											>
												{rows.find((r) => r.key === k)?.name ?? k}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{comparison.map((row) => (
										<tr
											key={row.key}
											className="border-border border-b last:border-b-0"
										>
											<td className="p-2.5">
												<span className="font-mono text-[10px] uppercase tracking-wider text-muted">
													{tc(domainName.get(row.domain) ?? { en: row.domain })}
												</span>
												<br />
												{tc(row.name)}
											</td>
											{row.values.map((v, i) => (
												<td
													key={`${row.key}-${picked[i]}`}
													className="p-2.5"
													title={t(MARK[v].label)}
												>
													<span className={MARK[v].cls}>{MARK[v].glyph}</span>{" "}
													<span className="text-xs text-muted">
														{t(MARK[v].label)}
													</span>
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
						{comparison.length === 0 && (
							<p className="mt-2 max-w-2xl text-sm text-muted">
								{t("features.noDiff")}
							</p>
						)}
					</>
				)}
			</section>

			{/* The legend: all five states, each visually distinct — and `unknown`
			    deliberately a dash, never a circle a reader could take for `no`. */}
			<p className="panel mt-10 flex flex-wrap items-center gap-x-5 gap-y-1.5 p-4 text-muted text-xs">
				{FEATURE_VALUES.map((v) => (
					<span key={v}>
						<span className={MARK[v].cls}>{MARK[v].glyph}</span>{" "}
						{t(MARK[v].label)}
					</span>
				))}
			</p>
		</PageShell>
	);
}
