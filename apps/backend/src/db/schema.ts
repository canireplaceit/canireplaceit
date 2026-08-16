/**
 * Only things that change without a deploy live here. Products, categories and
 * ad inventory are files in `data/` — see apps/backend/src/content.ts.
 *
 * SQLite, via Bun's built-in driver. Three shapes have no native column type and
 * are mapped rather than stored directly:
 *   - enums   → text with a TS-level `enum` list (SQLite has no ENUM)
 *   - uuids   → text primary keys, filled by `crypto.randomUUID()` on insert
 *   - arrays  → text in JSON mode (SQLite has no array type)
 * Timestamps are integers in `timestamp` mode, so Drizzle hands the application
 * `Date` objects on the way out and unix seconds to the file on the way in.
 */

import {
	customType,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Emails are compared and stored lowercased, or one buyer becomes two. */
export const normalizeEmail = (v: string) => v.trim().toLowerCase();

/**
 * Every column that holds an address.
 *
 * SQLite's `=` on TEXT is case-sensitive, so a buyer who types `John@` at
 * checkout and `john@` at sign-in is two people: they pay, their ad runs, and
 * their dashboard is empty. Canonicalising here rather than at each endpoint
 * means it happens on the way to the driver for both writes AND comparisons, so
 * a new route cannot forget it. `COLLATE NOCASE` would say the same thing to the
 * database, but adding it to an existing column means rebuilding the table.
 */
const emailText = customType<{ data: string; driverData: string }>({
	dataType: () => "text",
	toDriver: normalizeEmail,
});

/** Every table that had `uuid().defaultRandom()` under Postgres. */
const uuidPk = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

/** Every table that had `defaultNow()` under Postgres. */
const now = () => new Date();

/**
 * A purchase, not a slot, is the row that matters.
 *   hold      — checkout opened, reserves nothing (see below)
 *   paid      — money received, creative not submitted yet
 *   submitted — creative in, waiting on a human
 *   live      — approved and running until endsAt
 *   rejected / refunded — terminal
 *
 * `live` is reachable only by an explicit platform-admin approval. A settled
 * order with a creative lands on `submitted` and waits: nothing renders it, so an
 * ad that no human has read cannot appear on the site.
 *
 * Holds deliberately block nothing: several people can be in checkout for the
 * same slot, whoever pays first wins, and a late payer is refunded rather than
 * blocked by a timer. Occupancy is decided at read time from status + endsAt, so
 * a missed cron can cost bookkeeping but never correctness.
 */
export const PURCHASE_STATUSES = [
	"hold",
	"paid",
	"submitted",
	"live",
	"rejected",
	"refunded",
] as const;

/** Which kind of page an ad event happened on. */
export const AD_PAGES = [
	"home",
	"product",
	"category",
	"project",
	"other",
] as const;

export const sponsorPurchases = sqliteTable(
	"sponsor_purchases",
	{
		id: uuidPk(),
		/** Matches an id in data/sponsors/slots.json. Not a foreign key — inventory is a file. */
		slotId: text("slot_id").notNull(),
		/**
		 * Groups the rows bought together in one checkout. One order, many slots —
		 * several categories plus at most one rail position.
		 *
		 * This is deliberately NOT an orders table with line items pointing at it.
		 * Occupancy is the load-bearing behaviour on this table: `board()` decides
		 * whether a slot is free from this row's `status` and `endsAt`, and expiry,
		 * release and approval all act on one slot at a time. A buyer renews one
		 * category and drops another, so those dates diverge per slot almost
		 * immediately. Keeping the row per slot means every one of those paths keeps
		 * working untouched and the order id is only ever a grouping key; moving
		 * occupancy onto a line item would have made every occupancy read a join,
		 * to express a relationship that is one nullable column.
		 *
		 * Null on rows bought before multi-slot orders existed.
		 */
		orderId: text("order_id"),
		status: text("status", { enum: PURCHASE_STATUSES })
			.notNull()
			.default("hold"),
		/**
		 * This slot's share of the order total. An allocation, not a price — the
		 * term discount is applied once to the whole basket and split by
		 * `allocate()` in core, so these always sum to exactly what was quoted.
		 */
		amountCents: integer("amount_cents").notNull(),
		/**
		 * Lock-in term in months — 1, 3 or 12. `endsAt` is derived from it.
		 *
		 * The prices in data/sponsors/slots.json are the 30-day rate; a longer term
		 * is paid up front and discounted for it. See `SPONSOR_TERMS` in
		 * core/src/sponsorship.ts — the multipliers live there, shared by the API
		 * that charges and the form that quotes, because this column only has to
		 * record what was actually sold.
		 */
		months: integer("months").notNull().default(1),

		email: emailText("email").notNull(),
		/**
		 * Which payment provider settled this, e.g. "fake-dev" or "stripe". Kept on
		 * the row rather than inferred from the env, so a database that once ran the
		 * fake provider can never be mistaken for one that took real money.
		 */
		provider: text("provider"),
		/** The provider's own id for the transaction. Unique across providers. */
		providerRef: text("provider_ref").unique(),
		stripeSessionId: text("stripe_session_id").unique(),
		stripePaymentIntent: text("stripe_payment_intent"),
		/**
		 * The provider's id for the refund this line was given, once one succeeded.
		 *
		 * Written ONLY after the provider confirms, which is what makes it the
		 * idempotency record as well as the audit trail: a second reject finds it
		 * set and issues no second refund. A row that says `refunded` without one is
		 * a row that never sent the money back — see review.ts.
		 */
		stripeRefundId: text("stripe_refund_id"),
		/** Why it was refunded, in the reviewer's words. Null when nobody said. */
		refundReason: text("refund_reason"),
		/**
		 * sha256 of the single-use secret that unlocks the creative form. Hashed at
		 * rest for the same reason a magic link is: submitting a creative signs the
		 * bearer in as the buyer, so a copy of this table must not be a stack of
		 * working sign-ins. The raw value only ever exists in the response to the
		 * buyer who just paid.
		 */
		detailsTokenHash: text("details_token_hash").unique(),
		/** Cleared, along with the hash, the moment the creative lands. */
		detailsTokenExpiresAt: integer("details_token_expires_at", {
			mode: "timestamp",
		}),

		// The creative, submitted after payment. Per ROW, not per order: a buyer
		// with a rail slot and two category slots may run a different ad in each,
		// or the same one copied across — the form offers both and this shape
		// supports either without a second table.
		/**
		 * The default copy, and the fallback for every locale without its own.
		 *
		 * The site is en+fr and a sponsor may care about one, the other, or both.
		 * Rather than a `sponsor_creatives` table keyed by locale — two locales, one
		 * join, for two strings — the second language is a nullable column beside
		 * the first, and the API emits `{ en, fr }` so the existing `tc()` resolves
		 * it exactly like every other translated field on the site.
		 *
		 * Never null once a creative is submitted: a buyer who fills in only the
		 * French box gets that value written here too, so no renderer ever has to
		 * cope with a sponsor that has no name.
		 */
		name: text("name"),
		/** French override. Null means "use `name`". */
		nameFr: text("name_fr"),
		/**
		 * One line about the product. Only the rail panels have room to render it;
		 * the landing wall and the sponsored section are logo-and-name.
		 */
		tagline: text("tagline"),
		/** French override. Null means "use `tagline`". */
		taglineFr: text("tagline_fr"),
		url: text("url"),
		/**
		 * Either an absolute URL the sponsor hosts, or a path this API serves for
		 * an icon they uploaded (`/api/sponsor-logos/<file>`). One column, because
		 * every renderer only ever needs "where do I point an <img>" — a second
		 * column plus a branch at every call site would express the same thing.
		 */
		logoUrl: text("logo_url"),
		/**
		 * The card's accent, as `#rrggbb`. Null means the site's own accent.
		 *
		 * Stored as authored and validated on the way in, never interpolated raw
		 * into a stylesheet: it reaches the DOM through a style property, so a
		 * value that is not a colour can only ever be an ignored declaration.
		 */
		tint: text("tint"),

		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(now),
		paidAt: integer("paid_at", { mode: "timestamp" }),
		submittedAt: integer("submitted_at", { mode: "timestamp" }),
		approvedAt: integer("approved_at", { mode: "timestamp" }),
		/** The run starts when it goes live, not when it was paid for. */
		startsAt: integer("starts_at", { mode: "timestamp" }),
		endsAt: integer("ends_at", { mode: "timestamp" }),
		/**
		 * Ended early — a refund, a takedown, or the owner freeing the slot. Set
		 * alongside `endsAt`, so occupancy still needs only one comparison.
		 */
		releasedAt: integer("released_at", { mode: "timestamp" }),
	},
	(t) => [
		index("sponsor_purchases_slot_idx").on(t.slotId, t.status),
		index("sponsor_purchases_order_idx").on(t.orderId),
	],
);

/**
 * Per-sponsor click counts, so there is something to show at renewal time.
 *
 * Broken down the same way impressions are — by day, by which kind of page the
 * click happened on, and by which page exactly — because a CTR that cannot be
 * attributed to a page is not something a buyer can act on. `trusted` mirrors
 * the vote model: a click we did not believe is still recorded, it just never
 * reaches a number shown to an advertiser.
 */
export const sponsorClicks = sqliteTable(
	"sponsor_clicks",
	{
		id: uuidPk(),
		purchaseId: text("purchase_id")
			.notNull()
			.references(() => sponsorPurchases.id, { onDelete: "cascade" }),
		/** Denormalised from the purchase so a slot's history survives a cascade. */
		slotId: text("slot_id").notNull().default(""),
		page: text("page", { enum: AD_PAGES }).notNull().default("other"),
		/** The product/project/category slug, or "" on the home page. */
		pageSlug: text("page_slug").notNull().default(""),
		day: text("day").notNull(), // YYYY-MM-DD, UTC
		/** False for datacenter ranges, known crawlers and flooding networks. */
		trusted: integer("trusted", { mode: "boolean" }).notNull().default(true),
		clicks: integer("clicks").notNull().default(0),
	},
	(t) => [
		uniqueIndex("sponsor_clicks_unique").on(
			t.purchaseId,
			t.day,
			t.page,
			t.pageSlug,
			t.trusted,
		),
		index("sponsor_clicks_slot_idx").on(t.slotId, t.day),
	],
);

/**
 * Ad impressions, pre-aggregated.
 *
 * There is no per-event row on purpose. A rail is `position: fixed` and never
 * leaves the DOM, and the marquee renders every slot twice and loops forever, so
 * anything event-shaped would be millions of rows describing one person reading
 * one page. The browser decides what an impression IS (visible past a threshold,
 * for a minimum dwell, once per slot per window — see adTracking.ts) and this
 * table only counts them.
 *
 * The unique key is the full breakdown, so "L2 on the Figma product page today"
 * is one row that increments. `trusted` is part of the key rather than a column,
 * which keeps the believed and the discarded counts side by side: the public
 * page can print the first and honestly say how much of the second there was.
 */
export const sponsorImpressions = sqliteTable(
	"sponsor_impressions",
	{
		id: uuidPk(),
		slotId: text("slot_id").notNull(),
		/** "" when the slot was advertising itself rather than carrying a sponsor. */
		purchaseId: text("purchase_id").notNull().default(""),
		page: text("page", { enum: AD_PAGES }).notNull(),
		pageSlug: text("page_slug").notNull().default(""),
		/** The slot's OWN category (category inventory only), not the page's. */
		category: text("category").notNull().default(""),
		day: text("day").notNull(), // YYYY-MM-DD, UTC
		trusted: integer("trusted", { mode: "boolean" }).notNull().default(true),
		impressions: integer("impressions").notNull().default(0),
	},
	(t) => [
		uniqueIndex("sponsor_impressions_unique").on(
			t.slotId,
			t.purchaseId,
			t.page,
			t.pageSlug,
			t.day,
			t.trusted,
		),
		index("sponsor_impressions_day_idx").on(t.day),
		index("sponsor_impressions_purchase_idx").on(t.purchaseId),
	],
);

/**
 * What the bot filter threw away, and why.
 *
 * The counts on the public page are only defensible if the discards are
 * auditable, and it is the same argument as `votes.reasons`: a campaign has to
 * be re-scorable after the fact, not merely blocked at the door. Keyed by the
 * same network and client hashes the vote scorer uses, so a sweep can match on
 * exactly the signals it matches on there.
 */
export const adTrafficAudit = sqliteTable(
	"ad_traffic_audit",
	{
		id: uuidPk(),
		day: text("day").notNull(),
		netHash: text("net_hash").notNull(),
		clientHash: text("client_hash").notNull(),
		/** One of the reason strings from `scoreAdEvent`. */
		reason: text("reason").notNull(),
		events: integer("events").notNull().default(0),
	},
	(t) => [
		uniqueIndex("ad_traffic_audit_unique").on(
			t.day,
			t.netHash,
			t.clientHash,
			t.reason,
		),
		index("ad_traffic_audit_day_idx").on(t.day),
	],
);

/**
 * "I actually switched off X, to Y."
 *
 * Every vote keeps the signals that produced its trust score, so a campaign can
 * be re-scored and nullified after the fact rather than only blocked at the door.
 * Slugs come from git, so there are no foreign keys.
 */
export const votes = sqliteTable(
	"votes",
	{
		id: uuidPk(),
		productSlug: text("product_slug").notNull(),
		/** Project they moved to, so a project can show what it got people out of. */
		projectSlug: text("project_slug"),

		/** Opaque id from the signed httpOnly cookie. Never readable by the client. */
		voterId: text("voter_id").notNull(),
		/** Hashed /24 or /64 — what a cookie clear cannot escape. */
		netHash: text("net_hash").notNull(),
		/** Hashed header signature, including TLS fingerprint where the proxy gives us one. */
		clientHash: text("client_hash").notNull(),

		/** 0..1. Only votes at or above the threshold reach the public count. */
		trust: real("trust").notNull().default(1),
		/** Why the score is what it is — the audit trail that makes a nuke defensible. */
		reasons: text("reasons", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.$defaultFn(() => []),
		/** Set by an admin sweep, never by the voter. Survives re-scoring. */
		nullifiedAt: integer("nullified_at", { mode: "timestamp" }),

		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(now),
	},
	(t) => [
		// One vote per product per voter; re-voting updates where they went.
		uniqueIndex("votes_unique_voter").on(t.productSlug, t.voterId),
		index("votes_product_idx").on(t.productSlug),
		index("votes_project_idx").on(t.projectSlug),
		// The two lookups the scorer does on every single vote.
		index("votes_net_day_idx").on(t.netHash, t.createdAt),
		index("votes_client_day_idx").on(t.clientHash, t.createdAt),
	],
);

/** "Tell me when a slot opens." */
export const waitlist = sqliteTable("waitlist", {
	email: emailText("email").primaryKey(),
	slotId: text("slot_id"),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(now),
});

/**
 * A single-use, short-lived proof that somebody controls an email address.
 *
 * The token is stored HASHED and never in the clear: the raw value exists only
 * in the email, so a leaked database is not a stack of working sign-in links.
 * Same reasoning as `sponsorPurchases.detailsTokenHash`, which is the same idea
 * over a longer life.
 *
 * `usedAt` rather than deleting the row, so a replay is VISIBLE in the table
 * instead of merely failing — the audit argument `votes.nullifiedAt` already
 * makes. Rows are swept on use rather than by a cron; expiry is decided at read
 * time, exactly like occupancy.
 */
export const magicLinks = sqliteTable(
	"magic_links",
	{
		id: uuidPk(),
		email: emailText("email").notNull(),
		/** sha256 of the token. The raw token is never written down. */
		tokenHash: text("token_hash").notNull().unique(),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		usedAt: integer("used_at", { mode: "timestamp" }),
		/**
		 * Where to land after signing in. Same-origin PATH only, validated both
		 * when written and when read — a login callback that redirects wherever it
		 * is told is a phishing endpoint wearing our own domain.
		 */
		redirect: text("redirect").notNull().default(""),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(now),
	},
	(t) => [index("magic_links_email_idx").on(t.email)],
);

/**
 * Who else may see one buyer's ads.
 *
 * There is deliberately no `organisations` table. An org would be a row whose
 * only content is a name, joined to purchases through a key those purchases do
 * not have — every campaign read would grow a join to express a relationship
 * that is one column. The paying email is already the identity: it is what the
 * invoice, the Stripe receipt and the purchase row all agree on.
 *
 * Two roles and nothing else. `owner` can invite and remove; `user` can only
 * look. The payer — the address the purchases are keyed by — is implicitly an
 * owner and has no row here, so it can never be demoted or removed by someone
 * they invited.
 *
 * Not `admin`: that word now belongs to the platform operator (`SITE_ADMIN`),
 * who is not a member of any org. One word, one meaning.
 *
 * `revokedAt` rather than a delete: removing somebody is a thing that happened,
 * and the audit trail is the same argument `votes.nullifiedAt` makes.
 */
export const ORG_ROLES = ["owner", "user"] as const;

export const orgMembers = sqliteTable(
	"org_members",
	{
		id: uuidPk(),
		/** The buyer. Not a foreign key — it is an email, and purchases are per-slot. */
		ownerEmail: emailText("owner_email").notNull(),
		memberEmail: emailText("member_email").notNull(),
		role: text("role", { enum: ORG_ROLES }).notNull().default("user"),
		invitedBy: emailText("invited_by").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(now),
		revokedAt: integer("revoked_at", { mode: "timestamp" }),
	},
	(t) => [
		uniqueIndex("org_members_unique").on(t.ownerEmail, t.memberEmail),
		index("org_members_member_idx").on(t.memberEmail),
	],
);

/** Crude per-IP throttle for the write endpoints. */
export const rateLimits = sqliteTable("rate_limits", {
	key: text("key").primaryKey(),
	count: integer("count").notNull(),
	windowStart: integer("window_start", { mode: "timestamp" })
		.notNull()
		.$defaultFn(now),
});
