/**
 * The rule that decides whether a slot can be sold.
 *
 * It is worth a test because getting it wrong is expensive in a way most bugs
 * are not: a sponsor pays four figures for a rail position, the board silently
 * shows the other buyer's ad, and nothing anywhere logs that it happened. Every
 * case below is one of the ways that was possible before these checks existed.
 *
 *   bun test apps/backend/tests/occupancy.test.ts
 */

import { describe, expect, test } from "bun:test";
import { conflictsIn, type PurchaseRow, takenFrom } from "../src/occupancy";

const NOW = new Date("2026-08-03T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

/** Only the columns the occupancy rule reads. */
const row = (over: Partial<PurchaseRow> & { slotId: string }): PurchaseRow =>
	({
		id: crypto.randomUUID(),
		orderId: null,
		status: "live",
		endsAt: day(30),
		...over,
	}) as PurchaseRow;

describe("takenFrom", () => {
	test("a running sponsorship holds its slot", () => {
		const taken = takenFrom([row({ slotId: "rail-1" })], NOW);
		expect(taken.has("rail-1")).toBe(true);
	});

	test("a run whose endsAt has passed frees it — no cron involved", () => {
		const taken = takenFrom([row({ slotId: "rail-1", endsAt: day(-1) })], NOW);
		expect(taken.has("rail-1")).toBe(false);
	});

	test("expiry is inclusive: endsAt exactly now is over", () => {
		const taken = takenFrom([row({ slotId: "rail-1", endsAt: NOW })], NOW);
		expect(taken.has("rail-1")).toBe(false);
	});

	test("paid-but-not-yet-live holds the slot", () => {
		// Otherwise the window between paying and sending the creative is a window
		// in which the same slot can be sold to somebody else.
		const taken = takenFrom(
			[row({ slotId: "hero", status: "paid", endsAt: null })],
			NOW,
		);
		expect(taken.has("hero")).toBe(true);
	});

	test("submitted, awaiting approval, holds the slot", () => {
		const taken = takenFrom(
			[row({ slotId: "hero", status: "submitted", endsAt: null })],
			NOW,
		);
		expect(taken.has("hero")).toBe(true);
	});

	test("a paid row with a past endsAt still holds it", () => {
		// Only a `live` run has a meaningful end date — the clock starts when the ad
		// goes up, not when it was bought. Expiring a paid row on a stale date would
		// resell a slot somebody has already paid for.
		const taken = takenFrom(
			[row({ slotId: "hero", status: "paid", endsAt: day(-5) })],
			NOW,
		);
		expect(taken.has("hero")).toBe(true);
	});
});

describe("conflictsIn", () => {
	const taken = takenFrom(
		[
			row({ slotId: "rail-1", orderId: "order-A" }),
			row({ slotId: "cat-git", orderId: "order-A" }),
		],
		NOW,
	);

	test("reports a slot somebody else holds", () => {
		expect(conflictsIn(["rail-1"], taken)).toEqual(["rail-1"]);
	});

	test("says nothing about a free slot", () => {
		expect(conflictsIn(["rail-9"], taken)).toEqual([]);
	});

	test("reports every conflicting slot, not just the first", () => {
		// The buyer needs to be told the whole truth in one response, or they fix
		// one slot, resubmit, and get refused again for the next.
		expect(conflictsIn(["rail-1", "rail-9", "cat-git"], taken).sort()).toEqual([
			"cat-git",
			"rail-1",
		]);
	});

	test("an order does not conflict with itself", () => {
		// settleOrder re-checks availability for rows it already owns. Without the
		// exception, paying for a slot you hold would report a conflict with your
		// own row and refuse the sale.
		expect(conflictsIn(["rail-1", "cat-git"], taken, "order-A")).toEqual([]);
	});

	test("a different order still conflicts", () => {
		expect(conflictsIn(["rail-1"], taken, "order-B")).toEqual(["rail-1"]);
	});

	test("legacy rows with a null orderId conflict with everyone", () => {
		// Rows predating multi-slot orders carry no order id. Treating null as
		// "matches the asking order" would let any order steal their slot.
		const legacy = takenFrom([row({ slotId: "hero", orderId: null })], NOW);
		expect(conflictsIn(["hero"], legacy, "order-A")).toEqual(["hero"]);
	});
});
