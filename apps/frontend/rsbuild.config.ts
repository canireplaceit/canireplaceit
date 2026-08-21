import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

export default defineConfig({
	plugins: [pluginReact()],
	server: {
		port: 3000,
		/**
		 * Same-origin `/api` in development, exactly as in production.
		 *
		 * The dev server used to be cross-origin: the frontend on :3000 called the
		 * API on :3010 through `PUBLIC_API_URL`. That works, but it makes dev a
		 * DIFFERENT shape from every deployed environment — `local.nginx.conf` and
		 * `nginx.template.conf` both proxy `/api/` to the backend — and the
		 * differences are exactly where bugs hide:
		 *
		 *   - a root-relative asset the API serves (`/api/sponsor-logos/…`)
		 *     resolved against :3000 and 404'd, so every uploaded sponsor icon fell
		 *     back to a lettermark in dev and worked in prod
		 *   - the emailed sign-in link needed its own `API_ORIGIN` variable, because
		 *     `WEB_ORIGIN/api/...` was not the API here and is everywhere else
		 *   - cookies and CORS behave differently across ports
		 *
		 * Proxying makes dev match, so none of those can diverge again.
		 */
		proxy: {
			"/api": {
				target: "http://localhost:3010",
				changeOrigin: false,
			},
		},
	},
	// No `meta` here. scripts/prerender.ts owns every tag in <head>: it replaces
	// the <title> element with the whole block, so anything else injected at this
	// level survives alongside it — which is how every page shipped two meta
	// descriptions, the real one and this generic one.
	html: {
		title:
			"Can I replace it? — open source alternatives to the SaaS you pay for",
		/**
		 * The analytics tag, injected into the SHELL rather than by prerender.ts.
		 *
		 * It was in prerender's `head()` first, which meant it existed only in a
		 * production build — `bun run dev` never prerenders, so the tracker was
		 * absent for the whole of local development and Umami reported zero for a
		 * site being actively clicked through. Injecting it here puts it in the one
		 * document both paths start from.
		 *
		 * Safe against duplication: prerender's `withHead` inserts its block after
		 * `<meta charset>` and strips only the `<title>`, so a tag already in the
		 * shell survives and is not re-added.
		 *
		 * Unset website id emits nothing. A tracker pointed at nothing is a 404 on
		 * every one of the 3,052 pages.
		 */
		tags: process.env.PUBLIC_UMAMI_WEBSITE_ID
			? [
					{
						tag: "script",
						attrs: {
							defer: true,
							src: process.env.PUBLIC_UMAMI_SRC ?? "/u/script.js",
							"data-website-id": process.env.PUBLIC_UMAMI_WEBSITE_ID,
						},
						append: false,
					},
				]
			: [],
	},
});
