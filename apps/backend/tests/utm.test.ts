/**
 * The two rules that cost money if they break: a sponsor's own attribution must
 * survive, and a click must never be lost to a tagging bug.
 *
 *   bun test apps/backend/tests/utm.test.ts
 */

import { describe, expect, test } from "bun:test";
import { taggedUrl } from "../src/utm";

const ctx = {
	slotId: "L2",
	placement: "rail",
	page: "product",
	pageSlug: "notion",
	orderId: "ord-123",
	source: "canireplaceit.com",
};

const params = (url: string) =>
	Object.fromEntries(new URL(url).searchParams.entries());

describe("outbound click tagging", () => {
	test("a bare url gets the full set", () => {
		expect(params(taggedUrl("https://acme.com/pricing", ctx))).toEqual({
			utm_source: "canireplaceit.com",
			utm_medium: "sidebar",
			utm_campaign: "L2",
			utm_content: "product:notion",
			utm_term: "ord-123",
		});
	});

	test("the sponsor's own parameters are never overwritten", () => {
		const out = params(
			taggedUrl(
				"https://acme.com/?utm_campaign=q3-launch&utm_source=partner",
				ctx,
			),
		);
		expect(out.utm_campaign).toBe("q3-launch");
		expect(out.utm_source).toBe("partner");
		// The ones they did not set are still filled in.
		expect(out.utm_medium).toBe("sidebar");
	});

	test("their unrelated query survives", () => {
		const out = params(taggedUrl("https://acme.com/?ref=abc&plan=pro", ctx));
		expect(out.ref).toBe("abc");
		expect(out.plan).toBe("pro");
		expect(out.utm_campaign).toBe("L2");
	});

	test("the medium names the surface, not our internals", () => {
		const m = (placement: string) =>
			params(taggedUrl("https://acme.com", { ...ctx, placement })).utm_medium;
		expect(m("rail")).toBe("sidebar");
		expect(m("hero")).toBe("homepage");
		expect(m("category")).toBe("category-page");
		// An unknown placement still tags, rather than emitting "undefined".
		expect(m("something-new")).toBe("sponsor");
	});

	test("no page slug degrades to the page kind alone", () => {
		expect(
			params(
				taggedUrl("https://acme.com", { ...ctx, pageSlug: "", page: "home" }),
			).utm_content,
		).toBe("home");
	});

	test("an order-less purchase omits utm_term rather than sending empty", () => {
		expect(
			params(taggedUrl("https://acme.com", { ...ctx, orderId: null })),
		).not.toHaveProperty("utm_term");
	});

	/**
	 * The failure that must never happen. A click is what the sponsor paid for;
	 * losing one to a malformed URL would be worse than losing the attribution.
	 */
	test.each([
		"not a url at all",
		"mailto:hello@acme.com",
		"tel:+33123456789",
		"javascript:alert(1)",
	])("%s is returned untouched rather than breaking the redirect", (url) => {
		expect(taggedUrl(url, ctx)).toBe(url);
	});

	test("tagging is idempotent", () => {
		const once = taggedUrl("https://acme.com/pricing", ctx);
		expect(taggedUrl(once, ctx)).toBe(once);
	});
});
