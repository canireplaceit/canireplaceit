import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

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
	createRoot(el).render(<App />);
}
