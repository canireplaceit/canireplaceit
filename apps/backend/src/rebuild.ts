/**
 * Regenerate the static site.
 *
 * Deliberately NOT event-driven. Pages are rebuilt nightly, which bakes a real
 * number into the HTML so a crawler and a first paint both see one; the SPA then
 * fetches live counts on hydration and corrects them in place. Rebuilding on
 * every vote would buy freshness the client fetch already provides, at the cost
 * of a debounce, a coalescing queue and a process spawn on a write path.
 *
 * What remains is the smallest thing that works: one build at a time, on a
 * timer, plus a manual trigger for content deploys.
 */

import { spawn } from "node:child_process";
import { join } from "node:path";
import { env as settings } from "./env";

const ROOT = join(import.meta.dir, "../../..");

export type RebuildState = {
	building: boolean;
	lastBuiltAt: number | null;
	lastDurationMs: number | null;
	lastError: string | null;
	builds: number;
};

const state: RebuildState = {
	building: false,
	lastBuiltAt: null,
	lastDurationMs: null,
	lastError: null,
	builds: 0,
};

export const rebuildState = (): RebuildState => ({ ...state });

function runPrerender(): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn("bun", ["scripts/prerender.ts"], {
			cwd: ROOT,
			// The one process.env read outside env.ts: the child parses its own
			// configuration, and inheriting ours is what points it at this database.
			env: process.env,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let stderr = "";
		child.stderr?.on("data", (d) => {
			stderr += String(d);
		});
		child.on("error", reject);
		child.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(stderr.trim().slice(0, 500) || `exit ${code}`)),
		);
	});
}

/**
 * Rebuild now, unless one is already running.
 *
 * Single-flight is the only concurrency rule needed: two prerenders writing the
 * same files at once would interleave half-written HTML.
 */
export async function rebuild(): Promise<{ started: boolean }> {
	if (state.building) return { started: false };

	state.building = true;
	const started = Date.now();
	try {
		await runPrerender();
		state.lastError = null;
		state.builds++;
	} catch (e) {
		state.lastError = (e as Error).message;
	} finally {
		state.building = false;
		state.lastBuiltAt = Date.now();
		state.lastDurationMs = state.lastBuiltAt - started;
	}
	return { started: true };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startRebuildWorker(): void {
	if (!settings.rebuild.enabled || timer) return;
	timer = setInterval(() => void rebuild(), settings.rebuild.intervalMs);
	timer.unref?.();
}

/** Test seam. */
export const _reset = (over: Partial<RebuildState> = {}) => {
	Object.assign(state, {
		building: false,
		lastBuiltAt: null,
		lastDurationMs: null,
		lastError: null,
		builds: 0,
		...over,
	});
};
