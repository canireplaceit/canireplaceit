// Identifies a voter without login: weak signals are collected server-side, each vote is scored, and only votes above
// a trust threshold count publicly, so a fraud campaign can be neutralised after the fact by re-scoring.
// Identity lives in an httpOnly, signed cookie the client cannot read or forge — never localStorage, which it could edit.

import { env } from "./env";

// The published-default fence lives in env.ts, which throws on import before anything is listening.
const SECRET = env.voteSecret;

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

const sign = (payload: string): string =>
	b64url(
		new Bun.CryptoHasher("sha256")
			.update(`${SECRET}:${payload}`)
			.digest() as unknown as Uint8Array,
	).slice(0, 27);

/** `<random>.<issuedDay>.<sig>` — no PII, nothing the client can tamper with. */
export function issueVoterId(now = new Date()): string {
	const random = b64url(crypto.getRandomValues(new Uint8Array(16)));
	const day = Math.floor(now.getTime() / 86_400_000);
	const payload = `${random}.${day}`;
	return `${payload}.${sign(payload)}`;
}

export type VoterId = { id: string; issuedDay: number };

export function verifyVoterId(cookie: string | undefined): VoterId | null {
	if (!cookie) return null;
	const parts = cookie.split(".");
	if (parts.length !== 3) return null;
	const [random, day, sig] = parts;
	if (sign(`${random}.${day}`) !== sig) return null;
	const issuedDay = Number(day);
	if (!Number.isFinite(issuedDay)) return null;
	return { id: random, issuedDay };
}

// Groups an address to the block a single person plausibly controls: IPv4 -> /24 (a shared household/office range),
// IPv6 -> /64 (routinely handed to one subscriber, who can rotate within it for free).
export function networkKey(ip: string): string {
	if (ip.includes(":")) {
		const groups = ip.split(":");
		return `${groups.slice(0, 4).join(":")}::/64`;
	}
	const octets = ip.split(".");
	return octets.length === 4 ? `${octets.slice(0, 3).join(".")}.0/24` : ip;
}

/** Stable, non-reversible handle for a network block. */
export const hashNetwork = (ip: string): string =>
	new Bun.CryptoHasher("sha256")
		.update(`${SECRET}:net:${networkKey(ip)}`)
		.digest("hex")
		.slice(0, 32);

// A coarse client fingerprint from headers the browser sends anyway — deliberately weak (no canvas/font/JS fingerprinting,
// which are consent-requiring under GDPR). Only strong enough to notice many "different" voters sharing one header signature.
export const hashClient = (
	headers: Record<string, string | undefined>,
): string =>
	new Bun.CryptoHasher("sha256")
		.update(
			[
				SECRET,
				headers["user-agent"] ?? "",
				headers["accept-language"] ?? "",
				headers["accept-encoding"] ?? "",
				// TLS/JA4 hash, when present: the strongest signal here, since it survives a UA change.
				headers["cf-ja4"] ?? headers["x-tls-fingerprint"] ?? "",
			].join("|"),
		)
		.digest("hex")
		.slice(0, 32);

/** Votes at or above this count toward the public number. */
export const TRUST_THRESHOLD = 0.5;

/** How many votes one network block may cast in a day before we stop believing it. */
export const NETWORK_DAILY_LIMIT = 8;

export type VoteSignals = {
	/** Turnstile verdict: true passed, false failed, null not configured. */
	humanVerified: boolean | null;
	/** Votes already cast from this network block today. */
	networkVotesToday: number;
	/** Votes already cast from this client fingerprint today. */
	clientVotesToday: number;
	/** Request came from a hosting/VPN network rather than a consumer one. */
	datacenter: boolean;
	/** The voter cookie was issued in this same request. */
	freshCookie: boolean;
};

export type Scored = { trust: number; reasons: string[] };

// Scores a vote from 0 (discard) to 1 (believe it). The only hard block is a failed human check — everything else
// dampens, so a real person on a VPN or in a busy office can still vote at reduced, auditable weight.
export function scoreVote(s: VoteSignals): Scored {
	const reasons: string[] = [];
	let trust = 1;

	if (s.humanVerified === false) {
		return { trust: 0, reasons: ["failed-human-check"] };
	}
	if (s.humanVerified === null) {
		// No Turnstile configured — we simply know less.
		trust -= 0.2;
		reasons.push("no-human-check");
	}

	if (s.datacenter) {
		trust -= 0.4;
		reasons.push("datacenter-network");
	}

	// Clearing cookies is free, so the network is what actually bounds volume.
	if (s.networkVotesToday >= NETWORK_DAILY_LIMIT) {
		trust -= 0.6;
		reasons.push("network-over-daily-limit");
	} else if (s.networkVotesToday >= NETWORK_DAILY_LIMIT / 2) {
		trust -= 0.2;
		reasons.push("network-busy");
	}

	// Same headers, many identities: the signature of a script looping.
	if (s.clientVotesToday >= NETWORK_DAILY_LIMIT) {
		trust -= 0.5;
		reasons.push("client-signature-repeated");
	}

	// A cookie minted in the same request as the vote means no page was read
	// first. Real people land, read, then click.
	if (s.freshCookie) {
		trust -= 0.3;
		reasons.push("no-prior-session");
	}

	return { trust: Math.max(0, Math.round(trust * 100) / 100), reasons };
}

/** Cloudflare hands us this; other proxies vary. Absence is not suspicion. */
export function isDatacenter(
	headers: Record<string, string | undefined>,
): boolean {
	const type = headers["cf-ipcountry-type"] ?? headers["x-network-type"];
	return type === "hosting" || type === "datacenter";
}

// Impressions/clicks use the same weak-signal identity as votes, but the verdict direction flips: a vote errs toward
// counting a doubtful one, while an impression is what an advertiser pays against, so anything unvouched is excluded.

// Catches bots that identify themselves (Googlebot, monitors, headless CI) — the cheapest filter, not the load-bearing
// one; the network/datacenter signals below are what actually holds against a bot that lies about its user agent.
const CRAWLER_UA =
	/bot\b|crawler|spider|crawl|slurp|headless|phantomjs|puppeteer|playwright|selenium|lighthouse|pagespeed|curl\/|wget\/|python-requests|node-fetch|axios\/|go-http-client|java\/|okhttp|scrapy|feedfetcher|preview|monitor|uptime|pingdom|semrush|ahrefs|mj12|dotbot|bytespider|gptbot|claudebot|ccbot|perplexity/i;

export const isCrawler = (
	headers: Record<string, string | undefined>,
): boolean => {
	const ua = headers["user-agent"];
	// No user agent at all is not a browser — every real one sends it.
	if (!ua) return true;
	return CRAWLER_UA.test(ua);
};

// Detects a speculative prerender/prefetch (Chrome `Sec-Purpose`, Firefox `X-Moz`, older Chrome `Purpose`) — not an
// impression, since it may never be navigated to.
export const isPrerender = (
	headers: Record<string, string | undefined>,
): boolean => {
	const purpose = `${headers["sec-purpose"] ?? ""} ${headers.purpose ?? ""} ${headers["x-moz"] ?? ""}`;
	return /prefetch|prerender/i.test(purpose);
};

/** Ad events at or above this are printable on a page that sells advertising. */
export const AD_TRUST_THRESHOLD = 0.5;

// 400/hour allows a whole office behind one NAT while still catching a script — a real reader sees at most a dozen distinct slots an hour.
export const NETWORK_HOURLY_EVENT_LIMIT = 400;

export type AdSignals = {
	/** Self-identified crawler, or no user agent at all. */
	crawler: boolean;
	/** Speculative prerender/prefetch, not a page anybody has looked at. */
	prerender: boolean;
	/** Hosting/VPN range rather than a consumer one. */
	datacenter: boolean;
	/** No signed voter cookie: nothing tying this to a session that read a page. */
	noSession: boolean;
	/** Ad events already accepted from this network block this hour. */
	networkEventsThisHour: number;
	/** Ad events already accepted from this client signature this hour. */
	clientEventsThisHour: number;
};

// Scores an impression or click from 0 to 1; only >= AD_TRUST_THRESHOLD is shown to a buyer. Crawler/prerender/datacenter
// are hard zeros — "reduced weight" would still be a lie for those. Everything else dampens rather than blocks.
export function scoreAdEvent(s: AdSignals): Scored {
	if (s.crawler) return { trust: 0, reasons: ["crawler"] };
	if (s.prerender) return { trust: 0, reasons: ["prerender"] };
	if (s.datacenter) return { trust: 0, reasons: ["datacenter-network"] };

	const reasons: string[] = [];
	let trust = 1;

	if (s.networkEventsThisHour >= NETWORK_HOURLY_EVENT_LIMIT) {
		trust -= 0.6;
		reasons.push("network-over-hourly-limit");
	} else if (s.networkEventsThisHour >= NETWORK_HOURLY_EVENT_LIMIT / 2) {
		trust -= 0.2;
		reasons.push("network-busy");
	}

	if (s.clientEventsThisHour >= NETWORK_HOURLY_EVENT_LIMIT) {
		trust -= 0.5;
		reasons.push("client-signature-repeated");
	}

	// Absent session cookie means the client never ran /api/session or refuses cookies — worth a penalty, not a discard.
	if (s.noSession) {
		trust -= 0.3;
		reasons.push("no-session");
	}

	return { trust: Math.max(0, Math.round(trust * 100) / 100), reasons };
}

const TURNSTILE_SECRET = env.turnstileSecret;

// True/false when Turnstile is configured, null when it is not — null is deliberately distinct from false, so a
// missing env var costs a small trust penalty rather than silently zeroing every vote.
export async function verifyTurnstile(
	token: string | undefined,
	ip: string,
): Promise<boolean | null> {
	if (!TURNSTILE_SECRET) return null;
	if (!token) return false;
	try {
		const res = await fetch(
			"https://challenges.cloudflare.com/turnstile/v0/siteverify",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					secret: TURNSTILE_SECRET,
					response: token,
					remoteip: ip,
				}),
				signal: AbortSignal.timeout(5_000),
			},
		);
		const data = (await res.json()) as { success?: boolean };
		return data.success === true;
	} catch {
		// Cloudflare being unreachable must not block real people from voting.
		return null;
	}
}
