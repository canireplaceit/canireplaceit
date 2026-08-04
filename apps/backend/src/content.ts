/**
 * Content lives in git, not in the database. This reads `data/` once at boot and
 * keeps it in memory — the whole dataset is a few hundred KB, and a deploy is how
 * content ships. Validation failures are fatal on purpose: CI already ran the same
 * check on the PR, so a bad file here means something went wrong after review.
 */

import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
	type Category,
	type OssAlternative,
	type Product,
	projectSlug,
	validateCategory,
	validateProduct,
} from "core/src/content";
import type { Translations } from "core/src/index";
import { env } from "./env";

export type SlotDef = {
	id: string;
	placement: "hero" | "rail" | "category";
	/** Rail slots only: which side, and how far down. Position 1 is the top. */
	rail?: "left" | "right";
	position?: number;
	label: Translations;
	/**
	 * USD cents per 30-day run. One price per slot: the open source discount that
	 * used to sit beside it is gone, because it made every price on the site a
	 * question ("which one am I?") instead of an answer, and it cost a manual
	 * verification step at approval to police a rate nobody could self-serve.
	 * Longer terms are the discount now — see core/src/sponsorship.ts.
	 *
	 * Null when the owner has not priced the position yet. That is a real state
	 * and not a missing field: hero positions 4–10 exist as inventory before
	 * anyone has decided what they cost. `priceBasket` refuses to sell one, so a
	 * null can never reach an invoice.
	 */
	priceCents: number | null;
	category?: string;
	/** Category slots only: the category's display name, for grouping in the UI. */
	categoryName?: Translations;
};

/**
 * Category slots are inserted into the list itself at the rows named by
 * `CATEGORY_SLOT_ROWS` in `listShared.withSponsors`. So the number a category
 * needs is roughly how many of those insertion points its own filtered list
 * reaches — one per eight products — plus one, so the unfiltered list can draw a
 * second distinct slot for a category a reader passes twice.
 *
 * Floor of 2 keeps a one-product category sellable; the cap stops a large
 * category turning into a wall of ads. The cap matches the length of
 * `CATEGORY_SLOT_ROWS`: minting a seventh slot for a category whose list has
 * only six insertion points would create inventory that can never render.
 */
const CATEGORY_SLOTS_MIN = 2;
const CATEGORY_SLOTS_MAX = 7;
const categorySlotCount = (products: number) =>
	Math.min(
		CATEGORY_SLOTS_MAX,
		Math.max(CATEGORY_SLOTS_MIN, 1 + Math.ceil(products / 8)),
	);

/**
 * Price band, derived from the only real signal we have: how many products the
 * category holds. More products means more rows, more insertion points and more
 * reasons to land on that filter — `networking-vpn` at 23 products is not
 * `agriculture` at 2, and a flat $200 priced both the same. No traffic numbers
 * are invented; product count is a fact in `data/`.
 *
 * Later positions decay 20% each, exactly as the rails do, rounded to the
 * nearest $5 so the number reads like a price.
 */
const CATEGORY_PRICE_BASE = 15000;
const CATEGORY_PRICE_PER_PRODUCT = 1500;
const CATEGORY_PRICE_CAP = 45000;
const round5 = (cents: number) => Math.round(cents / 500) * 500;

const categoryPriceCents = (products: number, position: number) =>
	round5(
		Math.min(
			CATEGORY_PRICE_CAP,
			CATEGORY_PRICE_BASE + products * CATEGORY_PRICE_PER_PRODUCT,
		) *
			0.8 ** (position - 1),
	);

const DATA = env.contentDir ?? join(import.meta.dir, "../../../data");

const read = <T>(path: string): T =>
	JSON.parse(readFileSync(path, "utf8")) as T;

function load() {
	const categories = read<Category[]>(join(DATA, "categories.json"));
	const catSlugs = new Set(categories.map((c) => c.slug));
	categories.forEach((c, i) => {
		const issues = validateCategory(c, i);
		if (issues.length)
			throw new Error(
				`categories.json ${issues[0].path}: ${issues[0].message}`,
			);
	});

	const dir = join(DATA, "products");
	const products = readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			const value = read<Product>(join(dir, f));
			const issues = validateProduct(value, basename(f, ".json"), catSlugs);
			if (issues.length)
				throw new Error(`${f} ${issues[0].path}: ${issues[0].message}`);
			return value;
		});

	const slots = read<SlotDef[]>(join(DATA, "sponsors/slots.json"));

	// Sponsor slots per category, generated rather than hand-listed so a new
	// category automatically brings its own inventory with it. How many, and at
	// what price, both follow the category's product count.
	const productsPerCategory = new Map<string, number>();
	for (const p of products)
		productsPerCategory.set(
			p.category,
			(productsPerCategory.get(p.category) ?? 0) + 1,
		);

	for (const c of categories) {
		const n = productsPerCategory.get(c.slug) ?? 0;
		const name = { en: c.name.en, fr: c.name.fr ?? c.name.en };
		for (let position = 1; position <= categorySlotCount(n); position++) {
			const priceCents = categoryPriceCents(n, position);
			slots.push({
				id: `category-${c.slug}-${position}`,
				placement: "category",
				category: c.slug,
				categoryName: name,
				position,
				label: {
					en: `${name.en} — slot ${position}`,
					fr: `${name.fr} — emplacement ${position}`,
				},
				priceCents,
			});
		}
	}

	return { categories, products, slots };
}

export const content = load();

/**
 * product slug -> the project slugs it actually lists.
 * Votes are validated against this so the counter cannot be used to write
 * arbitrary strings into the database.
 */
export const projectsByProduct = new Map<string, Set<string>>(
	content.products.map((p) => [
		p.slug,
		new Set(
			p.alternatives
				.filter((a) => a.kind === "oss")
				.map((a) => projectSlug((a as OssAlternative).source)),
		),
	]),
);
export const slotById = new Map(content.slots.map((s) => [s.id, s]));

/** Human name for a slot; falls back to the raw id for inventory that no longer exists. */
export const slotLabel = (slotId: string): string =>
	slotById.get(slotId)?.label.en ?? slotId;

/** Total tracked monthly spend across every priced product, in USD cents. */
export const trackedSpendCents = content.products.reduce(
	(sum, p) => sum + Math.round((p.priceMonthly ?? 0) * 100),
	0,
);
