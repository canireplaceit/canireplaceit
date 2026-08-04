/**
 * The arithmetic and the default pick, which are the two things on the estimate
 * page that a reader can catch us getting wrong.
 *
 *   bun test packages/core
 */

import { expect, test } from "bun:test";
import type { Facts, OssAlternative, PriceSource, Product } from "./content";
import {
	decodePlan,
	defaultReplacement,
	encodePlan,
	monthlyCentsOf,
	replacements,
	spendOf,
} from "./plan";

const facts = (over: Partial<Facts> = {}): Facts => ({
	selfHostable: true,
	openCore: "none",
	ssoInFree: true,
	dataResidency: "self",
	...over,
});

const oss = (
	name: string,
	over: Partial<OssAlternative> = {},
): OssAlternative => ({
	kind: "oss",
	name,
	source: {
		host: "github",
		path: `o/${name.toLowerCase()}`,
		url: `https://github.com/o/${name.toLowerCase()}`,
	},
	license: "MIT",
	effort: "docker",
	note: { en: "n" },
	facts: facts(),
	...over,
});

const pricing = (basis: PriceSource["basis"]): PriceSource => ({
	plan: "Team",
	basis,
	url: "https://example.com/pricing",
	checkedOn: "2026-01-01",
	confidence: "high",
});

const product = (over: Partial<Product> = {}): Product => ({
	slug: "x",
	name: "X",
	domain: null,
	category: "c",
	priceMonthly: 10,
	pricing: pricing("per-seat"),
	verdict: "yes",
	why: { en: "w" },
	whatYouLose: [{ en: "l" }, { en: "m" }],
	alternatives: [oss("A")],
	priority: 3,
	...over,
});

test("a per-seat price is the only one the seat count multiplies", () => {
	const seats = 25;
	expect(monthlyCentsOf(product(), seats)).toBe(25_000);
	expect(monthlyCentsOf(product({ pricing: pricing("flat") }), seats)).toBe(
		1000,
	);
	expect(monthlyCentsOf(product({ pricing: pricing("usage") }), seats)).toBe(
		1000,
	);
	expect(monthlyCentsOf(product({ pricing: pricing("custom") }), seats)).toBe(
		1000,
	);
});

test("a perpetual licence is not a monthly cost", () => {
	expect(monthlyCentsOf(product({ pricing: pricing("one-time") }), 10)).toBe(
		null,
	);
});

test("no published figure contributes nothing rather than zero", () => {
	expect(monthlyCentsOf(product({ priceMonthly: null }), 10)).toBe(null);
});

test("the monthly total keeps every basis in its own group", () => {
	const spend = spendOf(
		[
			product({ priceMonthly: 10, pricing: pricing("per-seat") }),
			product({ priceMonthly: 99, pricing: pricing("flat") }),
			product({ priceMonthly: 5, pricing: pricing("usage") }),
			product({ priceMonthly: 60, pricing: pricing("one-time") }),
			product({ priceMonthly: null, pricing: null }),
		],
		10,
	);

	expect(spend.perSeat).toEqual({ count: 1, cents: 10_000 });
	expect(spend.flat).toEqual({ count: 1, cents: 9900 });
	expect(spend.usage).toEqual({ count: 1, cents: 500 });
	// Reported, and deliberately outside the monthly figure.
	expect(spend.oneTime).toEqual({ count: 1, cents: 6000 });
	expect(spend.unpriced).toBe(1);
	expect(spend.monthlyCents).toBe(10_000 + 9900 + 500);
});

test("the old bug: seats never multiply the whole basket", () => {
	const basket = [
		product({ priceMonthly: 10, pricing: pricing("per-seat") }),
		product({ priceMonthly: 100, pricing: pricing("flat") }),
	];
	// Σ(price) × seats would be (10 + 100) × 50 = $5,500.
	expect(spendOf(basket, 50).monthlyCents).toBe(50_000 + 10_000);
});

test("seats below one cannot shrink a bill", () => {
	expect(monthlyCentsOf(product(), 0)).toBe(1000);
});

test("a not-yet verdict offers nothing, however many entries the file has", () => {
	const p = product({ verdict: "not-yet", alternatives: [oss("A"), oss("B")] });
	expect(replacements(p)).toEqual([]);
	expect(defaultReplacement(p)).toBe(null);
});

test("an alternative that cannot be self-hosted is not an exit", () => {
	const p = product({
		alternatives: [oss("A", { facts: facts({ selfHostable: false }) })],
	});
	expect(defaultReplacement(p)).toBe(null);
});

test("a whole project beats a hosted open-core one", () => {
	const p = product({
		alternatives: [
			oss("Hosted", {
				effort: "managed",
				facts: facts({ openCore: "major", paywalled: { en: "sso" } }),
			}),
			oss("Whole", { effort: "docker" }),
		],
	});
	expect(defaultReplacement(p)?.name).toBe("Whole");
});

test("among whole projects the least work wins, and compose breaks a tie", () => {
	const p = product({
		alternatives: [
			oss("Ops", { effort: "ops" }),
			oss("Compose", { effort: "docker", hasCompose: true }),
			oss("Docker", { effort: "docker" }),
		],
	});
	expect(defaultReplacement(p)?.name).toBe("Compose");
});

test("the default never depends on the order of the file", () => {
	const a = oss("Alpha");
	const b = oss("Beta");
	expect(defaultReplacement(product({ alternatives: [a, b] }))?.name).toBe(
		defaultReplacement(product({ alternatives: [b, a] }))?.name,
	);
});

test("a plan survives a round trip through the query string", () => {
	const choices = [
		{ slug: "notion", alt: "appflowy" },
		{ slug: "slack", alt: "" },
		{ slug: "jira", alt: "keep" },
	];
	expect(encodePlan(choices)).toBe("notion~appflowy,slack,jira~keep");
	expect(decodePlan(encodePlan(choices))).toEqual(choices);
});

test("a hand-edited plan cannot produce a duplicate or an empty row", () => {
	expect(decodePlan("notion,,notion~appflowy, slack ")).toEqual([
		{ slug: "notion", alt: "" },
		{ slug: "slack", alt: "" },
	]);
	expect(decodePlan(null)).toEqual([]);
});
