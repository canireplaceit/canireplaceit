/**
 * The feature matrix — what each open source project actually does, as a closed
 * vocabulary rather than free prose.
 *
 * `data/features.json` is generated (see canireplaceit-ops/annex) and carries
 * BOTH the vocabulary and the values, so a label can never drift out of step
 * with the values it labels. It is SPARSE: an absent key means `unknown`, which
 * is the default and is never the same as `no`.
 *
 * Keyed by `healthKey(source)`, the same key `data/health.json` uses — so a repo
 * mirrored under two forge paths resolves to one project here, and joining to a
 * `Project` needs no second identifier.
 */

import { healthKey, type Source } from "./content";
import type { Translations } from "./index";

/**
 * Five values, and the two at the ends carry most of the meaning.
 *
 *   yes      ships it, in the free/self-hosted build
 *   paid     exists, but not in the build you can run for free — the open-core tell.
 *            `auth.sso.saml: "paid"` IS the SSO tax, expressed as data.
 *   partial  present but materially limited
 *   no       somebody checked, and it genuinely does not do this
 *   unknown  nobody looked — the DEFAULT, and never rendered as `no`
 *
 * `no` vs `unknown` is the same distinction as `ssoInFree: false` vs `null`, for
 * the same reason: "we checked and it can't" is a fact a reader can act on,
 * "nobody checked" is a gap we owe them. Collapsing the two would let the site
 * assert 119k things nobody ever verified.
 */
export const FEATURE_VALUES = [
	"yes",
	"paid",
	"partial",
	"no",
	"unknown",
] as const;
export type FeatureValue = (typeof FEATURE_VALUES)[number];

export type FeatureDef = { key: string; name: Translations; note?: string };

export type FeatureDomain = {
	key: string;
	/**
	 * `crosscutting` applies to every project — auth, data, collab, ops.
	 * `vertical` only inside `appliesTo` categories: `notes.*` on a CRM is noise,
	 * not a missing feature, and rendering it as a gap would be a lie of omission.
	 */
	kind: "crosscutting" | "vertical";
	name: Translations;
	appliesTo?: string[];
	features: FeatureDef[];
};

export type FeatureFile = {
	taxonomyVersion: number;
	domains: FeatureDomain[];
	/** Sparse. Absent project, or absent key, both mean `unknown`. */
	projects: Record<string, Record<string, FeatureValue>>;
	/**
	 * The proprietary side, keyed by product slug — read off vendor pricing and
	 * plan pages, same vocabulary. Separate from `projects` because the two are
	 * different populations and the features page lists the open-source one; a
	 * product must be reachable for comparison without appearing in that list.
	 *
	 * The key spaces are disjoint: a product slug never contains `/`, a
	 * `healthKey` always does. So `featureValue` serves both with no discriminator
	 * and `compare` works across the divide, which is the point — Notion's
	 * `auth.sso.saml: paid` next to Docmost's `yes` IS the site's argument.
	 */
	products?: Record<string, Record<string, FeatureValue>>;
	/**
	 * Which plan a product fact sits on — "Business", "Enterprise", "$39/mo".
	 *
	 * This is the difference between "they charge for SSO", which is a complaint,
	 * and "they charge Business-plan money for SSO", which is evidence. Sparse and
	 * beside the values rather than inside them, so a value stays one string.
	 */
	productTiers?: Record<string, Record<string, string>>;
};

/** Every feature definition, flattened, in domain order. */
export function allFeatures(
	file: FeatureFile,
): (FeatureDef & { domain: string })[] {
	return file.domains.flatMap((d) =>
		d.features.map((f) => ({ ...f, domain: d.key })),
	);
}

export function featureName(
	file: FeatureFile,
	key: string,
): Translations | null {
	for (const d of file.domains)
		for (const f of d.features) if (f.key === key) return f.name;
	return null;
}

/** Whichever side the key belongs to. Disjoint spaces, so no discriminator. */
const row = (file: FeatureFile, key: string) =>
	file.projects[key] ?? file.products?.[key];

/** The default is `unknown`, and it is produced by absence rather than stored. */
export function featureValue(
	file: FeatureFile,
	projectKey: string,
	featureKey: string,
): FeatureValue {
	return row(file, projectKey)?.[featureKey] ?? "unknown";
}

/** The plan a product fact sits on, or null when none was recorded. */
export function featureTier(
	file: FeatureFile,
	productKey: string,
	featureKey: string,
): string | null {
	return file.productTiers?.[productKey]?.[featureKey] ?? null;
}

/** How many features this project has a decided answer for. Drives "thin" checks. */
export function decidedCount(file: FeatureFile, projectKey: string): number {
	return Object.keys(row(file, projectKey) ?? {}).length;
}

/**
 * Which domains are worth showing for a project, given the categories it is
 * cited in. Crosscutting always; a vertical only when the project actually sits
 * in one of its categories.
 */
export function domainsFor(
	file: FeatureFile,
	categories: readonly string[],
): FeatureDomain[] {
	const cats = new Set(categories);
	return file.domains.filter(
		(d) =>
			d.kind === "crosscutting" || (d.appliesTo ?? []).some((c) => cats.has(c)),
	);
}

/** `healthKey` is the join. Exported so callers never re-derive the rule. */
export const projectFeatureKey = (source: Source): string => healthKey(source);

/**
 * A requirement the reader typed into a filter: this feature, at least this good.
 *
 * `paid` deliberately satisfies a `yes` requirement only when the reader opted
 * in — someone filtering for SSO usually means "without paying", and silently
 * counting the paid tier is the exact dishonesty the `paid` value exists to
 * expose.
 */
export type Requirement = { key: string; acceptPaid?: boolean };

export function satisfies(v: FeatureValue, req: Requirement): boolean {
	if (v === "yes") return true;
	if (v === "paid") return req.acceptPaid === true;
	return false;
}

/** Projects meeting every requirement. Order is the caller's problem. */
export function matching(
	file: FeatureFile,
	requirements: readonly Requirement[],
): string[] {
	return Object.keys(file.projects).filter((p) =>
		requirements.every((r) => satisfies(featureValue(file, p, r.key), r)),
	);
}

export type CompareRow = {
	key: string;
	domain: string;
	name: Translations;
	/** One value per project, in the order the caller passed them. */
	values: FeatureValue[];
};

/**
 * The comparison matrix for two or more projects.
 *
 * `differingOnly` is the default and is the whole point: a table of rows where
 * every side agrees is not a comparison, it is padding — and the publication
 * gate for `/compare` counts differing rows, not rows.
 *
 * A row where every side is `unknown` is dropped even when "differing" is off.
 * Nobody checked is not a finding, and a matrix of blanks reads as a verdict.
 */
export function compare(
	file: FeatureFile,
	projectKeys: readonly string[],
	opts: {
		differingOnly?: boolean;
		categories?: readonly string[];
		/**
		 * Keep only rows where at least two sides have a DECIDED value.
		 *
		 * Without this, "differing" is dominated by decided-vs-unknown, which is a
		 * gap in our research rather than a difference between the products. Both
		 * are worth showing — but only one of them is a reason to pick A over B,
		 * and conflating them inflates the row count and flatters the dataset.
		 */
		bothCheckedOnly?: boolean;
	} = {},
): CompareRow[] {
	const differingOnly = opts.differingOnly ?? true;
	const domains = opts.categories
		? domainsFor(file, opts.categories)
		: file.domains;

	const rows: CompareRow[] = [];
	for (const d of domains) {
		for (const f of d.features) {
			const values = projectKeys.map((p) => featureValue(file, p, f.key));
			if (values.every((v) => v === "unknown")) continue;
			if (
				opts.bothCheckedOnly &&
				values.filter((v) => v !== "unknown").length < 2
			)
				continue;
			if (differingOnly && new Set(values).size === 1) continue;
			rows.push({ key: f.key, domain: d.key, name: f.name, values });
		}
	}
	return rows;
}

/**
 * A project plus the categories it is cited in. `Project` itself carries
 * `replaces` (the products) rather than categories, so the caller does that join
 * once and passes the result — core does not reach for the product table.
 */
export type Genred = { key: string; categories: readonly string[] };

/**
 * Projects sharing a category with this one — the set a comparison may draw
 * from. Comparing a note-taker with a VPN is not a comparison, and the pair
 * space must be bounded by the data rather than by multiplication: 871 projects
 * would otherwise be 758,370 ordered pairs.
 */
export function sameGenre<T extends Genred>(target: T, all: readonly T[]): T[] {
	const cats = new Set(target.categories);
	return all.filter(
		(p) => p.key !== target.key && p.categories.some((c) => cats.has(c)),
	);
}
