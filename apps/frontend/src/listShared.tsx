// The parts every list design shares: where sponsors sit, and how a row is labelled.

import { byWeight } from "core/src/collections";
import { priceState } from "core/src/content";
import { type ListedProduct, money, type Slot } from "./api";
import type { Key, Lang } from "./i18n";

export type ListProps = {
	products: ListedProduct[];
	slots: Slot[];
	lang: Lang;
	t: (k: Key) => string;
	tc: (v: { en: string }) => string;
};

export type Item =
	| { kind: "product"; p: ListedProduct }
	| { kind: "sponsor"; slot: Slot };

// Named rows rather than a modulo, so the gaps can widen (3, 3, 5, 7, 9, 11) to front-load slots the way attention
// decays down a list, and so the first slot can land at row 2. Matches CATEGORY_SLOTS_MAX in apps/backend/src/content.ts.
export const CATEGORY_SLOT_ROWS = [2, 5, 8, 13, 20, 29, 40] as const;

/** The widest gap in the table above — how far back `surroundingCategory` looks. */
const LOOKBACK = 11;

// One source of truth for the main column's width, shared by the filter bar, hero sponsors, list, pager, and indexes.
export const MEASURE = "max-w-6xl";

/** The category most of the rows around `i` belong to. */
function surroundingCategory(products: ListedProduct[], i: number): string {
	const tally = new Map<string, number>();
	for (let j = Math.max(0, i - LOOKBACK + 1); j <= i; j++)
		tally.set(products[j].category, (tally.get(products[j].category) ?? 0) + 1);
	let best = products[i].category;
	let most = 0;
	for (const [cat, n] of tally)
		if (n > most) {
			most = n;
			best = cat;
		}
	return best;
}

const SLOT_ROWS = new Set<number>(CATEGORY_SLOT_ROWS);

// Sponsors sit in the flow as rows of their own, matched to the category the surrounding rows belong to.
export function withSponsors(products: ListedProduct[], slots: Slot[]): Item[] {
	const byCategory = new Map<string, Slot[]>();
	for (const s of slots) {
		if (s.placement !== "category" || !s.category) continue;
		const list = byCategory.get(s.category);
		if (list) list.push(s);
		else byCategory.set(s.category, [s]);
	}
	for (const list of byCategory.values())
		list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

	// A slot appears at most once per render — inventory is finite, and repeating one would be padding, not inventory.
	const used = new Set<string>();
	const out: Item[] = [];
	products.forEach((p, i) => {
		out.push({ kind: "product", p });

		// Never as the final item — an advert after the last verdict reads as the list running out.
		if (i === products.length - 1) return;
		if (!SLOT_ROWS.has(i + 1)) return;

		const pool = byCategory.get(surroundingCategory(products, i));
		const slot = pool?.find((s) => !used.has(s.id));
		if (!slot) return;
		used.add(slot.id);
		out.push({ kind: "sponsor", slot });
	});
	return out;
}

// The one-line price for a list row. Null priceMonthly is not zero — it can mean usage/perpetual pricing, a vendor
// that publishes nothing, or nobody having checked, so each is named separately rather than defaulting to "free".
export const priceLabel = (
	p: ListedProduct,
	lang: Lang,
	t: (k: Key) => string,
) => {
	if (p.priceMonthly !== null) {
		return p.priceMonthly === 0
			? t("row.free")
			: `${money(p.priceMonthly * 100, lang)}${t("row.perMonth")}`;
	}
	if (priceState(p) === "no-price") return t("price.noPublic");
	return p.pricing
		? t(`price.basis.${p.pricing.basis}` as Key)
		: t("price.unverified");
};

/**
 * The products a product page links sideways to.
 *
 * Called by the prerenderer, not by a component: a product page ships only its
 * own entry, so the six neighbours it should link to are not in its payload and
 * cannot be derived in the browser. Same category, heaviest first.
 *
 * Trimmed to what `ProductCard` actually prints, which is the name, the price,
 * the verdict and HOW MANY open source alternatives there are — never one of
 * them. So each alternative travels as its `kind` and nothing else: the four
 * fields a card never reads are 5.9 kB of a 7.1 kB entry, and this rides on all
 * 1,184 product documents. The cast is the price of keeping `ProductCard` on one
 * type; nothing downstream of `ctx.related` reads any other field.
 */
export const relatedProducts = (
	all: ListedProduct[],
	product: ListedProduct,
	limit = 6,
): ListedProduct[] =>
	byWeight(
		all.filter(
			(p) => p.category === product.category && p.slug !== product.slug,
		),
	)
		.slice(0, limit)
		.map((p) => ({
			...p,
			alternatives: p.alternatives.map(
				(a) => ({ kind: a.kind }) as (typeof p.alternatives)[number],
			),
		}));
