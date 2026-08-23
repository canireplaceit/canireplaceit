/**
 * The product page's head-to-head: the proprietary product in the first column,
 * its open source alternatives beside it, one row per feature they disagree on.
 *
 * This is the site's argument rendered as data rather than prose. A row reading
 * `€ / ● / ●` says the vendor charges for something two alternatives ship free,
 * and that is a fact a reader can act on — unlike a paragraph asserting it.
 *
 * Renders nothing unless at least two columns have decided values and at least
 * one row differs. A matrix of blanks reads as a verdict, and we have no verdict
 * to give for a product nobody has checked yet.
 */

import { openness, opennessRank } from "core/src/collections";
import type { OssAlternative, Product } from "core/src/content";
import { EFFORT_RANK, healthKey, isArchived } from "core/src/content";
import type { FeatureFile } from "core/src/features";
import { compare, decidedCount, featureTier } from "core/src/features";
import type { Translations } from "core/src/index";
import { paths } from "core/src/routes";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { bootFeatures, healthOf } from "./api";
import type { Key, Lang } from "./i18n";
import { GLYPH, TONE } from "./ProjectFeatures";

/**
 * Five columns at most, beside the product itself.
 *
 * Six columns is what fits before a table stops being readable — on a phone it
 * scrolls sideways with a stuck first column, which is fine, and past six the
 * eye cannot hold a row. Which five is the reader's choice; the default is the
 * five best exits, not the five we happen to know most about.
 */
const MAX_ALTS = 5;

export function ReplaceMatrix({
	product,
	lang,
	t,
	tc,
}: {
	product: Product;
	lang: Lang;
	t: (k: Key) => string;
	tc: (v: Translations) => string;
}) {
	// Same two-source pattern as ProjectFeatures: prerendered slice in production,
	// a lazy import in dev where no boot payload exists.
	const [file, setFile] = useState<FeatureFile | null>(() => bootFeatures());
	/**
	 * Which columns the reader wants, or null while they have not said.
	 *
	 * The picker is the mechanic `FeaturesPage` already has (a `picked` array and
	 * a toggle) — it just started empty on a page nobody lands on, while this
	 * page rendered a fixed four with no way to change them.
	 */
	const [picked, setPicked] = useState<string[] | null>(null);

	useEffect(() => {
		if (file) return;
		let live = true;
		import("../../../data/features.json")
			.then((m) => {
				if (live) setFile((m.default ?? m) as unknown as FeatureFile);
			})
			.catch(() => {
				/* Additive block; a failed load leaves the page as it was. */
			});
		return () => {
			live = false;
		};
	}, [file]);

	if (!file) return null;

	/**
	 * Columns are picked by how good an exit the alternative is, not by how much
	 * we happen to know about it.
	 *
	 * Sorting on `decidedCount` alone answered a different question — "which
	 * projects has someone filled in a form about" — and on the Claude Code page
	 * it produced a table whose four columns did not include opencode, the entry
	 * the page's own prose calls "the most direct equivalent". Least work first,
	 * then most open, and decided-count only as the tie-break it should always
	 * have been. Archived projects sort last: a dead project is not a comparison
	 * a reader can act on.
	 */
	const candidates = product.alternatives
		.filter((a): a is OssAlternative => a.kind === "oss")
		.map((a) => ({ alt: a, key: healthKey(a.source) }))
		.filter((x) => decidedCount(file, x.key) > 0)
		.sort(
			(a, b) =>
				Number(isArchived(a.alt, healthOf(a.alt.source))) -
					Number(isArchived(b.alt, healthOf(b.alt.source))) ||
				EFFORT_RANK[a.alt.effort] - EFFORT_RANK[b.alt.effort] ||
				opennessRank(openness(b.alt)) - opennessRank(openness(a.alt)) ||
				decidedCount(file, b.key) - decidedCount(file, a.key),
		);

	// One column cannot disagree with itself, and neither can a product we have
	// not checked — in both cases there is no comparison to publish.
	if (candidates.length === 0 || decidedCount(file, product.slug) === 0) {
		return null;
	}

	const defaults = candidates.slice(0, MAX_ALTS).map((x) => x.key);
	// `picked === null` means "nobody has touched it", which is different from
	// "the reader removed every column" — the second must render an empty table
	// with the add-list under it rather than silently resetting to the default.
	const chosen = picked ?? defaults;
	const alts = chosen
		.map((k) => candidates.find((c) => c.key === k))
		.filter((x): x is (typeof candidates)[number] => x !== undefined);
	const rest = candidates.filter((c) => !chosen.includes(c.key));

	const keys = [product.slug, ...alts.map((x) => x.key)];
	const rows = compare(file, keys, {
		differingOnly: true,
		bothCheckedOnly: true,
		categories: [product.category],
	})
		/**
		 * The vendor's own cell must be decided. `bothCheckedOnly` is satisfied by
		 * any two columns, which on measurement left 77% of rows as
		 * alternative-vs-alternative differences with a dash in the first column —
		 * true, but not the question this page asks, and a lead column of dashes
		 * reads as "nobody knows what you are paying for".
		 */
		.filter((r) => r.values[0] !== "unknown")
		/**
		 * A row has to teach the reader something. `differingOnly` counts a row as
		 * differing if ANY two columns differ, which the vendor's own cell satisfies
		 * on its own — so the Claude Code table published
		 *
		 *   Has AI features   € Pro   ●   ●   ●   ●
		 *
		 * on a page comparing AI coding agents. Every alternative says yes; the row
		 * is noise dressed as a finding.
		 *
		 * Two rows are worth printing, and no others:
		 *   1. the alternatives disagree with each other — a real choice to make;
		 *   2. they all agree AND the vendor charges for it — the site's whole
		 *      argument, and the one case where unanimity IS the point.
		 */
		.filter((r) => {
			const alternativeCells = r.values.slice(1);
			const decided = alternativeCells.filter((v) => v !== "unknown");
			if (decided.length === 0) return false;
			const theyDisagree = new Set(decided).size > 1;
			if (theyDisagree) return true;
			/**
			 * They all agree. That is only worth a row when the vendor charges for
			 * it — EXCEPT where the feature is the category itself.
			 *
			 * The feature keys are `domain.thing`, and when the domain is the
			 * product's own category the feature is definitional rather than
			 * distinguishing. Claude Code gating `ai.features` behind Pro is not a
			 * finding, it is what an AI product is; the row read
			 *
			 *   Has AI features   € Pro   ●   ●   ●   ●
			 *
			 * on a page whose every column is an AI coding agent. Notion gating
			 * `auth.sso.saml` IS a finding, because SAML is not what a notes app is.
			 */
			const domain = r.key.split(".")[0] ?? "";
			const definitional =
				product.category === domain ||
				product.category.startsWith(`${domain}-`);
			return (
				!definitional &&
				r.values[0] === "paid" &&
				decided.every((v) => v === "yes")
			);
		});
	if (rows.length === 0) return null;

	return (
		<section>
			<h2 className="font-display font-semibold text-lg">
				{t("features.vsHeading")}
			</h2>
			<p className="mt-1 text-muted text-sm">
				{t("features.vsBlurb")} ·{" "}
				{/* Carries the columns across. The features page already reads `cmp`
				    on load and already writes it when you pick — this link was the
				    one path in that dropped the selection, landing the reader on 137
				    features with nothing chosen and no way back to what they were
				    just looking at. */}
				{/* Named, not an arrow. This link was 2,633 of the 3,384 inbound
				    links to the feature explorer and every one of them said "compare
				    with others →" — the textbook generic-anchor-at-scale pattern,
				    3,384 chances to say what that page is spent on a glyph. The
				    count is `candidates`, not the columns on screen: the reader can
				    add and remove columns, and anchor text must not move when they
				    do. */}
				<a
					href={`${paths.features(lang)}?cmp=${encodeURIComponent(keys.join(","))}`}
					className="hover:underline"
				>
					{t("features.compareProduct")
						.replace("{name}", product.name)
						.replace("{n}", String(candidates.length))}
				</a>
			</p>

			{/*
			 * `relative` is load-bearing, not decoration.
			 *
			 * `.sr-only` is `position: absolute`, and a STATIC scroll container is
			 * not a containing block — so every sr-only span in this table resolved
			 * against the initial containing block, kept the wide table's x offset,
			 * and escaped the clip. The box scrolled correctly and the DOCUMENT grew
			 * anyway: `documentElement.scrollWidth` measured 474 on /notion/ and 594
			 * on /1password/ at a 390px viewport, which is a phone page that slides
			 * sideways. Making the scroller a containing block puts them back inside
			 * it; measured 390 at 360, 390 and 414 after.
			 */}
			<div className="relative mt-3 overflow-x-auto">
				<table className="w-full min-w-[30rem] border-collapse text-sm">
					{/* Google's table extraction keys on caption + th, and the visible
					    heading above the table is not one. sr-only so the block looks
					    exactly as it did. */}
					<caption className="sr-only">
						{t("features.vsHeading")} —{" "}
						{[product.name, ...alts.map((x) => x.alt.name)].join(", ")}
					</caption>
					<thead>
						<tr className="border-b text-left">
							<th scope="col" className="py-2 pr-3 font-normal text-muted">
								{t("features.featureCol")}
							</th>
							<th scope="col" className="px-2 py-2 text-center font-semibold">
								{product.name}
							</th>
							{alts.map((x) => (
								// `aria-labelledby` so the column is named by the project and
								// nothing else. The remove control is a button inside the header
								// cell, and a button's `aria-label` joins the cell's own name
								// computation -- so every data cell in the column announced its
								// header as "Remove column: Trilium" rather than "Trilium".
								<th
									key={x.key}
									scope="col"
									aria-labelledby={`cmp-col-${x.key}`}
									className="px-2 py-2 text-center font-normal text-muted"
								>
									<button
										type="button"
										onClick={() => setPicked(chosen.filter((k) => k !== x.key))}
										aria-label={`${t("features.removeColumn")}: ${x.alt.name}`}
										className="inline-flex items-center gap-1 hover:text-text"
									>
										<span id={`cmp-col-${x.key}`}>{x.alt.name}</span>
										<X className="size-3 shrink-0 opacity-50" aria-hidden />
									</button>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.key} className="border-b last:border-0">
								<th scope="row" className="py-1.5 pr-3 text-left font-normal">
									{tc(r.name)}
								</th>
								{r.values.map((v, i) => {
									// Only the vendor column carries a plan name; the alternatives
									// are open source and have no tiers to name.
									const tier =
										i === 0 ? featureTier(file, keys[0], r.key) : null;
									return (
										<td
											// The feature key and the column index together are the
											// cell's identity; the value is not unique down a row.
											key={`${r.key}:${keys[i]}`}
											className="px-2 py-1.5 text-center"
										>
											{/*
											 * The glyph is decoration. `title` is read by neither
											 * Google nor a screen reader on a non-interactive
											 * span, so the answer travels beside it as real text
											 * — the treatment `ProjectFeatures` has always had,
											 * and which this table never got. Without it a whole
											 * row indexed as "● – ● – €".
											 */}
											<span
												className={v === "unknown" ? "text-muted" : TONE[v]}
												aria-hidden="true"
												title={t(`features.val.${v}`)}
											>
												{v === "unknown" ? "–" : GLYPH[v]}
											</span>
											<span className="sr-only">{t(`features.val.${v}`)}</span>
											{tier && (
												<span className="mt-0.5 block font-mono text-[10px] text-muted leading-tight">
													{tier}
												</span>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* The rest of the alternatives we know anything about, as one click
			    each. Capped at MAX_ALTS: past six columns a row stops being
			    readable, so adding is disabled rather than silently dropping
			    somebody else's column out from under the reader. */}
			{rest.length > 0 && (
				<div className="mt-3">
					<p className="eyebrow">{t("features.addColumn")}</p>
					<ul className="mt-1.5 flex flex-wrap gap-1.5">
						{rest.map((x) => (
							<li key={x.key}>
								<button
									type="button"
									disabled={alts.length >= MAX_ALTS}
									onClick={() => setPicked([...chosen, x.key])}
									className="pill disabled:cursor-not-allowed disabled:opacity-40"
								>
									{x.alt.name}
								</button>
							</li>
						))}
					</ul>
					{alts.length >= MAX_ALTS && (
						<p className="mt-1.5 text-[11px] text-muted">
							{t("features.columnLimit").replace("{n}", String(MAX_ALTS))}
						</p>
					)}
				</div>
			)}

			<p className="mt-2 text-[11px] text-muted">{t("features.legend")}</p>
		</section>
	);
}
