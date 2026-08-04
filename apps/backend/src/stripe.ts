/**
 * The real payment provider: Stripe Checkout.
 *
 * It is the second implementation of `PaymentProvider` and nothing outside this
 * file and one webhook route knows Stripe exists — see the header of payments.ts
 * for why that boundary is drawn there.
 *
 * The flow, and why it is split in two:
 *
 *   createCheckout   makes a hosted Checkout Session and answers `settled: false`.
 *                    The browser is sent to `redirectUrl`. Nothing is paid yet and
 *                    the purchase stays on `hold`, so the slot is still on sale —
 *                    which is the existing rule: whoever pays first wins.
 *   webhook          `checkout.session.completed` is the only thing that flips a
 *                    row to `paid`. Not the success_url: that is a browser
 *                    redirect the buyer can fabricate or never load.
 *
 *   refund           issued from here too, because a row that says `refunded` has
 *                    to mean money moved. It used to mean an admin had clicked
 *                    something and then remembered to open the Stripe dashboard.
 *
 * Deliberately not here: subscriptions (terms are fixed 30-day runs paid up
 * front) and tax (Stripe Tax is a dashboard toggle, not code).
 */

import { paths } from "core/src/routes";
import Stripe from "stripe";
import { env } from "./env";
import type { PaymentProvider } from "./payments";

const {
	secretKey: SECRET,
	currency: CURRENCY,
	taxCode: TAX_CODE,
} = env.payments.stripe;

/** Where Stripe sends the buyer back. Same origin as the site. */
const WEB = env.webOrigin;

/**
 * Pinned, not left to default. Unpinned, the version silently moves the day
 * someone runs `bun update stripe`, and the shape of a webhook payload is set by
 * the version configured on the endpoint in the Stripe dashboard — set the same
 * string there, or `event.data.object` is an assumption rather than a contract.
 */
export const stripe = SECRET
	? new Stripe(SECRET, { apiVersion: "2026-07-29.dahlia" })
	: null;

/**
 * Stripe's own guidance is to test for "not unpaid" rather than "is paid":
 * `no_payment_required` is what a 100%-off order settles as, and treating it as
 * unsettled would take an order nobody ever has to pay for and never deliver it.
 */
const isSettled = (s: Stripe.Checkout.Session.PaymentStatus | null) =>
	s !== null && s !== "unpaid";

/**
 * A multi-line order stores `<sessionId>#0`, `#1`, … so each row keeps a unique
 * `providerRef`. Anything asking Stripe about the transaction wants the session.
 */
const sessionOf = (providerRef: string) => providerRef.replace(/#\d+$/, "");

export const stripePaymentProvider: PaymentProvider = {
	id: "stripe",
	live: true,

	async createCheckout(input) {
		if (!stripe) throw new Error("STRIPE_SECRET_KEY not set");

		const slots = input.slotId.split(",");
		const session = await stripe.checkout.sessions.create(
			{
				mode: "payment",
				customer_email: input.email,
				/**
				 * Managed Payments OFF — a tax decision, not a technical one.
				 *
				 * Stripe enables it by default on new accounts, and under it Stripe is
				 * merchant of record and handles indirect tax. But it covers digital
				 * products only, and its documented exclusions name "professional
				 * services, such as consulting, MARKETING, design, development".
				 * Selling advertising space is not eligible, and Stripe proves it by
				 * refusing the session twice: first for a missing product tax code,
				 * then for `txcd_10701000` (Website Advertising) being ineligible.
				 *
				 * So the seller is merchant of record and owes the VAT. That was
				 * already true of an ad sale — leaving the flag on would not have
				 * changed the liability, only hidden it behind a checkout that will
				 * not open.
				 */
				managed_payments: { enabled: false },
				line_items: [
					{
						quantity: 1,
						price_data: {
							currency: CURRENCY,
							unit_amount: input.amountCents,
							product_data: {
								name: `Sponsorship — ${slots.length} slot${slots.length === 1 ? "" : "s"}, ${input.months} month${input.months === 1 ? "" : "s"}`,
								description: slots.join(", ").slice(0, 500),
								/**
								 * "Website Advertising" — what this actually is, and REQUIRED.
								 *
								 * Stripe enables Managed Payments by default on new accounts,
								 * and it refuses a session whose line item has no tax code:
								 * "Invalid line_items[0]: the product tax code is missing".
								 * So this is not a Stripe Tax nicety that can wait for the
								 * dashboard — without it, checkout does not open at all.
								 *
								 * The alternative is switching Managed Payments off for the
								 * session, which trades a correct declaration for a worse one.
								 * Selling ad space IS website advertising; say so.
								 */
								tax_code: TAX_CODE,
							},
						},
					},
				],
				// The webhook has no other way back to our rows. `orderId` is the join
				// key; the slot list is there so a Stripe dashboard row is readable.
				metadata: {
					orderId: input.purchaseId,
					slots: input.slotId.slice(0, 480),
				},
				// Stripe's own hosted page, in the buyer's language.
				locale: input.lang,
				// Built from `paths`, never a bare `/sponsor`: every route is locale
				// prefixed and `parseRoute` returns `unknown` without one, so a bare
				// path dropped a customer who had just paid onto a page that does not
				// resolve. The locale comes from the request rather than being fixed
				// at "en" — these URLs are minted once and `resume()` replays them, so
				// this is the only chance to get the language right.
				success_url: `${WEB}${paths.sponsor(input.lang)}?paid={CHECKOUT_SESSION_ID}`,
				cancel_url: `${WEB}${paths.sponsor(input.lang)}?cancelled=1`,
			},
			// One order, one session. Stripe replays the first response for a repeated
			// key for 24h, so a retried request cannot mint a second payable page.
			{ idempotencyKey: `order-${input.purchaseId}` },
		);

		// Documented as null once a session is no longer active. A fresh one always
		// has it, so this is a "the world changed under us" guard rather than a real
		// branch — and a null redirect would strand a buyer silently.
		if (!session.url) {
			throw new Error(`stripe: session ${session.id} has no checkout url`);
		}

		return {
			providerRef: session.id,
			redirectUrl: session.url,
			settled: false,
		};
	},

	async verify(providerRef) {
		if (!stripe) return { settled: false };
		const session = await stripe.checkout.sessions.retrieve(
			sessionOf(providerRef),
		);
		return { settled: isSettled(session.payment_status) };
	},

	async resume(providerRef) {
		if (!stripe) return null;
		const session = await stripe.checkout.sessions.retrieve(
			sessionOf(providerRef),
		);
		// `open` is the only status that can still be paid — `expired` and
		// `complete` both mean handing this url back would be a dead end.
		if (session.status !== "open" || !session.url) return null;
		return {
			providerRef: session.id,
			redirectUrl: session.url,
			settled: isSettled(session.payment_status),
		};
	},

	/**
	 * Refund one line of an order, against the order's payment intent.
	 *
	 * The amount is passed rather than left to default. Defaulting refunds the
	 * WHOLE intent, and one intent pays for every slot in the order — so rejecting
	 * the rail ad of a buyer who also bought three categories would silently hand
	 * back all four. `amountCents` is that line's own charge in full, and the
	 * lines sum to exactly what was taken (see `allocate` in core), so refusing
	 * every line of an order refunds it to the cent.
	 *
	 * Throws on failure. The caller must NOT write `refunded` unless this returns.
	 */
	async refund(o) {
		if (!stripe) throw new Error("STRIPE_SECRET_KEY not set");
		const refund = await stripe.refunds.create(
			{ payment_intent: o.paymentIntent, amount: o.amountCents },
			// Stripe replays the first response for a repeated key for 24h, so a
			// retry that lost its answer cannot become a second refund.
			{ idempotencyKey: o.idempotencyKey },
		);
		// Documented as `succeeded`, `pending` (some bank-backed methods) or
		// `failed`. Only the last is a refusal — a pending refund is money already
		// on its way back and the row may honestly say so.
		if (refund.status === "failed" || refund.status === "canceled") {
			throw new Error(
				`stripe: refund ${refund.id} ${refund.status}${refund.failure_reason ? ` (${refund.failure_reason})` : ""}`,
			);
		}
		return { refundId: refund.id };
	},
};

/** What a verified, money-is-in webhook delivery tells us. */
export type Settlement = {
	orderId: string;
	sessionId: string;
	/** The handle a refund needs. Null only if Stripe omitted it. */
	paymentIntent: string | null;
};

/**
 * Verify a webhook delivery and return the order it settles, or null.
 *
 * The raw request body is required — Stripe signs the bytes, so a parsed and
 * re-serialised object never verifies. An unverified body is dropped rather than
 * trusted: this endpoint is public, and it grants paid inventory.
 */
export async function settledOrderIdFrom(
	rawBody: string,
	signature: string | undefined,
): Promise<Settlement | null> {
	const secret = env.payments.stripe.webhookSecret;
	// Throwing rather than returning null: a null here answers 200, which tells
	// Stripe the delivery succeeded and stops the retries forever. A misconfigured
	// endpoint must keep failing loudly, so the retries are still coming when
	// somebody fixes it.
	if (!stripe) throw new Error("stripe not configured");
	if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET not set");
	if (!signature) throw new Error("missing stripe-signature header");

	const event = await stripe.webhooks.constructEventAsync(
		rawBody,
		signature,
		secret,
	);

	// Two events, not one. `completed` fires the moment checkout finishes, which
	// for a bank debit or a buy-now-pay-later method is BEFORE the money clears;
	// `async_payment_succeeded` is the one that fires when it does. Handling only
	// the first drops every delayed payment on the floor — the buyer is charged
	// and the order sits on `hold` for ever.
	if (
		event.type !== "checkout.session.completed" &&
		event.type !== "checkout.session.async_payment_succeeded"
	) {
		return null;
	}

	const session = event.data.object;
	if (!isSettled(session.payment_status)) return null;

	const orderId = session.metadata?.orderId;
	if (!orderId) return null;

	return {
		orderId,
		sessionId: session.id,
		paymentIntent:
			typeof session.payment_intent === "string"
				? session.payment_intent
				: (session.payment_intent?.id ?? null),
	};
}
