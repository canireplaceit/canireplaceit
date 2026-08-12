/**
 * The feature block on a project page.
 *
 * Renders nothing at all when we hold no data for the project — an empty
 * section headed "Features" reads as "this project has none", which is the
 * exact `no`/`unknown` confusion the whole vocabulary exists to prevent. 857 of
 * 871 projects are in that state today, so this is the common case, not the
 * edge one.
 *
 * Only decided values are shown. The link out to the explorer is what gives
 * that page an inbound path from the catalogue — without it, it is invisible.
 */

import { healthKey, type Source } from "core/src/content";
import type { FeatureFile, FeatureValue } from "core/src/features";
import { domainsFor, featureValue } from "core/src/features";
import type { Translations } from "core/src/index";
import { paths } from "core/src/routes";
import { useEffect, useState } from "react";
import { bootFeatures } from "./api";
import type { Key, Lang } from "./i18n";

export const GLYPH: Record<Exclude<FeatureValue, "unknown">, string> = {
	yes: "●",
	paid: "€",
	partial: "◐",
	no: "○",
};
export const TONE: Record<Exclude<FeatureValue, "unknown">, string> = {
	yes: "text-yes",
	paid: "text-almost",
	partial: "text-almost",
	no: "text-no",
};

export function ProjectFeatures({
	source,
	categories,
	lang,
	t,
	tc,
}: {
	source: Source;
	/** Categories of the products citing this project — gates the vertical domains. */
	categories: readonly string[];
	lang: Lang;
	t: (k: Key) => string;
	tc: (v: Translations) => string;
}) {
	/**
	 * Production reads the slice the page was prerendered with, so the block is
	 * in the static HTML and the first paint is complete — no layout shift, and
	 * crawlers and LLM answers can actually see the facts. Dev has no prerendered
	 * payload, so it falls back to importing the file after mount.
	 */
	const [file, setFile] = useState<FeatureFile | null>(() => bootFeatures());

	useEffect(() => {
		if (file) return;
		let live = true;
		import("../../../data/features.json")
			.then((m) => {
				if (live) setFile((m.default ?? m) as unknown as FeatureFile);
			})
			.catch(() => {
				/* The block is additive; a failed load leaves the page as it was. */
			});
		return () => {
			live = false;
		};
	}, [file]);

	if (!file) return null;
	const key = healthKey(source);
	if (!file.projects[key]) return null;

	const domains = domainsFor(file, categories)
		.map((d) => ({
			...d,
			decided: d.features
				.map((f) => ({ f, v: featureValue(file, key, f.key) }))
				.filter((x) => x.v !== "unknown"),
		}))
		.filter((d) => d.decided.length > 0);

	if (domains.length === 0) return null;
	const total = domains.reduce((n, d) => n + d.decided.length, 0);

	return (
		<section>
			<h2 className="font-display text-lg font-semibold">
				{t("features.onProject")}
			</h2>
			<p className="mt-1 text-sm text-muted">
				{total} {t("features.checked")} ·{" "}
				<a href={paths.features(lang)} className="hover:underline">
					{t("features.compareLink")}
				</a>
			</p>

			<div className="mt-3 space-y-3">
				{domains.map((d) => (
					<div key={d.key}>
						<h3 className="font-mono text-[11px] uppercase tracking-wider text-muted">
							{tc(d.name)}
						</h3>
						<ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
							{d.decided.map(({ f, v }) => (
								<li key={f.key} className="text-sm">
									<span
										className={TONE[v as Exclude<FeatureValue, "unknown">]}
										aria-hidden="true"
									>
										{GLYPH[v as Exclude<FeatureValue, "unknown">]}
									</span>{" "}
									<span className={v === "no" ? "text-muted" : undefined}>
										{tc(f.name)}
									</span>
									{v === "paid" && (
										<span className="ml-1 font-mono text-[10px] uppercase tracking-wider text-almost">
											{t("features.paidOnly")}
										</span>
									)}
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</section>
	);
}
