/**
 * The Postgres → SQLite port mapped four column shapes that have no native
 * SQLite equivalent (enums, uuid keys, `text[]`, `timestamptz`) and moved schema
 * creation from `drizzle-kit push` to the migrator. Each of those is a place a
 * value can silently round-trip wrong, so each gets a test.
 *
 * Runs against a throwaway file, never the real database.
 *
 *   bun test apps/backend/tests
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, gt, sql as raw } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/db/schema";

const dir = mkdtempSync(join(tmpdir(), "cri-db-test-"));
const sqlite = new Database(join(dir, "test.db"), { create: true });
const db = drizzle(sqlite, { schema });

beforeAll(() => {
	sqlite.exec("PRAGMA journal_mode = WAL");
	sqlite.exec("PRAGMA busy_timeout = 5000");
	sqlite.exec("PRAGMA foreign_keys = ON");
	// The same migrations `bun run db:push` applies — so a broken generated file
	// fails here rather than on someone's first clone.
	migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });
});

afterAll(() => {
	sqlite.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("pragmas", () => {
	test("WAL is on, so a read during the nightly rebuild cannot block a vote", () => {
		const row = sqlite.query("PRAGMA journal_mode").get() as {
			journal_mode: string;
		};
		expect(row.journal_mode).toBe("wal");
	});

	test("foreign keys are on — SQLite leaves them off by default", () => {
		const row = sqlite.query("PRAGMA foreign_keys").get() as {
			foreign_keys: number;
		};
		expect(row.foreign_keys).toBe(1);
	});
});

describe("column mappings", () => {
	test("uuid primary keys are generated without the DB doing it", async () => {
		const [row] = await db
			.insert(schema.votes)
			.values({
				productSlug: "p-uuid",
				voterId: "v1",
				netHash: "n",
				clientHash: "c",
			})
			.returning();
		// Not just "truthy" — a wrong $defaultFn would still produce a string.
		expect(row.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
		);
	});

	test("trust keeps its fractional part (doublePrecision → real)", async () => {
		const [row] = await db
			.insert(schema.votes)
			.values({
				productSlug: "p-trust",
				voterId: "v1",
				netHash: "n",
				clientHash: "c",
				trust: 0.35,
			})
			.returning();
		expect(row.trust).toBe(0.35);
		// An integer column would have truncated this to 0.
		expect(Number.isInteger(row.trust)).toBe(false);
	});

	test("reasons round-trips as an array, not a JSON string", async () => {
		const reasons = ["no-human-check", "network-busy"];
		const [row] = await db
			.insert(schema.votes)
			.values({
				productSlug: "p-reasons",
				voterId: "v1",
				netHash: "n",
				clientHash: "c",
				reasons,
			})
			.returning();
		expect(row.reasons).toEqual(reasons);

		const [read] = await db
			.select()
			.from(schema.votes)
			.where(eq(schema.votes.productSlug, "p-reasons"));
		expect(read.reasons).toEqual(reasons);
		expect(Array.isArray(read.reasons)).toBe(true);
	});

	test("an empty reasons array defaults in and reads back as []", async () => {
		const [row] = await db
			.insert(schema.votes)
			.values({
				productSlug: "p-empty",
				voterId: "v1",
				netHash: "n",
				clientHash: "c",
			})
			.returning();
		expect(row.reasons).toEqual([]);
	});

	test("productSlugs on a quote round-trips as an array", async () => {
		const slugs = ["notion", "slack"];
		const [row] = await db
			.insert(schema.quoteRequests)
			.values({ email: "a@b.dev", productSlugs: slugs })
			.returning();
		expect(row.productSlugs).toEqual(slugs);
	});

	test("timestamps come back as Date objects", async () => {
		const [row] = await db
			.insert(schema.votes)
			.values({
				productSlug: "p-date",
				voterId: "v1",
				netHash: "n",
				clientHash: "c",
			})
			.returning();
		expect(row.createdAt).toBeInstanceOf(Date);
		expect(Math.abs(Date.now() - row.createdAt.getTime())).toBeLessThan(10_000);
		expect(row.nullifiedAt).toBeNull();
	});

	test("gt(createdAt, since) still selects by time window", async () => {
		const old = new Date(Date.now() - 3 * 86_400_000);
		await db.insert(schema.votes).values([
			{
				productSlug: "p-win",
				voterId: "old",
				netHash: "win",
				clientHash: "c",
				createdAt: old,
			},
			{
				productSlug: "p-win",
				voterId: "new",
				netHash: "win",
				clientHash: "c",
			},
		]);

		const since = new Date(Date.now() - 86_400_000);
		const rows = await db
			.select()
			.from(schema.votes)
			.where(
				and(eq(schema.votes.netHash, "win"), gt(schema.votes.createdAt, since)),
			);
		expect(rows).toHaveLength(1);
		expect(rows[0].voterId).toBe("new");
	});

	test("a new purchase defaults to a one-month hold", async () => {
		const [row] = await db
			.insert(schema.sponsorPurchases)
			.values({ slotId: "hero", amountCents: 1, email: "a@b.dev" })
			.returning();
		expect(row.status).toBe("hold");
		// One price, one default term. There is no buyer tier any more.
		expect(row.months).toBe(1);
	});
});

describe("upserts", () => {
	test("re-voting updates the target instead of inserting a second row", async () => {
		const base = {
			productSlug: "p-upsert",
			voterId: "same-voter",
			netHash: "n",
			clientHash: "c",
		};
		await db
			.insert(schema.votes)
			.values({ ...base, projectSlug: "first", trust: 0.9 });

		await db
			.insert(schema.votes)
			.values({ ...base, projectSlug: "second", trust: 0.1 })
			.onConflictDoUpdate({
				target: [schema.votes.productSlug, schema.votes.voterId],
				set: { projectSlug: "second" },
			});

		const rows = await db
			.select()
			.from(schema.votes)
			.where(eq(schema.votes.productSlug, "p-upsert"));
		expect(rows).toHaveLength(1);
		expect(rows[0].projectSlug).toBe("second");
		// The score must not be re-rolled upward or downward by a re-vote.
		expect(rows[0].trust).toBe(0.9);
	});

	test("a duplicate waitlist signup is silently ignored", async () => {
		await db.insert(schema.waitlist).values({ email: "dup@b.dev" });
		await db
			.insert(schema.waitlist)
			.values({ email: "dup@b.dev" })
			.onConflictDoNothing();
		const rows = await db
			.select()
			.from(schema.waitlist)
			.where(eq(schema.waitlist.email, "dup@b.dev"));
		expect(rows).toHaveLength(1);
	});

	test("a second click on the same page the same day increments", async () => {
		const [purchase] = await db
			.insert(schema.sponsorPurchases)
			.values({ slotId: "clicks", amountCents: 1, email: "a@b.dev" })
			.returning();

		const day = "2026-01-01";
		for (let i = 0; i < 3; i++) {
			await db
				.insert(schema.sponsorClicks)
				.values({
					purchaseId: purchase.id,
					slotId: "clicks",
					page: "product",
					pageSlug: "figma",
					day,
					trusted: true,
					clicks: 1,
				})
				.onConflictDoUpdate({
					target: [
						schema.sponsorClicks.purchaseId,
						schema.sponsorClicks.day,
						schema.sponsorClicks.page,
						schema.sponsorClicks.pageSlug,
						schema.sponsorClicks.trusted,
					],
					// Qualified column in DO UPDATE SET — the SQLite syntax that
					// differs most from Postgres.
					set: { clicks: raw`${schema.sponsorClicks.clicks} + 1` },
				});
		}

		const rows = await db
			.select()
			.from(schema.sponsorClicks)
			.where(eq(schema.sponsorClicks.purchaseId, purchase.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].clicks).toBe(3);
	});

	/**
	 * The breakdown is in the key, so the same sponsor clicked from two different
	 * pages is two rows. Without this the per-page CTR would collapse into one
	 * number and the whole point of the breakdown would be lost.
	 */
	test("the same click from a different page is a separate row", async () => {
		const [purchase] = await db
			.insert(schema.sponsorPurchases)
			.values({ slotId: "clicks2", amountCents: 1, email: "a@b.dev" })
			.returning();

		for (const page of ["home", "product"] as const) {
			await db.insert(schema.sponsorClicks).values({
				purchaseId: purchase.id,
				slotId: "clicks2",
				page,
				day: "2026-01-02",
				clicks: 1,
			});
		}

		const rows = await db
			.select()
			.from(schema.sponsorClicks)
			.where(eq(schema.sponsorClicks.purchaseId, purchase.id));
		expect(rows).toHaveLength(2);
	});

	/**
	 * Trusted and untrusted counts live side by side rather than in one column, so
	 * the public page can print the first and still say how much of the second
	 * there was. If `trusted` were not in the unique key they would merge.
	 */
	test("an untrusted impression does not merge into the trusted count", async () => {
		for (const trusted of [true, false]) {
			await db.insert(schema.sponsorImpressions).values({
				slotId: "L1",
				page: "home",
				day: "2026-01-03",
				trusted,
				impressions: 5,
			});
		}

		const rows = await db
			.select()
			.from(schema.sponsorImpressions)
			.where(eq(schema.sponsorImpressions.slotId, "L1"));
		expect(rows).toHaveLength(2);
		expect(rows.filter((r) => r.trusted)).toHaveLength(1);
	});
});

describe("foreign keys", () => {
	test("deleting a purchase cascades to its clicks", async () => {
		const [purchase] = await db
			.insert(schema.sponsorPurchases)
			.values({ slotId: "cascade", amountCents: 1, email: "a@b.dev" })
			.returning();
		await db
			.insert(schema.sponsorClicks)
			.values({ purchaseId: purchase.id, day: "2026-02-02", clicks: 5 });

		await db
			.delete(schema.sponsorPurchases)
			.where(eq(schema.sponsorPurchases.id, purchase.id));

		const rows = await db
			.select()
			.from(schema.sponsorClicks)
			.where(eq(schema.sponsorClicks.purchaseId, purchase.id));
		expect(rows).toHaveLength(0);
	});

	test("a click against an unknown purchase is rejected", async () => {
		let threw: unknown;
		try {
			await db
				.insert(schema.sponsorClicks)
				.values({ purchaseId: "no-such-purchase", day: "2026-03-03" });
		} catch (e) {
			threw = e;
		}
		// Would silently insert an orphan if PRAGMA foreign_keys were left off.
		expect((threw as Error | undefined)?.message).toMatch(/FOREIGN KEY/i);
	});
});
