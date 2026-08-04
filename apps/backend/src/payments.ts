/**
 * Taking money for a slot, behind an interface — and one implementation that
 * takes none.
 *
 * The point is to be able to run the whole loop (reserve → pay → creative →
 * approve → live → expire → slot back on sale) before a Stripe account exists,
 * without the rest of the codebase learning anything about Stripe. Everything
 * outside this file talks to `PaymentProvider`; adding the real one is writing a
 * second object with these four methods and changing one env var.
 *
 * ## The fake provider is a development fixture and a production vulnerability
 *
 * An unauthenticated endpoint that grants paid ad placements for free is not a
 * test convenience, it is a way to take the site's inventory for nothing. So it
 * is fenced three times over, and every fence is independent:
 *
 *   1. `NODE_ENV === "production"` disables it, whatever else is set.
 *   2. It is off unless `PAYMENTS_PROVIDER=fake` is set explicitly. There is no
 *      "default to fake in dev" — an unset variable means no provider at all and
 *      checkout returns 503, because a silent default is how this ends up live.
 *   3. Everything it does is logged with a banner, and `provider: "fake-dev"` is
 *      written onto the purchase row. A database that ran this can never be
 *      mistaken later for one that took real money.
 *
 * The terms and their discounts live in `core/src/sponsorship.ts`, because the
 * sponsor form has to quote the same numbers this file charges.
 */

import type { Lang } from "core/src/index";
import { env } from "./env";
import { log } from "./log";
import { stripePaymentProvider } from "./stripe";

export type CheckoutInput = {
	purchaseId: string;
	slotId: string;
	amountCents: number;
	months: number;
	email: string;
	/**
	 * The language the buyer was reading when they clicked pay.
	 *
	 * It is part of the input rather than something the provider guesses because
	 * the return URLs are minted here, once, and a provider that resumes an
	 * existing session (Stripe does) replays the URLs from that first mint — so
	 * there is no later point at which a wrong language can be corrected.
	 */
	lang: Lang;
};

export type Checkout = {
	/** The provider's own id for this transaction. Stored on the purchase. */
	providerRef: string;
	/**
	 * Where to send the buyer. For a real provider this is a hosted payment page;
	 * for the fake one it is null, because there is nothing to pay.
	 */
	redirectUrl: string | null;
	/**
	 * True when the money is already in — the fake provider settles instantly.
	 * A real one answers false here and later on its webhook.
	 */
	settled: boolean;
};

export type PaymentProvider = {
	/** Stable id, written onto the purchase row. */
	readonly id: string;
	/** Loud enough to be noticed in a log, for anything that is not real money. */
	readonly live: boolean;
	createCheckout(input: CheckoutInput): Promise<Checkout>;
	/** Did this transaction actually settle? Called before a slot goes live. */
	verify(providerRef: string): Promise<{ settled: boolean }>;
	/**
	 * The still-payable checkout for `providerRef`, or null if there is none.
	 *
	 * Optional, because a provider that settles instantly can never have one. It
	 * exists so a buyer who double-clicks, or comes back after closing the tab, is
	 * handed the payment page they already have instead of a second one — two live
	 * payment pages for one order is two charges for one order.
	 */
	resume?(providerRef: string): Promise<Checkout | null>;
	/**
	 * Send the money back, and answer with the provider's id for the refund.
	 *
	 * `idempotencyKey` is the caller's, not the provider's: it is derived from the
	 * purchase row, so a reject that is clicked twice, retried, or replayed after a
	 * crash asks for the SAME refund rather than a second one. A provider that
	 * honours it (Stripe does) is the last line of that defence; the first is that
	 * `stripeRefundId` on the row is checked before this is ever called.
	 *
	 * Optional, because "no refund path" must be an explicit failure at the call
	 * site rather than a silent success — see review.ts.
	 */
	refund?(o: RefundInput): Promise<{ refundId: string }>;
};

export type RefundInput = {
	/**
	 * The charge to refund against. One payment intent covers a whole order, so
	 * `amountCents` is what decides how much of it this line gets back.
	 */
	paymentIntent: string;
	/**
	 * This line's own charge, in full. Not a proration: an ad refused before it
	 * ran had no run to prorate, and a line is refunded whole or not at all.
	 */
	amountCents: number;
	idempotencyKey: string;
};

const BANNER = "★ FAKE PAYMENT PROVIDER — NO MONEY MOVED ★";

/** Refs are prefixed so they are unmistakable anywhere they surface. */
const fakeRef = () => `FAKE-DEV-${crypto.randomUUID()}`;

const settledRefs = new Set<string>();

export const fakePaymentProvider: PaymentProvider = {
	id: "fake-dev",
	live: false,

	async createCheckout(input) {
		const ref = fakeRef();
		settledRefs.add(ref);
		log.warn(
			{
				purchaseId: input.purchaseId,
				slotId: input.slotId,
				amountCents: input.amountCents,
				months: input.months,
				ref,
			},
			`${BANNER} — "charged" nobody`,
		);
		return { providerRef: ref, redirectUrl: null, settled: true };
	},

	async verify(providerRef) {
		// Refs live in memory only, so a restart forgets them — but the purchase row
		// already carries `paidAt`, which is the record that matters. Anything that
		// did not come from this process is not settled.
		return { settled: settledRefs.has(providerRef) };
	},

	/**
	 * "Returns" money that was never taken, so the whole reject → refunded loop can
	 * be run end to end locally. Stamped like every other fake artefact, so a
	 * refund id in the table can never be mistaken for one Stripe issued.
	 */
	async refund(o) {
		const refundId = `FAKE-DEV-REFUND-${crypto.randomUUID()}`;
		log.warn(
			{
				amountCents: o.amountCents,
				paymentIntent: o.paymentIntent,
				idempotencyKey: o.idempotencyKey,
				refundId,
			},
			`${BANNER} — "refunded" nobody`,
		);
		return { refundId };
	},
};

/**
 * Null means "no provider configured", and every checkout route must answer 503
 * rather than falling back to anything. Not being able to sell a slot is a
 * missed sale; falling back to the fake provider is giving inventory away.
 */
function select(): PaymentProvider | null {
	const want = env.payments.provider;

	if (want === "fake") {
		if (env.isProduction) {
			log.error(
				`${BANNER} — PAYMENTS_PROVIDER=fake is IGNORED in production. Checkout is disabled. Set a real provider.`,
			);
			return null;
		}
		log.warn(
			`${BANNER} — checkout will complete purchases WITHOUT CHARGING ANYONE. Unset PAYMENTS_PROVIDER to disable.`,
		);
		return fakePaymentProvider;
	}

	if (want === "stripe") {
		if (!env.payments.stripe.secretKey) {
			log.error(
				"payments: PAYMENTS_PROVIDER=stripe but no STRIPE_SECRET_KEY — checkout off",
			);
			return null;
		}
		if (!env.payments.stripe.webhookSecret) {
			// Without it nothing can ever flip a purchase to `paid`, so a sale would
			// take money and never deliver the slot. Refusing the sale is better.
			log.error("payments: STRIPE_WEBHOOK_SECRET not set — checkout off");
			return null;
		}
		return stripePaymentProvider;
	}

	if (want) log.warn(`payments: unknown provider "${want}" — checkout off`);
	return null;
}

export const paymentProvider = select();
