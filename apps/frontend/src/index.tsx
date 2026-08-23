import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

/**
 * The prerendered payload, which travels as JSON rather than as a script that
 * assigns it.
 *
 * `scripts/prerender.ts` writes it as `<script type="application/json">`: inert
 * text the JS parser never touches, where a bare `<script>` would have handed
 * the whole blob — 80% of the home document — to the JavaScript parser as an
 * object literal. `JSON.parse` reads it roughly twice as fast at that size.
 *
 * It goes back on `window.__DATA__` because that is where `boot()` in App.tsx
 * and `healthOf`/`featuresOf` in api.ts read it, and because it must be in place
 * before the first render rather than after one.
 */
const payload = document.getElementById("boot-data")?.textContent;
if (payload) {
	(globalThis as { __DATA__?: unknown }).__DATA__ = JSON.parse(payload);
}

const el = document.getElementById("root");
if (!el) throw new Error("no #root");

// Every URL is prerendered to a real document (scripts/prerender.ts). `createRoot`
// throws that document away before a crawler's renderer ever sees it, which is
// how 1,449 indexable pages became one — so hydrate onto it instead. The dev
// server serves the empty shell, and hydrating nothing is a mismatch by
// definition, so that one case still mounts fresh.
if (el.hasChildNodes()) {
	hydrateRoot(el, <App />);
} else {
	// The 404 document ships a static bilingual <main> above the empty #root, so
	// a dead link is not a blank page without JavaScript. React is about to
	// render its own, and two <main> elements is a worse defect than the one this
	// fixes, so the fallback goes first.
	document.getElementById("nojs-404")?.remove();
	createRoot(el).render(<App />);
}
