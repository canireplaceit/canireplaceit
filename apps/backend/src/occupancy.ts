/**
 * Who holds which slot, right now.
 *
 * This lives in its own file because it stopped being a display concern. The
 * board shows it, `reserveOrder` refuses to sell against it, `settleOrder`
 * re-checks it before taking money, and the Stripe webhook checks it again
 * before marking a slot delivered. Four callers, one rule: a second
 * implementation of "is this slot free" is how a site sells the same rail
 * position twice and only notices when the second sponsor emails to ask why
 * their ad never appeared.
 *
 * Occupancy is derived, never stored: a run whose `endsAt` has passed frees its
 * slot the moment the next request reads it. No cron, so a missed job costs
 * bookkeeping and never correctness.
 */

import { inArray } from "drizzle-orm";
import { db, schema } from "./db";

export type PurchaseRow = typeof schema.sponsorPurchases.$inferSelect;

/**
 * The occupancy rule itself, over rows already in memory.
 *
 * Separated from the query so it can be tested without a database, and so the
 * one comparison that decides whether inventory is sellable is a pure function
 * rather than a line buried in a route.
 *
 * Note what is deliberately NOT expired: a row sitting at `paid` or `submitted`
 * holds its slot indefinitely, because the sponsor has paid and not yet sent
 * their creative. Only a `live` run has a meaningful end date. That is why the
 * paths that can strand a row at `paid` matter so much.
 */
export function takenFrom(
	rows: PurchaseRow[],
	now: Date,
): Map<string, PurchaseRow> {
	const taken = new Map<string, PurchaseRow>();
	for (const p of rows) {
		if (p.status === "live" && p.endsAt && p.endsAt <= now) continue;
		taken.set(p.slotId, p);
	}
	return taken;
}

/** Which slots are spoken for, and by which row. */
export async function occupancy(): Promise<Map<string, PurchaseRow>> {
	const rows = await db
		.select()
		.from(schema.sponsorPurchases)
		.where(
			inArray(schema.sponsorPurchases.status, [
				"paid",
				"submitted",
				"live",
			] as const),
		);
	return takenFrom(rows, new Date());
}

/**
 * The slots in `ids` that somebody else already holds.
 *
 * `exceptOrder` is the order doing the asking: its own rows must not count
 * against it, or settling a paid order would report a conflict with itself.
 */
export function conflictsIn(
	ids: string[],
	taken: Map<string, PurchaseRow>,
	exceptOrder?: string | null,
): string[] {
	return ids.filter((id) => {
		const p = taken.get(id);
		return p !== undefined && (!exceptOrder || p.orderId !== exceptOrder);
	});
}

export async function conflictingSlots(
	ids: string[],
	exceptOrder?: string | null,
): Promise<string[]> {
	return conflictsIn(ids, await occupancy(), exceptOrder);
}
