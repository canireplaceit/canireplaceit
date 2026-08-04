/**
 * The ad numbers are shown to advertisers as a reason to pay, so the filter in
 * front of them is the part that gets tested — not the arithmetic.
 *
 *   bun test apps/backend/tests/ad-analytics.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
	allocate,
	discountPct,
	endOfTerm,
	isSellable,
	isTerm,
	limitFor,
	ORDER_MAX_SLOTS,
	orderTotalCents,
	orderUndiscountedCents,
	PLACEMENT_LIMITS,
	priceForTerm,
	SPONSOR_TERMS,
} from "core/src/sponsorship";
import {
	AD_TRUST_THRESHOLD,
	type AdSignals,
	isCrawler,
	isPrerender,
	NETWORK_HOURLY_EVENT_LIMIT,
	scoreAdEvent,
} from "../src/vote-identity";

const signals = (over: Partial<AdSignals> = {}): AdSignals => ({
	crawler: false,
	prerender: false,
	datacenter: false,
	noSession: false,
	networkEventsThisHour: 0,
	clientEventsThisHour: 0,
	...over,
});

const counted = (s: AdSignals) => scoreAdEvent(s).trust >= AD_TRUST_THRESHOLD;

describe("crawler detection", () => {
	test("a normal browser is not a crawler", () => {
		expect(
			isCrawler({
				"user-agent":
					"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
			}),
		).toBe(false);
	});

	test.each([
		"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
		"Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0 Safari/537.36",
		"curl/8.5.0",
		"python-requests/2.32.3",
		"Mozilla/5.0 (compatible; ClaudeBot/1.0)",
		"Mozilla/5.0 (compatible; AhrefsBot/7.0)",
	])("%s is a crawler", (ua) => {
		expect(isCrawler({ "user-agent": ua })).toBe(true);
	});

	test("no user agent at all is treated as a crawler", () => {
		// Every real browser sends one. A client that does not is not an audience.
		expect(isCrawler({})).toBe(true);
	});
});

describe("prerender detection", () => {
	test.each([
		{ "sec-purpose": "prefetch;prerender" },
		{ purpose: "prefetch" },
		{ "x-moz": "prefetch" },
	])("%o is speculative", (headers) => {
		expect(isPrerender(headers)).toBe(true);
	});

	test("a normal navigation is not", () => {
		expect(isPrerender({ "sec-fetch-mode": "navigate" })).toBe(false);
	});
});

describe("scoring", () => {
	test("an ordinary reader counts", () => {
		expect(counted(signals())).toBe(true);
	});

	/**
	 * The three hard zeros. Unlike a vote — where a doubtful reader is still worth
	 * counting at reduced weight — there is no weight at which a crawler is an
	 * audience, so these discard rather than dampen.
	 */
	test.each(["crawler", "prerender", "datacenter"] as const)(
		"%s is discarded outright",
		(flag) => {
			const scored = scoreAdEvent(signals({ [flag]: true }));
			expect(scored.trust).toBe(0);
			expect(scored.reasons).toContain(
				flag === "datacenter" ? "datacenter-network" : flag,
			);
		},
	);

	test("a crawler never consumes a budget it could inflate", () => {
		// Reasons are exclusive: a crawler is rejected before volume is considered,
		// so a busy bot can never make real traffic on its network look busy.
		expect(scoreAdEvent(signals({ crawler: true })).reasons).toEqual([
			"crawler",
		]);
	});

	test("missing session cookie dampens but still counts", () => {
		const scored = scoreAdEvent(signals({ noSession: true }));
		expect(scored.reasons).toContain("no-session");
		expect(scored.trust).toBeGreaterThanOrEqual(AD_TRUST_THRESHOLD);
	});

	test("a network past the hourly limit stops counting", () => {
		expect(
			counted(signals({ networkEventsThisHour: NETWORK_HOURLY_EVENT_LIMIT })),
		).toBe(false);
	});

	test("a busy office is dampened, not cut off", () => {
		expect(
			counted(
				signals({ networkEventsThisHour: NETWORK_HOURLY_EVENT_LIMIT / 2 }),
			),
		).toBe(true);
	});

	test("busy network plus no session lands exactly on the threshold", () => {
		// The deliberate boundary. Neither signal alone is damning and both are
		// ordinary for a large office with cookies off, so the pair is believed —
		// but only just, and one more signal tips it out.
		const scored = scoreAdEvent(
			signals({
				networkEventsThisHour: NETWORK_HOURLY_EVENT_LIMIT / 2,
				noSession: true,
			}),
		);
		expect(scored.trust).toBe(AD_TRUST_THRESHOLD);
		expect(
			counted(
				signals({
					networkEventsThisHour: NETWORK_HOURLY_EVENT_LIMIT,
					noSession: true,
				}),
			),
		).toBe(false);
	});

	test("trust never goes below zero", () => {
		const scored = scoreAdEvent(
			signals({
				networkEventsThisHour: 10_000,
				clientEventsThisHour: 10_000,
				noSession: true,
			}),
		);
		expect(scored.trust).toBe(0);
	});
});

describe("lock-in terms", () => {
	test("only 1, 3 and 12 are sellable", () => {
		expect(SPONSOR_TERMS.map((t) => t.months)).toEqual([1, 3, 12]);
		expect(isTerm(6)).toBe(false);
		expect(isTerm(12)).toBe(true);
	});

	test("one month is the undiscounted 30-day rate", () => {
		expect(priceForTerm(149900, 1)).toBe(149900);
		expect(discountPct(SPONSOR_TERMS[0])).toBe(0);
	});

	test("longer terms are cheaper per month, and say by how much", () => {
		expect(discountPct(SPONSOR_TERMS[1])).toBe(12);
		expect(discountPct(SPONSOR_TERMS[2])).toBe(25);
		// Always cheaper than paying month by month, never more expensive.
		for (const term of SPONSOR_TERMS) {
			expect(priceForTerm(149900, term.months)).toBeLessThanOrEqual(
				149900 * term.months,
			);
		}
	});

	test("a quote is always whole dollars", () => {
		for (const term of SPONSOR_TERMS) {
			expect(priceForTerm(89900, term.months) % 100).toBe(0);
		}
	});

	test("expiry follows from the term and nothing else, per slot", () => {
		const start = new Date("2026-01-01T00:00:00Z");
		expect(endOfTerm(start, 1).toISOString().slice(0, 10)).toBe("2026-01-31");
		expect(endOfTerm(start, 3).toISOString().slice(0, 10)).toBe("2026-04-01");
		expect(endOfTerm(start, 12).toISOString().slice(0, 10)).toBe("2026-12-27");
	});
});

/**
 * The basket maths. This is the part that costs trust if it is wrong: a total
 * that disagrees with the sum of its own lines, on a page asking for four
 * figures.
 */
describe("orders", () => {
	/** A realistic mixed basket: three categories plus one rail position. */
	const BASKET = [109900, 22500, 18000, 15500];
	const sum = (xs: number[]) => xs.reduce((n, c) => n + c, 0);

	const BASKETS = [
		BASKET,
		[199900],
		[15000, 15000, 15000],
		// Three equal shares of a total that does not divide by three: the
		// classic allocation trap.
		[10000, 10000, 10000],
		[89900, 7500],
		Array.from({ length: 40 }, (_, i) => 5000 + i * 500),
	];

	test("the term is applied to the basket total, once", () => {
		expect(orderTotalCents(BASKET, 3)).toBe(priceForTerm(sum(BASKET), 3));
		// A one-month order is the plain sum: no multiplier, no rounding to do.
		expect(orderTotalCents(BASKET, 1)).toBe(sum(BASKET));
	});

	/**
	 * The bug this design exists to prevent. `priceForTerm` rounds to a whole
	 * dollar, so discounting each slot separately rounds once per line and the
	 * errors do not cancel — the checkout would then charge something other than
	 * the number the buyer was looking at.
	 */
	test("the total is the discounted sum, not the sum of discounted parts", () => {
		for (const term of SPONSOR_TERMS) {
			for (const basket of BASKETS) {
				expect(orderTotalCents(basket, term.months)).toBe(
					priceForTerm(sum(basket), term.months),
				);
			}
		}
	});

	test("a basket where the two disagree is priced from the total", () => {
		// 12 months x9: each line ends in $50, so per-slot rounding moves each one
		// up half a dollar and the naive sum lands $2 above the real total.
		const basket = [5050, 5050, 5050, 5050];
		const perSlot = sum(basket.map((c) => priceForTerm(c, 12)));
		const total = orderTotalCents(basket, 12);
		expect(perSlot).not.toBe(total);
		expect(total).toBe(priceForTerm(sum(basket), 12));
		// And the lines still reconcile with the total that was quoted.
		expect(sum(allocate(basket, total))).toBe(total);
	});

	test("line items always sum to exactly the order total", () => {
		for (const term of SPONSOR_TERMS) {
			for (const basket of BASKETS) {
				const total = orderTotalCents(basket, term.months);
				const lines = allocate(basket, total);
				expect(sum(lines)).toBe(total);
				// Whole dollars, so an invoice line never shows stray cents.
				expect(lines.every((c) => c % 100 === 0)).toBe(true);
				expect(lines.every((c) => c >= 0)).toBe(true);
				expect(lines).toHaveLength(basket.length);
			}
		}
	});

	test("shares track the slots' relative value", () => {
		const rates = [100000, 50000];
		const total = orderTotalCents(rates, 12);
		const [big, small] = allocate(rates, total);
		expect(big).toBeGreaterThan(small);
		expect(big + small).toBe(total);
	});

	test("an empty basket is priced at nothing rather than crashing", () => {
		expect(orderTotalCents([], 3)).toBe(0);
		expect(allocate([], 0)).toEqual([]);
	});

	test("the undiscounted comparison is the honest month-by-month figure", () => {
		expect(orderUndiscountedCents(BASKET, 12)).toBe(sum(BASKET) * 12);
		// A longer term must always beat paying monthly, or the discount is a lie.
		for (const term of SPONSOR_TERMS) {
			expect(orderTotalCents(BASKET, term.months)).toBeLessThanOrEqual(
				orderUndiscountedCents(BASKET, term.months),
			);
		}
	});

	test("one of each kind", () => {
		expect(limitFor("rail")).toBe(1);
		expect(limitFor("hero")).toBe(1);
		expect(limitFor("category")).toBe(1);
	});

	test("the per-placement caps sum to the order cap", () => {
		// If this stops holding, one was changed without the other and a buyer can
		// either exceed the total or be refused a basket the caps allow.
		const total = Object.keys(PLACEMENT_LIMITS).reduce(
			(n, p) => n + limitFor(p),
			0,
		);
		expect(total).toBe(ORDER_MAX_SLOTS);
	});

	test("an unknown placement answers 0, not 1", () => {
		// A default of 1 would quote a price for inventory nothing honours.
		expect(limitFor("whatever")).toBe(0);
		expect(isSellable("whatever")).toBe(false);
		expect(isSellable("category")).toBe(true);
	});
});
