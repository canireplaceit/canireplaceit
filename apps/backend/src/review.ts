// approvePurchase is the ONLY place that writes status: "live" — every approval route must go through it.
// A refund must succeed with the provider before the row's status changes; a failed refund leaves the row untouched.
// The provider that refunds a row is read from the row's own `provider` field, never the currently configured one.

import { DEFAULT_LANG } from "core/src/index";
import { paths } from "core/src/routes";
import { endOfTerm } from "core/src/sponsorship";
import { and, eq } from "drizzle-orm";
import { createMagicLink } from "./auth";
import { slotLabel } from "./content";
import { db, schema } from "./db";
import { authEnabled, env } from "./env";
import { log } from "./log";
import { approvedMail, mailer, rejectedMail } from "./mail";
import type { PurchaseRow } from "./occupancy";
import { fakePaymentProvider, type PaymentProvider } from "./payments";
import { stripePaymentProvider } from "./stripe";

// Review-outcome mails are English-only, so there's no stored locale to build this from.
async function dashboardLink(email: string): Promise<string> {
	const path = paths.dashboard(DEFAULT_LANG);
	return authEnabled
		? await createMagicLink(email, path)
		: `${env.webOrigin}${path}`;
}

// Fire-and-forget: the row is already `live` by the time this runs, so a dead SMTP must not fail the request.
async function notifyApproved(row: PurchaseRow): Promise<void> {
	const dashboardUrl = await dashboardLink(row.email);
	void mailer.send({
		...approvedMail({
			dashboardUrl,
			slot: slotLabel(row.slotId),
			// approvePurchase always sets endsAt alongside status, so this is never null.
			endsAt: row.endsAt ?? new Date(),
		}),
		to: row.email,
	});
}

// Fire-and-forget, called after the refund (if any) already succeeded.
async function notifyRejected(
	row: PurchaseRow,
	o: { reason: string | null; wasRefunded: boolean },
): Promise<void> {
	void mailer.send({
		...rejectedMail({
			slot: slotLabel(row.slotId),
			reason: o.reason,
			amountCents: row.amountCents,
			currency: env.payments.stripe.currency,
			wasRefunded: o.wasRefunded,
		}),
		to: row.email,
	});
}

// What a settled purchase becomes: `submitted` if it carries a creative, `paid` if not. Never `live` —
// an ad must pass human review before it can appear; approvePurchase is the only way out of either state.
export function settledState(row: { name: string | null }, now: Date) {
	return row.name
		? { status: "submitted" as const, paidAt: now }
		: { status: "paid" as const, paidAt: now };
}

// Run starts now, not when paid. Scoped to `submitted` so re-approving is a no-op. Returns null if nothing was awaiting approval.
export async function approvePurchase(
	id: string,
	now = new Date(),
): Promise<PurchaseRow | null> {
	const [current] = await db
		.select({ months: schema.sponsorPurchases.months })
		.from(schema.sponsorPurchases)
		.where(eq(schema.sponsorPurchases.id, id));
	if (!current) return null;

	const [row] = await db
		.update(schema.sponsorPurchases)
		.set({
			status: "live",
			approvedAt: now,
			startsAt: now,
			endsAt: endOfTerm(now, current.months),
		})
		.where(
			and(
				eq(schema.sponsorPurchases.id, id),
				eq(schema.sponsorPurchases.status, "submitted"),
			),
		)
		.returning();
	if (row) void notifyApproved(row);
	return row ?? null;
}

export type RefundResult =
	| { ok: true; refundId: string; already: boolean }
	| { ok: false; error: string };

export type RejectResult =
	| { ok: true; refundId: string | null; already: boolean }
	| { ok: false; error: string };

// Refunds only when a provider actually took the money (checked via providerOf, not paidAt — the dev
// seed can stamp a paid date with no provider behind it). A stripe row with no recorded intent still
// goes through refundPurchase and fails loudly there, so a real charge can never be silently kept.
export async function rejectPurchase(
	row: PurchaseRow,
	o: { reason?: string | null; now?: Date } = {},
): Promise<RejectResult> {
	const reason = o.reason?.trim() || null;
	if (providerOf(row) || row.stripeRefundId) {
		const out = await refundPurchase(row, o);
		if (out.ok) void notifyRejected(row, { reason, wasRefunded: true });
		return out;
	}

	const now = o.now ?? new Date();
	await db
		.update(schema.sponsorPurchases)
		.set({
			status: "rejected",
			refundReason: reason,
			releasedAt: now,
			endsAt: now,
		})
		.where(eq(schema.sponsorPurchases.id, row.id));
	void notifyRejected(row, { reason, wasRefunded: false });
	return { ok: true, refundId: null, already: false };
}

// The provider that took this money, or null if the row was never settled — never a default.
function providerOf(row: PurchaseRow): PaymentProvider | null {
	if (row.provider === fakePaymentProvider.id) return fakePaymentProvider;
	if (row.provider === stripePaymentProvider.id) return stripePaymentProvider;
	return null;
}

// Refunds with the provider before marking the row, always in that order. `now` is passed in so a
// whole order refunded together shares one instant.
export async function refundPurchase(
	row: PurchaseRow,
	o: { reason?: string | null; now?: Date } = {},
): Promise<RefundResult> {
	const now = o.now ?? new Date();
	const reason = o.reason?.trim() || null;

	const mark = async (refundId: string, fields: Partial<PurchaseRow> = {}) => {
		await db
			.update(schema.sponsorPurchases)
			.set({
				status: "refunded",
				stripeRefundId: refundId,
				refundReason: reason,
				// Slot goes back on sale immediately — must satisfy both tests board() applies to "ended".
				releasedAt: now,
				endsAt: now,
				...fields,
			})
			.where(eq(schema.sponsorPurchases.id, row.id));
	};

	// Already refunded: re-assert the status rather than assume it, in case the refund succeeded
	// but the write that should have followed it didn't.
	if (row.stripeRefundId) {
		await mark(row.stripeRefundId, {
			refundReason: row.refundReason ?? reason,
			releasedAt: row.releasedAt ?? now,
			endsAt: row.endsAt ?? now,
		});
		return { ok: true, refundId: row.stripeRefundId, already: true };
	}

	const provider = providerOf(row);
	if (!provider?.refund) {
		return {
			ok: false,
			error: row.provider
				? `no refund path for provider "${row.provider}"`
				: "this purchase was never settled by a payment provider",
		};
	}

	// The fake provider never made a payment intent, so its own reference stands in instead.
	const handle =
		provider === fakePaymentProvider
			? (row.stripePaymentIntent ?? row.providerRef)
			: row.stripePaymentIntent;
	if (!handle) {
		return {
			ok: false,
			error: `no payment intent recorded for purchase ${row.id} — refund it in the Stripe dashboard`,
		};
	}

	let refundId: string;
	try {
		({ refundId } = await provider.refund({
			paymentIntent: handle,
			amountCents: row.amountCents,
			// Stable per purchase, not per request — a retry must not buy a second refund.
			idempotencyKey: `refund-${row.id}`,
		}));
	} catch (e) {
		const error = (e as Error).message;
		log.error({ purchaseId: row.id, err: e }, "refund failed");
		return { ok: false, error };
	}

	await mark(refundId);
	return { ok: true, refundId, already: false };
}
