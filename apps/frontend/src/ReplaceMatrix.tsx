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
import { useEffect, useState } from "react";
import { bootFeatures, healthOf } from "./api";
import type { Key, Lang } from "./i18n";
import { GLYPH, TONE } from "./ProjectFeatures";

/**
 * Four columns at most. Some products cite a dozen alternatives, and a table
 * that wide is unreadable on a phone and unreadable on a desktop too. The ones
 * we know most about lead, because a column of dashes teaches nobody anything.
 */
const MAX_ALTS = 4;

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
	const alts = product.alternatives
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
		)
		.slice(0, MAX_ALTS);

	// One column cannot disagree with itself, and neither can a product we have
	// not checked — in both cases there is no comparison to publish.
	if (alts.length === 0 || decidedCount(file, product.slug) === 0) return null;

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
				<a href={paths.features(lang)} className="hover:underline">
					{t("features.compareLink")}
				</a>
			</p>

			<div className="mt-3 overflow-x-auto">
				<table className="w-full min-w-[30rem] border-collapse text-sm">
					<thead>
						<tr className="border-b text-left">
							<th className="py-2 pr-3 font-normal text-muted">
								{t("features.featureCol")}
							</th>
							<th className="px-2 py-2 text-center font-semibold">
								{product.name}
							</th>
							{alts.map((x) => (
								<th
									key={x.key}
									className="px-2 py-2 text-center font-normal text-muted"
								>
									{x.alt.name}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{rows.map((r) => (
							<tr key={r.key} className="border-b last:border-0">
								<td className="py-1.5 pr-3">{tc(r.name)}</td>
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
											{v === "unknown" ? (
												<span
													className="text-muted"
													title={t("features.val.unknown")}
												>
													–
												</span>
											) : (
												<span
													className={TONE[v]}
													title={t(`features.val.${v}`)}
												>
													{GLYPH[v]}
												</span>
											)}
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

			<p className="mt-2 text-[11px] text-muted">{t("features.legend")}</p>
		</section>
	);
}
