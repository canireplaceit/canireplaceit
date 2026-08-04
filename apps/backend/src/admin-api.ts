/**
 * The platform operator's own API, gated by who they are signed in as.
 *
 * ## Why this is not part of `/api/admin/*`
 *
 * That group is the MACHINE path: a bearer token in a header, no identity behind
 * it, meant for a script or a curl. This one is a person with a session cookie,
 * and the two must not be merged. Widening the token routes to also accept a
 * cookie would mean every existing admin endpoint silently gained a second way
 * in; adding a token check here would mean a review queue that a shared secret
 * can approve ads with. Two credentials, two prefixes, one shared implementation
 * of the actual work (see review.ts).
 *
 * Fails closed exactly as ADMIN_TOKEN does: SITE_ADMIN unset means nobody is a
 * platform admin, and every route here answers 503 rather than 403 — "this
 * server has no operators" is a different fact from "you are not one", and only
 * the first is fixable by the person reading the response.
 *
 * ## What it returns
 *
 * The whole creative, in both locales, exactly as the site will render it. A
 * reviewer approving an ad is deciding whether that text and that logo may
 * appear beside our content, and a summary is not something you can make that
 * decision from — a French tagline nobody previewed is a French tagline nobody
 * reviewed.
 */

import { desc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
	adStats,
	MIN_REPORTABLE_DAYS,
	MIN_REPORTABLE_IMPRESSIONS,
	purchaseStats,
} from "./ad-analytics";
import { type CookieJar, isPlatformAdmin, sessionOf } from "./auth";
import { content, slotById } from "./content";
import { db, schema } from "./db";
import { env } from "./env";
import { occupancy, type PurchaseRow } from "./occupancy";
import { approvePurchase, rejectPurchase } from "./review";

const DAY_MS = 86_400_000;

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

/** Whole days, never negative — a run that starts today has run zero days. */
const daysBetween = (from: Date, to: Date) =>
	Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS));

/**
 * Everything a reviewer needs to look at, and nothing derived.
 *
 * Both locales are emitted the way `board()` emits them — `fr` falling back to
 * the default rather than being null — so what the reviewer reads is what a
 * French reader would see, not what the database happens to have in a column.
 */
function creativeOf(p: PurchaseRow) {
	const slot = slotById.get(p.slotId);
	return {
		id: p.id,
		orderId: p.orderId,
		status: p.status,
		slotId: p.slotId,
		placement: slot?.placement ?? null,
		slotLabel: slot?.label ?? null,
		category: slot?.category ?? null,
		email: p.email,
		amountCents: p.amountCents,
		months: p.months,
		provider: p.provider,
		name: p.name ? { en: p.name, fr: p.nameFr ?? p.name } : null,
		tagline: p.tagline ? { en: p.tagline, fr: p.taglineFr ?? p.tagline } : null,
		/** The raw columns too: a reviewer editing copy needs to see what is null. */
		raw: {
			name: p.name,
			nameFr: p.nameFr,
			tagline: p.tagline,
			taglineFr: p.taglineFr,
		},
		url: p.url,
		logoUrl: p.logoUrl,
		tint: p.tint,
		createdAt: iso(p.createdAt),
		paidAt: iso(p.paidAt),
		submittedAt: iso(p.submittedAt),
		approvedAt: iso(p.approvedAt),
		startsAt: iso(p.startsAt),
		endsAt: iso(p.endsAt),
		releasedAt: iso(p.releasedAt),
		refundReason: p.refundReason,
		stripeRefundId: p.stripeRefundId,
	};
}

/**
 * The numbers, with the same refusal to invent them that the public page makes.
 *
 * Below either threshold there is no CTR, only counts and a reason — the site
 * sells advertising on being honest about its figures, and the operator's own
 * screen is the last place that should start rounding noise into a trend. The
 * counts are always real; it is the RATE that needs enough of them to mean
 * anything.
 */
async function metricsOf(p: PurchaseRow, now: Date) {
	const stats = await purchaseStats(p.id);
	const started = p.startsAt;
	const daysRunning = started ? daysBetween(started, now) : 0;
	const daysRemaining = p.endsAt ? daysBetween(now, p.endsAt) : null;
	const reportable =
		stats.impressions >= MIN_REPORTABLE_IMPRESSIONS &&
		daysRunning >= MIN_REPORTABLE_DAYS;

	return {
		impressions: stats.impressions,
		clicks: stats.clicks,
		/** Null below the thresholds. The client prints `note`, never a zero. */
		ctr: reportable ? stats.ctr : null,
		reportable,
		note: reportable
			? null
			: `not enough data yet — ${MIN_REPORTABLE_IMPRESSIONS} impressions and ${MIN_REPORTABLE_DAYS} days of running are needed before a CTR means anything`,
		minImpressions: MIN_REPORTABLE_IMPRESSIONS,
		minDays: MIN_REPORTABLE_DAYS,
		daysRunning,
		daysRemaining,
		byPage: stats.byPage,
	};
}

/**
 * "Why", in the reviewer's words, persisted on the row. Optional: a refund that
 * had to be issued in a hurry must never be blocked by a required field.
 *
 * Exported because the token-gated reject and release take the same body — one
 * shape, so the reason means the same thing whichever door it came through.
 */
export const RefundBody = t.Optional(
	t.Object({ reason: t.Optional(t.String({ maxLength: 1000 })) }),
);

/**
 * 503 / 401 / 403, in that order.
 *
 * The order is the point: an unconfigured server must say so to everybody,
 * including an anonymous caller, because otherwise the only symptom of a missing
 * SITE_ADMIN is that the operator's own sign-in appears to be rejected.
 */
const requirePlatformAdmin = async ({
	cookie,
	status,
}: {
	cookie: Record<string, CookieJar>;
	status: (code: number, body: unknown) => unknown;
}) => {
	if (env.siteAdmins.length === 0) {
		return status(503, { error: "SITE_ADMIN not configured" });
	}
	const email = await sessionOf(cookie);
	if (!email) return status(401, { error: "not signed in" });
	if (!isPlatformAdmin(email)) {
		return status(403, { error: "not a platform admin" });
	}
};

export const platformAdminApi = new Elysia({ prefix: "/api/site-admin" })
	.onBeforeHandle(requirePlatformAdmin)

	/**
	 * Everything waiting on a human, oldest first — the queue is a to-do list and
	 * the thing that has waited longest is the thing that should be at the top.
	 *
	 * `waitingSince` is the later of "creative filed" and "money in": a row cannot
	 * be reviewed before both have happened, so the earlier of the two would
	 * overstate the wait on every order that sat in checkout for a day.
	 */
	.get("/queue", async () => {
		const rows = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(eq(schema.sponsorPurchases.status, "submitted"))
			.orderBy(schema.sponsorPurchases.createdAt);

		const now = new Date();
		return {
			now: now.toISOString(),
			queue: rows.map((p) => {
				const since = new Date(
					Math.max(
						(p.submittedAt ?? p.createdAt).getTime(),
						(p.paidAt ?? p.createdAt).getTime(),
					),
				);
				return {
					...creativeOf(p),
					waitingSince: since.toISOString(),
					waitingHours:
						Math.round(((now.getTime() - since.getTime()) / 3_600_000) * 10) /
						10,
				};
			}),
		};
	})

	/** Publish it. The only credential that can, alongside the machine token. */
	.post("/purchases/:id/approve", async ({ params, status }) => {
		const row = await approvePurchase(params.id);
		return row
			? { ok: true, purchase: creativeOf(row) }
			: status(409, { error: "unknown purchase, or not awaiting approval" });
	})

	/**
	 * Refuse it and send the money back.
	 *
	 * The refund is attempted BEFORE the status moves, and a failure is a 502 with
	 * the provider's own message — the row stays `submitted`, visibly unfinished,
	 * because a queue that has quietly dropped an un-refunded rejection is worse
	 * than one with an angry red row in it.
	 */
	.post(
		"/purchases/:id/reject",
		async ({ params, body, status }) => {
			const [row] = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(eq(schema.sponsorPurchases.id, params.id));
			if (!row) return status(404, { error: "unknown purchase" });

			const out = await rejectPurchase(row, { reason: body?.reason });
			if (!out.ok) return status(502, { error: `refund failed: ${out.error}` });

			const [after] = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(eq(schema.sponsorPurchases.id, params.id));
			return {
				ok: true,
				refundId: out.refundId,
				/** True when this reject found a refund already issued and made none. */
				alreadyRefunded: out.already,
				purchase: creativeOf(after),
			};
		},
		{ body: RefundBody },
	)

	/**
	 * Every campaign the site has ever sold, with what it did.
	 *
	 * Holds are excluded: an abandoned checkout is not a campaign, and a list that
	 * counts them is a list nobody trusts. `site` is the whole board's figures from
	 * the same `adStats()` the public page publishes, so a campaign's numbers can
	 * be read against the site's rather than against a guess.
	 */
	.get("/campaigns", async () => {
		const rows = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(
				inArray(schema.sponsorPurchases.status, [
					"paid",
					"submitted",
					"live",
					"rejected",
					"refunded",
				] as const),
			)
			.orderBy(desc(schema.sponsorPurchases.createdAt));

		const now = new Date();
		return {
			now: now.toISOString(),
			site: await adStats(),
			campaigns: await Promise.all(
				rows.map(async (p) => ({
					...creativeOf(p),
					metrics: await metricsOf(p, now),
				})),
			),
		};
	})

	/**
	 * The whole board: what is sold, to whom, until when, and what is still on
	 * sale. Straight from `occupancy()` — the same one comparison `board()` and
	 * every sale path use, so this screen can never disagree with the site about
	 * whether a slot is free.
	 */
	.get("/slots", async () => {
		const taken = await occupancy();
		const now = new Date();
		return {
			now: now.toISOString(),
			slots: content.slots.map((slot) => {
				const p = taken.get(slot.id);
				return {
					...slot,
					available: !p,
					occupant: p
						? {
								...creativeOf(p),
								daysRemaining: p.endsAt ? daysBetween(now, p.endsAt) : null,
							}
						: null,
				};
			}),
		};
	});
