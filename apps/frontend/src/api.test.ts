/**
 * The API boundary. Every response is parsed here, so this is the file that
 * decides whether a bad payload becomes a rendered error or a `TypeError` from
 * inside a component that trusted a cast.
 *
 *   bun test apps/frontend
 */

import { afterAll, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, api } from "./api";

const realFetch = globalThis.fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

/** `typeof fetch` carries Bun's own extras, so the stub is not structurally one. */
const stubFetch = (res: () => Response) => {
	globalThis.fetch = (async () => res()) as unknown as typeof fetch;
};

const answers = (body: unknown, status = 200) =>
	stubFetch(
		() =>
			new Response(typeof body === "string" ? body : JSON.stringify(body), {
				status,
				headers: { "content-type": "application/json" },
			}),
	);

const SITE_STATS = {
	pageviews: 120,
	visitors: 40,
	visits: 55,
	bounces: 12,
	avgSeconds: 61,
	bestDay: 30,
	windowDays: 30,
	since: "2026-01-01",
	series: [{ day: "2026-08-01", pageviews: 30, sessions: 10 }],
	pages: [{ name: "/en", count: 30 }],
	referrers: [],
	source: "https://umami.example",
	fetchedAt: "2026-08-04T00:00:00.000Z",
};

test("a well-formed payload parses, and the empty referrer list Umami really returns survives it", async () => {
	answers(SITE_STATS);
	const stats = await api.siteStats();
	if ("unavailable" in stats) throw new Error("narrowed the wrong way");
	expect(stats.referrers).toEqual([]);
	expect(stats.series[0].pageviews).toBe(30);
});

test("a payload missing an array fails at the boundary, naming the endpoint", async () => {
	// The actual outage: /api/ answered by something that is not our API, and
	// `stats.referrers.map()` several layers into StatsPage.
	const { referrers, ...missing } = SITE_STATS;
	answers(missing);
	const err = await api.siteStats().catch((e) => e);
	expect(err).toBeInstanceOf(ApiError);
	expect(err.message).toContain("/api/site/stats");
	expect(err.message).toContain("referrers");
});

test("nothing half-parsed reaches the caller", async () => {
	answers({ ...SITE_STATS, series: null });
	expect(api.siteStats()).rejects.toBeInstanceOf(ApiError);
});

test("a 200 that is not JSON at all is an ApiError, not a SyntaxError", async () => {
	stubFetch(
		() =>
			new Response("<html>502 Bad Gateway</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
	);
	const err = await api.stats().catch((e) => e);
	expect(err).toBeInstanceOf(ApiError);
	expect(err.message).toBe("/api/stats: response was not JSON");
});

test("the unavailable shape still parses and narrows", async () => {
	answers({ unavailable: true });
	const stats = await api.siteStats();
	expect("unavailable" in stats).toBe(true);
});

test("the statuses the pages branch on survive validation", async () => {
	// AdminPage, Dashboard and SignInPage all read `.status` off this.
	for (const status of [401, 403, 503]) {
		answers({ error: "nope" }, status);
		const err = await api.siteAdmin.queue().catch((e) => e);
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(status);
	}
});

const DATA = join(import.meta.dir, "../../../data");
const read = (p: string) => JSON.parse(readFileSync(join(DATA, p), "utf8"));

test("the real catalogue parses — a schema stricter than the data is an outage", async () => {
	answers(read("categories.json"));
	expect((await api.categories()).length).toBeGreaterThan(0);

	const products = readdirSync(join(DATA, "products"))
		.filter((f) => f.endsWith(".json"))
		.map((f) => ({ ...read(join("products", f)), switchedCount: 0 }));
	answers(products);
	expect((await api.products()).length).toBe(products.length);
});
