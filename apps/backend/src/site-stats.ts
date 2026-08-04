// Public traffic figures, read back from our self-hosted Umami. Self-hosted Umami has no API keys, so this holds a
// view-only login and exchanges it for a bearer token, re-logging in once on a 401 rather than guessing a TTL.
// Every failure path here must return the last good value or null — `/stats` must degrade to stale data, never an error.

import { env } from "./env";
import { log } from "./log";

export type SitePoint = { day: string; pageviews: number; sessions: number };
export type SiteRow = { name: string; count: number };

export type SiteStats = {
	pageviews: number;
	visitors: number;
	visits: number;
	bounces: number;
	/** Seconds. Umami reports totals, so the average is derived here, once. */
	avgSeconds: number | null;
	bestDay: number;
	windowDays: number;
	/** First day Umami holds data for, ISO. Null when the instance has none. */
	since: string | null;
	series: SitePoint[];
	pages: SiteRow[];
	referrers: SiteRow[];
	/** Which Umami this came from, so a wrong instance is visible, not silent. */
	source: string;
	fetchedAt: string;
};

const cfg = env.umami;

/** Cached bearer token. Null means "log in on the next call". */
let token: string | null = null;

async function login(): Promise<string> {
	if (!cfg) throw new Error("umami not configured");
	const res = await fetch(`${cfg.url}/api/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ username: cfg.username, password: cfg.password }),
		signal: AbortSignal.timeout(cfg.timeoutMs),
	});
	if (!res.ok) throw new Error(`umami login failed: ${res.status}`);
	const body = (await res.json()) as { token?: string };
	if (!body.token) throw new Error("umami login returned no token");
	return body.token;
}

// One authenticated GET with a single re-login on 401. A second 401 after a fresh token is a real auth failure and must surface, not loop.
async function get<T>(path: string, retry = true): Promise<T> {
	if (!cfg) throw new Error("umami not configured");
	token ??= await login();
	const res = await fetch(`${cfg.url}${path}`, {
		headers: { Authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(cfg.timeoutMs),
	});
	if (res.status === 401 && retry) {
		token = null;
		return get<T>(path, false);
	}
	if (!res.ok) throw new Error(`umami ${res.status} on ${path}`);
	return (await res.json()) as T;
}

// Umami's `/stats` returns both plain numbers and `{value, prev}` objects across minor versions; normalised here so a version bump breaks here, not as `[object Object]` on the page.
const scalar = (v: unknown): number => {
	if (typeof v === "number") return v;
	if (v && typeof v === "object" && "value" in v) {
		const inner = (v as { value: unknown }).value;
		return typeof inner === "number" ? inner : 0;
	}
	return 0;
};

/** `/metrics` returns `[{x, y}]`; `x` is null for "unknown". */
const rows = (raw: unknown): SiteRow[] =>
	Array.isArray(raw)
		? raw
				.map((r) => ({
					name: String((r as { x: unknown }).x ?? "(direct)"),
					count: scalar((r as { y: unknown }).y),
				}))
				.filter((r) => r.count > 0)
		: [];

let cache: { at: number; data: SiteStats | null } = { at: 0, data: null };

export async function siteStats(): Promise<SiteStats | null> {
	if (!cfg) return null;
	if (Date.now() - cache.at < cfg.ttlMs) return cache.data;

	const endAt = Date.now();
	// Umami takes epoch milliseconds, not seconds or ISO.
	const startAt = endAt - cfg.windowDays * 86_400_000;
	const range = `startAt=${startAt}&endAt=${endAt}`;
	const site = `/api/websites/${cfg.websiteId}`;

	try {
		const [totals, series, pages, referrers, daterange] = await Promise.all([
			get<Record<string, unknown>>(`${site}/stats?${range}`),
			get<{
				pageviews?: { x: string; y: number }[];
				sessions?: { x: string; y: number }[];
			}>(`${site}/pageviews?${range}&unit=day&timezone=UTC`),
			get<unknown>(`${site}/metrics?${range}&type=path&limit=8`), // `path`, not `url` — `url` is not a valid metric type
			get<unknown>(`${site}/metrics?${range}&type=referrer&limit=8`),
			// Optional: an instance without this endpoint must not fail the rest of the request.
			get<{ startDate?: string }>(`${site}/daterange`).catch(
				(): { startDate?: string } => ({}),
			),
		]);

		const byDay = new Map<string, SitePoint>();
		for (const p of series.pageviews ?? []) {
			byDay.set(p.x, { day: p.x, pageviews: scalar(p.y), sessions: 0 });
		}
		for (const s of series.sessions ?? []) {
			const row = byDay.get(s.x) ?? { day: s.x, pageviews: 0, sessions: 0 };
			row.sessions = scalar(s.y);
			byDay.set(s.x, row);
		}
		const points = [...byDay.values()].sort((a, b) =>
			a.day.localeCompare(b.day),
		);

		const visits = scalar(totals.visits);
		const totalTime = scalar(totals.totaltime);

		cache = {
			at: Date.now(),
			data: {
				pageviews: scalar(totals.pageviews),
				visitors: scalar(totals.visitors),
				visits,
				bounces: scalar(totals.bounces),
				avgSeconds: visits > 0 ? Math.round(totalTime / visits) : null,
				bestDay: points.reduce((m, p) => Math.max(m, p.pageviews), 0),
				windowDays: cfg.windowDays,
				since: daterange.startDate ?? null,
				series: points,
				pages: rows(pages),
				referrers: rows(referrers),
				source: cfg.url,
				fetchedAt: new Date().toISOString(),
			},
		};
	} catch (e) {
		log.error({ err: e }, "site stats");
		cache.at = Date.now();
	}
	return cache.data;
}

/** Diagnostics for `/api/site/stats/diag`, distinguishing the causes an empty stats page can have. Admin-only: it names the instance and website id. */
export async function siteStatsDiagnostics(): Promise<Record<string, unknown>> {
	if (!cfg) {
		return {
			configured: false,
			hint: "Set UMAMI_URL, UMAMI_WEBSITE_ID, UMAMI_USERNAME, UMAMI_PASSWORD.",
		};
	}
	const out: Record<string, unknown> = {
		configured: true,
		url: cfg.url,
		websiteId: cfg.websiteId,
		username: cfg.username,
		windowDays: cfg.windowDays,
		ttlMs: cfg.ttlMs,
	};
	try {
		token = await login();
		out.login = "ok";
	} catch (e) {
		out.login = `failed: ${(e as Error).message}`;
		return out;
	}
	// `/api/websites` lists only owned websites — a team-shared site is readable but absent here, so an empty list proves nothing. Informational only.
	try {
		const owned = await get<{ data?: { id: string }[] }>("/api/websites");
		out.ownedWebsites = (owned.data ?? []).map((w) => w.id);
	} catch (e) {
		out.ownedWebsites = `failed: ${(e as Error).message}`;
	}

	// The authoritative check: can this account actually read this website's figures.
	try {
		const s = await get<Record<string, unknown>>(
			`/api/websites/${cfg.websiteId}/stats?startAt=${Date.now() - cfg.windowDays * 86_400_000}&endAt=${Date.now()}`,
		);
		const pageviews = scalar(s.pageviews);
		out.canRead = true;
		out.statsProbe = { pageviews, visitors: scalar(s.visitors) };
		out.hint =
			pageviews > 0
				? "Reading fine."
				: "Access is fine — this website just has no pageviews in the window yet. Load a page carrying the tracker, then re-check.";
	} catch (e) {
		const msg = (e as Error).message;
		out.canRead = false;
		out.statsProbe = `failed: ${msg}`;
		out.hint = msg.includes("401")
			? "Authenticated, but not authorised for this website. In Umami a site owned by a personal account cannot be shared with a user directly: create a Team, have the user join it with the team access code, then Websites → Edit → Transfer website to that team."
			: "Check UMAMI_URL and UMAMI_WEBSITE_ID.";
	}
	return out;
}
