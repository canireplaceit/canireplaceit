/**
 * The gate between a payment and a published ad, and the money that comes back
 * when a reviewer says no.
 *
 * Three properties are worth the whole file, and every one of them was once not
 * true:
 *
 *   - paying does not publish. A settled order with a creative lands on
 *     `submitted`, and `live` is reachable only through `approvePurchase`
 *   - a rejection refunds exactly once, and the row never claims a refund the
 *     provider refused
 *   - a `fake-dev` row never reaches Stripe, whatever this process is configured
 *     with
 *
 * One file, because `src/db` is a singleton and the tests share its connection —
 * the same reason org-roles.test.ts gives. Runs against a throwaway file, never
 * the real database, and against a stub provider, never a real Stripe key.
 *
 *   bun test apps/backend/tests/ad-review.test.ts
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endOfTerm } from "core/src/sponsorship";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/db/schema";
import type { PaymentProvider } from "../src/payments";

const dir = mkdtempSync(join(tmpdir(), "cri-review-test-"));
const sqlite = new Database(join(dir, "test.db"), { create: true });
const db = drizzle(sqlite, { schema });
sqlite.exec("PRAGMA foreign_keys = ON");
migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });

mock.module(join(import.meta.dir, "../src/db"), () => ({
	db,
	sqlite,
	schema,
	DB_PATH: join(dir, "test.db"),
}));

const ADMIN = "ops@site.dev";
const PAYER = "payer@acme.dev";
const READER = "reader@acme.dev";

const { env: parsed } = await import("../src/env");
const fakeEnv = {
	...parsed,
	siteAdmins: [ADMIN],
	authSecret: "test-secret-for-sessions",
	sessionTtlMs: 3_600_000,
};
mock.module(join(import.meta.dir, "../src/env"), () => ({
	env: fakeEnv,
	authEnabled: true,
	banner: () => {},
}));

/**
 * A Stripe that counts. The point of the counter is not that refunding works —
 * Stripe's own SDK is not under test — it is that a second reject, and a
 * `fake-dev` row, produce ZERO further calls to it.
 */
let stripeCalls: { intent: string; amountCents: number; key: string }[] = [];
let stripeFails = "";
const stripeStub: PaymentProvider = {
	id: "stripe",
	live: true,
	async createCheckout() {
		throw new Error("checkout is not under test");
	},
	async verify() {
		return { settled: true };
	},
	async refund(o) {
		stripeCalls.push({
			intent: o.paymentIntent,
			amountCents: o.amountCents,
			key: o.idempotencyKey,
		});
		if (stripeFails) throw new Error(stripeFails);
		return { refundId: `re_test_${stripeCalls.length}` };
	},
};
mock.module(join(import.meta.dir, "../src/stripe"), () => ({
	stripePaymentProvider: stripeStub,
}));

/**
 * A mailer that records rather than sends, so the review outcome mails
 * (approve → live, reject → refunded-or-not) can be asserted on without a
 * real SMTP hop. The templates themselves stay real — only the transport is
 * swapped, same as the Stripe stub above swaps the provider and not the money
 * math.
 */
let sentMails: import("../src/mail").MailMessage[] = [];
const actualMail = await import("../src/mail");
mock.module(join(import.meta.dir, "../src/mail"), () => ({
	...actualMail,
	mailer: {
		id: "test",
		async send(m: import("../src/mail").MailMessage) {
			sentMails.push(m);
			return true;
		},
	},
}));

const { approvePurchase, refundPurchase, rejectPurchase, settledState } =
	await import("../src/review");
const { platformAdminApi } = await import("../src/admin-api");
const { issueSession, SESSION_COOKIE } = await import("../src/auth");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const CREATIVE = {
	name: "Acme",
	nameFr: "Acme FR",
	tagline: "Own your stack",
	taglineFr: "Votre pile, à vous",
	url: "https://acme.dev",
	logoUrl: "/api/sponsor-logos/acme.png",
	tint: "#0e9c47",
};

/** A settled, creative-carrying line, exactly as the buyer's payment leaves it. */
async function submitted(
	over: Partial<typeof schema.sponsorPurchases.$inferInsert> = {},
) {
	const [row] = await db
		.insert(schema.sponsorPurchases)
		.values({
			slotId: `slot-${crypto.randomUUID()}`,
			orderId: crypto.randomUUID(),
			email: PAYER,
			amountCents: 12_000,
			months: 3,
			status: "submitted",
			provider: "fake-dev",
			providerRef: `FAKE-DEV-${crypto.randomUUID()}`,
			paidAt: new Date(),
			submittedAt: new Date(),
			...CREATIVE,
			...over,
		})
		.returning();
	return row;
}

const load = async (id: string) =>
	(
		await db
			.select()
			.from(schema.sponsorPurchases)
			.where(eq(schema.sponsorPurchases.id, id))
	)[0];

beforeEach(() => {
	stripeCalls = [];
	stripeFails = "";
	sentMails = [];
	fakeEnv.siteAdmins = [ADMIN];
});

/** The notify calls are fire-and-forget, so tests wait one microtask tick. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("what settling a payment is allowed to produce", () => {
	const now = new Date("2026-08-03T12:00:00Z");

	test("a settled purchase with a creative lands submitted, never live", () => {
		expect(settledState({ name: "Acme" }, now)).toEqual({
			status: "submitted",
			paidAt: now,
		});
	});

	test("one without a creative still lands paid, and waits for the form", () => {
		expect(settledState({ name: null }, now)).toEqual({
			status: "paid",
			paidAt: now,
		});
	});
});

/**
 * The structural half of "no path other than approval can publish". A behavioural
 * test can only cover the paths somebody thought to write; this one fails the
 * moment a NEW route sets the column, which is exactly when it would be missed.
 */
describe("who is allowed to write status live", () => {
	test("exactly one function in the source does, and it is approvePurchase", () => {
		const src = join(import.meta.dir, "../src");
		// Comments are stripped first: review.ts's own header states the rule in
		// prose, and a doc comment describing the invariant is not a violation of
		// it. Scanning the raw text counted the sentence as a second writer.
		const code = (f: string) =>
			readFileSync(join(src, f), "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^[ \t]*\/\/.*$/gm, "");
		const writers = readdirSync(src, { recursive: true, encoding: "utf8" })
			.filter((f) => f.endsWith(".ts"))
			.filter((f) => /status:\s*"live"/.test(code(f)));
		/**
		 * `db/seed.ts` is the demo fixture and the one deliberate exception: it is
		 * fenced twice over (`SEED_DEV=true` AND not production) precisely because it
		 * hands out live inventory nobody paid for. Every OTHER writer would be a
		 * publication path with no reviewer in it.
		 */
		expect(writers.sort()).toEqual(["db/seed.ts", "review.ts"]);

		const review = code("review.ts");
		expect(review.match(/status:\s*"live"/g)).toHaveLength(1);
		expect(review.indexOf('status: "live"')).toBeGreaterThan(
			review.indexOf("export async function approvePurchase"),
		);
	});
});

describe("approval, the only door to live", () => {
	test("publishes a submitted line and dates the run from now", async () => {
		const row = await submitted();
		const now = new Date("2026-08-03T12:00:00Z");
		const out = await approvePurchase(row.id, now);

		expect(out?.status).toBe("live");
		expect(out?.approvedAt).toEqual(now);
		expect(out?.startsAt).toEqual(now);
		expect(out?.endsAt).toEqual(endOfTerm(now, 3));
	});

	test("refuses a row whose creative never arrived", async () => {
		const row = await submitted({ status: "paid", name: null });
		expect(await approvePurchase(row.id)).toBeNull();
		expect((await load(row.id)).status).toBe("paid");
	});

	test("refuses one that is already refunded, so nothing is republished", async () => {
		const row = await submitted({ status: "refunded" });
		expect(await approvePurchase(row.id)).toBeNull();
		expect((await load(row.id)).status).toBe("refunded");
	});

	test("re-approving a live run is a no-op, not a second set of dates", async () => {
		const row = await submitted();
		const first = await approvePurchase(row.id);
		expect(await approvePurchase(row.id)).toBeNull();
		expect((await load(row.id)).startsAt).toEqual(first?.startsAt ?? null);
	});

	test("publishing tells the buyer their ad is live", async () => {
		const row = await submitted();
		await approvePurchase(row.id);
		await flush();

		expect(sentMails).toHaveLength(1);
		expect(sentMails[0].to).toBe(PAYER);
		expect(sentMails[0].subject).toContain("live");
	});

	test("a no-op re-approve sends no second mail", async () => {
		const row = await submitted();
		await approvePurchase(row.id);
		await approvePurchase(row.id);
		await flush();

		expect(sentMails).toHaveLength(1);
	});
});

describe("refunds", () => {
	test("a fake-provider row is refunded by the fake provider, never Stripe", async () => {
		const row = await submitted();
		const out = await refundPurchase(row, { reason: "off-brand" });

		expect(out).toMatchObject({ ok: true, already: false });
		expect(stripeCalls).toHaveLength(0);

		const after = await load(row.id);
		expect(after.status).toBe("refunded");
		expect(after.stripeRefundId).toStartWith("FAKE-DEV-REFUND-");
		expect(after.refundReason).toBe("off-brand");
		// Freed by both of the tests board() applies, exactly as a release is.
		expect(after.endsAt).not.toBeNull();
		expect(after.releasedAt).not.toBeNull();
	});

	test("rejecting twice issues one refund and reports the one it has", async () => {
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_test_1",
		});
		const first = await refundPurchase(row);
		expect(first).toMatchObject({ ok: true, already: false });
		expect(stripeCalls).toHaveLength(1);
		expect(stripeCalls[0]).toEqual({
			intent: "pi_test_1",
			// This line's own charge in full — never the whole payment intent, which
			// pays for every slot in the order.
			amountCents: 12_000,
			key: `refund-${row.id}`,
		});

		const second = await refundPurchase(await load(row.id));
		expect(second).toMatchObject({ ok: true, already: true });
		expect(stripeCalls).toHaveLength(1);
		if (first.ok && second.ok) {
			expect(second.refundId).toBe(first.refundId);
		}
	});

	test("a second reject does not overwrite the first one's reason or dates", async () => {
		const row = await submitted();
		await refundPurchase(row, { reason: "off-brand" });
		const first = await load(row.id);

		await refundPurchase(first, { reason: "clicked again" });
		const second = await load(row.id);
		expect(second.refundReason).toBe("off-brand");
		expect(second.releasedAt).toEqual(first.releasedAt);
		expect(second.endsAt).toEqual(first.endsAt);
	});

	/**
	 * A release ends a run that IS live, so its future `endsAt` has to be pulled
	 * back to now — the one case where an existing value must NOT be preserved.
	 */
	test("releasing a live run frees the slot rather than keeping its end date", async () => {
		const row = await submitted();
		const live = await approvePurchase(row.id);
		expect(live?.endsAt?.getTime()).toBeGreaterThan(Date.now());

		const out = await refundPurchase(await load(row.id), {
			reason: "takedown",
		});
		expect(out.ok).toBe(true);
		const after = await load(row.id);
		expect(after.status).toBe("refunded");
		expect(after.endsAt?.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
	});

	test("a refund Stripe refuses leaves the row honest and surfaces the error", async () => {
		stripeFails = "card_declined: refund refused";
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_test_2",
		});
		const out = await refundPurchase(row, { reason: "spam" });

		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.error).toContain("refund refused");

		const after = await load(row.id);
		expect(after.status).toBe("submitted");
		expect(after.stripeRefundId).toBeNull();
		expect(after.refundReason).toBeNull();
	});

	test("a stripe row with no payment intent is a human's problem, not a status", async () => {
		const row = await submitted({ provider: "stripe" });
		const out = await refundPurchase(row);
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.error).toContain("Stripe dashboard");
		expect((await load(row.id)).status).toBe("submitted");
		expect(stripeCalls).toHaveLength(0);
	});

	test("a row nothing ever settled cannot be refunded into silence", async () => {
		const row = await submitted({ status: "hold", provider: null });
		const out = await refundPurchase(row);
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.error).toContain("never settled");
		expect((await load(row.id)).status).toBe("hold");
	});

	/**
	 * The dev seed writes `provider: "seed"` and no payment of any kind. Refusing
	 * to refund that is right; refusing to REJECT it left it stuck in the queue
	 * with no way out, which is what these two cover.
	 */
	test("rejecting a row nobody paid for marks it rejected and refunds nothing", async () => {
		const row = await submitted({ provider: "seed" });
		const out = await rejectPurchase(row, { reason: "seed fixture" });

		expect(out.ok).toBe(true);
		if (out.ok) expect(out.refundId).toBeNull();
		const after = await load(row.id);
		expect(after.status).toBe("rejected");
		expect(after.refundReason).toBe("seed fixture");
		expect(after.stripeRefundId).toBeNull();
		expect(stripeCalls).toHaveLength(0);
	});

	test("rejecting a row nobody paid for still mails the buyer, without refund copy", async () => {
		const row = await submitted({ provider: "seed" });
		await rejectPurchase(row, { reason: "seed fixture" });
		await flush();

		expect(sentMails).toHaveLength(1);
		expect(sentMails[0].to).toBe(PAYER);
		expect(sentMails[0].text).toContain("seed fixture");
		expect(sentMails[0].text).not.toContain("refunded");
	});

	test("a refund the provider refuses sends no mail — nothing to tell the buyer yet", async () => {
		stripeFails = "card_declined";
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_test_fail_mail",
		});
		await rejectPurchase(row, { reason: "spam" });
		await flush();

		expect(sentMails).toHaveLength(0);
	});

	test("rejecting a stripe row with no recorded intent still fails loudly", async () => {
		// It WAS charged; the webhook simply never wrote the handle. Quietly
		// rejecting it would keep the buyer's money.
		const row = await submitted({ provider: "stripe" });
		const out = await rejectPurchase(row);
		expect(out.ok).toBe(false);
		expect((await load(row.id)).status).toBe("submitted");
		expect(stripeCalls).toHaveLength(0);
	});

	test("rejecting a charged row still refunds before it marks", async () => {
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_test_reject",
		});
		const out = await rejectPurchase(row, { reason: "off-brand" });

		expect(out.ok).toBe(true);
		if (out.ok) expect(out.refundId).not.toBeNull();
		const after = await load(row.id);
		expect(after.status).toBe("refunded");
		expect(after.stripeRefundId).not.toBeNull();
		expect(stripeCalls).toHaveLength(1);
	});

	test("rejecting a charged row mails the buyer the reason and the refund", async () => {
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_test_reject_mail",
		});
		await rejectPurchase(row, { reason: "off-brand" });
		await flush();

		expect(sentMails).toHaveLength(1);
		expect(sentMails[0].to).toBe(PAYER);
		expect(sentMails[0].text).toContain("off-brand");
		expect(sentMails[0].text).toContain("refunded");
	});
});

const sessionCookie = async (email: string) =>
	`${SESSION_COOKIE}=${await issueSession(email)}`;

const call = (
	path: string,
	o: { cookie?: string; method?: string; body?: unknown } = {},
) =>
	platformAdminApi.handle(
		new Request(`http://localhost${path}`, {
			method: o.method ?? "GET",
			headers: {
				...(o.cookie ? { cookie: o.cookie } : {}),
				"content-type": "application/json",
			},
			body: o.body === undefined ? undefined : JSON.stringify(o.body),
		}),
	);

const READS = [
	"/api/site-admin/queue",
	"/api/site-admin/campaigns",
	"/api/site-admin/slots",
];

describe("who may reach the platform-admin API", () => {
	test("not signed in is 401, on every endpoint", async () => {
		for (const path of READS) {
			expect((await call(path)).status).toBe(401);
		}
		const id = (await submitted()).id;
		expect(
			(
				await call(`/api/site-admin/purchases/${id}/approve`, {
					method: "POST",
				})
			).status,
		).toBe(401);
	});

	test("an org-owner and an org-user are both 403, on every endpoint", async () => {
		for (const who of [PAYER, READER]) {
			const cookie = await sessionCookie(who);
			for (const path of READS) {
				expect((await call(path, { cookie })).status).toBe(403);
			}
			const id = (await submitted()).id;
			for (const verb of ["approve", "reject"]) {
				const res = await call(`/api/site-admin/purchases/${id}/${verb}`, {
					method: "POST",
					cookie,
					body: {},
				});
				expect(res.status).toBe(403);
			}
			// And the ad they could not approve is still waiting.
			expect((await load(id)).status).toBe("submitted");
		}
	});

	/** Fail closed, and say which of the two problems it is. */
	test("an unset SITE_ADMIN is 503 for everyone, including the admin", async () => {
		fakeEnv.siteAdmins = [];
		const cookie = await sessionCookie(ADMIN);
		for (const path of READS) {
			const res = await call(path, { cookie });
			expect(res.status).toBe(503);
			expect((await res.json()).error).toContain("SITE_ADMIN");
		}
		expect((await call(READS[0])).status).toBe(503);
	});

	test("the admin gets through", async () => {
		const cookie = await sessionCookie(ADMIN);
		for (const path of READS) {
			expect((await call(path, { cookie })).status).toBe(200);
		}
	});
});

describe("what the reviewer is shown", () => {
	test("the whole creative, in both locales, plus the timestamp trail", async () => {
		const row = await submitted();
		const res = await call("/api/site-admin/queue", {
			cookie: await sessionCookie(ADMIN),
		});
		const body = (await res.json()) as {
			queue: Record<string, unknown>[];
		};
		const found = body.queue.find((q) => q.id === row.id);

		expect(found).toBeDefined();
		expect(found).toMatchObject({
			status: "submitted",
			email: PAYER,
			slotId: row.slotId,
			amountCents: 12_000,
			months: 3,
			name: { en: "Acme", fr: "Acme FR" },
			tagline: { en: "Own your stack", fr: "Votre pile, à vous" },
			url: "https://acme.dev",
			logoUrl: "/api/sponsor-logos/acme.png",
			tint: "#0e9c47",
			raw: {
				name: "Acme",
				nameFr: "Acme FR",
				tagline: "Own your stack",
				taglineFr: "Votre pile, à vous",
			},
		});
		for (const stamp of [
			"createdAt",
			"paidAt",
			"submittedAt",
			"waitingSince",
		]) {
			expect(typeof found?.[stamp]).toBe("string");
		}
		for (const stamp of ["approvedAt", "startsAt", "endsAt", "releasedAt"]) {
			expect(found?.[stamp]).toBeNull();
		}
		expect(typeof found?.waitingHours).toBe("number");
	});

	/**
	 * A French tagline nobody previewed is a French tagline nobody reviewed, so
	 * the fallback is applied here and not left to the page.
	 */
	test("a creative with no French copy is shown falling back, as it renders", async () => {
		const row = await submitted({ nameFr: null, taglineFr: null });
		const res = await call("/api/site-admin/queue", {
			cookie: await sessionCookie(ADMIN),
		});
		const body = (await res.json()) as { queue: Record<string, unknown>[] };
		const found = body.queue.find((q) => q.id === row.id);
		expect(found).toMatchObject({
			name: { en: "Acme", fr: "Acme" },
			tagline: { en: "Own your stack", fr: "Own your stack" },
			raw: { nameFr: null, taglineFr: null },
		});
	});

	test("campaigns refuse a CTR until there is enough of one to mean anything", async () => {
		const row = await submitted();
		await approvePurchase(row.id);
		const res = await call("/api/site-admin/campaigns", {
			cookie: await sessionCookie(ADMIN),
		});
		const body = (await res.json()) as {
			site: { minImpressions: number };
			campaigns: { id: string; metrics: Record<string, unknown> }[];
		};
		const found = body.campaigns.find((c) => c.id === row.id);

		expect(found?.metrics).toMatchObject({
			impressions: 0,
			clicks: 0,
			ctr: null,
			reportable: false,
			daysRunning: 0,
		});
		expect(found?.metrics.note).toContain("not enough data yet");
		// The site's own figures, for comparison — the same adStats() the public
		// page publishes, never a second opinion.
		expect(body.site.minImpressions).toBe(1000);
	});
});

describe("the review decisions, over HTTP", () => {
	test("approve publishes it, with the term that was bought", async () => {
		const row = await submitted();
		const res = await call(`/api/site-admin/purchases/${row.id}/approve`, {
			method: "POST",
			cookie: await sessionCookie(ADMIN),
		});
		expect(res.status).toBe(200);

		const after = await load(row.id);
		expect(after.status).toBe("live");
		expect(after.startsAt).not.toBeNull();
		expect(after.endsAt).toEqual(
			endOfTerm(after.startsAt as Date, after.months),
		);
	});

	test("reject refunds once, records the refund and keeps the reason", async () => {
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_http_1",
		});
		const cookie = await sessionCookie(ADMIN);
		const first = await call(`/api/site-admin/purchases/${row.id}/reject`, {
			method: "POST",
			cookie,
			body: { reason: "misleading claim" },
		});
		expect(first.status).toBe(200);
		expect(await first.json()).toMatchObject({
			ok: true,
			refundId: "re_test_1",
			alreadyRefunded: false,
		});

		const after = await load(row.id);
		expect(after.status).toBe("refunded");
		expect(after.stripeRefundId).toBe("re_test_1");
		expect(after.refundReason).toBe("misleading claim");

		const second = await call(`/api/site-admin/purchases/${row.id}/reject`, {
			method: "POST",
			cookie,
			body: { reason: "clicked twice" },
		});
		expect(await second.json()).toMatchObject({ alreadyRefunded: true });
		expect(stripeCalls).toHaveLength(1);
	});

	test("a refund the provider refuses is a 502, and the queue keeps the row", async () => {
		stripeFails = "insufficient_funds";
		const row = await submitted({
			provider: "stripe",
			stripePaymentIntent: "pi_http_2",
		});
		const res = await call(`/api/site-admin/purchases/${row.id}/reject`, {
			method: "POST",
			cookie: await sessionCookie(ADMIN),
			body: {},
		});
		expect(res.status).toBe(502);
		expect((await res.json()).error).toContain("insufficient_funds");
		expect((await load(row.id)).status).toBe("submitted");
	});

	test("approving something that is not awaiting review is a 409", async () => {
		const row = await submitted({ status: "paid", name: null });
		const res = await call(`/api/site-admin/purchases/${row.id}/approve`, {
			method: "POST",
			cookie: await sessionCookie(ADMIN),
		});
		expect(res.status).toBe(409);
	});
});
