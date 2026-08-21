/**
 * The public API's contract, exercised through the real routes.
 *
 * Four properties are worth defending here, because breaking any of them is
 * silent and only shows up as an agent quoting us without a link:
 *
 *   - every row carries `url` and `api`, since the link is the only thing this
 *     site gets back for answering the question
 *   - filters actually filter, and a dead project never appears unasked
 *   - `limit` is capped, so one caller cannot ask for the corpus in a loop
 *   - an unknown slug is a 404 with a way forward, never a 500
 *
 * `./counts` is mocked so this needs no database. Everything else is the real
 * catalogue read from `data/`, which is the point: a content change that breaks
 * a shape should fail here.
 *
 *   bun test apps/backend/tests/api-v1.test.ts
 */

import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { Elysia } from "elysia";

mock.module("../src/counts", () => ({
	counted: () => undefined,
	voteCounts: async () => new Map<string, number>(),
	projectCounts: async () => new Map<string, number>(),
}));

let api: Elysia;

beforeAll(async () => {
	api = (await import("../src/api-v1")).publicApi;
});

const get = async (path: string) => {
	const res = await api.handle(
		new Request(`http://localhost/api/v1${path}`, {
			// A distinct address per call, or the rate limiter counts the whole
			// suite as one caller and the later tests get 429s.
			headers: {
				"x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`,
			},
		}),
	);
	return { res, body: (await res.json()) as Record<string, never> };
};

describe("links", () => {
	test("every search result carries a page url and its own api url", async () => {
		const { body } = await get("/search?q=notion&limit=20");
		const results = body.results as unknown as {
			url: string;
			api: string;
			type: string;
		}[];
		expect(results.length).toBeGreaterThan(0);
		for (const row of results) {
			expect(row.url).toContain("/en/");
			expect(row.api).toContain("/api/v1/");
		}
	});

	test("a product's alternatives link to their own project pages", async () => {
		const { body } = await get("/products/notion");
		const alts = body.alternatives as unknown as {
			kind: string;
			url?: string;
			homepage?: string;
		}[];
		expect(alts.length).toBeGreaterThan(0);
		for (const alt of alts) {
			// A cheaper alternative is somebody else's paid product, so it has a
			// vendor homepage and no page here. Everything else must be linkable.
			if (alt.kind === "cheaper") expect(alt.homepage).toBeTruthy();
			else expect(alt.url).toContain("/en/tools/");
		}
	});
});

describe("project links", () => {
	test("point at the slug the site actually publishes", async () => {
		// The site's project pages live at /en/tools/appflowy. A Project object
		// carries github-appflowy-io-appflowy, and emitting that as `url` would
		// have 404'd every project link in the API. Recomputed here the way
		// scripts/prerender.ts computes it, so the two cannot drift apart.
		const { collectProjects } = await import("core/src/content");
		const { buildProjectSlugs } = await import("core/src/routes");
		const { content } = await import("../src/content");

		const expected = buildProjectSlugs(
			collectProjects(content.products),
			content.products.map((p) => p.slug),
		);

		const { body } = await get("/projects?limit=50");
		const rows = body.results as unknown as { slug: string; url: string }[];
		const published = new Set(expected.values());
		for (const row of rows) {
			expect(published.has(row.slug)).toBe(true);
			expect(row.url).toContain(`/en/tools/${row.slug}`);
			// The forge id must never reach a URL.
			expect(row.slug.startsWith("github-")).toBe(false);
		}
	});

	test("the forge id still resolves, since older links carry it", async () => {
		const pretty = await get("/projects/appflowy");
		const forge = await get("/projects/github-appflowy-io-appflowy");
		expect(pretty.res.status).toBe(200);
		expect(forge.res.status).toBe(200);
		expect(forge.body.slug).toBe("appflowy");
	});
});

describe("filters", () => {
	test("self_hostable=true drops projects that cannot be self-hosted", async () => {
		const { body } = await get(
			"/search?type=project&self_hostable=true&limit=50",
		);
		const rows = body.results as unknown as { self_hostable: boolean }[];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.self_hostable === true)).toBe(true);
	});

	test("dead projects are excluded unless asked for", async () => {
		const living = await get("/search?type=project&limit=50");
		const rows = living.body.results as unknown as { archived: boolean }[];
		expect(rows.every((r) => r.archived === false)).toBe(true);

		const dead = await get("/search?type=project&archived=true&limit=50");
		const deadRows = dead.body.results as unknown as { archived: boolean }[];
		expect(deadRows.length).toBeGreaterThan(0);
		expect(deadRows.every((r) => r.archived === true)).toBe(true);
	});

	test("verdict=not-yet returns the same products as /gaps", async () => {
		const search = await get("/search?type=product&verdict=not-yet&limit=1");
		const gaps = await get("/gaps?limit=1");
		expect(search.body.total).toBe(gaps.body.total);
		expect(Number(gaps.body.total)).toBeGreaterThan(0);
	});

	test("the graveyard holds only archived projects", async () => {
		const { body } = await get("/collections/archived?limit=50");
		const rows = body.results as unknown as { archived: boolean }[];
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.archived === true)).toBe(true);
	});
});

describe("features", () => {
	test("resolve for a project that is not on GitHub", async () => {
		// features.json keys projects by `healthKey`, which prefixes every forge
		// except GitHub with its hostname. Looking up by the bare `source.path`
		// silently returned null for 76 projects and would have collided the two
		// repos called blender/blender rather than merely missing them.
		const { body } = await get("/projects?limit=50");
		const rows = body.results as unknown as { forge: string; api: string }[];
		const offGitHub = rows.find((r) => r.forge !== "github");
		if (!offGitHub) return; // no non-GitHub project in the first page today

		const slug = offGitHub.api.split("/").pop() as string;
		const detail = await get(`/projects/${slug}`);
		expect(detail.res.status).toBe(200);
		// The point is that the lookup runs at all, not that this repo is covered:
		// the feature file is sparse and an absent project is a real answer.
		expect(detail.body).toHaveProperty("features");
	});

	test("a GitHub project with known answers gets them", async () => {
		const { body } = await get("/projects/appflowy");
		const features = body.features as unknown as Record<string, string> | null;
		expect(features).not.toBeNull();
		expect(Object.keys(features ?? {}).length).toBeGreaterThan(0);
	});
});

describe("limits", () => {
	test("limit is capped no matter what the caller asks for", async () => {
		const { body } = await get("/search?limit=5000");
		expect(Number(body.limit)).toBe(50);
		expect((body.results as unknown as unknown[]).length).toBeLessThanOrEqual(
			50,
		);
	});

	test("rate limit headers tell a caller how much room is left", async () => {
		const { res } = await get("/stats");
		expect(res.headers.get("RateLimit-Limit")).toBe("60");
		expect(res.headers.get("cache-control")).toContain("max-age");
	});

	test("cross-origin reads are allowed without credentials", async () => {
		const { res } = await get("/stats");
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		// `*` with credentials is invalid and a browser rejects the pair.
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});
});

describe("missing things", () => {
	test("an unknown slug is a 404 that says where to look instead", async () => {
		for (const path of [
			"/products/not-a-product",
			"/projects/not-a-project",
			"/categories/not-a-category",
			"/collections/not-a-collection",
			"/groups/not-a-theme",
		]) {
			const { res, body } = await get(path);
			expect(res.status).toBe(404);
			expect(body.error).toBeTruthy();
		}
	});
});

describe("discovery", () => {
	test("the index lists every route it claims to have", async () => {
		const { body } = await get("/");
		const routes = Object.values(
			body.routes as unknown as Record<string, string>,
		);
		expect(routes.length).toBeGreaterThan(5);
		for (const route of routes) {
			// The feed is deliberately a site URL: readers subscribe to
			// /feed.xml, and nginx sends it here. Everything else is an API route.
			if (route.endsWith("/feed.xml")) continue;
			expect(route).toContain("/api/v1");
		}
	});

	test("openapi documents every route the index advertises", async () => {
		const index = await get("/");
		const spec = await get("/openapi.json");
		const documented = Object.keys(
			spec.body.paths as unknown as Record<string, unknown>,
		);
		const advertised = Object.values(
			index.body.routes as unknown as Record<string, string>,
		)
			// Two routes are advertised under a different name than they are
			// documented: the graveyard is one value of the parameterised
			// /collections/{slug}, and the feed is advertised at its site URL.
			.map((url) => url.replace(/^https?:\/\/[^/]+/, ""))
			.map((path) => path.replace(/^\/api\/v1/, "") || "/")
			.map((path) =>
				path === "/collections/archived" ? "/collections" : path,
			);
		for (const path of advertised) expect(documented).toContain(path);
	});
});
