import { timingSafeEqual } from "node:crypto";
import { cors } from "@elysiajs/cors";
import { collectProjects } from "core/src/content";
import { DEFAULT_LANG, isLang, type Lang } from "core/src/index";
import { spendOf } from "core/src/plan";
import { paths } from "core/src/routes";
import {
	allocate,
	discountPct,
	isTerm,
	limitFor,
	ORDER_MAX_SLOTS,
	orderTotalCents,
	orderUndiscountedCents,
	SPONSOR_TERMS,
} from "core/src/sponsorship";
import {
	and,
	count,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNull,
	sql,
} from "drizzle-orm";
import { Elysia, t } from "elysia";
import {
	type AdPage,
	adStats,
	asPage,
	purchaseStats,
	recordClick,
	recordImpressions,
	scoreRequest,
} from "./ad-analytics";
import { platformAdminApi, RefundBody } from "./admin-api";
import {
	canManage,
	consumeMagicLink,
	createMagicLink,
	detailsTokenHolder,
	issueSession,
	mintDetailsToken,
	type Role,
	redirectFor,
	roleOf,
	SESSION_COOKIE,
	sessionOf,
	visibleEmails,
	withinRateLimit,
} from "./auth";
import {
	content,
	projectsByProduct,
	type SlotDef,
	slotById,
	slotLabel,
	trackedSpendCents,
} from "./content";
import { db, schema } from "./db";
import { applyMigrations } from "./db/migrate";
import { normalizeEmail } from "./db/schema";
import { seedDev } from "./db/seed";
import { authEnabled, banner, env } from "./env";
import { log } from "./log";
import {
	MAX_LOGO_BYTES,
	normalizeTint,
	pruneOrphanLogos,
	readLogo,
	storeLogo,
} from "./logos";
import { invitedMail, mailer, paidMail, signInMail } from "./mail";
import { conflictingSlots, occupancy, type PurchaseRow } from "./occupancy";
import { paymentProvider } from "./payments";
import { rebuild, rebuildState, startRebuildWorker } from "./rebuild";
import { approvePurchase, refundPurchase, settledState } from "./review";
import { siteStats, siteStatsDiagnostics } from "./site-stats";
import { settledOrderIdFrom } from "./stripe";
import { taggedUrl } from "./utm";
import {
	hashClient,
	hashNetwork,
	isDatacenter,
	issueVoterId,
	scoreVote,
	TRUST_THRESHOLD,
	verifyTurnstile,
	verifyVoterId,
} from "./vote-identity";

const ADMIN_TOKEN = env.adminToken;

/** Keyed on the Request object itself, which stays the same reference across every lifecycle hook. */
const requestStarts = new WeakMap<Request, { id: string; startMs: number }>();

const clientIp = (
	headers: Record<string, string | undefined>,
	fallback?: string,
) => headers["x-forwarded-for"]?.split(",")[0]?.trim() ?? fallback ?? "unknown";

/** Elysia types cookie values as unknown until a schema is declared. */
const readVoterCookie = (value: unknown) =>
	verifyVoterId(typeof value === "string" && value ? value : undefined);

/** Issued by both `/api/session` and the vote endpoint; keep the cookie attributes identical between the two. */
const issueVoterCookie = (cookie: {
	cri_v?: { set: (options: Record<string, unknown>) => void };
}): string => {
	const id = issueVoterId();
	cookie.cri_v?.set({
		value: id,
		httpOnly: true,
		sameSite: "lax",
		secure: env.isProduction,
		maxAge: 60 * 60 * 24 * 365,
		path: "/",
	});
	return id;
};

/** `!==` short-circuits on the first differing byte, which leaks timing information; timingSafeEqual requires equal-length buffers so length is checked first separately. */
const secretEquals = (a: string, b: string): boolean => {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Per-IP hourly cap on public endpoints that write rows (waitlist, quotes, reserve) — these can't move money, so the risk is queue/table spam, not theft.
 * Vote and ad endpoints deliberately skip this: they're scored instead of capped, see vote-identity.ts.
 * Shares the `rate_limits` table with the ad scorer under a `req:` prefix, keyed by hour so a bucket ages out rather than being deleted.
 */
const HOURLY_WRITE_LIMIT = 20;

async function overWriteLimit(bucket: string, ip: string): Promise<boolean> {
	const hour = Math.floor(Date.now() / 3_600_000);
	const key = `req:${bucket}:${ip}:${hour}`;
	const [row] = await db
		.select({ n: schema.rateLimits.count })
		.from(schema.rateLimits)
		.where(eq(schema.rateLimits.key, key));
	if ((row?.n ?? 0) >= HOURLY_WRITE_LIMIT) return true;
	await db
		.insert(schema.rateLimits)
		.values({ key, count: 1, windowStart: new Date() })
		.onConflictDoUpdate({
			target: schema.rateLimits.key,
			set: { count: sql`${schema.rateLimits.count} + 1` },
		});
	return false;
}

/** Deletes uploaded logos no purchase row (in any status) points at, once a day old — see `pruneOrphanLogos`. */
async function sweepLogos(): Promise<number> {
	const rows = await db
		.select({ logoUrl: schema.sponsorPurchases.logoUrl })
		.from(schema.sponsorPurchases);
	const keep = new Set(
		rows.flatMap((r) => {
			const name = r.logoUrl?.startsWith("/api/sponsor-logos/")
				? r.logoUrl.slice("/api/sponsor-logos/".length)
				: null;
			return name ? [name] : [];
		}),
	);
	return pruneOrphanLogos(keep);
}

const requireAdmin = ({
	headers,
	status,
}: {
	headers: Record<string, string | undefined>;
	status: (code: number, body: unknown) => unknown;
}) => {
	if (!ADMIN_TOKEN) return status(503, { error: "ADMIN_TOKEN not configured" });
	if (!secretEquals(headers.authorization ?? "", `Bearer ${ADMIN_TOKEN}`))
		return status(401, { error: "nope" });
};

/** Only trusted, un-nullified votes are ever shown. */
const counted = () =>
	and(
		gte(schema.votes.trust, TRUST_THRESHOLD),
		isNull(schema.votes.nullifiedAt),
	);

/** Live tallies per product slug, one query. */
async function voteCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({ slug: schema.votes.productSlug, n: count() })
		.from(schema.votes)
		.where(counted())
		.groupBy(schema.votes.productSlug);
	return new Map(rows.map((r) => [r.slug, r.n]));
}

/** How many people this project got out of something. */
async function projectCounts(): Promise<Map<string, number>> {
	const rows = await db
		.select({ slug: schema.votes.projectSlug, n: count() })
		.from(schema.votes)
		.where(counted())
		.groupBy(schema.votes.projectSlug);
	return new Map(
		rows.filter((r) => r.slug !== null).map((r) => [r.slug as string, r.n]),
	);
}

async function board() {
	const taken = await occupancy();

	return content.slots.map((slot) => {
		const p = taken.get(slot.id);
		return {
			...slot,
			available: !p,
			takenUntil: p?.endsAt?.toISOString() ?? null,
			sponsor:
				p && p.status === "live" && p.name
					? {
							purchaseId: p.id,
							/** `fr` falls back to the English copy rather than null, so a French reader never sees an empty card. */
							name: { en: p.name, fr: p.nameFr ?? p.name },
							tagline: p.tagline
								? { en: p.tagline, fr: p.taglineFr ?? p.tagline }
								: null,
							url: p.url,
							logoUrl: p.logoUrl,
							/** The card accent the buyer chose, or null for the site's own. */
							tint: p.tint,
						}
					: null,
		};
	});
}

type PricedBasket = {
	months: number;
	totalCents: number;
	undiscountedCents: number;
	lines: { slotId: string; rateCents: number; amountCents: number }[];
};

/** Placement caps are enforced here, not only in the form — this endpoint is public, so a client-side-only rule isn't a rule. */
function priceBasket(
	slotIds: string[],
	months: number,
): PricedBasket | { error: string } {
	if (!isTerm(months)) return { error: "unknown term" };

	// De-duplicated: the same slot twice is one purchase, not two rows fighting over one piece of inventory.
	const ids = [...new Set(slotIds)];
	if (ids.length === 0) return { error: "no slots selected" };
	// Separate from the per-placement caps below — a future placement mustn't silently raise the total.
	if (ids.length > ORDER_MAX_SLOTS) {
		return { error: `at most ${ORDER_MAX_SLOTS} slots per order` };
	}

	const slots = ids.map((id) => slotById.get(id));
	const missing = ids.filter((_, i) => !slots[i]);
	if (missing.length) return { error: `unknown slot: ${missing[0]}` };

	const counts = new Map<string, number>();
	for (const s of slots) {
		const p = (s as SlotDef).placement;
		counts.set(p, (counts.get(p) ?? 0) + 1);
	}
	for (const [placement, n] of counts) {
		const limit = limitFor(placement);
		// 0 means the placement is rendered but not sold (drawn from existing sponsors instead).
		if (limit === 0) {
			return { error: `${placement} slots are not for sale` };
		}
		if (n > limit) {
			return {
				error: `at most ${limit} ${placement} slot${limit === 1 ? "" : "s"} per order`,
			};
		}
	}

	// Refused here rather than in the form: a null price falling through to `orderTotalCents` would quietly bill nothing.
	const unpriced = ids.filter(
		(_, i) => (slots[i] as SlotDef).priceCents === null,
	);
	if (unpriced.length) {
		return { error: `not priced yet: ${unpriced.join(", ")}` };
	}

	const rates = slots.map((s) => (s as SlotDef).priceCents as number);
	// Priced once from the summed 30-day rate, then split — summing per-slot prices would round once per line and drift.
	const totalCents = orderTotalCents(rates, months);
	const shares = allocate(rates, totalCents);

	return {
		months,
		totalCents,
		undiscountedCents: orderUndiscountedCents(rates, months),
		lines: ids.map((slotId, i) => ({
			slotId,
			rateCents: rates[i],
			amountCents: shares[i],
		})),
	};
}

/** The ad, supplied at reserve time (before payment) rather than after — a settled payment is then a complete order that can go live by itself. */
type CreativeInput = {
	name: string;
	tagline: string;
	url: string;
	nameFr?: string;
	taglineFr?: string;
	logoUrl?: string;
	tint?: string;
};

async function reserveOrder(
	slotIds: string[],
	email: string,
	months: number,
	status: (code: number, body: unknown) => unknown,
	creative?: CreativeInput,
) {
	const priced = priceBasket(slotIds, months);
	if ("error" in priced) return status(400, priced);

	// The board's `available` flag is advisory only — this endpoint is public and must recheck, or a second sponsor could pay for a slot that's already running.
	const conflicts = await conflictingSlots(priced.lines.map((l) => l.slotId));
	if (conflicts.length) {
		return status(409, {
			error: `already sponsored: ${conflicts.join(", ")}`,
			slotIds: conflicts,
		});
	}

	const orderId = crypto.randomUUID();
	const rows = await db
		.insert(schema.sponsorPurchases)
		.values(
			priced.lines.map((l) => ({
				slotId: l.slotId,
				orderId,
				email,
				months,
				amountCents: l.amountCents,
				// Written onto the hold, so an abandoned checkout takes its creative with it when the hold lapses.
				...(creative
					? {
							name: creative.name,
							nameFr: creative.nameFr ?? creative.name,
							tagline: creative.tagline,
							taglineFr: creative.taglineFr ?? creative.tagline,
							url: creative.url,
							logoUrl: creative.logoUrl ?? null,
							tint: normalizeTint(creative.tint),
							submittedAt: new Date(),
						}
					: {}),
			})),
		)
		.returning({
			id: schema.sponsorPurchases.id,
			slotId: schema.sponsorPurchases.slotId,
		});

	return {
		orderId,
		/** The first line, so the existing single-slot callers keep working. */
		purchaseId: rows[0].id,
		purchaseIds: rows.map((r) => r.id),
		amountCents: priced.totalCents,
		months,
		undiscountedCents: priced.undiscountedCents,
		lines: priced.lines,
		provider: paymentProvider?.id ?? null,
	};
}

/** `lang` is optional and unvalidated so an older client can still pay; `langOf` maps anything unrecognised to the default rather than a 422. */
const CheckoutBody = t.Optional(
	t.Object({ lang: t.Optional(t.String()) }, { additionalProperties: true }),
);

const langOf = (body: { lang?: string } | undefined | null): Lang =>
	isLang(body?.lang) ? body.lang : DEFAULT_LANG;

/**
 * Charges the sum of the stored line amounts rather than re-deriving a price, so this can never disagree with what `allocate` quoted.
 * One creative token per order, held on the first line (`detailsTokenHash` is unique) — the details endpoint applies it across the whole order.
 */
async function settleOrder(
	rows: PurchaseRow[],
	status: (code: number, body: unknown) => unknown,
	/** The language the buyer is reading, for the provider's return URLs. */
	lang: Lang,
) {
	if (!paymentProvider) {
		return status(503, { error: "no payment provider configured" });
	}
	// Bound to a const so the narrowing survives into the transaction callback.
	const provider = paymentProvider;
	const open = rows.filter((r) => r.status === "hold");
	if (open.length === 0) return status(409, { error: "not on hold" });

	const amountCents = open.reduce((n, r) => n + r.amountCents, 0);
	const first = open[0];

	// Holds reserve nothing, deliberately, so someone else may have paid for one of these slots since — refuse the sale rather than take money for gone inventory.
	const conflicts = await conflictingSlots(
		open.map((r) => r.slotId),
		first.orderId,
	);
	if (conflicts.length) {
		return status(409, {
			error: `already sponsored: ${conflicts.join(", ")}`,
			slotIds: conflicts,
		});
	}

	// Resume the existing payment page rather than minting a second one — Stripe would happily charge both.
	const existing =
		first.providerRef && paymentProvider.resume
			? await paymentProvider.resume(first.providerRef)
			: null;

	const checkout =
		existing ??
		(await paymentProvider.createCheckout({
			purchaseId: first.orderId ?? first.id,
			slotId: open.map((r) => r.slotId).join(","),
			amountCents,
			months: first.months,
			email: first.email,
			lang,
		}));

	// Minted only once money is in — never exists on an unpaid order. Only the hash is written down.
	const details = checkout.settled ? mintDetailsToken() : null;

	// One transaction, not N updates: a half-settled order would leave a sponsor who paid for three slots receiving one.
	db.transaction((tx) => {
		for (const [i, row] of open.entries()) {
			tx.update(schema.sponsorPurchases)
				.set({
					provider: provider.id,
					// Unique per row: one provider reference, one line suffix.
					providerRef:
						open.length === 1
							? checkout.providerRef
							: `${checkout.providerRef}#${i}`,
					// stripeSessionId is UNIQUE and one session covers the whole order, so only line 0 (which also holds the details token) can carry it.
					...(i === 0 && provider.id === "stripe"
						? { stripeSessionId: checkout.providerRef }
						: {}),
					...(checkout.settled
						? {
								...settledState(row, new Date()),
								...(i === 0 && details ? details.columns : {}),
							}
						: {}),
				})
				.where(eq(schema.sponsorPurchases.id, row.id))
				.run();
		}
	});

	// Settled here means a provider that returns instantly (the fake one); one that settles later sends the same mail from its webhook instead.
	if (checkout.settled) {
		void sendPaidMail({
			email: first.email,
			slots: open.map((r) => slotLabel(r.slotId)),
			amountCents,
			months: first.months,
			lang,
		});
	}

	return {
		provider: paymentProvider.id,
		live: paymentProvider.live,
		settled: checkout.settled,
		redirectUrl: checkout.redirectUrl,
		orderId: first.orderId ?? null,
		amountCents,
		slotIds: open.map((r) => r.slotId),
		/** Present only on a settled order; this is the creative-form key. */
		detailsToken: details?.token ?? null,
	};
}

/** Never awaited: the rows are already written by the time this runs, so a slow/dead SMTP must degrade to a logged failure, not fail an already-succeeded request — and on the Stripe path, must not push the response past the webhook's retry timeout. */
async function sendPaidMail(o: {
	email: string;
	slots: string[];
	amountCents: number;
	months: number;
	lang: Lang;
}): Promise<void> {
	/** A sign-in link rather than a bare dashboard URL — lands them straight on it; ordinary magic link, single-use and expiring like any other. */
	const url = authEnabled
		? await createMagicLink(o.email, paths.dashboard(o.lang))
		: `${env.webOrigin}${paths.dashboard(o.lang)}`;

	void mailer.send({
		...paidMail({
			dashboardUrl: url,
			slots: o.slots,
			amountCents: o.amountCents,
			months: o.months,
			currency: env.payments.stripe.currency,
		}),
		to: o.email,
	});
}

const app = new Elysia()
	.use(
		cors({
			// Credentials require an explicit origin — "*" is rejected once cookies are involved.
			origin: env.webOrigins,
			credentials: true,
		}),
	)

	.onRequest(({ request }) => {
		requestStarts.set(request, {
			id: crypto.randomUUID(),
			startMs: Date.now(),
		});
	})
	// `route` is the matcher pattern (e.g. "/api/sponsor/creative/:token"), never the interpolated URL — path params and query strings can carry tokens.
	.onAfterResponse(({ request, route, set, responseValue }) => {
		const start = requestStarts.get(request);
		// `redirect()` hands back a Response directly, bypassing `set.status` — read it off the response itself when that happens.
		const status =
			responseValue instanceof Response
				? responseValue.status
				: (set.status ?? 200);
		const fields = {
			reqId: start?.id,
			method: request.method,
			path: route,
			status,
			durationMs: start ? Date.now() - start.startMs : undefined,
		};
		if (route === "/health") log.debug(fields, "request");
		else log.info(fields, "request");
	})
	.onError(({ request, route, code, error }) => {
		const start = requestStarts.get(request);
		log.error(
			{
				reqId: start?.id,
				method: request.method,
				path: route,
				code,
				err: error,
			},
			"request error",
		);
	})

	.get("/health", () => ({ ok: true }))

	.get("/api/categories", () => content.categories)

	/** Projects with how many people each one got out of something. */
	.get("/api/projects", async () => {
		const counts = await projectCounts();
		return collectProjects(content.products).map((p) => ({
			...p,
			replacedCount: counts.get(p.slug) ?? 0,
		}));
	})

	/** The whole list, straight from git plus live vote counts — filtering and search happen client-side since the payload is small. */
	.get("/api/products", async () => {
		const votes = await voteCounts();
		return content.products.map((p) => ({
			...p,
			switchedCount: votes.get(p.slug) ?? 0,
		}));
	})

	.get("/api/stats", async () => {
		// Must apply the same trust filter as the per-product counts, or a nullified campaign keeps inflating the headline number.
		const [switches] = await db
			.select({ n: count() })
			.from(schema.votes)
			.where(counted());
		return {
			products: content.products.length,
			categories: content.categories.length,
			alternatives: content.products.reduce(
				(n, p) => n + p.alternatives.length,
				0,
			),
			ossAlternatives: content.products.reduce(
				(n, p) => n + p.alternatives.filter((a) => a.kind === "oss").length,
				0,
			),
			notYet: content.products.filter((p) => p.verdict === "not-yet").length,
			monthlySpendCents: trackedSpendCents,
			switches: switches.n,
		};
	})

	/** Issues the voter cookie on first load, so a vote is never the request that mints the identity — see `freshCookie` scoring. */
	.get("/api/session", ({ cookie }) => {
		const existing = readVoterCookie(cookie.cri_v?.value);
		if (existing) return { ok: true, existing: true };
		issueVoterCookie(cookie);
		return { ok: true, existing: false };
	})

	/** Public traffic figures from Umami; `{ unavailable: true }` rather than a 503 when it's off or unreachable so the page still renders. */
	.get(
		"/api/site/stats",
		async () => (await siteStats()) ?? { unavailable: true },
	)

	/** Why the stats page is empty, in one request — tells apart unset config, wrong URL, bad credentials, no access, or genuinely no traffic. Admin-only: names the instance, account and website id. */
	.get("/api/admin/site/stats/diag", async (ctx) => {
		const denied = requireAdmin(ctx);
		return denied ?? (await siteStatsDiagnostics());
	})

	/** Always answers `{ ok: true }` — a truthful "no such account" would make this unauthenticated endpoint an oracle for who our customers are. Rate limit is per address, so it also can't mailbomb one inbox. */
	.post(
		"/api/auth/request",
		async ({ body, status }) => {
			if (!authEnabled) return status(503, { error: "sign-in disabled" });

			const email = normalizeEmail(body.email);
			const ok = { ok: true } as const;
			if (!(await withinRateLimit(email))) return ok;

			const link = await createMagicLink(email);
			const mail = signInMail(link, Math.round(env.magicLinkTtlMs / 60_000));
			// Fire and forget — a slow SMTP hop must not hold the response open long enough to time-leak whether the address exists.
			void mailer.send({ ...mail, to: email });
			return ok;
		},
		{
			body: t.Object({ email: t.String({ format: "email", maxLength: 320 }) }),
		},
	)

	/** Redirect (not JSON) since a human clicks this from a mail client. Destination is built from `WEB_ORIGIN` and a fixed path, never a query param — that would make this a phishing endpoint on our own domain. */
	.get("/api/auth/callback", async ({ query, cookie, redirect, status }) => {
		if (!authEnabled) return status(503, { error: "sign-in disabled" });

		const token = typeof query.token === "string" ? query.token : "";
		// Read before spending it — `consumeMagicLink` marks the row used.
		const dest = token ? await redirectFor(token) : "";
		const email = token ? await consumeMagicLink(token) : null;
		if (!email) {
			// Expired, already used, or never existed — one message for all three, so a token sprayer can't tell which guesses were close.
			log.warn("auth: rejected callback (bad, used or expired token)");
			return redirect(`${env.webOrigin}/en/signin?error=link`, 302);
		}

		cookie[SESSION_COOKIE]?.set({
			value: await issueSession(email),
			httpOnly: true,
			sameSite: "lax",
			secure: env.isProduction,
			maxAge: Math.round(env.sessionTtlMs / 1000),
			path: "/",
		});
		return redirect(`${env.webOrigin}${dest || "/en/signin?ok=1"}`, 302);
	})

	/** Who am I? The one endpoint the frontend needs to render a signed-in state. */
	.get("/api/me", async ({ cookie, status }) => {
		const email = await sessionOf(cookie);
		return email ? { email } : status(401, { error: "not signed in" });
	})

	/** A purchase is keyed by the email that paid for it, so "my campaigns" is just an equality check. Holds excluded — an abandoned checkout isn't a campaign. */
	.get("/api/me/campaigns", async ({ cookie, status }) => {
		const email = await sessionOf(cookie);
		if (!email) return status(401, { error: "not signed in" });

		// Their own ads plus every org they belong to. One hop — see visibleEmails.
		const mine = await visibleEmails(email);
		const rows = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(
				and(
					inArray(schema.sponsorPurchases.email, mine),
					inArray(schema.sponsorPurchases.status, [
						"paid",
						"submitted",
						"live",
						"rejected",
						"refunded",
					] as const),
				),
			)
			.orderBy(desc(schema.sponsorPurchases.createdAt));

		const campaigns = await Promise.all(
			rows.map(async (p) => ({
				id: p.id,
				slotId: p.slotId,
				status: p.status,
				months: p.months,
				amountCents: p.amountCents,
				startsAt: p.startsAt?.toISOString() ?? null,
				endsAt: p.endsAt?.toISOString() ?? null,
				name: p.name,
				tagline: p.tagline,
				url: p.url,
				logoUrl: p.logoUrl,
				tint: p.tint,
				stats: await purchaseStats(p.id),
			})),
		);

		const totals = campaigns.reduce(
			(acc, c) => ({
				impressions: acc.impressions + c.stats.impressions,
				clicks: acc.clicks + c.stats.clicks,
			}),
			{ impressions: 0, clicks: 0 },
		);

		return {
			email,
			campaigns,
			totals: {
				...totals,
				// 0/0 is not a rate. Null, and the page prints a dash.
				ctr:
					totals.impressions > 0
						? Math.round((totals.clicks / totals.impressions) * 10_000) / 100
						: null,
			},
		};
	})

	/** `org-owner` may add/remove, `org-user` may only look. The payer is implicitly an org-owner with no membership row, so nobody they added can remove them. */
	.get("/api/me/team", async ({ cookie, status }) => {
		const email = await sessionOf(cookie);
		if (!email) return status(401, { error: "not signed in" });

		const owners = await visibleEmails(email);
		const orgs = await Promise.all(
			owners.map(async (owner) => {
				const members = (
					await db
						.select({
							memberEmail: schema.orgMembers.memberEmail,
							role: schema.orgMembers.role,
							createdAt: schema.orgMembers.createdAt,
						})
						.from(schema.orgMembers)
						.where(
							and(
								eq(schema.orgMembers.ownerEmail, owner),
								isNull(schema.orgMembers.revokedAt),
							),
						)
				).map((m) => ({
					email: m.memberEmail,
					role: (m.role === "owner" ? "org-owner" : "org-user") as Role,
					since: m.createdAt.toISOString(),
				}));

				/** Returned rather than inferred client-side from raw membership rows — same `roleOf` the write endpoints enforce with. */
				const role = await roleOf(email, owner);

				return {
					owner,
					/** Who is actually charged — a promoted member and the payer are both `org-owner`, but only the payer has a card on file. */
					isPayer: owner === email,
					role,
					canManage: canManage(role),
					members,
					/** How many placements this account has, so an empty one can be hidden. */
					purchases: (
						await db
							.select({ id: schema.sponsorPurchases.id })
							.from(schema.sponsorPurchases)
							.where(
								and(
									eq(schema.sponsorPurchases.email, owner),
									inArray(schema.sponsorPurchases.status, [
										"paid",
										"submitted",
										"live",
									] as const),
								),
							)
					).length,
				};
			}),
		);

		/** Hides the caller's own account when empty — an org-user otherwise saw a phantom second account the dashboard defaulted to. */
		return {
			email,
			orgs: orgs.filter(
				(o) => !o.isPayer || o.purchases > 0 || o.members.length > 0,
			),
		};
	})

	/** Emailing an arbitrary address must be fenced: org-owner only, org is capped, and the mail body is fixed — no free-text field, the usual invite-spam payload. */
	.post(
		"/api/me/team",
		async ({ body, cookie, status }) => {
			const session = await sessionOf(cookie);
			if (!session) return status(401, { error: "not signed in" });

			const owner = normalizeEmail(body.owner ?? session);
			if (!canManage(await roleOf(session, owner))) {
				return status(403, { error: "not an owner of this org" });
			}

			const member = normalizeEmail(body.email);
			if (member === owner) {
				return status(400, { error: "that address already owns this org" });
			}

			const existing = await db
				.select({ id: schema.orgMembers.id })
				.from(schema.orgMembers)
				.where(
					and(
						eq(schema.orgMembers.ownerEmail, owner),
						isNull(schema.orgMembers.revokedAt),
					),
				);
			if (existing.length >= env.orgMaxMembers) {
				return status(400, {
					error: `at most ${env.orgMaxMembers} members per account`,
				});
			}

			// The client speaks org-owner/org-user; the column stores owner/user — mapped here so the enum never carries `org-` on disk.
			const role = body.role ?? "org-user";
			const stored = role === "org-owner" ? "owner" : "user";

			await db
				.insert(schema.orgMembers)
				.values({
					ownerEmail: owner,
					memberEmail: member,
					role: stored,
					invitedBy: session,
				})
				.onConflictDoUpdate({
					target: [schema.orgMembers.ownerEmail, schema.orgMembers.memberEmail],
					// Re-adding somebody removed restores them rather than erroring on the unique index.
					set: {
						role: stored,
						revokedAt: null,
						invitedBy: session,
					},
				});

			// A sign-in link, so being added is one click rather than a second email round-trip.
			if (authEnabled) {
				const link = await createMagicLink(
					member,
					paths.dashboard(DEFAULT_LANG),
				);
				void mailer.send({
					...invitedMail({ link, owner, role }),
					to: member,
				});
			}
			return { ok: true };
		},
		{
			body: t.Object({
				email: t.String({ format: "email", maxLength: 320 }),
				role: t.Optional(
					t.Union([t.Literal("org-owner"), t.Literal("org-user")]),
				),
				/** Which org, when the caller belongs to more than one. */
				owner: t.Optional(t.String({ format: "email", maxLength: 320 })),
			}),
		},
	)

	/** Remove somebody. Revoked, not deleted — see the schema note. */
	.post(
		"/api/me/team/remove",
		async ({ body, cookie, status }) => {
			const session = await sessionOf(cookie);
			if (!session) return status(401, { error: "not signed in" });

			const owner = normalizeEmail(body.owner ?? session);
			if (!canManage(await roleOf(session, owner))) {
				return status(403, { error: "not an owner of this org" });
			}
			await db
				.update(schema.orgMembers)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(schema.orgMembers.ownerEmail, owner),
						eq(schema.orgMembers.memberEmail, normalizeEmail(body.email)),
					),
				);
			return { ok: true };
		},
		{
			body: t.Object({
				email: t.String({ format: "email", maxLength: 320 }),
				owner: t.Optional(t.String({ format: "email", maxLength: 320 })),
			}),
		},
	)

	.post("/api/auth/logout", ({ cookie }) => {
		cookie[SESSION_COOKIE]?.remove();
		return { ok: true };
	})

	/**
	 * "I switched off X to Y." No login: identity is a signed httpOnly cookie
	 * plus network-level signals, and every vote is scored and kept auditable.
	 */
	.post(
		"/api/products/:slug/vote",
		async ({ params, body, headers, cookie, server, request, status }) => {
			const product = content.products.find((p) => p.slug === params.slug);
			if (!product) return status(404, { error: "unknown product" });

			// The project must be one this product actually lists, or the counter
			// becomes a free-text write endpoint.
			if (body.projectSlug) {
				const known = projectsByProduct.get(params.slug);
				if (!known?.has(body.projectSlug)) {
					return status(400, { error: "unknown project for this product" });
				}
			}

			let voter = readVoterCookie(cookie.cri_v?.value);
			const freshCookie = voter === null;
			if (!voter) {
				voter = verifyVoterId(issueVoterCookie(cookie));
			}
			if (!voter) return status(500, { error: "could not issue identity" });

			const ip = clientIp(headers, server?.requestIP(request)?.address);
			const netHash = hashNetwork(ip);
			const clientHash = hashClient(headers);
			const since = new Date(Date.now() - 86_400_000);

			const [[net], [client]] = await Promise.all([
				db
					.select({ n: count() })
					.from(schema.votes)
					.where(
						and(
							eq(schema.votes.netHash, netHash),
							gt(schema.votes.createdAt, since),
						),
					),
				db
					.select({ n: count() })
					.from(schema.votes)
					.where(
						and(
							eq(schema.votes.clientHash, clientHash),
							gt(schema.votes.createdAt, since),
						),
					),
			]);

			const { trust, reasons } = scoreVote({
				humanVerified: await verifyTurnstile(body.token, ip),
				networkVotesToday: net.n,
				clientVotesToday: client.n,
				datacenter: isDatacenter(headers),
				freshCookie,
			});

			await db
				.insert(schema.votes)
				.values({
					productSlug: params.slug,
					projectSlug: body.projectSlug ?? null,
					voterId: voter.id,
					netHash,
					clientHash,
					trust,
					reasons,
				})
				.onConflictDoUpdate({
					target: [schema.votes.productSlug, schema.votes.voterId],
					// Re-voting corrects where you went; it never re-rolls the score
					// upward, so a low-trust voter cannot retry into a good one.
					set: { projectSlug: body.projectSlug ?? null },
				});

			const [{ n }] = await db
				.select({ n: count() })
				.from(schema.votes)
				.where(and(eq(schema.votes.productSlug, params.slug), counted()));

			// The voter always sees their click land, even at low trust — telling them otherwise teaches an attacker the threshold.
			return { switchedCount: n, counted: trust >= TRUST_THRESHOLD };
		},
		{
			body: t.Object({
				projectSlug: t.Optional(t.String({ maxLength: 200 })),
				/** Turnstile response, when the site key is configured. */
				token: t.Optional(t.String({ maxLength: 4000 })),
			}),
		},
	)

	.post(
		"/api/quotes",
		async ({ body, headers, server, request, status }) => {
			const ip = clientIp(headers, server?.requestIP(request)?.address);
			if (await overWriteLimit("quotes", ip))
				return status(429, { error: "too many requests, try again later" });
			const slugs = body.productSlugs ?? [];
			// Priced server-side via the same `spendOf` the page used, so a tampered client can't inflate the lead — see pricing.basis in packages/core/src/plan.ts.
			const currentSpendCents = spendOf(
				content.products.filter((p) => slugs.includes(p.slug)),
				body.seats ?? 1,
			).monthlyCents;

			const [row] = await db
				.insert(schema.quoteRequests)
				.values({ ...body, productSlugs: slugs, currentSpendCents })
				.returning({ id: schema.quoteRequests.id });
			return { id: row.id, currentSpendCents };
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				company: t.Optional(t.String({ maxLength: 200 })),
				seats: t.Optional(t.Integer({ minimum: 1, maximum: 100_000 })),
				productSlugs: t.Optional(t.Array(t.String(), { maxItems: 200 })),
				/** The plan as built, e.g. `notion~appflowy,slack~keep` — same string the page keeps in its URL, says what they're switching to. */
				plan: t.Optional(t.String({ maxLength: 8000 })),
				message: t.Optional(t.String({ maxLength: 4000 })),
			}),
		},
	)

	// ---- sponsorship ----

	.get("/api/slots", () => board())

	.post(
		"/api/waitlist",
		async ({ body, headers, server, request, status }) => {
			const ip = clientIp(headers, server?.requestIP(request)?.address);
			if (await overWriteLimit("waitlist", ip))
				return status(429, { error: "too many requests, try again later" });
			await db.insert(schema.waitlist).values(body).onConflictDoNothing();
			return { ok: true };
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				slotId: t.Optional(t.String({ maxLength: 80 })),
			}),
		},
	)

	/** Opens a purchase; returns what to charge. Deliberately does NOT reserve the slot. */
	.post(
		"/api/slots/:id/reserve",
		async ({ params, body, status, headers, server, request }) => {
			const ip = clientIp(headers, server?.requestIP(request)?.address);
			if (await overWriteLimit("reserve", ip))
				return status(429, { error: "too many requests, try again later" });
			// Kept as a documented URL; delegates to reserveOrder rather than duplicating the pricing.
			return reserveOrder(
				[params.id, ...(body.slotIds ?? [])],
				body.email,
				body.months ?? 1,
				status,
			);
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				/** Lock-in term: 1, 3 or 12 months. */
				months: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
				/** Extra slots to buy in the same order as `:id`. */
				slotIds: t.Optional(
					t.Array(t.String({ maxLength: 80 }), { maxItems: 60 }),
				),
			}),
		},
	)

	/** Reserve a whole basket: several category slots plus at most one rail. Deliberately does NOT reserve anything — whoever pays first wins. */
	.post(
		"/api/orders/reserve",
		async ({ body, status, headers, server, request }) => {
			const ip = clientIp(headers, server?.requestIP(request)?.address);
			if (await overWriteLimit("reserve", ip))
				return status(429, { error: "too many requests, try again later" });
			return reserveOrder(
				body.slotIds,
				body.email,
				body.months ?? 1,
				status,
				body.creative,
			);
		},
		{
			body: t.Object({
				email: t.String({ format: "email" }),
				months: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
				slotIds: t.Array(t.String({ maxLength: 80 }), {
					minItems: 1,
					maxItems: 60,
				}),
				/** Optional only so an older client keeps working — without it, the order settles to `paid` and waits in the admin queue instead of going live blank. */
				creative: t.Optional(
					t.Object({
						name: t.String({ minLength: 1, maxLength: 60 }),
						tagline: t.String({ minLength: 1, maxLength: 120 }),
						url: t.String({ format: "uri", maxLength: 500 }),
						nameFr: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
						taglineFr: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
						logoUrl: t.Optional(t.String({ maxLength: 500 })),
						tint: t.Optional(t.String({ maxLength: 7 })),
					}),
				),
			}),
		},
	)

	/** Price a basket without committing to it, so the UI never has to guess. */
	.post(
		"/api/orders/quote",
		({ body, status }) => {
			const priced = priceBasket(body.slotIds, body.months ?? 1);
			return "error" in priced ? status(400, priced) : priced;
		},
		{
			body: t.Object({
				months: t.Optional(t.Integer({ minimum: 1, maximum: 12 })),
				slotIds: t.Array(t.String({ maxLength: 80 }), { maxItems: 60 }),
			}),
		},
	)

	/** The terms on offer and what each multiplies the 30-day rate by. */
	.get("/api/sponsor/terms", () => ({
		terms: SPONSOR_TERMS.map((term) => ({
			...term,
			discountPct: discountPct(term),
		})),
		provider: paymentProvider?.id ?? null,
		live: paymentProvider?.live ?? false,
	}))

	/** 503 when no payment provider is configured — never a fallback; see payments.ts, the fake provider hands out real inventory for free. */
	.post(
		"/api/sponsor/:purchaseId/checkout",
		async ({ params, body, status }) => {
			const [p] = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(eq(schema.sponsorPurchases.id, params.purchaseId));
			if (!p) return status(404, { error: "unknown purchase" });
			// A purchase is a line of an order; paying for one line pays for the order.
			return settleOrder(
				p.orderId
					? await db
							.select()
							.from(schema.sponsorPurchases)
							.where(eq(schema.sponsorPurchases.orderId, p.orderId))
					: [p],
				status,
				langOf(body),
			);
		},
		{ body: CheckoutBody },
	)

	/** Pay for every slot in one order, in one charge. */
	.post(
		"/api/orders/:orderId/checkout",
		async ({ params, body, status }) => {
			const rows = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(eq(schema.sponsorPurchases.orderId, params.orderId));
			if (rows.length === 0) return status(404, { error: "unknown order" });
			return settleOrder(rows, status, langOf(body));
		},
		{ body: CheckoutBody },
	)

	/**
	 * Stripe's callback — the only thing that turns a hold into a paid slot; the success_url redirect proves nothing.
	 * `parse: "text"` because Stripe signs the raw bytes — a parsed and re-serialised body never verifies.
	 * Idempotent: scoped to rows still on `hold`, so a retried delivery finds none and answers 200.
	 */
	.post(
		"/api/stripe/webhook",
		async ({ body, headers, status }) => {
			let settlement: Awaited<ReturnType<typeof settledOrderIdFrom>>;
			try {
				settlement = await settledOrderIdFrom(
					typeof body === "string" ? body : "",
					headers["stripe-signature"],
				);
			} catch (e) {
				// Detail goes to the log, not the caller — this route is public and Stripe's message would be free reconnaissance for a prober.
				log.error({ err: e }, "stripe webhook rejected");
				return status(400, { error: "invalid signature" });
			}
			if (!settlement) return { ok: true };
			const { orderId, sessionId, paymentIntent } = settlement;

			const rows = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(
					and(
						eq(schema.sponsorPurchases.orderId, orderId),
						eq(schema.sponsorPurchases.status, "hold"),
					),
				);
			if (rows.length === 0) {
				// Normally a redelivery of an event already applied — but could be a second payment for an already-settled order (buyer charged twice).
				log.warn(
					{ orderId, sessionId },
					"stripe webhook: no open rows for order — expected for a redelivery; if this session is a second payment, refund it",
				);
				return { ok: true };
			}

			// Money is already in, so refusing isn't an option — but log it if another order took the slot in the meantime.
			const conflicts = await conflictingSlots(
				rows.map((r) => r.slotId),
				orderId,
			);
			if (conflicts.length) {
				log.error(
					{ orderId, conflicts, paymentIntent: paymentIntent ?? null },
					"paid but unavailable — already sponsored by someone else, refund the payment intent",
				);
			}

			const paidAt = new Date();
			const details = mintDetailsToken();
			// One transaction: a half-settled order would hand the buyer a token unlocking only part of what they bought.
			db.transaction((tx) => {
				for (const [i, row] of rows.entries()) {
					tx.update(schema.sponsorPurchases)
						.set({
							...settledState(row, paidAt),
							...(paymentIntent ? { stripePaymentIntent: paymentIntent } : {}),
							// Only if the order doesn't already hold one — a raced redelivery must not issue a second key.
							...(i === 0 && !rows.some((r) => r.detailsTokenHash)
								? details.columns
								: {}),
						})
						.where(eq(schema.sponsorPurchases.id, row.id))
						.run();
				}
			});

			// Order id only — the raw token is never logged, since whoever holds it can submit creative for someone else's slot.
			log.info({ orderId, slots: rows.length }, "paid");

			void sendPaidMail({
				email: rows[0].email,
				slots: rows.map((r) => slotLabel(r.slotId)),
				amountCents: rows.reduce((n, r) => n + r.amountCents, 0),
				months: rows[0]?.months ?? 1,
				// The webhook has no reader attached, so it cannot know the language.
				lang: DEFAULT_LANG,
			});
			return { ok: true };
		},
		{ parse: "text" },
	)

	/**
	 * The bridge from "Stripe redirected me back" to the creative form, keyed on the `{CHECKOUT_SESSION_ID}` the browser carries.
	 * A session id is not a secret (it rides in a URL), so it's never the only gate: the row must already be settled by our webhook, and the session is re-verified against Stripe.
	 * The token is minted here rather than read back, since only its hash was kept — this also makes it the recovery path for a lost or expired token.
	 */
	.get("/api/sponsor/by-session/:sessionId", async ({ params, status }) => {
		if (!paymentProvider?.verify) {
			return status(503, { error: "no payment provider configured" });
		}

		const [holder] = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(eq(schema.sponsorPurchases.stripeSessionId, params.sessionId));

		// Not an error: the webhook may not have arrived yet, so the client polls and this says "not settled" rather than "no such thing".
		// Checks "paid" OR "submitted" — creative is now collected before checkout, so "submitted" is the common case, not the exception.
		const rowSettled =
			holder?.status === "paid" || holder?.status === "submitted";
		if (!rowSettled || !holder.detailsTokenHash) {
			return { settled: false, detailsToken: null };
		}

		const { settled } = await paymentProvider.verify(params.sessionId);
		if (!settled) return { settled: false, detailsToken: null };

		const details = mintDetailsToken();
		await db
			.update(schema.sponsorPurchases)
			.set(details.columns)
			.where(eq(schema.sponsorPurchases.id, holder.id));

		return {
			settled: true,
			detailsToken: details.token,
			orderId: holder.orderId,
		};
	})

	/**
	 * Creative is collected after payment via a single-use token, never mailed — `/api/sponsor/by-session/:sessionId` hands it to the browser and re-mints on demand.
	 * One submission covers the whole order: the token lives on the order's first line, and the same creative is written to every slot bought with it.
	 */
	.post(
		"/api/sponsor/details",
		async ({ body, status, cookie }) => {
			const found = await detailsTokenHolder(body.token);
			if (!found.ok) {
				return found.reason === "expired"
					? status(410, {
							error:
								"this link has expired — reopen the payment confirmation to get a new one",
						})
					: status(404, { error: "unknown or already-used token" });
			}
			const holder = found.holder;

			const submittedAt = new Date();
			const scope = holder.orderId
				? eq(schema.sponsorPurchases.orderId, holder.orderId)
				: eq(schema.sponsorPurchases.id, holder.id);

			/** The creative every row gets unless `perSlot` overrides it. */
			const shared = {
				name: body.name,
				nameFr: body.nameFr ?? body.name,
				tagline: body.tagline,
				taglineFr: body.taglineFr ?? body.tagline,
				url: body.url,
				logoUrl: body.logoUrl ?? null,
				tint: normalizeTint(body.tint),
				status: "submitted" as const,
				submittedAt,
				// Single-use: burnt in the same transaction as the write it authorised, so a spent credential can't outlive its use.
				detailsTokenHash: null,
				detailsTokenExpiresAt: null,
			};

			// One transaction, so a buyer submitting four creatives can't end up with the order half `paid`.
			const ids = await db.transaction(async (tx) => {
				const written = await tx
					.update(schema.sponsorPurchases)
					.set(shared)
					.where(and(scope, eq(schema.sponsorPurchases.status, "paid")))
					.returning({
						id: schema.sponsorPurchases.id,
						slotId: schema.sponsorPurchases.slotId,
					});

				// Per-slot overrides, scoped to this order's own slots so a crafted body can't rewrite somebody else's creative.
				const mine = new Set(written.map((r) => r.slotId));
				for (const one of body.perSlot ?? []) {
					if (!mine.has(one.slotId)) continue;
					await tx
						.update(schema.sponsorPurchases)
						.set({
							name: one.name ?? shared.name,
							nameFr: one.nameFr ?? one.name ?? shared.nameFr,
							tagline: one.tagline ?? shared.tagline,
							taglineFr: one.taglineFr ?? one.tagline ?? shared.taglineFr,
							url: one.url ?? shared.url,
							logoUrl: one.logoUrl ?? shared.logoUrl,
							tint:
								one.tint === undefined ? shared.tint : normalizeTint(one.tint),
						})
						.where(and(scope, eq(schema.sponsorPurchases.slotId, one.slotId)));
				}
				return written;
			});

			// Signs them in directly — using this token proves control of holder.email, exactly what the magic-link flow proves. Only when sign-in is configured.
			if (authEnabled) {
				cookie[SESSION_COOKIE]?.set({
					value: await issueSession(holder.email),
					httpOnly: true,
					sameSite: "lax",
					secure: env.isProduction,
					maxAge: Math.round(env.sessionTtlMs / 1000),
					path: "/",
				});
			}

			return { ok: true, slots: ids.length, signedInAs: holder.email };
		},
		{
			body: t.Object({
				token: t.String({ minLength: 16, maxLength: 200 }),
				name: t.String({ minLength: 1, maxLength: 60 }),
				tagline: t.String({ minLength: 1, maxLength: 120 }),
				/** French copy. Absent means the default above is used for both. */
				nameFr: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
				taglineFr: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
				url: t.String({ format: "uri", maxLength: 500 }),
				/**
				 * Absolute (the sponsor hosts it) or a `/api/sponsor-logos/...` path
				 * from our own upload route — so this cannot be `format: "uri"`.
				 */
				logoUrl: t.Optional(t.String({ maxLength: 500 })),
				tint: t.Optional(t.String({ maxLength: 7 })),
				/** Overrides for buyers running a different ad per placement. */
				perSlot: t.Optional(
					t.Array(
						t.Object({
							slotId: t.String({ maxLength: 80 }),
							name: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
							tagline: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
							nameFr: t.Optional(t.String({ minLength: 1, maxLength: 60 })),
							taglineFr: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
							url: t.Optional(t.String({ format: "uri", maxLength: 500 })),
							logoUrl: t.Optional(t.String({ maxLength: 500 })),
							tint: t.Optional(t.String({ maxLength: 7 })),
						}),
						{ maxItems: ORDER_MAX_SLOTS },
					),
				),
			}),
		},
	)

	/**
	 * Which slots a creative token covers, so the form can preview each — the token is the only thing common to both ways of reaching the form.
	 * Returns inventory facts only (slot ids, placement, labels) — no email, amount or order id, since a token is a bearer credential.
	 */
	.get("/api/sponsor/creative/:token", async ({ params, status }) => {
		const found = await detailsTokenHolder(params.token);
		if (!found.ok) {
			return found.reason === "expired"
				? status(410, { error: "this link has expired" })
				: status(404, { error: "unknown or already-used token" });
		}

		// The token sits on line 0; the order is what actually holds every slot.
		const all = found.holder.orderId
			? await db
					.select({ slotId: schema.sponsorPurchases.slotId })
					.from(schema.sponsorPurchases)
					.where(
						and(
							eq(schema.sponsorPurchases.orderId, found.holder.orderId),
							eq(schema.sponsorPurchases.status, "paid"),
						),
					)
			: [{ slotId: found.holder.slotId }];

		return {
			slots: all.flatMap((r) => {
				const def = slotById.get(r.slotId);
				return def
					? [
							{
								id: def.id,
								placement: def.placement,
								rail: def.rail ?? null,
								label: def.label,
								category: def.category ?? null,
							},
						]
					: [];
			}),
		};
	})

	/**
	 * Upload a sponsor icon. Token is optional: the creative is now collected before payment, so a buyer mid-purchase has no token yet — an existing order still proves itself with one.
	 * This makes it an anonymous write, bounded rather than trusted: the same per-IP hourly write cap as the reserve routes (512 KB per file), untouched byte validation in logos.ts (raster only, type sniffed), and anything unclaimed is deleted within a day by `pruneOrphanLogos`. Filenames are uuids, so nothing stored is discoverable either.
	 */
	.post(
		"/api/sponsor/logo",
		async ({ body, status, headers, server, request }) => {
			if (body.token) {
				const found = await detailsTokenHolder(body.token);
				if (!found.ok)
					return status(404, { error: "unknown or already-used token" });
			} else {
				const ip = clientIp(headers, server?.requestIP(request)?.address);
				if (await overWriteLimit("logo", ip))
					return status(429, { error: "too many requests, try again later" });
			}

			const out = await storeLogo(body.file);
			if ("error" in out) return status(400, out);
			// Not awaited: a failed sweep should cost disk, not the buyer's own upload request.
			void sweepLogos().catch(() => {});
			return out;
		},
		{
			body: t.Object({
				/** Absent while the buyer is still filling the form — see above. */
				token: t.Optional(t.String({ minLength: 16, maxLength: 200 })),
				file: t.File({ maxSize: MAX_LOGO_BYTES }),
			}),
		},
	)

	/** Public: it's an ad, rendered on every page. Cached hard — the name is content-addressed (new upload = new uuid), so a cached response can never be stale. */
	.get("/api/sponsor-logos/:name", ({ params, status }) => {
		const found = readLogo(params.name);
		if (!found) return status(404, { error: "not found" });
		const file = Bun.file(found.path);
		return new Response(file, {
			headers: {
				"Content-Type": found.mime,
				"Cache-Control": "public, max-age=31536000, immutable",
				// It is an image, and it is user-supplied. Belt and braces against a
				// browser deciding it is something more interesting.
				"X-Content-Type-Options": "nosniff",
			},
		});
	})

	/**
	 * Counted server-side for the renewal story, then bounced to the sponsor. Page context arrives via query params rather than `Referer` — cross-origin, the default referrer policy would drop it.
	 * Scored like an impression; the redirect happens either way, so a crawler still reaches the sponsor's site but lands in the untrusted half of the table.
	 */
	.get(
		"/api/sponsor/:purchaseId/click",
		async ({
			params,
			query,
			headers,
			cookie,
			server,
			request,
			redirect,
			status,
		}) => {
			const [p] = await db
				.select()
				.from(schema.sponsorPurchases)
				.where(eq(schema.sponsorPurchases.id, params.purchaseId));
			if (!p?.url) return status(404, { error: "unknown sponsor" });

			const ip = clientIp(headers, server?.requestIP(request)?.address);
			const verdict = await scoreRequest(
				headers,
				ip,
				typeof cookie.cri_v?.value === "string"
					? cookie.cri_v.value
					: undefined,
			);

			const slotId =
				typeof query.slot === "string" ? query.slot.slice(0, 80) : p.slotId;
			const page = asPage(query.page);
			const pageSlug =
				typeof query.on === "string" ? query.on.slice(0, 200) : "";

			await recordClick({
				purchaseId: p.id,
				slotId,
				page,
				pageSlug,
				trusted: verdict.trusted,
			});

			// Tagged so the sponsor can see us in their own analytics; an unparseable URL redirects untagged rather than failing — see utm.ts.
			return redirect(
				taggedUrl(p.url, {
					slotId,
					placement: slotById.get(slotId)?.placement ?? "sponsor",
					page,
					pageSlug,
					orderId: p.orderId,
					source: new URL(env.webOrigin).hostname,
				}),
				302,
			);
		},
	)

	/**
	 * One batched `sendBeacon` per page visit — apps/frontend/src/adTracking.ts decides what counts before anything is sent.
	 * Always 204, even when the batch is discarded — an attacker who can see the verdict can tune against the trust threshold.
	 */
	.post(
		"/api/ads/impressions",
		async ({ body, headers, cookie, server, request, set }) => {
			set.status = 204;
			const events = body.events.slice(0, 200);
			if (events.length === 0) return;

			const ip = clientIp(headers, server?.requestIP(request)?.address);
			const verdict = await scoreRequest(
				headers,
				ip,
				typeof cookie.cri_v?.value === "string"
					? cookie.cri_v.value
					: undefined,
				events.length,
			);

			// Slot ids are checked against the inventory in `data/`, same rule the vote endpoint follows.
			const known = events.filter((e) => slotById.has(e.slotId));
			if (known.length === 0) return;

			await recordImpressions(
				known.map((e) => ({
					slotId: e.slotId,
					purchaseId: e.purchaseId ?? "",
					category: slotById.get(e.slotId)?.category ?? "",
				})),
				asPage(body.page) as AdPage,
				(body.pageSlug ?? "").slice(0, 200),
				verdict.trusted,
			);
		},
		{
			body: t.Object({
				page: t.String({ maxLength: 20 }),
				pageSlug: t.Optional(t.String({ maxLength: 200 })),
				events: t.Array(
					t.Object({
						slotId: t.String({ maxLength: 80 }),
						purchaseId: t.Optional(t.String({ maxLength: 80 })),
					}),
					{ maxItems: 200 },
				),
			}),
		},
	)

	/** `reportable: false` is the normal state pre-launch — the client renders a sentence saying so rather than a table of zeros. */
	.get("/api/ads/stats", () => adStats())

	/** The operator's own screens, gated on WHO is signed in rather than a shared token — its own prefix and file, see admin-api.ts. */
	.use(platformAdminApi)

	// ---- admin ----
	.group("/api/admin", (a) =>
		a
			.onBeforeHandle(requireAdmin)
			.get("/quotes", () =>
				db
					.select()
					.from(schema.quoteRequests)
					.orderBy(desc(schema.quoteRequests.createdAt)),
			)
			.get("/waitlist", () => db.select().from(schema.waitlist))

			/** Is the published site current, and what did the queue absorb? */
			.get("/rebuild", () => rebuildState())

			/** Force one now — for a content deploy, or after nullifying a campaign. */
			.post("/rebuild", () => rebuild())

			/** Every vote with its signals — the audit trail before a nuke. */
			.get("/votes", ({ query }) =>
				db
					.select()
					.from(schema.votes)
					.where(
						query.product
							? eq(schema.votes.productSlug, query.product)
							: undefined,
					)
					.orderBy(desc(schema.votes.createdAt))
					.limit(Number(query.limit ?? 500)),
			)

			/** Matches on the signals a campaign shares (network block, client signature, time window) rather than individual votes — that's the shape abuse arrives in. */
			.post(
				"/votes/nullify",
				async ({ body, status }) => {
					const filters = [
						body.netHash ? eq(schema.votes.netHash, body.netHash) : undefined,
						body.clientHash
							? eq(schema.votes.clientHash, body.clientHash)
							: undefined,
						body.since
							? gt(schema.votes.createdAt, new Date(body.since))
							: undefined,
						body.productSlug
							? eq(schema.votes.productSlug, body.productSlug)
							: undefined,
					].filter(Boolean);

					// Refuse to run unfiltered: that would wipe every vote on the site.
					if (filters.length === 0) {
						return status(400, { error: "at least one filter is required" });
					}

					const rows = await db
						.update(schema.votes)
						.set({ nullifiedAt: new Date() })
						.where(and(...filters))
						.returning({ id: schema.votes.id });
					return { nullified: rows.length };
				},
				{
					body: t.Object({
						netHash: t.Optional(t.String({ maxLength: 64 })),
						clientHash: t.Optional(t.String({ maxLength: 64 })),
						since: t.Optional(t.String()),
						productSlug: t.Optional(t.String({ maxLength: 200 })),
					}),
				},
			)

			/** Undo a nullify sweep that went too wide. */
			.post(
				"/votes/restore",
				async ({ body }) => {
					const rows = await db
						.update(schema.votes)
						.set({ nullifiedAt: null })
						.where(eq(schema.votes.netHash, body.netHash))
						.returning({ id: schema.votes.id });
					return { restored: rows.length };
				},
				{ body: t.Object({ netHash: t.String({ maxLength: 64 }) }) },
			)
			.get("/purchases", () =>
				db
					.select()
					.from(schema.sponsorPurchases)
					.orderBy(desc(schema.sponsorPurchases.createdAt)),
			)
			.get("/purchases/:id/clicks", ({ params }) =>
				db
					.select()
					.from(schema.sponsorClicks)
					.where(eq(schema.sponsorClicks.purchaseId, params.id))
					.orderBy(desc(schema.sponsorClicks.day)),
			)
			/** Impressions, clicks and CTR for one run — the renewal conversation. */
			.get("/purchases/:id/stats", ({ params }) => purchaseStats(params.id))
			/** Approve, from a script — same `approvePurchase` the operator's own screen calls. */
			.post("/purchases/:id/approve", async ({ params, status }) => {
				const row = await approvePurchase(params.id);
				return (
					row ??
					status(409, { error: "unknown purchase, or not awaiting approval" })
				);
			})
			/** Refund must be confirmed by the provider before status changes — 502 with the row untouched if it isn't (previously wrote `rejected` unconditionally, making the row a claim about a refund that might not have happened). */
			.post(
				"/purchases/:id/reject",
				async ({ params, body, status }) => {
					const [row] = await db
						.select()
						.from(schema.sponsorPurchases)
						.where(eq(schema.sponsorPurchases.id, params.id));
					if (!row) return status(404, { error: "unknown purchase" });

					const out = await refundPurchase(row, { reason: body?.reason });
					return out.ok
						? { ok: true, refundId: out.refundId, alreadyRefunded: out.already }
						: status(502, { error: `refund failed: ${out.error}` });
				},
				{ body: RefundBody },
			)
			/** `endsAt` is moved to now as well as the status, so the slot is free by both tests `board()` applies. Refund must succeed before status changes, same as reject. */
			.post(
				"/purchases/:id/release",
				async ({ params, body, status }) => {
					const [row] = await db
						.select()
						.from(schema.sponsorPurchases)
						.where(eq(schema.sponsorPurchases.id, params.id));
					if (!row) return status(404, { error: "unknown purchase" });

					const out = await refundPurchase(row, { reason: body?.reason });
					return out.ok
						? { ok: true, refundId: out.refundId, alreadyRefunded: out.already }
						: status(502, { error: `refund failed: ${out.error}` });
				},
				{ body: RefundBody },
			)
			/** Loops the same per-slot approve/release over every line — each slot keeps its own `endsAt` and its own refund share. */
			.post("/orders/:orderId/approve", async ({ params }) => {
				const rows = await db
					.select({ id: schema.sponsorPurchases.id })
					.from(schema.sponsorPurchases)
					.where(eq(schema.sponsorPurchases.orderId, params.orderId));
				const now = new Date();
				const live = [];
				for (const r of rows) {
					const row = await approvePurchase(r.id, now);
					if (row) live.push(row);
				}
				return { approved: live.length, purchases: live };
			})
			/** Partial failure is reported, never swallowed — a line whose refund Stripe refused is left untouched and named in `failed`. */
			.post(
				"/orders/:orderId/release",
				async ({ params, body }) => {
					const rows = await db
						.select()
						.from(schema.sponsorPurchases)
						.where(eq(schema.sponsorPurchases.orderId, params.orderId));
					const now = new Date();
					const failed: { id: string; error: string }[] = [];
					let released = 0;
					for (const r of rows) {
						const out = await refundPurchase(r, { reason: body?.reason, now });
						if (out.ok) released += 1;
						else failed.push({ id: r.id, error: out.error });
					}
					return { released, failed };
				},
				{ body: RefundBody },
			)
			/** Manual repair tool for a webhook that never arrived (Stripe stops retrying after three days) — admin-only, asks the provider directly rather than trusting the caller. */
			.post("/orders/:orderId/verify", async ({ params, status }) => {
				if (!paymentProvider) {
					return status(503, { error: "no payment provider configured" });
				}
				const rows = await db
					.select()
					.from(schema.sponsorPurchases)
					.where(eq(schema.sponsorPurchases.orderId, params.orderId));
				if (rows.length === 0) return status(404, { error: "unknown order" });

				const open = rows.filter((r) => r.status === "hold");
				if (open.length === 0) {
					return { settled: true, changed: 0, note: "nothing on hold" };
				}
				const ref = open.find((r) => r.providerRef)?.providerRef;
				if (!ref)
					return { settled: false, changed: 0, note: "never checked out" };

				const { settled } = await paymentProvider.verify(ref);
				if (!settled) return { settled: false, changed: 0 };

				const paidAt = new Date();
				const details = mintDetailsToken();
				const mint = !rows.some((r) => r.detailsTokenHash);
				db.transaction((tx) => {
					for (const [i, row] of open.entries()) {
						tx.update(schema.sponsorPurchases)
							.set({
								status: "paid",
								paidAt,
								...(i === 0 && mint ? details.columns : {}),
							})
							.where(eq(schema.sponsorPurchases.id, row.id))
							.run();
					}
				});
				log.warn(
					{ orderId: params.orderId, slots: open.length },
					"reconciled by admin",
				);
				return {
					settled: true,
					changed: open.length,
					/** The only copy — the row keeps only a hash, so the admin repairing this hands it to the buyer directly. */
					detailsToken: mint ? details.token : null,
				};
			})
			.get("/orders/:orderId", ({ params }) =>
				db
					.select()
					.from(schema.sponsorPurchases)
					.where(eq(schema.sponsorPurchases.orderId, params.orderId)),
			)
			/** The raw board, including what the public stats view is withholding. */
			.get("/ads/stats", () => adStats())
			.get("/ads/discarded", ({ query }) =>
				db
					.select()
					.from(schema.adTrafficAudit)
					.orderBy(desc(schema.adTrafficAudit.day))
					.limit(Number(query.limit ?? 500)),
			),
	)

	.listen(env.port);

startRebuildWorker();

// Cheap and idempotent on a local file — makes every entry point work on a fresh clone, not just `bun run dev`.
applyMigrations();

// Dev only, idempotent: gives a fresh clone a site that looks alive.
await seedDev().catch((e) => log.warn({ err: e }, "seed skipped"));

log.info(
	{
		port: app.server?.port,
		products: content.products.length,
		slots: content.slots.length,
	},
	"api on",
);
banner();
