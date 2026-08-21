// Every env var, read once, in one place, so `banner()` can print exactly which features are live on boot.
// Rule throughout: an unset variable means the feature is OFF, never a guessed default — only dimensional values
// (timeouts, caps, TTLs) get defaults.

import { normalizeEmail } from "./db/schema";
import { log } from "./log";

const str = (k: string): string | undefined => process.env[k] || undefined;

const bool = (k: string): boolean => process.env[k] === "true";

// Makes `PAYMENTS_PROVIDER=fake`, `SEED_DEV` and `MAIL_DEV_SINK` inert when true.
const nodeEnv = str("NODE_ENV") ?? "development";
const isProduction = nodeEnv === "production";

const num = (k: string, fallback: number): number => {
	const raw = process.env[k];
	if (!raw) return fallback;
	const n = Number(raw);
	// A typo'd duration (e.g. `SLOT_HOLD_MS=3min`) parses to NaN, which would expire every hold immediately.
	if (!Number.isFinite(n) || n <= 0) {
		log.error(
			`env: ${k}="${raw}" is not a positive number — using ${fallback}`,
		);
		return fallback;
	}
	return n;
};

/** All present → the config; any missing → undefined, i.e. the feature is off. */
const group = <T extends Record<string, string | undefined>>(
	fields: T,
): { [K in keyof T]: string } | undefined =>
	Object.values(fields).every(Boolean)
		? (fields as { [K in keyof T]: string })
		: undefined;

// Only the host is required: mailpit needs no credentials, Gmail needs all three, so the host decides whether mail is on.
const smtpHost = str("SMTP_HOST");
const port = num("SMTP_PORT", 465);

// Opt-in AND ignored when NODE_ENV=production, so real SMTP_* credentials can stay set while a developer routes to mailpit locally.
const devSink = bool("MAIL_DEV_SINK") && !isProduction;

// All four required together — a URL with no credentials can't read anything, so half-configured must mean off, not a stream of 401s.
const umami = group({
	url: str("UMAMI_URL")?.replace(/\/+$/, ""),
	websiteId: str("UMAMI_WEBSITE_ID"),
	username: str("UMAMI_USERNAME"),
	password: str("UMAMI_PASSWORD"),
});

// Comma-separated: CORS may accept more than one host, but every link we mint has to pick exactly one (webOrigins[0]).
const webOriginRaw = str("WEB_ORIGIN");
const webOrigins = (webOriginRaw ?? "http://localhost:3000")
	.split(",")
	.map((o) => o.trim())
	.filter(Boolean);

// Canonicalised with normalizeEmail like every session, so `Ada@` in the variable still matches. Empty means nobody, never everybody.
const siteAdmins = (str("SITE_ADMIN") ?? "")
	.split(",")
	.map(normalizeEmail)
	.filter(Boolean);

/** The published default, and the one value production must never run with. */
const DEV_VOTE_SECRET = "dev-secret-change-me";
const voteSecret = str("VOTE_SECRET") ?? DEV_VOTE_SECRET;

export const env = {
	isProduction,

	port: num("PORT", 3010),

	/** Undefined means the repo-root default; db/index.ts resolves the path. */
	databaseUrl: str("DATABASE_URL"),

	/** Undefined means the repo-root `data/`. */
	contentDir: str("CONTENT_DIR"),

	webOrigins,
	webOrigin: webOrigins[0],

	// Where the API is reachable from a browser. In production this is WEB_ORIGIN (nginx proxies /api). In development
	// they're two different ports, so this needs its own variable — otherwise a magic link silently signs nobody in.
	apiOrigin:
		str("API_ORIGIN") ??
		(webOriginRaw ? webOrigins[0] : "http://localhost:3010"),

	smtp: devSink
		? {
				host: "localhost",
				port: 1026,
				user: undefined,
				pass: undefined,
				secure: false,
				poolMax: 2,
				from: str("MAIL_FROM") ?? "canireplaceit@localhost.dev",
			}
		: smtpHost
			? {
					host: smtpHost,
					port,
					user: str("SMTP_USER"),
					pass: str("SMTP_PASS"),
					// 465 is implicit TLS, 587 is STARTTLS — derived from the port rather than configured separately.
					secure: str("SMTP_SECURE")
						? str("SMTP_SECURE") === "true"
						: port === 465,
					poolMax: num("SMTP_POOL_MAX", 2),
					// Gmail rewrites a From it doesn't own, so the authenticated user is the only default that can't surprise anyone.
					from:
						str("MAIL_FROM") ??
						str("SMTP_USER") ??
						"canireplaceit@localhost.dev",
				}
			: undefined,

	// Signs the session cookie; undefined disables sign-in entirely. Deliberately not VOTE_SECRET — auth wants its own rotation schedule.
	authSecret: str("AUTH_SECRET"),

	// Signs the voter cookie and the network hashes. Falls back to a published default; production refuses to boot on it (see guard below).
	voteSecret,

	// Undefined leaves every admin route answering 503 (fail-closed: no token, no admin).
	adminToken: str("ADMIN_TOKEN"),

	// Independent of ADMIN_TOKEN: the token is for machines, this is for people signed in as themselves.
	siteAdmins,

	// Undefined means a vote is scored "not checked" (a small trust penalty) rather than "failed".
	turnstileSecret: str("TURNSTILE_SECRET"),

	payments: {
		provider: str("PAYMENTS_PROVIDER") ?? "",
		stripe: {
			secretKey: str("STRIPE_SECRET_KEY"),
			webhookSecret: str("STRIPE_WEBHOOK_SECRET"),
			currency: str("STRIPE_CURRENCY") ?? "usd",
			// Stripe's code for "Website Advertising"; overridable per an accountant's jurisdiction call.
			taxCode: str("STRIPE_TAX_CODE") ?? "txcd_10701000",
		},
	},

	rebuild: {
		enabled: bool("REBUILD_ENABLED"),
		intervalMs: num("REBUILD_INTERVAL_MS", 24 * 60 * 60_000),
	},

	// Undefined disables the public stats page's data source; `/api/site/stats` answers `{ unavailable: true }`.
	umami: umami && {
		...umami,
		ttlMs: num("UMAMI_STATS_TTL_MS", 300_000),
		windowDays: num("UMAMI_STATS_WINDOW_DAYS", 30),
		timeoutMs: num("UMAMI_TIMEOUT_MS", 8_000),
	},

	// Opt-in AND dev-only: seeded rows include live sponsors that were never paid for.
	seedDev: bool("SEED_DEV") && !isProduction,

	magicLinkTtlMs: num("MAGIC_LINK_TTL_MS", 15 * 60_000),
	// Renewed on activity — see `shouldRenew`. Short because the token is stateless and cannot be revoked.
	sessionTtlMs: num("SESSION_TTL_MS", 60 * 60_000),
	magicLinksPerHour: num("MAGIC_LINKS_PER_HOUR", 3),
	orgMaxMembers: num("ORG_MAX_MEMBERS", 10),
} as const;

/** True when sign-in can actually work end to end. */
export const authEnabled = Boolean(env.authSecret);

// Throws at import time (before the server accepts requests), not inside `banner()` — only for values whose absence is silently wrong.
if (isProduction) {
	const wrong = [
		voteSecret === DEV_VOTE_SECRET &&
			"VOTE_SECRET is unset or still the public default — it signs the voter cookie, so anyone who has read this repo can mint identities and forge the counts the site sells itself on",
		!webOriginRaw &&
			"WEB_ORIGIN is unset — every magic link and Stripe return URL would point at http://localhost:3000",
		// `.env.example` ships a localhost origin, so a copied example passes an is-it-set check but is still wrong.
		/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(webOriginRaw ?? "") &&
			`WEB_ORIGIN is ${webOriginRaw} — that is the copied example, and every magic link and Stripe return URL would point at the container itself`,
	].filter(Boolean);

	if (wrong.length) {
		throw new Error(
			`refusing to start:\n  ${wrong.join("\n  ")}\nGenerate secrets with \`bun run env:gen\`; see .env.example.`,
		);
	}
}

const on = (v: unknown, why: string) => (v ? "ON" : `OFF (${why})`);

// Mirrors `select()` in payments.ts rather than calling it (that module imports this one). Fences are enforced there.
function checkout(): string {
	const { provider, stripe } = env.payments;
	if (provider === "fake") {
		return isProduction
			? "OFF (PAYMENTS_PROVIDER=fake is ignored in production)"
			: "FAKE — NO MONEY MOVED";
	}
	if (provider === "stripe") {
		if (!stripe.secretKey) return "OFF (STRIPE_SECRET_KEY unset)";
		if (!stripe.webhookSecret) return "OFF (STRIPE_WEBHOOK_SECRET unset)";
		return `stripe ${stripe.currency.toUpperCase()}`;
	}
	return provider
		? `OFF (unknown provider "${provider}")`
		: "OFF (PAYMENTS_PROVIDER unset)";
}

/** One line on boot. A misconfigured deploy should not need a debugger to spot. */
export function banner(): void {
	log.info(
		`config · sign-in ${on(env.authSecret, "AUTH_SECRET unset")}` +
			` · mail ${on(env.smtp, "SMTP_* unset — links print to stdout")}` +
			(devSink ? " (DEV SINK → mailpit)" : "") +
			` · analytics ${on(env.umami, "UMAMI_* unset")}` +
			` · seed ${on(env.seedDev, "SEED_DEV not true")}` +
			` · magic link ttl ${Math.round(env.magicLinkTtlMs / 1000)}s`,
	);
	log.info(
		`config · ${isProduction ? "PRODUCTION" : nodeEnv}` +
			` · origin ${env.webOrigins.join(", ")}` +
			` · api ${env.apiOrigin}` +
			` · checkout ${checkout()}` +
			` · admin ${on(env.adminToken, "ADMIN_TOKEN unset — /api/admin/* answers 503")}` +
			` · site admins ${
				siteAdmins.length
					? siteAdmins.join(", ")
					: "OFF (SITE_ADMIN unset — no session is a platform admin)"
			}` +
			` · human check ${on(env.turnstileSecret, "TURNSTILE_SECRET unset — votes score as unchecked")}` +
			` · vote identity ${env.voteSecret === DEV_VOTE_SECRET ? "DEV DEFAULT (forgeable)" : "signed"}` +
			` · rebuild ${
				env.rebuild.enabled
					? `every ${Math.round(env.rebuild.intervalMs / 3_600_000)}h`
					: "OFF (REBUILD_ENABLED not true)"
			}`,
	);
	if (env.smtp) {
		log.info(
			`  mail → ${env.smtp.host}:${env.smtp.port}` +
				`${env.smtp.user ? ` as ${env.smtp.user}` : " (no auth)"} from ${env.smtp.from}`,
		);
	}
	if (env.umami) {
		log.info(
			`  analytics → ${env.umami.url} website ${env.umami.websiteId} as ${env.umami.username}`,
		);
	}
	if (isProduction) {
		if (!env.authSecret) {
			log.error(
				"AUTH_SECRET is unset — sign-in is disabled. Generate one with `bun run env:gen`.",
			);
		} else if (!env.smtp) {
			log.error(
				"SMTP_* unset in production — magic links are printed to stdout and nobody receives them.",
			);
		}
	}
}
