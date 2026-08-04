/**
 * The self-hosting plan: what a reader would run, and what it costs them to stay.
 *
 * This lives in core rather than in the page because two callers have to agree on
 * it — the estimate page computes the figure a reader sees, and `POST /api/quotes`
 * recomputes it server-side so a tampered client cannot inflate a lead. A second
 * implementation on either side is a number that disagrees with itself.
 *
 * Nothing here is authored. The default replacement is derived from the facts, the
 * arithmetic is derived from `pricing.basis`, and a product with no credible exit
 * derives that from its verdict.
 */

import type { OssAlternative, PriceSource, Product } from "./content";
import { EFFORT_RANK } from "./content";
import { kebab } from "./routes";

/**
 * What one product contributes to a MONTHLY total, in cents — or null when it
 * contributes nothing that can honestly be added up.
 *
 * `pricing.basis` exists precisely so this is not `price × seats`. Multiplying a
 * flat plan, a usage bill or a perpetual licence by the seat count is how a
 * calculator on a page about saving money produces a number its own audience can
 * disprove in ten seconds.
 *
 *   per-seat   × seats
 *   flat       × 1 — the plan costs what it costs however many people use it
 *   usage      × 1, and it is a FLOOR: the published figure is where the meter
 *              starts, not where the bill lands. Never multiplied by anything.
 *   custom     × 1, same reasoning: whatever was published is a starting point
 *   one-time   null — a perpetual licence is not a monthly cost. It is reported
 *              separately rather than smeared across twelve months, because the
 *              month you leave is the month it stops mattering.
 *
 * A missing `pricing` block cannot currently happen — every product carrying a
 * figure carries a receipt with it, and validation enforces the receipt — but
 * flat is the assumption that cannot inflate the total, so that is the fallback.
 */
export function monthlyCentsOf(
	product: { priceMonthly: number | null; pricing: PriceSource | null },
	seats: number,
): number | null {
	if (product.priceMonthly === null) return null;
	const cents = Math.round(product.priceMonthly * 100);
	const basis = product.pricing?.basis ?? "flat";
	if (basis === "one-time") return null;
	return basis === "per-seat" ? cents * Math.max(1, seats) : cents;
}

export type SpendGroup = { count: number; cents: number };

/**
 * A monthly total that shows its working.
 *
 * Every group is reported separately so the page can print the assumption beside
 * the figure instead of burying it in a caveat: how much of this moves with the
 * seat count, how much is a meter reading, and how many products are in the
 * selection but in no total at all.
 */
export type Spend = {
	seats: number;
	/** perSeat + flat + usage. The number a reader may quote at their finance team. */
	monthlyCents: number;
	perSeat: SpendGroup;
	flat: SpendGroup;
	/** Counted at the published starting figure. A floor, never a forecast. */
	usage: SpendGroup;
	/** Perpetual licences. Reported, never folded into the monthly figure. */
	oneTime: SpendGroup;
	/** Selected, but the vendor publishes no figure we could verify. In no total. */
	unpriced: number;
};

const EMPTY: SpendGroup = { count: 0, cents: 0 };

export function spendOf(
	products: {
		priceMonthly: number | null;
		pricing: PriceSource | null;
	}[],
	seats: number,
): Spend {
	const spend: Spend = {
		seats,
		monthlyCents: 0,
		perSeat: { ...EMPTY },
		flat: { ...EMPTY },
		usage: { ...EMPTY },
		oneTime: { ...EMPTY },
		unpriced: 0,
	};

	for (const product of products) {
		if (product.priceMonthly === null) {
			spend.unpriced++;
			continue;
		}
		const cents = Math.round(product.priceMonthly * 100);
		const basis = product.pricing?.basis ?? "flat";

		if (basis === "one-time") {
			spend.oneTime.count++;
			spend.oneTime.cents += cents;
			continue;
		}

		const group =
			basis === "per-seat"
				? spend.perSeat
				: basis === "usage"
					? spend.usage
					: spend.flat;
		const monthly = monthlyCentsOf(product, seats) ?? 0;
		group.count++;
		group.cents += monthly;
		spend.monthlyCents += monthly;
	}

	return spend;
}

/** Cheapest to actually run, first. */

/** How much of the product is withheld from the build you can run. */
const OPEN_CORE_RANK: Record<OssAlternative["facts"]["openCore"], number> = {
	none: 0,
	minor: 1,
	major: 2,
};

/**
 * The open source options we are willing to put in front of somebody.
 *
 * Empty for every product whose verdict is `not-yet`. Those files still carry
 * alternatives — that is how the verdict was reached — but offering one as "your
 * replacement" would be the exact dishonesty this site exists to refuse. The page
 * says there is no credible exit and leaves the bill where it is.
 *
 * Also drops anything whose own facts say it is not self-hostable, matching
 * `rungOf`: an "open source alternative" you cannot run is not an exit.
 */
export function replacements(product: Product): OssAlternative[] {
	if (product.verdict === "not-yet") return [];
	return product.alternatives.filter(
		(a): a is OssAlternative =>
			a.kind === "oss" && a.facts?.selfHostable !== false,
	);
}

/**
 * The one we pick for you: the least work to run, among the ones that are whole.
 *
 * `openCore` outranks effort deliberately. A managed tier of a build with the
 * useful half paywalled is not the easy option, it is the same subscription with
 * a different logo — so a fully open project you have to `docker compose up`
 * wins over a hosted open-core one. Compose and free SSO break the remaining
 * ties, and the name settles it so the default never depends on file order.
 */
export function defaultReplacement(product: Product): OssAlternative | null {
	const options = replacements(product);
	if (options.length === 0) return null;
	return [...options].sort(
		(a, b) =>
			OPEN_CORE_RANK[a.facts.openCore] - OPEN_CORE_RANK[b.facts.openCore] ||
			EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] ||
			Number(b.hasCompose ?? false) - Number(a.hasCompose ?? false) ||
			Number(b.facts.ssoInFree ?? false) - Number(a.facts.ssoInFree ?? false) ||
			a.name.localeCompare(b.name),
	)[0];
}

/**
 * How one choice is written down: the product slug, then the replacement.
 *
 * The replacement is keyed by the kebabbed NAME rather than by its index in the
 * file. An index is a link that silently starts meaning something else the day
 * somebody reorders an array — which happens on every pull request that adds an
 * alternative — and a shared plan has to survive that. A rename breaks the link
 * instead, which is rarer and fails visibly: the reader gets the default back.
 */
export const KEEP = "keep";

export type Choice = { slug: string; alt: string };

export const altId = (name: string): string => kebab(name);

/** `notion~appflowy,slack,jira~keep` */
export function encodePlan(choices: Choice[]): string {
	return choices.map((c) => (c.alt ? `${c.slug}~${c.alt}` : c.slug)).join(",");
}

export function decodePlan(value: string | null): Choice[] {
	if (!value) return [];
	const seen = new Set<string>();
	const out: Choice[] = [];
	for (const part of value.split(",")) {
		const [slug, alt = ""] = part.trim().split("~");
		if (!slug || seen.has(slug)) continue;
		seen.add(slug);
		out.push({ slug, alt });
	}
	return out;
}
