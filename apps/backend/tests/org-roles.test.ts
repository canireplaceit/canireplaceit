/**
 * Three roles, and what each of them may do.
 *
 * `admin` used to mean two unrelated things — the person who manages one
 * advertiser's team, and the operator of the whole site — told apart only by
 * whether the request carried a bearer token or a session cookie. The words are
 * now `org-owner`, `org-user` and `admin`, and every one of them is decided by
 * `roleOf`, so the properties worth defending are testable in one place:
 *
 *   - the payer cannot be demoted or removed by anyone they invited
 *   - membership is one hop and never transitive
 *   - a stranger gets no role, which is not the same as a read-only one
 *   - an unset SITE_ADMIN means nobody, never everybody
 *
 * One file, because `src/db` is a singleton and the tests share its connection.
 * Runs against a throwaway file, never the real database.
 *
 *   bun test apps/backend/tests/org-roles.test.ts
 */

import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "../src/db/schema";

const dir = mkdtempSync(join(tmpdir(), "cri-roles-test-"));
const sqlite = new Database(join(dir, "test.db"), { create: true });
const db = drizzle(sqlite, { schema });
sqlite.exec("PRAGMA foreign_keys = ON");
migrate(db, { migrationsFolder: join(import.meta.dir, "../drizzle") });

// `src/db` opens a connection the moment it is imported, and this suite WRITES —
// so the module is replaced rather than the environment. Same reasoning as
// purchase-identity.test.ts.
mock.module(join(import.meta.dir, "../src/db"), () => ({
	db,
	sqlite,
	schema,
	DB_PATH: join(dir, "test.db"),
}));

const SITE_ADMIN = "ops@site.dev";

/**
 * `src/env` parses the environment once on import, so setting SITE_ADMIN here
 * would be read by nobody. Held by reference rather than spread inline because
 * "an empty list means nobody" is one of the things under test.
 */
const { env: parsed } = await import("../src/env");
const fake = { ...parsed, siteAdmins: [SITE_ADMIN] };
mock.module(join(import.meta.dir, "../src/env"), () => ({
	env: fake,
	authEnabled: true,
}));

const { canManage, isPlatformAdmin, roleOf, visibleEmails } = await import(
	"../src/auth"
);

// Left open: the replacement above outlives this file, and a suite that runs
// after it must not find a closed connection.
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PAYER = "payer@acme.dev";
const MANAGER = "manager@acme.dev";
const READER = "reader@acme.dev";
const RIVAL = "payer@rival.dev";

beforeAll(async () => {
	await db.insert(schema.orgMembers).values([
		{
			ownerEmail: PAYER,
			memberEmail: MANAGER,
			role: "owner",
			invitedBy: PAYER,
		},
		{ ownerEmail: PAYER, memberEmail: READER, role: "user", invitedBy: PAYER },
	]);
	await db.insert(schema.sponsorPurchases).values([
		{ slotId: "acme-hero", amountCents: 1, email: PAYER, status: "live" },
		{ slotId: "rival-hero", amountCents: 1, email: RIVAL, status: "live" },
	]);
});

describe("what a session is on one account", () => {
	test("the payer is an org-owner, and has no membership row to be one", async () => {
		expect(await roleOf(PAYER, PAYER)).toBe("org-owner");
		const rows = await db
			.select()
			.from(schema.orgMembers)
			.where(eq(schema.orgMembers.memberEmail, PAYER));
		expect(rows).toHaveLength(0);
	});

	test("an invited member is an org-user and may not invite or remove", async () => {
		expect(await roleOf(READER, PAYER)).toBe("org-user");
		expect(canManage(await roleOf(READER, PAYER))).toBe(false);
	});

	test("a promoted member is an org-owner and may invite and remove", async () => {
		expect(await roleOf(MANAGER, PAYER)).toBe("org-owner");
		expect(canManage(await roleOf(MANAGER, PAYER))).toBe(true);
	});

	/** Not "org-user": no relationship must never fall through to read-only. */
	test("a stranger has no role at all", async () => {
		expect(await roleOf(RIVAL, PAYER)).toBeNull();
		expect(canManage(await roleOf(RIVAL, PAYER))).toBe(false);
	});

	test("a revoked member loses their role on the very next call", async () => {
		const gone = "gone@acme.dev";
		await db
			.insert(schema.orgMembers)
			.values({ ownerEmail: PAYER, memberEmail: gone, invitedBy: PAYER });
		expect(await roleOf(gone, PAYER)).toBe("org-user");

		await db
			.update(schema.orgMembers)
			.set({ revokedAt: new Date() })
			.where(eq(schema.orgMembers.memberEmail, gone));
		expect(await roleOf(gone, PAYER)).toBeNull();
	});
});

/**
 * The property the whole shape exists to protect. An org-owner they invited has
 * every write the payer has, so the only thing keeping the payer's own standing
 * out of reach is that it is not stored anywhere to be edited.
 */
describe("the payer, against someone they invited", () => {
	test("cannot be demoted by writing a row that says otherwise", async () => {
		await db.insert(schema.orgMembers).values({
			ownerEmail: PAYER,
			memberEmail: PAYER,
			role: "user",
			invitedBy: MANAGER,
		});

		expect(await roleOf(PAYER, PAYER)).toBe("org-owner");
		expect(canManage(await roleOf(PAYER, PAYER))).toBe(true);
	});

	test("cannot be removed by revoking one either", async () => {
		await db
			.update(schema.orgMembers)
			.set({ revokedAt: new Date() })
			.where(
				and(
					eq(schema.orgMembers.ownerEmail, PAYER),
					eq(schema.orgMembers.memberEmail, PAYER),
				),
			);

		expect(await roleOf(PAYER, PAYER)).toBe("org-owner");
		expect(await visibleEmails(PAYER)).toContain(PAYER);

		await db
			.delete(schema.orgMembers)
			.where(
				and(
					eq(schema.orgMembers.ownerEmail, PAYER),
					eq(schema.orgMembers.memberEmail, PAYER),
				),
			);
	});
});

describe("what a session can see", () => {
	test("one account's session sees none of another's campaigns", async () => {
		const rows = await db
			.select({ slotId: schema.sponsorPurchases.slotId })
			.from(schema.sponsorPurchases)
			.where(
				inArray(schema.sponsorPurchases.email, await visibleEmails(READER)),
			);
		expect(rows.map((r) => r.slotId)).toEqual(["acme-hero"]);
	});

	/**
	 * A adds B, B adds C, C sees nothing of A's. A transitive closure would let
	 * any org-owner widen somebody else's audience without them ever seeing it.
	 */
	test("membership is one hop, so an invitee's invitee sees nothing", async () => {
		const guest = "guest@manager.dev";
		await db.insert(schema.orgMembers).values({
			ownerEmail: MANAGER,
			memberEmail: guest,
			invitedBy: MANAGER,
		});

		const seen = await visibleEmails(guest);
		expect(seen.sort()).toEqual([MANAGER, guest].sort());
		expect(seen).not.toContain(PAYER);
		expect(await roleOf(guest, PAYER)).toBeNull();

		const rows = await db
			.select()
			.from(schema.sponsorPurchases)
			.where(inArray(schema.sponsorPurchases.email, seen));
		expect(rows).toHaveLength(0);
	});
});

describe("the platform admin", () => {
	test("is whoever SITE_ADMIN names, and nobody else", () => {
		expect(isPlatformAdmin(SITE_ADMIN)).toBe(true);
		expect(isPlatformAdmin(PAYER)).toBe(false);
		expect(isPlatformAdmin(null)).toBe(false);
		expect(isPlatformAdmin("")).toBe(false);
	});

	/** Platform-wide, so it is not scoped to an org and outranks the question. */
	test("is `admin` on an account they have no membership in", async () => {
		expect(await roleOf(SITE_ADMIN, PAYER)).toBe("admin");
		expect(canManage(await roleOf(SITE_ADMIN, PAYER))).toBe(true);
	});

	test("fails closed when SITE_ADMIN names nobody", async () => {
		fake.siteAdmins = [];
		try {
			expect(isPlatformAdmin(SITE_ADMIN)).toBe(false);
			expect(await roleOf(SITE_ADMIN, PAYER)).toBeNull();
		} finally {
			fake.siteAdmins = [SITE_ADMIN];
		}
	});
});

/**
 * The list is parsed at import time in `src/env` — the one module that reads
 * `process.env` — so it is read back out of a fresh process rather than by
 * re-implementing the split here, which would only test the copy.
 */
async function siteAdminsFrom(value?: string): Promise<string[]> {
	const path = join(import.meta.dir, "../src/env");
	const { SITE_ADMIN: _drop, ...rest } = process.env;
	const proc = Bun.spawn(
		[
			"bun",
			"-e",
			`const { env } = await import(${JSON.stringify(path)});` +
				`console.log(JSON.stringify(env.siteAdmins));`,
		],
		{
			// A directory with no `.env`, so the developer's own file cannot decide
			// what "unset" means.
			cwd: dir,
			env: value === undefined ? rest : { ...rest, SITE_ADMIN: value },
			stdout: "pipe",
			stderr: "inherit",
		},
	);
	const out = await new Response(proc.stdout).text();
	expect(await proc.exited).toBe(0);
	return JSON.parse(out) as string[];
}

describe("SITE_ADMIN, as it is parsed", () => {
	test("unset is nobody", async () => {
		expect(await siteAdminsFrom()).toEqual([]);
	});

	test("a list survives whitespace and capitals, because sessions do not", async () => {
		const list = await siteAdminsFrom(" Ops@Site.dev , Second@SITE.dev ");
		expect(list).toEqual(["ops@site.dev", "second@site.dev"]);

		// The parse and the check, joined: a session carries the canonical form.
		fake.siteAdmins = list;
		try {
			expect(isPlatformAdmin("second@site.dev")).toBe(true);
			expect(isPlatformAdmin("third@site.dev")).toBe(false);
		} finally {
			fake.siteAdmins = [SITE_ADMIN];
		}
	});

	test("one address needs no comma", async () => {
		expect(await siteAdminsFrom("Solo@Site.dev")).toEqual(["solo@site.dev"]);
	});
});
