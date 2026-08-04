// Sign-in by emailed link. No passwords, no OAuth, no users table.
// Two secrets: the link token is 32 random bytes, stored and looked up (never signed/parsed) so single-use is a
// database fact; the session is a JWT signed with AUTH_SECRET via `jose` (HS256, exp enforced on verify).
// Token lookup is by sha256 hash through a unique index, not a JS string compare, to avoid a timing signal.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, isNull, lt, sql as raw } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { db, schema } from "./db";
import { normalizeEmail } from "./db/schema";
import { authEnabled, env } from "./env";

/** The cookie the browser carries once signed in. */
export const SESSION_COOKIE = "cri_s";

const key = () => new TextEncoder().encode(env.authSecret ?? "");

// Bearer tokens are stored as this hash, never in the clear.
const hash = (v: string) => createHash("sha256").update(v).digest("hex");

// 256 bits, not a UUID (only 122 bits of entropy) — this is the only thing standing between a stranger and somebody else's account.
const mintToken = () => randomBytes(32).toString("base64url");

// Per-email throttle (not per-IP: this stops mailbombing one address, which an attacker could do from anywhere).
export async function withinRateLimit(email: string): Promise<boolean> {
	const hour = Math.floor(Date.now() / 3_600_000);
	const k = `magic:${hash(email)}:${hour}`;
	const [row] = await db
		.select({ n: schema.rateLimits.count })
		.from(schema.rateLimits)
		.where(eq(schema.rateLimits.key, k));
	if ((row?.n ?? 0) >= env.magicLinksPerHour) return false;

	await db
		.insert(schema.rateLimits)
		.values({ key: k, count: 1, windowStart: new Date() })
		.onConflictDoUpdate({
			target: schema.rateLimits.key,
			set: { count: raw`${schema.rateLimits.count} + 1` },
		});
	return true;
}

// Mints a link for `email` and returns the URL to mail. Expired rows for the address are cleared on the way through,
// keeping the table bounded without a cron.
export async function createMagicLink(
	email: string,
	/** Same-origin path to land on. Validated on the way out of the callback. */
	redirect = "",
): Promise<string> {
	await db
		.delete(schema.magicLinks)
		.where(
			and(
				eq(schema.magicLinks.email, email),
				lt(schema.magicLinks.expiresAt, new Date()),
			),
		);

	const token = mintToken();
	await db.insert(schema.magicLinks).values({
		email,
		tokenHash: hash(token),
		expiresAt: new Date(Date.now() + env.magicLinkTtlMs),
		// Same-origin path only — an open redirect here is a phishing endpoint wearing our domain.
		redirect: /^\/[a-z]{2}\/[\w/-]*$/.test(redirect) ? redirect : "",
	});

	return `${env.apiOrigin}/api/auth/callback?token=${encodeURIComponent(token)}`;
}

// Spends a token, returning the email it proved, or null. The update is conditional on the row still being unused
// and unexpired, with the email returned atomically — so two simultaneous uses of one link cannot both succeed.
export async function consumeMagicLink(token: string): Promise<string | null> {
	const now = new Date();
	const [row] = await db
		.update(schema.magicLinks)
		.set({ usedAt: now })
		.where(
			and(
				eq(schema.magicLinks.tokenHash, hash(token)),
				isNull(schema.magicLinks.usedAt),
				gte(schema.magicLinks.expiresAt, now),
			),
		)
		.returning({ email: schema.magicLinks.email });

	return row?.email ?? null;
}

/** Where a spent token wanted to land, or "". Same validation as on the way in. */
export async function redirectFor(token: string): Promise<string> {
	const [row] = await db
		.select({ redirect: schema.magicLinks.redirect })
		.from(schema.magicLinks)
		.where(eq(schema.magicLinks.tokenHash, hash(token)));
	const r = row?.redirect ?? "";
	return /^\/[a-z]{2}\/[\w/-]*$/.test(r) ? r : "";
}

// The creative token: `POST /api/sponsor/details` takes it, saves the ad, and signs in the paying address — a sign-in
// link by another name, so it's kept hashed with an expiry like one. 14 days (not the link's minutes) since it's
// minted when the money clears and the buyer may be away from their desk; the Stripe return page can mint a fresh one.
export const DETAILS_TOKEN_TTL_MS = 14 * 86_400_000;

/** The raw token to hand the buyer, and the columns that remember it. */
export function mintDetailsToken(): {
	token: string;
	columns: { detailsTokenHash: string; detailsTokenExpiresAt: Date };
} {
	const token = mintToken();
	return {
		token,
		columns: {
			detailsTokenHash: hash(token),
			detailsTokenExpiresAt: new Date(Date.now() + DETAILS_TOKEN_TTL_MS),
		},
	};
}

// The paid row a creative token unlocks. "expired" is reported apart from "unknown" — same info to an attacker, but a
// buyer needs to know whether to ask for a new link or check what they pasted.
export async function detailsTokenHolder(
	token: string,
): Promise<
	| { ok: true; holder: typeof schema.sponsorPurchases.$inferSelect }
	| { ok: false; reason: "unknown" | "expired" }
> {
	const [holder] = await db
		.select()
		.from(schema.sponsorPurchases)
		.where(
			and(
				eq(schema.sponsorPurchases.detailsTokenHash, hash(token)),
				eq(schema.sponsorPurchases.status, "paid"),
			),
		);
	if (!holder) return { ok: false, reason: "unknown" };
	const until = holder.detailsTokenExpiresAt?.getTime() ?? 0;
	return until > Date.now()
		? { ok: true, holder }
		: { ok: false, reason: "expired" };
}

// A signed session for `email`, valid for SESSION_TTL_MS. Stateless (no sessions table, no revocation before expiry) —
// the mitigation is the short TTL plus re-deriving access from the database on every request. The token proves
// identity only, never permissions. Email is canonicalised here since it's compared against email columns on every read.
export async function issueSession(email: string): Promise<string> {
	return new SignJWT({ email: normalizeEmail(email) })
		.setProtectedHeader({ alg: "HS256" })
		.setIssuedAt()
		.setExpirationTime(new Date(Date.now() + env.sessionTtlMs))
		.sign(key());
}

// The session this cookie proves, or null. `jose` checks signature, expiry, and the declared `alg` — the classic
// failure this avoids is a naive verifier accepting `alg: none`.
export async function readSessionFull(
	cookie: string | undefined,
): Promise<{ email: string; issuedAt: number } | null> {
	if (!authEnabled || !cookie) return null;
	try {
		const { payload } = await jwtVerify(cookie, key(), {
			algorithms: ["HS256"],
		});
		if (typeof payload.email !== "string") return null;
		return { email: payload.email, issuedAt: (payload.iat ?? 0) * 1000 };
	} catch {
		// Expired, tampered with, or signed under a rotated secret — all mean "not signed in".
		return null;
	}
}

export async function readSession(
	cookie: string | undefined,
): Promise<string | null> {
	return (await readSessionFull(cookie))?.email ?? null;
}

// Reissue past half the session's life: an active session rolls forward indefinitely, an idle one dies one TTL after the last request.
export const shouldRenew = (issuedAt: number): boolean =>
	Date.now() - issuedAt > env.sessionTtlMs / 2;

/** Elysia's cookie accessor, narrowed to what `sessionOf` touches. */
export type CookieJar = {
	value?: unknown;
	set: (o: Record<string, unknown>) => void;
	remove?: () => void;
};

// The one way an endpoint learns who is calling — every protected route goes through this rather than reading the
// cookie itself. Renews in place past half its life. Returns null for "not signed in"; the caller answers 401.
export async function sessionOf(
	cookie: Record<string, CookieJar>,
): Promise<string | null> {
	const raw = cookie[SESSION_COOKIE]?.value;
	const found = await readSessionFull(
		typeof raw === "string" ? raw : undefined,
	);
	if (!found) return null;
	if (shouldRenew(found.issuedAt)) {
		cookie[SESSION_COOKIE]?.set({
			value: await issueSession(found.email),
			httpOnly: true,
			sameSite: "lax",
			secure: env.isProduction,
			maxAge: Math.round(env.sessionTtlMs / 1000),
			path: "/",
		});
	}
	return found.email;
}

// Every email whose ads this session may see: their own, plus every org they have an unrevoked membership in.
// One hop, never transitive — if A adds B and B adds C, C must not see A's ads.
export async function visibleEmails(session: string): Promise<string[]> {
	const rows = await db
		.select({ ownerEmail: schema.orgMembers.ownerEmail })
		.from(schema.orgMembers)
		.where(
			and(
				eq(schema.orgMembers.memberEmail, session),
				isNull(schema.orgMembers.revokedAt),
			),
		);
	return [...new Set([session, ...rows.map((r) => r.ownerEmail)])];
}

// org-owner: the payer, plus anyone they promote, manages that org.
// org-user: invited and not promoted, reads that org, changes nothing.
// admin: the platform operator — a property of the person, not their relationship to any org.
export type Role = "org-owner" | "org-user" | "admin";

// `env.siteAdmins` is empty unless SITE_ADMIN names somebody, so unset means nobody rather than everybody (fail-closed).
export function isPlatformAdmin(session: string | null | undefined): boolean {
	return Boolean(session) && env.siteAdmins.includes(session as string);
}

// `session`'s role in `owner`'s org, or null for no relationship (never "org-user"). A platform admin is `admin`
// everywhere. Re-derived from the database on every call — the session token never carries permissions.
export async function roleOf(
	session: string,
	owner: string,
): Promise<Role | null> {
	if (isPlatformAdmin(session)) return "admin";
	// The payer has no membership row, so nobody they invited can demote or remove them.
	if (session === owner) return "org-owner";
	const [row] = await db
		.select({ role: schema.orgMembers.role })
		.from(schema.orgMembers)
		.where(
			and(
				eq(schema.orgMembers.ownerEmail, owner),
				eq(schema.orgMembers.memberEmail, session),
				isNull(schema.orgMembers.revokedAt),
			),
		);
	if (!row) return null;
	return row.role === "owner" ? "org-owner" : "org-user";
}

/** Whether a role may add or remove members. */
export const canManage = (role: Role | null): boolean =>
	role === "org-owner" || role === "admin";
