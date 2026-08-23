import type {
	Category,
	Health,
	HealthFile,
	Product,
	Source,
} from "core/src/content";
import {
	altIconKey,
	CATEGORY_GROUPS,
	CONFIDENCE,
	EFFORTS,
	FORGES,
	healthKey,
	OPEN_CORE,
	PRICE_BASIS,
	RESIDENCY,
	VERDICTS,
} from "core/src/content";
import type { FeatureFile } from "core/src/features";
import type { Lang } from "core/src/index";
import { parseRoute } from "core/src/routes";
import { z } from "zod";
/**
 * DEV ONLY. The whole file, 170 KB of it, for the dev server — which renders no
 * prerendered payload and so has no other source for this.
 *
 * `import.meta.env.DEV` is a compile-time constant, so the production build
 * folds this to `null`, tree-shakes the JSON module out, and ships none of it.
 * That is load-bearing, not incidental: this site's traffic is overwhelmingly
 * single-page organic landings, so 869 repos on the critical path to render
 * three alternatives is the dominant case, not the edge case. Production reads
 * the page's own slice out of `window.__DATA__` instead — see `healthOf`.
 */
import healthData from "../../../data/health.json";

/**
 * Empty means same-origin `/api/...`, which is true in every environment now:
 * in production the edge nginx proxies it (see nginx/canireplaceit.conf), and
 * `bun run dev` proxies it in the rsbuild dev server. Set PUBLIC_API_URL only to
 * point a build at an API on another host.
 */
const BASE = import.meta.env.PUBLIC_API_URL ?? "";

export type { Category, Product };
export type ListedProduct = Product & { switchedCount: number };

/**
 * Every shape this module will accept off the wire, as a schema.
 *
 * `req` parses against one of these instead of casting, so a 200 carrying an
 * nginx error page, a proxy's own HTML or a stale deploy's shape fails HERE,
 * naming the endpoint and the field — rather than reaching a component and
 * surfacing as `undefined.map()` several layers in. The exported types are
 * inferred from the schemas, so there is no second declaration to keep in step.
 *
 * Each one matches what the server actually emits, no tighter: a schema
 * stricter than the API is an outage on a field the API was always allowed to
 * omit.
 */
const TranslationsSchema = z.object({
	en: z.string(),
	fr: z.string().optional(),
});

/** Endpoints that only acknowledge. Extra keys are dropped, as everywhere here. */
const OkSchema = z.object({ ok: z.literal(true) });

/**
 * `signedIn` is the browser's only view of the session: the cookie is httpOnly,
 * so before this the only way to find out was to call `/api/me/*` and read the
 * 401. Signature check on the server, no database read — see `sessionOf`.
 */
const SessionSchema = z.object({ ok: z.literal(true), signedIn: z.boolean() });

const StatsSchema = z.object({
	products: z.number(),
	categories: z.number(),
	alternatives: z.number(),
	ossAlternatives: z.number(),
	/** Products whose verdict is "not-yet" — the "don't bother" count. */
	notYet: z.number(),
	monthlySpendCents: z.number(),
	switches: z.number(),
});

export type Stats = z.infer<typeof StatsSchema>;

const PlacementSchema = z.enum(["hero", "rail", "category"]);

const SlotSchema = z.object({
	id: z.string(),
	placement: PlacementSchema,
	rail: z.enum(["left", "right"]).optional(),
	position: z.number().optional(),
	label: TranslationsSchema,
	/**
	 * USD cents per 30-day run, or null when the owner has not priced this
	 * position yet. Null is a real state, not a missing field: seven hero
	 * positions exist as inventory before anyone has decided what they cost, and
	 * rendering an unpriced slot as $0 — or hiding it — would be the same class of
	 * lie as `priceMonthly: null` rendering as "free tier".
	 */
	priceCents: z.number().nullable(),
	category: z.string().optional(),
	/** Category slots only: the category's display name, for grouping in the UI. */
	categoryName: TranslationsSchema.optional(),
	available: z.boolean(),
	takenUntil: z.string().nullable(),
	sponsor: z
		.object({
			purchaseId: z.string(),
			/**
			 * Translated, like every other authored string on the site. A sponsor may
			 * write English, French or both; the API fills `fr` from the default when
			 * they wrote only one, so a renderer never has to fall back itself.
			 * Resolve through `tc()`.
			 */
			name: TranslationsSchema,
			tagline: TranslationsSchema.nullable(),
			url: z.string().nullable(),
			logoUrl: z.string().nullable(),
			/** The `#rrggbb` the buyer chose, or null for the site's own accent. */
			tint: z.string().nullable(),
		})
		.nullable(),
});

export type Slot = z.infer<typeof SlotSchema>;

/**
 * One creative, whole, exactly as `creativeOf` in admin-api.ts emits it.
 *
 * `name`/`tagline` are the RESOLVED pair a reader would see — `fr` already
 * falling back to the default — and `raw` is what the database actually holds.
 * Both are needed on the review screen: the first is what ships, the second is
 * what tells the reviewer that the French line was never written.
 */
const AdminCreativeSchema = z.object({
	id: z.string(),
	orderId: z.string().nullable(),
	status: z.string(),
	slotId: z.string(),
	placement: z.string().nullable(),
	slotLabel: TranslationsSchema.nullable(),
	category: z.string().nullable(),
	email: z.string(),
	amountCents: z.number(),
	months: z.number(),
	provider: z.string().nullable(),
	name: z.object({ en: z.string(), fr: z.string() }).nullable(),
	tagline: z.object({ en: z.string(), fr: z.string() }).nullable(),
	raw: z.object({
		name: z.string().nullable(),
		nameFr: z.string().nullable(),
		tagline: z.string().nullable(),
		taglineFr: z.string().nullable(),
	}),
	url: z.string().nullable(),
	logoUrl: z.string().nullable(),
	tint: z.string().nullable(),
	createdAt: z.string().nullable(),
	paidAt: z.string().nullable(),
	submittedAt: z.string().nullable(),
	approvedAt: z.string().nullable(),
	startsAt: z.string().nullable(),
	endsAt: z.string().nullable(),
	releasedAt: z.string().nullable(),
	refundReason: z.string().nullable(),
	stripeRefundId: z.string().nullable(),
});

export type AdminCreative = z.infer<typeof AdminCreativeSchema>;

const AdminQueueSchema = z.object({
	now: z.string(),
	queue: z.array(
		AdminCreativeSchema.extend({
			/** The later of "creative filed" and "money in" — see the API. */
			waitingSince: z.string(),
			waitingHours: z.number(),
		}),
	),
});

export type AdminQueue = z.infer<typeof AdminQueueSchema>;

const ByPageSchema = z.object({
	page: z.string(),
	pageSlug: z.string(),
	impressions: z.number(),
});

/**
 * A campaign's numbers, with the same refusal to invent a rate the public page
 * makes: `ctr` is null and `reportable` false below either threshold, and `note`
 * is the API's own words for why.
 */
const AdminMetricsSchema = z.object({
	impressions: z.number(),
	clicks: z.number(),
	ctr: z.number().nullable(),
	reportable: z.boolean(),
	note: z.string().nullable(),
	minImpressions: z.number(),
	minDays: z.number(),
	daysRunning: z.number(),
	daysRemaining: z.number().nullable(),
	byPage: z.array(ByPageSchema),
});

export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;

/**
 * What the sponsorship stats endpoint returns.
 *
 * `reportable` is the field that matters: false means there is not yet enough
 * traffic to publish anything, and `slots`/`byPage`/`byCategory` are empty
 * rather than full of zeros. A page selling advertising must say "we have not
 * measured enough yet" out loud instead of rendering an empty table that looks
 * like a bad month.
 */
const AdStatsSchema = z.object({
	measuringSince: z.string().nullable(),
	days: z.number(),
	impressions: z.number(),
	clicks: z.number(),
	ctr: z.number().nullable(),
	discarded: z.number(),
	discardedBy: z.array(z.object({ reason: z.string(), events: z.number() })),
	reportable: z.boolean(),
	minImpressions: z.number(),
	minDays: z.number(),
	slots: z.array(
		z.object({
			slotId: z.string(),
			category: z.string().nullable(),
			impressions: z.number(),
			clicks: z.number(),
			ctr: z.number().nullable(),
		}),
	),
	byPage: z.array(
		z.object({
			page: z.string(),
			impressions: z.number(),
			clicks: z.number(),
		}),
	),
	byCategory: z.array(
		z.object({
			category: z.string(),
			impressions: z.number(),
			clicks: z.number(),
		}),
	),
});

export type AdStats = z.infer<typeof AdStatsSchema>;

const AdminCampaignsSchema = z.object({
	now: z.string(),
	/** The whole board's figures, so one campaign can be read against the site. */
	site: AdStatsSchema,
	campaigns: z.array(
		AdminCreativeSchema.extend({ metrics: AdminMetricsSchema }),
	),
});

export type AdminCampaigns = z.infer<typeof AdminCampaignsSchema>;

const AdminSlotsSchema = z.object({
	now: z.string(),
	slots: z.array(
		z.object({
			id: z.string(),
			placement: PlacementSchema,
			rail: z.enum(["left", "right"]).optional(),
			position: z.number().optional(),
			label: TranslationsSchema,
			priceCents: z.number().nullable(),
			category: z.string().optional(),
			categoryName: TranslationsSchema.optional(),
			available: z.boolean(),
			occupant: AdminCreativeSchema.extend({
				daysRemaining: z.number().nullable(),
			}).nullable(),
		}),
	),
});

export type AdminSlots = z.infer<typeof AdminSlotsSchema>;

/** What somebody can be on one account. The platform `admin` is not one of these. */
const OrgRoleSchema = z.enum(["org-owner", "org-user"]);

export type OrgRole = z.infer<typeof OrgRoleSchema>;

const OrgMemberSchema = z.object({
	email: z.string(),
	role: OrgRoleSchema,
	since: z.string(),
});

export type OrgMember = z.infer<typeof OrgMemberSchema>;

const OrgSchema = z.object({
	owner: z.string(),
	/**
	 * Whether the signed-in person is the address being charged. A promoted
	 * member is an `org-owner` too, so the role alone no longer says who pays.
	 */
	isPayer: z.boolean(),
	/**
	 * What the signed-in person is here. Three words and no finer: `org-owner`
	 * and the platform `admin` may manage, `org-user` may only look.
	 */
	role: z.enum(["org-owner", "org-user", "admin"]).nullable(),
	/** Derived from `role` by the API. The controls are hidden when false — and
	 *  the API refuses regardless, so this is presentation, not the check. */
	canManage: z.boolean(),
	members: z.array(OrgMemberSchema),
	/** Placements on this account. */
	purchases: z.number(),
});

export type Org = z.infer<typeof OrgSchema>;

const TeamSchema = z.object({ email: z.string(), orgs: z.array(OrgSchema) });

export type Team = z.infer<typeof TeamSchema>;

const CreativeSlotSchema = z.object({
	id: z.string(),
	placement: z.string(),
	rail: z.string().nullable(),
	label: TranslationsSchema,
	category: z.string().nullable(),
});

export type CreativeSlot = z.infer<typeof CreativeSlotSchema>;

const CampaignSchema = z.object({
	id: z.string(),
	slotId: z.string(),
	status: z.string(),
	months: z.number(),
	amountCents: z.number(),
	startsAt: z.string().nullable(),
	endsAt: z.string().nullable(),
	name: z.string().nullable(),
	tagline: z.string().nullable(),
	url: z.string().nullable(),
	logoUrl: z.string().nullable(),
	tint: z.string().nullable(),
	stats: z.object({
		impressions: z.number(),
		clicks: z.number(),
		ctr: z.number().nullable(),
		byPage: z.array(ByPageSchema),
	}),
});

export type Campaign = z.infer<typeof CampaignSchema>;

const CampaignsSchema = z.object({
	email: z.string(),
	campaigns: z.array(CampaignSchema),
	totals: z.object({
		impressions: z.number(),
		clicks: z.number(),
		ctr: z.number().nullable(),
	}),
});

export type Campaigns = z.infer<typeof CampaignsSchema>;

const SitePointSchema = z.object({
	day: z.string(),
	pageviews: z.number(),
	sessions: z.number(),
});

export type SitePoint = z.infer<typeof SitePointSchema>;

const SiteRowSchema = z.object({ name: z.string(), count: z.number() });

export type SiteRow = z.infer<typeof SiteRowSchema>;

const SiteStatsSchema = z.object({
	pageviews: z.number(),
	visitors: z.number(),
	visits: z.number(),
	bounces: z.number(),
	avgSeconds: z.number().nullable(),
	bestDay: z.number(),
	windowDays: z.number(),
	since: z.string().nullable(),
	series: z.array(SitePointSchema),
	pages: z.array(SiteRowSchema),
	referrers: z.array(SiteRowSchema),
	source: z.string(),
	fetchedAt: z.string(),
});

export type SiteStats = z.infer<typeof SiteStatsSchema>;

/**
 * The full figures OR the one-word refusal, never a half-filled shape. The
 * order matters for the error message: a body that meant to be the real thing
 * and lost a field reports that field, not "expected true".
 */
const SiteStatsResultSchema = z.union([
	SiteStatsSchema,
	z.object({ unavailable: z.literal(true) }),
]);

const OrderLineSchema = z.object({
	slotId: z.string(),
	/** The slot's own 30-day rate, before any term discount. */
	rateCents: z.number(),
	/** This slot's share of the order total. The lines always sum to the total. */
	amountCents: z.number(),
});

export type OrderLine = z.infer<typeof OrderLineSchema>;

const OrderQuoteSchema = z.object({
	months: z.number(),
	totalCents: z.number(),
	undiscountedCents: z.number(),
	lines: z.array(OrderLineSchema),
});

export type OrderQuote = z.infer<typeof OrderQuoteSchema>;

const ReservationSchema = z.object({
	orderId: z.string(),
	/** The order's first line, for callers that still think in single purchases. */
	purchaseId: z.string(),
	purchaseIds: z.array(z.string()),
	/** The whole order. Never the sum of per-slot prices — see core/sponsorship. */
	amountCents: z.number(),
	months: z.number(),
	undiscountedCents: z.number(),
	lines: z.array(OrderLineSchema),
	provider: z.string().nullable(),
});

export type Reservation = z.infer<typeof ReservationSchema>;

const TermsSchema = z.object({
	terms: z.array(
		z.object({
			months: z.number(),
			multiplier: z.number(),
			discountPct: z.number(),
		}),
	),
	provider: z.string().nullable(),
	live: z.boolean(),
});

export type Terms = z.infer<typeof TermsSchema>;

const CheckoutResultSchema = z.object({
	provider: z.string(),
	live: z.boolean(),
	settled: z.boolean(),
	redirectUrl: z.string().nullable(),
	orderId: z.string().nullable(),
	amountCents: z.number(),
	slotIds: z.array(z.string()),
	/** One token per ORDER: the creative is written to every slot it bought. */
	detailsToken: z.string().nullable(),
});

export type CheckoutResult = z.infer<typeof CheckoutResultSchema>;

const LogoSchema = z.object({
	url: z.string(),
	bytes: z.number(),
	mime: z.string(),
});

/**
 * The editorial content, which the API serves straight from git.
 *
 * The enums come from core rather than being retyped, so a new verdict or forge
 * cannot pass `bun run validate` and then be rejected here. The types stay
 * core's — this is the same data, arriving over a network rather than a file.
 */
const PriceSourceSchema = z.object({
	plan: z.string(),
	basis: z.enum(PRICE_BASIS),
	url: z.string(),
	checkedOn: z.string(),
	confidence: z.enum(CONFIDENCE),
});

const AlternativeSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("oss"),
		name: z.string(),
		source: z.object({
			host: z.enum(FORGES),
			path: z.string(),
			url: z.string(),
		}),
		license: z.string(),
		effort: z.enum(EFFORTS),
		note: TranslationsSchema,
		facts: z.object({
			selfHostable: z.boolean(),
			openCore: z.enum(OPEN_CORE),
			paywalled: TranslationsSchema.optional(),
			ssoInFree: z.boolean().nullable(),
			dataResidency: z.enum(RESIDENCY),
		}),
		hasCompose: z.boolean().optional(),
		// Zod strips what it does not name, so a field missing here is a field the
		// UI never sees however well-formed the API's answer was.
		archived: z.boolean().optional(),
		/** People who report switching TO this. Server-computed; absent in boot payloads. */
		switchedTo: z.number().optional(),
		/** Forge's top language by bytes, backfilled onto the entry. */
		language: z.string().optional(),
	}),
	z.object({
		kind: z.literal("cheaper"),
		name: z.string(),
		url: z.string(),
		priceMonthly: z.number().nullable(),
		priceOnce: z.number().optional(),
		note: TranslationsSchema,
	}),
]);

const ListedProductSchema = z.object({
	slug: z.string(),
	name: z.string(),
	domain: z.string().nullable(),
	category: z.string(),
	priceMonthly: z.number().nullable(),
	pricing: PriceSourceSchema.nullable(),
	notPublic: z.literal(true).optional(),
	verdict: z.enum(VERDICTS),
	why: TranslationsSchema,
	whatYouLose: z.array(TranslationsSchema),
	alternatives: z.array(AlternativeSchema),
	priority: z.number(),
	switchedCount: z.number(),
});

const CategorySchema = z.object({
	slug: z.string(),
	name: TranslationsSchema,
	icon: z.string(),
	group: z.enum(CATEGORY_GROUPS),
	position: z.number(),
});

/**
 * A failed request, carrying the status alongside the body.
 *
 * The status was previously thrown away, which is fine while every failure means
 * the same thing to the caller. It stops being fine on the operator's console:
 * 503 (nobody is configured as an admin), 401 (not signed in) and 403 (signed in,
 * not an admin) are three different sentences to show a person, and only the
 * middle one is fixed by signing in. `message` stays the response body, so the
 * callers that match on it — see TeamPanel — are unaffected.
 */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		body: string,
	) {
		super(body);
		this.name = "ApiError";
	}
}

/**
 * The first thing that was wrong, and where.
 *
 * Zod reports a failed union as a bare "Invalid input" with the branches buried,
 * so the first branch's own complaint is unwrapped — for `/api/site/stats` that
 * branch is the real shape, and its message is the one worth reading.
 */
const firstProblem = (issues: readonly z.core.$ZodIssue[]): string => {
	const issue = issues[0];
	if (!issue) return "unexpected response shape";
	if (issue.code === "invalid_union")
		return firstProblem(issue.errors[0] ?? []);
	const at = issue.path.join(".");
	return at ? `${at}: ${issue.message}` : issue.message;
};

/**
 * Parses rather than casts. A body that is not what the endpoint promised is a
 * failure at this boundary, with the endpoint and the field named, and never a
 * null or an invented default: an error state the pages already render is
 * honest, and figures nobody measured are not.
 */
async function req<S extends z.ZodType>(
	path: string,
	schema: S,
	init?: RequestInit,
): Promise<z.infer<S>> {
	const res = await fetch(`${BASE}${path}`, {
		...init,
		// The voter identity is an httpOnly cookie, so it only travels if the
		// request explicitly opts in. Without this, every vote looks brand new.
		credentials: "include",
		headers: init?.body ? { "content-type": "application/json" } : undefined,
	});
	if (!res.ok) throw new ApiError(res.status, await res.text());

	let body: unknown;
	try {
		body = await res.json();
	} catch {
		throw new ApiError(res.status, `${path}: response was not JSON`);
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) {
		throw new ApiError(
			res.status,
			`${path}: ${firstProblem(parsed.error.issues)}`.slice(0, 300),
		);
	}
	return parsed.data;
}

/**
 * Absolute URL for an asset this API serves.
 *
 * Uploaded sponsor icons are stored as `/api/sponsor-logos/<uuid>.png` — a
 * root-relative path, because in production the site and the API share an
 * origin and that is the correct, cache-friendly thing to store. In development
 * they are two ports, so the browser resolved it against :3000 and got a 404,
 * and every uploaded icon silently fell back to a lettermark.
 *
 * A sponsor's own absolute URL passes through untouched.
 */
export const assetUrl = (u: string | null): string | null =>
	u?.startsWith("/") ? `${BASE}${u}` : u;

const post = <S extends z.ZodType>(path: string, schema: S, body: unknown) =>
	req(path, schema, { method: "POST", body: JSON.stringify(body) });

export const api = {
	/** Mint the voter cookie before any vote, so voting is not the first request,
	 *  and report whether there is a session worth asking `/api/me/*` about. */
	session: () => req("/api/session", SessionSchema),
	products: () => req("/api/products", z.array(ListedProductSchema)),
	categories: () => req("/api/categories", z.array(CategorySchema)),
	stats: () => req("/api/stats", StatsSchema),
	slots: () => req("/api/slots", z.array(SlotSchema)),
	/** `projectSlug` records which project they moved to, for its replaced count. */
	vote: (slug: string, projectSlug?: string) =>
		post(
			`/api/products/${slug}/vote`,
			z.object({ switchedCount: z.number(), counted: z.boolean() }),
			{ projectSlug },
		),
	waitlist: (body: Record<string, unknown>) =>
		post("/api/waitlist", OkSchema, body),
	reserve: (slotId: string, body: Record<string, unknown>) =>
		post(`/api/slots/${slotId}/reserve`, ReservationSchema, body),
	/** Reserve a whole basket: several categories plus at most one rail slot. */
	reserveOrder: (body: { email: string; months: number; slotIds: string[] }) =>
		post("/api/orders/reserve", ReservationSchema, body),
	/**
	 * Price a basket without committing to it.
	 *
	 * The running total comes from the server rather than being recomputed in the
	 * form, so the figure on screen is produced by the same code that will charge
	 * for it. A total the client worked out for itself is a total that can
	 * disagree with the invoice.
	 */
	quoteOrder: (body: { months: number; slotIds: string[] }) =>
		post("/api/orders/quote", OrderQuoteSchema, body),
	/** Lock-in terms and what each multiplies the 30-day rate by. */
	terms: () => req("/api/sponsor/terms", TermsSchema),
	/**
	 * Hands the purchase to whichever provider is configured. 503 when none is.
	 *
	 * `lang` is what the buyer is reading. It decides the language of the hosted
	 * payment page and the page they land back on, and the server has no other way
	 * to know it — the request carries no locale-prefixed path.
	 */
	checkout: (purchaseId: string, lang: Lang) =>
		post(`/api/sponsor/${purchaseId}/checkout`, CheckoutResultSchema, { lang }),
	/** One charge for every slot in the order. */
	checkoutOrder: (orderId: string, lang: Lang) =>
		post(`/api/orders/${orderId}/checkout`, CheckoutResultSchema, { lang }),
	/**
	 * Redeem the checkout session id Stripe puts in the return URL for the
	 * creative token. `settled: false` means the webhook has not landed yet, not
	 * that anything is wrong — the caller polls.
	 */
	bySession: (sessionId: string) =>
		req(
			`/api/sponsor/by-session/${encodeURIComponent(sessionId)}`,
			z.object({ settled: z.boolean(), detailsToken: z.string().nullable() }),
		),
	/** The creative, against the single-use token minted when the money landed. */
	details: (body: Record<string, unknown>) =>
		post("/api/sponsor/details", OkSchema, body),
	/** Public audience numbers — see `reportable` before rendering any of them. */
	adStats: () => req("/api/ads/stats", AdStatsSchema),
	/**
	 * Site traffic, from our own Umami. Answers `{ unavailable: true }` rather
	 * than failing when analytics is off or unreachable, so the caller renders an
	 * empty state instead of an error.
	 */
	siteStats: () => req("/api/site/stats", SiteStatsResultSchema),
	/** Always resolves, whether or not the address is a customer. */
	requestSignIn: (email: string) =>
		post("/api/auth/request", OkSchema, { email }),
	me: () => req("/api/me", z.object({ email: z.string() })),
	campaigns: () => req("/api/me/campaigns", CampaignsSchema),
	/** Which slots a creative token covers, so the form can preview each. */
	creativeSlots: (token: string) =>
		req(
			`/api/sponsor/creative/${encodeURIComponent(token)}`,
			z.object({ slots: z.array(CreativeSlotSchema) }),
		),
	/**
	 * Multipart, so this bypasses `post` — that helper sets a JSON content type,
	 * and a multipart body needs the boundary the browser generates.
	 */
	uploadLogo: (body: FormData) =>
		fetch(`${BASE}/api/sponsor/logo`, {
			method: "POST",
			credentials: "include",
			body,
		}).then(async (r) => {
			if (!r.ok) throw new Error(await r.text());
			const parsed = LogoSchema.safeParse(await r.json().catch(() => null));
			if (!parsed.success) {
				throw new ApiError(
					r.status,
					`/api/sponsor/logo: ${firstProblem(parsed.error.issues)}`.slice(
						0,
						300,
					),
				);
			}
			return parsed.data;
		}),
	signOut: () => post("/api/auth/logout", OkSchema, {}),
	team: () => req("/api/me/team", TeamSchema),
	addMember: (body: { email: string; role: OrgRole; owner?: string }) =>
		post("/api/me/team", OkSchema, body),
	removeMember: (body: { email: string; owner?: string }) =>
		post("/api/me/team/remove", OkSchema, body),
	/**
	 * The platform operator's own endpoints. Session-gated, and a different
	 * credential from the machine token behind `/api/admin/*` — see admin-api.ts.
	 */
	siteAdmin: {
		queue: () => req("/api/site-admin/queue", AdminQueueSchema),
		campaigns: () => req("/api/site-admin/campaigns", AdminCampaignsSchema),
		slots: () => req("/api/site-admin/slots", AdminSlotsSchema),
		approve: (id: string) =>
			post(
				`/api/site-admin/purchases/${id}/approve`,
				z.object({ ok: z.literal(true), purchase: AdminCreativeSchema }),
				{},
			),
		/**
		 * Refuses the creative AND refunds the charge. A 502 means the refund did
		 * not go through and the row was left untouched — the caller must say so
		 * rather than removing the item from the queue.
		 */
		reject: (id: string, reason: string) =>
			post(
				`/api/site-admin/purchases/${id}/reject`,
				z.object({
					ok: z.literal(true),
					refundId: z.string().nullable(),
					alreadyRefunded: z.boolean(),
					purchase: AdminCreativeSchema,
				}),
				{ reason },
			),
	},
};

/**
 * The click-through, which is also the click counter.
 *
 * The page context rides in the query string because it cannot ride in
 * `Referer`: the site and the API are different origins, so the default
 * referrer policy sends the origin and drops the path — which is exactly the
 * breakdown a buyer wants. Computed here from `location` rather than threaded
 * through every ad component, so the call sites only add the slot id.
 */
export const sponsorClickUrl = (purchaseId: string, slotId?: string) => {
	const url = `${BASE}/api/sponsor/${purchaseId}/click`;
	if (typeof location === "undefined") return url;
	// `parseRoute` rather than splitting the path here, so the analytics buckets
	// can never drift from the routes — and so `/fr/outils/x` is a project page
	// under both locales without a second table of segment words.
	const route = parseRoute(new URL(location.href));
	const q = new URLSearchParams();
	if (slotId) q.set("slot", slotId);
	q.set("page", route.name === "unknown" ? "other" : route.name);
	if ("slug" in route) q.set("on", route.slug);
	return `${url}?${q}`;
};

/** Where an editorial outbound link sits, for whatever we do with them later. */
export type Outbound = "repo" | "homepage" | "alt" | "price";

/**
 * Every outbound link the *editorial* side of the site emits goes through here.
 *
 * It returns the URL untouched today. It exists so that the day this has to
 * carry a campaign parameter, or route through a redirect, it is one function
 * rather than a hunt through the JSX — and so the count of places that can rank
 * a link stays visible in one file.
 *
 * Deliberately NOT `sponsorClickUrl`, and deliberately no `rel="sponsored"` at
 * the call sites: a repo we recommend on the merits must never be marked paid.
 */
export const outboundUrl = (url: string, _context: Outbound): string => url;

/** Icons are fetched at build time into public/icons — see scripts/fetch-icons.ts. */
export const productIcon = (p: Product) =>
	p.domain ? `/icons/products/${p.slug}.webp` : null;

export const altIcon = (alt: Product["alternatives"][number]) => {
	if (alt.kind === "oss") {
		// Same key the fetcher wrote the file under — see `altIconKey`.
		const key = altIconKey(alt.source);
		return key ? `/icons/alts/${key}.webp` : null;
	}
	try {
		return `/icons/alts/${new URL(alt.url).hostname.replace(/^www\./, "")}.webp`;
	} catch {
		return null;
	}
};

const DEV_HEALTH: HealthFile | null = import.meta.env.DEV
	? (healthData as unknown as HealthFile)
	: null;

/**
 * The readings this page shipped with, inlined by scripts/prerender.ts — only
 * the repos this page actually cites, which is three or four on a product page
 * rather than all 869.
 *
 * Read at call time, not at import time: the prerenderer reuses one module
 * instance across every page and swaps `__DATA__` between them, exactly as
 * `boot()` in App.tsx does. Duplicated rather than imported from there because
 * App.tsx imports this module.
 */
const health = (): HealthFile | null =>
	(globalThis as { __DATA__?: { health?: HealthFile } }).__DATA__?.health ??
	DEV_HEALTH;

/**
 * How old `data/health.json` may be before its time-sensitive readings stop
 * being rendered at all.
 *
 * Thirty days. The workflow that regenerates the file runs weekly, so this
 * tolerates four consecutive failed or skipped runs before the site goes quiet
 * — long enough that one bad week is invisible, short enough that a workflow
 * somebody disabled cannot keep a page insisting a project is alive for a
 * quarter. It is also the scale on which these facts actually move: nothing
 * meaningful changes about "archived" or "dormant for a year" inside a month,
 * so a reading up to thirty days old is still true, and one older than that is
 * merely plausible. A date nobody is maintaining is a lie with a timestamp on
 * it, and this is the line where we stop printing it.
 */
const MAX_AGE_DAYS = 30;

/** The file's own date, whether or not it is still worth trusting. */
const fetchedAt = (): string | null => health()?.fetchedAt ?? null;

/**
 * Are the time-sensitive readings on this page still current?
 *
 * Deliberately fails closed: a missing or unparseable `fetchedAt` counts as too
 * old, because a file that cannot say when it was written cannot be shown to
 * date anything.
 */
const current = (now = Date.now()): boolean => {
	const at = fetchedAt();
	const ms = at ? Date.parse(`${at}T00:00:00Z`) : Number.NaN;
	return Number.isFinite(ms) && now - ms < MAX_AGE_DAYS * 86_400_000;
};

/**
 * What we know about one repo, or null when that is nothing.
 *
 * Null is the honest answer in several real cases: a forge with no API to ask
 * (Savannah), a repo that 404s, and a page whose payload does not carry this
 * repo. None of them may be rendered as "no recent activity" or as a zero; they
 * are rendered as nothing at all, because absence of a reading is not a reading
 * — which is also why every field of `Health` is optional and why nothing here
 * substitutes a default for one a forge would not give us.
 *
 * `archived` and `lastPush` are additionally stripped once the file is stale.
 * They are the two facts that decay, and they are the two the site would be
 * caught lying about; the rest — a compose file, a language, a homepage — are
 * standing properties of a repo that do not rot on a monthly scale, so they
 * keep being shown.
 */
/**
 * The feature slice this page was prerendered with, or the whole file in dev.
 *
 * Mirrors `health`: production reads the page's own slice out of
 * `window.__DATA__`, dev has no prerendered payload so the component falls back
 * to importing the file. Absent means we hold nothing for this project, which
 * the caller must render as nothing at all — never as "no features".
 */
export const bootFeatures = (): FeatureFile | null =>
	(globalThis as { __DATA__?: { features?: FeatureFile } }).__DATA__
		?.features ?? null;

export const healthOf = (source: Source): Health | null => {
	const h = health()?.repos?.[healthKey(source)];
	// A `{}` here would be a half-written file. An entry with no field we can use
	// is not a reading.
	if (!h || Object.values(h).every((v) => v === undefined)) return null;
	if (current()) return h;
	const { archived, lastPush, ...stable } = h;
	return Object.values(stable).some((v) => v !== undefined) ? stable : null;
};

/**
 * The project's own site, when the forge records one that is worth a second
 * link. A homepage that is the repo again — plenty of them are — would be two
 * links to one page, so it is dropped rather than rendered twice.
 */
export const homepageOf = (source: Source): string | null => {
	const raw = healthOf(source)?.homepage;
	if (!raw) return null;
	const bare = (u: string) => u.replace(/\/+$/, "").toLowerCase();
	return bare(raw) === bare(source.url) ? null : raw;
};

const locale = (lang: string) => (lang === "fr" ? "fr-FR" : "en-US");

/**
 * An absolute date, always. This is the string that goes into the prerendered
 * HTML, and it is still true a year after the build — see `relativeDate`.
 * Short month so French ("sept.", not "septembre") stays inside a badge.
 */
export const formatDate = (iso: string, lang: string) => {
	const d = new Date(`${iso}T00:00:00Z`);
	if (Number.isNaN(d.getTime())) return iso;
	return new Intl.DateTimeFormat(locale(lang), {
		day: "numeric",
		month: "short",
		year: "numeric",
		timeZone: "UTC",
	}).format(d);
};

/**
 * "3 days ago", for the cases where recency is the signal rather than the date.
 *
 * Takes `now` instead of reading the clock, because the caller has to pass a
 * client-side one: this string is only correct for the instant it was computed,
 * and prerendered HTML sits on a CDN for weeks. Baking "3 days ago" at build
 * time asserts a fact about the reader's today that the build cannot know — so
 * the static document carries only the absolute date, and this is added after
 * hydration (see `useNow`).
 */
export const relativeDate = (iso: string, lang: string, now: number) => {
	const then = Date.parse(`${iso}T00:00:00Z`);
	if (Number.isNaN(then)) return null;
	// Calendar days apart, not elapsed hours. Dividing the raw difference by 24h
	// made a price read TODAY report as "yesterday" from mid-afternoon onwards,
	// because `now` was 18 hours past the date's midnight — an off-by-one that
	// aged every date on the site by a day for most of every day.
	const d = new Date(now);
	const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
	const days = Math.round((then - today) / 86_400_000);
	const rtf = new Intl.RelativeTimeFormat(locale(lang), { numeric: "auto" });
	if (Math.abs(days) < 31) return rtf.format(days, "day");
	if (Math.abs(days) < 365) return rtf.format(Math.round(days / 30), "month");
	return rtf.format(Math.round(days / 365), "year");
};

export const money = (cents: number, lang = "en") =>
	new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", {
		style: "currency",
		currency: "USD",
		// fr-FR renders USD as "$US" by default, which reads as noise in a price list.
		currencyDisplay: "narrowSymbol",
		maximumFractionDigits: 0,
	}).format(cents / 100);
