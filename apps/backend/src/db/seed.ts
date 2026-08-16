/**
 * The demo site: what `bun run dev` fills an empty database with.
 *
 * Only the dynamic tables need seeding — products, projects and ad inventory all
 * come from git. What this adds is everything that normally only exists after
 * real people have used the site: switch counts, sold ad slots with real
 * creatives, orders part-way through the funnel, and enough impressions and
 * clicks for the ad stats to clear their own reporting threshold.
 *
 * ## Two fences, and why both
 *
 * `SEED_DEV=true` AND `NODE_ENV !== production` (see env.ts). This inserts
 * sponsor rows at `status: "live"` that nobody paid for — in production that is
 * inventory given away, and it would be indistinguishable from a real sale in
 * the admin queue. One forgotten variable must not be enough to do that, which
 * is the same argument payments.ts makes about the fake provider.
 *
 * Idempotent: it does nothing at all if anything has been seeded before, so a
 * reload does not pile up duplicates. `bun run dev:rm` is how you start over.
 *
 * Slugs come from the real content rather than being hardcoded, so the fixture
 * cannot rot when a product is renamed.
 */

import { collectProjects } from "core/src/content";
import { count } from "drizzle-orm";
import { mintDetailsToken } from "../auth";
import { content } from "../content";
import { env } from "../env";
import { log } from "../log";
import { db, schema } from ".";

/** Deterministic pseudo-random, so every dev machine gets the same fixture. */
function rng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) % 4294967296;
		return s / 4294967296;
	};
}

/** Brand-ish accents for the demo cards, in slot order. */
const TINTS = [
	"#0e9c47",
	"#0082c9",
	"#f46800",
	"#3152a0",
	"#175ddc",
	"#4250af",
	"#5850ec",
	"#8b5cf6",
];

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const ahead = (days: number) => new Date(Date.now() + days * DAY);

/**
 * The demo sponsors.
 *
 * Real self-hosted projects with real icon URLs, because the point of the
 * fixture is to see whether the ad units actually look right — a row of grey
 * placeholder boxes proves nothing about a component whose whole job is to
 * render somebody's brand. They are also on-message: every one of them is
 * something this site would tell you to switch to.
 *
 * `logoUrl` is what makes the icon appear; `Logo` falls back to a lettermark on
 * a broken URL, so one dead link costs one icon rather than the layout.
 */
const SPONSORS = [
	{
		name: "Gitea",
		tagline: "A painless self-hosted Git service",
		url: "https://about.gitea.com",
		logoUrl: "https://avatars.githubusercontent.com/u/12724356?s=200&v=4",
	},
	{
		name: "Nextcloud",
		tagline: "Your own cloud, on your own server",
		url: "https://nextcloud.com",
		logoUrl: "https://avatars.githubusercontent.com/u/19211038?s=200&v=4",
	},
	{
		name: "Grafana",
		tagline: "Dashboards for everything you run",
		url: "https://grafana.com",
		logoUrl: "https://avatars.githubusercontent.com/u/7195757?s=200&v=4",
	},
	{
		name: "Matomo",
		tagline: "Analytics that never leave your server",
		url: "https://matomo.org",
		logoUrl: "https://avatars.githubusercontent.com/u/698038?s=200&v=4",
	},
	{
		name: "Vaultwarden",
		tagline: "Bitwarden-compatible, one container",
		url: "https://github.com/dani-garcia/vaultwarden",
		logoUrl: "https://avatars.githubusercontent.com/u/725423?s=200&v=4",
	},
	{
		name: "Immich",
		tagline: "Google Photos, but it is yours",
		url: "https://immich.app",
		logoUrl: "https://avatars.githubusercontent.com/u/109746326?s=200&v=4",
	},
	{
		name: "Plausible",
		tagline: "Lightweight, privacy-first web analytics",
		url: "https://plausible.io",
		logoUrl: "https://avatars.githubusercontent.com/u/54802774?s=200&v=4",
	},
	{
		name: "Coolify",
		tagline: "Self-hosted Heroku, one VPS",
		url: "https://coolify.io",
		logoUrl: "https://avatars.githubusercontent.com/u/60715044?s=200&v=4",
	},
];

export async function seedDev(): Promise<void> {
	if (!env.seedDev) return;

	const [{ n }] = await db.select({ n: count() }).from(schema.sponsorPurchases);
	if (n > 0) return; // already seeded — leave whatever is there alone

	const random = rng(42);
	const projects = collectProjects(content.products);

	// ── Switch counts ────────────────────────────────────────────────────────
	// Weighted toward products people recognise, so "most switched" shows
	// something plausible rather than noise.
	const candidates = content.products
		.filter(
			(p) => p.priority >= 4 && p.alternatives.some((a) => a.kind === "oss"),
		)
		.slice(0, 60);

	const byProduct = new Set(
		projects.flatMap((proj) =>
			proj.replaces.map((r) => `${r.slug}:${proj.slug}`),
		),
	);

	const votes: (typeof schema.votes.$inferInsert)[] = [];
	let voter = 0;
	for (const product of candidates) {
		const howMany = Math.floor(random() ** 2 * 15);
		const targets = projects
			.filter((proj) => byProduct.has(`${product.slug}:${proj.slug}`))
			.slice(0, 3);
		for (let i = 0; i < howMany; i++) {
			voter++;
			votes.push({
				productSlug: product.slug,
				projectSlug:
					targets[Math.floor(random() * targets.length)]?.slug ?? null,
				voterId: `seed-${voter}`,
				netHash: `seed-net-${voter % 37}`,
				clientHash: `seed-client-${voter % 23}`,
				trust: 1,
				reasons: [],
				createdAt: ago(Math.floor(random() * 90)),
			});
		}
	}
	if (votes.length)
		await db.insert(schema.votes).values(votes).onConflictDoNothing();

	// ── Sold inventory ───────────────────────────────────────────────────────
	// Spread across every PLACEMENT rather than eight of the same kind, because
	// the rails, the hero grid and the marquee are three different components
	// and the fixture exists to prove all three render.
	const sellable = (placement: string) =>
		content.slots.filter(
			(s) => s.placement === placement && s.priceCents !== null,
		);

	const wanted = [
		...sellable("rail")
			.filter((s) => s.rail === "left")
			.slice(0, 3),
		...sellable("rail")
			.filter((s) => s.rail === "right")
			.slice(0, 2),
		...sellable("hero").slice(0, 2),
		...sellable("category").slice(0, 1),
	];

	const seedCreativeToken = mintDetailsToken();
	const purchases: (typeof schema.sponsorPurchases.$inferInsert)[] = [];
	const liveIds: { id: string; slotId: string; category: string }[] = [];

	wanted.forEach((slot, i) => {
		const s = SPONSORS[i % SPONSORS.length];
		const id = crypto.randomUUID();
		const startsAt = ago(20);
		purchases.push({
			id,
			slotId: slot.id,
			orderId: crypto.randomUUID(),
			status: "live",
			amountCents: slot.priceCents as number,
			months: 3,
			email: `${s.name.toLowerCase()}@seed.dev`,
			provider: "seed",
			name: s.name,
			tagline: s.tagline,
			url: s.url,
			logoUrl: s.logoUrl,
			// A colour per sponsor, so the tint path is visible in the fixture rather
			// than only in a form nobody has filled in yet.
			tint: TINTS[i % TINTS.length],
			paidAt: startsAt,
			submittedAt: startsAt,
			approvedAt: startsAt,
			startsAt,
			// Staggered, so the board shows a range of "taken until" dates and the
			// renewal case is visible rather than everything expiring together.
			endsAt: ahead(10 + i * 12),
		});
		liveIds.push({ id, slotId: slot.id, category: slot.category ?? "" });
	});

	// Two orders part-way through the funnel, so the admin queues and the
	// creative-email path are exercised without anyone clicking through Stripe.
	const pendingCreative = sellable("rail").find(
		(s) => !wanted.some((w) => w.id === s.id),
	);
	if (pendingCreative) {
		purchases.push({
			slotId: pendingCreative.id,
			orderId: crypto.randomUUID(),
			status: "paid",
			amountCents: pendingCreative.priceCents as number,
			months: 1,
			email: "awaiting-creative@seed.dev",
			provider: "seed",
			// Minted the same way a real one is, so the seeded row is shaped like a
			// paid order and not like a fixture. Only the hash is stored, which is
			// why the console below has to print the token.
			...seedCreativeToken.columns,
			paidAt: ago(1),
		});
	}

	const awaitingApproval = sellable("category").find(
		(s) => !wanted.some((w) => w.id === s.id),
	);
	if (awaitingApproval) {
		purchases.push({
			slotId: awaitingApproval.id,
			orderId: crypto.randomUUID(),
			status: "submitted",
			amountCents: awaitingApproval.priceCents as number,
			months: 1,
			email: "awaiting-approval@seed.dev",
			provider: "seed",
			name: "Uptime Kuma",
			tagline: "Self-hosted uptime monitoring",
			url: "https://uptime.kuma.pet",
			logoUrl: "https://avatars.githubusercontent.com/u/1336778?s=200&v=4",
			paidAt: ago(2),
			submittedAt: ago(1),
		});
	}

	await db
		.insert(schema.sponsorPurchases)
		.values(purchases)
		.onConflictDoNothing();

	// ── Impressions and clicks ───────────────────────────────────────────────
	// Enough to clear MIN_REPORTABLE_IMPRESSIONS (1000) and MIN_REPORTABLE_DAYS
	// (7), so /api/ads/stats returns `reportable: true` and the rate card shows a
	// table instead of its "not enough traffic yet" sentence. Without this the
	// component nobody can see is the one that took the most care to write.
	const pages = ["home", "product", "category", "project"] as const;
	const slugs = candidates.slice(0, 6).map((p) => p.slug);
	const impressions: (typeof schema.sponsorImpressions.$inferInsert)[] = [];
	const clicks: (typeof schema.sponsorClicks.$inferInsert)[] = [];

	for (let d = 0; d < 21; d++) {
		const day = ago(d).toISOString().slice(0, 10);
		for (const p of liveIds) {
			for (const page of pages) {
				const pageSlug =
					page === "home" ? "" : slugs[Math.floor(random() * slugs.length)];
				// Big enough that a ~1.2% CTR is a whole number. At 8-48 impressions a
				// row, `n * 0.012` never reached 1 and every click rounded away to
				// nothing — the fixture claimed 40k impressions and zero clicks, which
				// is not a demo of anything.
				const n = 40 + Math.floor(random() * 160);
				impressions.push({
					slotId: p.slotId,
					purchaseId: p.id,
					page,
					pageSlug,
					category: p.category,
					day,
					trusted: true,
					impressions: n,
				});
				// ~1.2% CTR, which is a believable number rather than a flattering one.
				const c = Math.round(n * 0.012 * (0.6 + random() * 0.8));
				if (c > 0) {
					clicks.push({
						purchaseId: p.id,
						slotId: p.slotId,
						page,
						pageSlug,
						day,
						trusted: true,
						clicks: c,
					});
				}
			}
			// A slice of untrusted traffic too, so the discard ledger on the public
			// page has something in it. A rate card that claims zero bots is not
			// more honest than one that says how many it threw away.
			impressions.push({
				slotId: p.slotId,
				purchaseId: p.id,
				page: "home",
				pageSlug: "",
				category: p.category,
				day,
				trusted: false,
				impressions: 1 + Math.floor(random() * 6),
			});
		}
	}
	await db
		.insert(schema.sponsorImpressions)
		.values(impressions)
		.onConflictDoNothing();
	if (clicks.length)
		await db.insert(schema.sponsorClicks).values(clicks).onConflictDoNothing();

	for (const [reason, events] of [
		["datacenter network", 184],
		["declared crawler", 103],
		["no session cookie", 47],
		["network volume this hour", 9],
	] as const) {
		await db
			.insert(schema.adTrafficAudit)
			.values({
				day: ago(1).toISOString().slice(0, 10),
				netHash: "seed-net",
				clientHash: "seed-client",
				reason,
				events,
			})
			.onConflictDoNothing();
	}

	await db
		.insert(schema.waitlist)
		.values([
			{ email: "waiting@seed.dev", slotId: wanted[0]?.id ?? null },
			{ email: "also-waiting@seed.dev", slotId: wanted[1]?.id ?? null },
		])
		.onConflictDoNothing();

	log.info(
		`seeded dev data: ${votes.length} votes · ${purchases.length} purchases ` +
			`(${liveIds.length} live, 1 awaiting creative, 1 awaiting approval) · ` +
			`${impressions.length} impression rows · ${clicks.length} click rows`,
	);
	// Raw stdout, not the pino logger: dev-only (SEED_DEV, never production), and the point is to hand the developer a working link.
	console.log(
		"  creative form for the unfinished order: " +
			`${env.webOrigin}/en/sponsor?token=${seedCreativeToken.token}`,
	);
}
