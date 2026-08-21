/**
 * The structured data that answer engines actually read.
 *
 * FAQPage is the one type on this site that both Google and the retrieval
 * systems lift wholesale, which makes it the one place a missing field turns
 * into a published sentence containing the word "undefined". Every question is
 * built from a record, so the tests here defend the same rule the rest of the
 * catalogue runs on: state a fact or say nothing, never pad.
 *
 *   bun test apps/frontend/src/seo.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Category, Product } from "core/src/content";
import { homeMeta, productMeta } from "./seo";

const DATA = join(import.meta.dir, "../../../data");
const read = <T>(path: string): T =>
	JSON.parse(readFileSync(join(DATA, path), "utf8")) as T;

const categories = read<Category[]>("categories.json");
const notion = read<Product>("products/notion.json");
const categoryOf = (p: Product) =>
	categories.find((c) => c.slug === p.category);

const blocks = (p: Product, lang: "en" | "fr") =>
	(productMeta(p, lang, categoryOf(p)).jsonLd ?? []).map(
		(raw) => JSON.parse(raw) as Record<string, unknown>,
	);

const typed = (p: Product, lang: "en" | "fr", type: string) =>
	blocks(p, lang).find((b) => b["@type"] === type);

describe("FAQPage", () => {
	test("asks and answers in both languages", () => {
		for (const lang of ["en", "fr"] as const) {
			const faq = typed(notion, lang, "FAQPage") as unknown as
				| { mainEntity: { name: string; acceptedAnswer: { text: string } }[] }
				| undefined;
			expect(faq).toBeDefined();
			expect(faq?.mainEntity.length).toBeGreaterThan(2);
			for (const q of faq?.mainEntity ?? []) {
				expect(q.name.length).toBeGreaterThan(10);
				expect(q.acceptedAnswer.text.length).toBeGreaterThan(10);
			}
		}
	});

	test("never publishes a hole in a sentence", () => {
		// One absent field is all it takes to ship "checked on undefined".
		for (const product of ["notion", "figma", "zoominfo"]) {
			const p = read<Product>(`products/${product}.json`);
			for (const lang of ["en", "fr"] as const) {
				for (const raw of productMeta(p, lang, categoryOf(p)).jsonLd ?? []) {
					expect(raw).not.toContain("undefined");
					expect(raw).not.toContain("NaN");
					expect(raw).not.toContain('"null"');
				}
			}
		}
	});

	test("quotes the price only with the date and the page it came from", () => {
		const faq = typed(notion, "en", "FAQPage") as unknown as {
			mainEntity: { name: string; acceptedAnswer: { text: string } }[];
		};
		const cost = faq.mainEntity.find((q) => q.name.includes("cost"));
		expect(cost).toBeDefined();
		expect(cost?.acceptedAnswer.text).toContain(
			notion.pricing?.checkedOn ?? "",
		);
		expect(cost?.acceptedAnswer.text).toContain(notion.pricing?.url ?? "");
	});
});

describe("Offer", () => {
	test("is stated only when there is a price and a receipt for it", () => {
		const app = typed(notion, "en", "SoftwareApplication") as unknown as
			| { offers: { price: number; url: string } }
			| undefined;
		expect(app?.offers.price).toBe(notion.priceMonthly as number);
		expect(app?.offers.url).toBe(notion.pricing?.url as string);

		// A product nobody has priced must not gain an invented offer.
		const unpriced: Product = { ...notion, priceMonthly: null, pricing: null };
		expect(typed(unpriced, "en", "SoftwareApplication")).toBeUndefined();
	});
});

describe("WebSite", () => {
	test("is declared once, on the first page only", () => {
		const first = homeMeta("en", 592).jsonLd ?? [];
		expect(first.length).toBe(1);
		expect(JSON.parse(first[0])["@type"]).toBe("WebSite");
		expect(homeMeta("en", 592, 2).jsonLd).toBeUndefined();
	});
});
