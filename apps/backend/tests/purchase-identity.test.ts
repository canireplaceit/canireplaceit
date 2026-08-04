/**
 * Who a purchase belongs to, and what proves it.
 *
 * Both halves have been wrong. Identity is an email address and SQLite compares
 * TEXT case-sensitively, so one capital letter at checkout was enough to hand a
 * paying advertiser an empty dashboard: the purchase said `John.Doe@Example.com`,
 * the session said `john.doe@example.com`, and `WHERE email IN (...)` matched
 * nothing. And the creative token signs its bearer in — `POST
 * /api/sponsor/details` sets a session cookie for the address that paid — so it
 * is held to the same rules as a magic link: hashed at rest, single-use, dead
 * after a while.
 *
 * One file, because `src/db` is a singleton and the tests share its connection.
 * Runs against a throwaway file, never the real database.
 *
 *   bun test apps/backend/tests/purchase-identity.test.ts
 */

import { Database } from "bun:sqlite";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/db/schema";

const dir = mkdtempSync(join(tmpdir(), "cri-identity-test-"));
const sqlite = new Database(join(dir, "test.db"), { create: true });
const db = drizzle(sqlite, { schema });
sqlite.exec("PRAGMA foreign_keys = ON");
migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });

/**
 * `src/db` opens a connection the moment it is imported, and by the time this
 * file runs another suite has already imported it — pointing at the developer's
 * real database. So the module is replaced rather than the environment: this
 * suite WRITES, and a test run must not write there.
 */
mock.module(join(import.meta.dir, "../src/db"), () => ({
	db,
	sqlite,
	schema,
	DB_PATH: join(dir, "test.db"),
}));
/**
 * Same problem, same shape: `src/env` parses the environment once on import, and
 * an earlier suite has already imported it — so setting AUTH_SECRET here would
 * be read by nobody. The rest of the configuration is passed through unchanged.
 */
const { env: parsed } = await import("../src/env");
mock.module(join(import.meta.dir, "../src/env"), () => ({
	env: { ...parsed, authSecret: "test-secret-not-used-anywhere-else" },
	authEnabled: true,
}));

const {
	detailsTokenHolder,
	issueSession,
	mintDetailsToken,
	readSession,
	visibleEmails,
} = await import("../src/auth");

// Left open: the replacement above outlives this file, and a suite that runs
// after it must not find a closed connection.
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** What the buyer typed at checkout. */
const TYPED = " John.Doe@Example.com ";
const CANONICAL = "john.doe@example.com";

describe("the address on a purchase", () => {
	test("is stored canonical, not as it was typed", async () => {
		await db.insert(schema.sponsorPurchases).values({
			slotId: "rail-1",
			amountCents: 1,
			email: TYPED,
			status: "live",
		});

		// Read past Drizzle: this asserts the COLUMN is canonical, so a query
		// written by hand tomorrow finds the row too.
		const rows = sqlite
			.query("SELECT email FROM sponsor_purchases WHERE slot_id = 'rail-1'")
			.all() as { email: string }[];
		expect(rows.map((r) => r.email)).toEqual([CANONICAL]);
	});

	/** The bug, end to end: pay with a capital letter, sign in, see your ad. */
	test("is what the dashboard query finds from a lowercase session", async () => {
		const session = await readSession(await issueSession(TYPED));
		expect(session).toBe(CANONICAL);

		const mine = await visibleEmails(session as string);
		const rows = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(inArray(schema.sponsorPurchases.email, mine));
		expect(rows).toHaveLength(1);
		expect(rows[0].slotId).toBe("rail-1");
	});

	test("is matched for a member invited as Mixed@Case", async () => {
		await db.insert(schema.orgMembers).values({
			ownerEmail: TYPED,
			memberEmail: "Viewer@Example.com",
			invitedBy: TYPED,
		});

		const owners = await visibleEmails("viewer@example.com");
		expect(owners).toContain(CANONICAL);
	});
});

/** A paid order waiting for its creative, exactly as a settled checkout leaves one. */
async function paidOrder(columns: Record<string, unknown>) {
	const [row] = await db
		.insert(schema.sponsorPurchases)
		.values({
			slotId: `slot-${crypto.randomUUID()}`,
			amountCents: 1,
			email: "buyer@example.com",
			status: "paid",
			...columns,
		})
		.returning();
	return row;
}

describe("the creative token", () => {
	test("resolves to the order it was minted for, and is not stored beside it", async () => {
		const details = mintDetailsToken();
		const row = await paidOrder(details.columns);

		const found = await detailsTokenHolder(details.token);
		expect(found.ok).toBe(true);
		expect(found.ok && found.holder.id).toBe(row.id);

		// The raw value exists only in the response to the buyer. A dump of this
		// table must not be a stack of working sign-ins.
		const stored = sqlite
			.query("SELECT * FROM sponsor_purchases WHERE id = ?")
			.get(row.id) as Record<string, unknown>;
		expect(JSON.stringify(stored)).not.toContain(details.token);
	});

	test("is unknown when nobody minted it", async () => {
		expect(await detailsTokenHolder("not-a-token")).toEqual({
			ok: false,
			reason: "unknown",
		});
	});

	test("cannot be replayed once the creative has landed", async () => {
		const details = mintDetailsToken();
		const row = await paidOrder(details.columns);
		expect((await detailsTokenHolder(details.token)).ok).toBe(true);

		// What POST /api/sponsor/details writes when the creative arrives: the
		// status moves off `paid` and the spent credential is burnt with it.
		await db
			.update(schema.sponsorPurchases)
			.set({
				status: "submitted",
				detailsTokenHash: null,
				detailsTokenExpiresAt: null,
			})
			.where(eq(schema.sponsorPurchases.id, row.id));

		expect(await detailsTokenHolder(details.token)).toEqual({
			ok: false,
			reason: "unknown",
		});
	});

	/**
	 * Told apart from "unknown" so the endpoint can answer "this link has expired,
	 * reopen your payment confirmation" rather than "no such order" to somebody who
	 * has paid.
	 */
	test("is expired rather than unknown once past its life", async () => {
		const details = mintDetailsToken();
		await paidOrder({
			...details.columns,
			detailsTokenExpiresAt: new Date(Date.now() - 1000),
		});

		expect(await detailsTokenHolder(details.token)).toEqual({
			ok: false,
			reason: "expired",
		});
	});
});
