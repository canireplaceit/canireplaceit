/** Lock-in terms. Prices in `data/sponsors/slots.json` are the 30-day rate; a longer term is paid up front and discounted for it. */

export type SponsorTerm = { months: number; multiplier: number };

export const SPONSOR_TERMS: readonly SponsorTerm[] = [
	{ months: 1, multiplier: 1 },
	{ months: 3, multiplier: 2.64 }, // 12% off
	{ months: 12, multiplier: 9 }, // 25% off — effectively 3 months free
];

export const termFor = (months: number): SponsorTerm | undefined =>
	SPONSOR_TERMS.find((t) => t.months === months);

export const isTerm = (months: number): boolean =>
	termFor(months) !== undefined;

/** How much a term saves against paying month by month, as a whole percent. */
export const discountPct = (term: SponsorTerm): number =>
	Math.round((1 - term.multiplier / term.months) * 100);

/** Rounded to the nearest dollar, so a quarter never quotes $2,967.30. */
export const priceForTerm = (rateCents: number, months: number): number =>
	Math.round((rateCents * (termFor(months)?.multiplier ?? months)) / 100) * 100;

/** One of each placement kind per order. */
export const PLACEMENT_LIMITS: Record<string, number> = {
	rail: 1,
	hero: 1,
	category: 1,
};

// Written out rather than derived from PLACEMENT_LIMITS so the two can't silently drift; a test asserts they match.
export const ORDER_MAX_SLOTS = 3;

/** False for placements the site renders but does not sell (absent from PLACEMENT_LIMITS). */
export const isSellable = (placement: string): boolean =>
	placement in PLACEMENT_LIMITS;

export const limitFor = (placement: string): number =>
	PLACEMENT_LIMITS[placement] ?? 0;

// Term multiplier applies to the basket total once, not per slot, so per-slot rounding can't drift the checkout total from the quote.
export const orderTotalCents = (
	rateCents: number[],
	months: number,
): number => {
	const base = rateCents.reduce((n, c) => n + c, 0);
	return base === 0 ? 0 : priceForTerm(base, months);
};

/** What the same basket would cost month by month, so the saving is visible. */
export const orderUndiscountedCents = (
	rateCents: number[],
	months: number,
): number => rateCents.reduce((n, c) => n + c, 0) * months;

// Largest-remainder allocation: splits the total across slots in whole dollars, summing to exactly totalCents.
export function allocate(rateCents: number[], totalCents: number): number[] {
	const base = rateCents.reduce((n, c) => n + c, 0);
	if (rateCents.length === 0) return [];
	if (base === 0) return rateCents.map(() => 0);

	const dollars = Math.round(totalCents / 100);
	const exact = rateCents.map((c) => (c / base) * dollars);
	const floors = exact.map(Math.floor);
	let left = dollars - floors.reduce((n, c) => n + c, 0);

	// Biggest fractional part first; ties go to the more expensive slot.
	const order = exact
		.map((v, i) => ({ i, frac: v - Math.floor(v), rate: rateCents[i] }))
		.sort((a, b) => b.frac - a.frac || b.rate - a.rate);

	const out = [...floors];
	for (const { i } of order) {
		if (left <= 0) break;
		out[i] += 1;
		left -= 1;
	}
	return out.map((d) => d * 100);
}

/** The run length one term month buys. Slot prices are the 30-day rate. */
export const DAYS_PER_TERM_MONTH = 30;

/** When a run starting now would end. Expiry always follows from the term. */
export const endOfTerm = (start: Date, months: number): Date =>
	new Date(start.getTime() + months * DAYS_PER_TERM_MONTH * 86_400_000);
