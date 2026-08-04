/**
 * Counting ad impressions honestly, in a layout that makes it hard.
 *
 * ## Why a render count would be a lie
 *
 * The side rails are `position: fixed` and never unmount for the whole visit.
 * The narrow-screen marquee renders every slot **twice** — a duplicated track so
 * the loop has no seam — and animates forever. So "the component rendered" and
 * "somebody saw the ad" are unrelated: a ten-minute read would report hundreds
 * of thousands of impressions for ten slots. These numbers are eventually shown
 * to advertisers as a reason to pay, which makes a flattering count worse than
 * no count at all.
 *
 * ## What an impression is here
 *
 * Four conditions, all of them:
 *
 *   1. **Visible.** `IntersectionObserver` at `VISIBLE_RATIO` of the element's
 *      area. Not "in the DOM", not "in the viewport rect" — actually intersecting.
 *   2. **For long enough.** It has to hold that for `DWELL_MS` without dropping
 *      out. A marquee chip sliding past the edge of the screen in 300ms is not an
 *      impression; the timer is cancelled when it leaves.
 *   3. **On a tab somebody is looking at.** `document.visibilityState` must be
 *      `visible`, and dwell timers are cancelled when the tab is hidden — a
 *      background tab satisfies the intersection observer perfectly.
 *   4. **Not already counted.** Deduped per slot per page per
 *      `DEDUPE_WINDOW_MS`. A rail slot pinned on screen for a ten-minute read is
 *      one impression, not six hundred.
 *
 * The dedupe key is the **slot id**, which is what makes the duplicated marquee
 * track harmless: its two copies carry React keys `a-<id>` and `b-<id>` but the
 * same `data-ad-slot`, so both map to one entry. Nothing here reads the React
 * key, and nothing needs to know the marquee exists.
 *
 * `prefers-reduced-motion` needs no special case, and that is the point of
 * observing intersection rather than the animation: when the marquee does not
 * scroll, the chips that happen to be on screen intersect and count once, and the
 * ones clipped by `overflow: hidden` never intersect and never count. A reader
 * who cannot see an ad has not seen it, whatever the CSS is doing.
 *
 * ## Never in the way
 *
 * Nothing here runs during render. Slots are found by attribute
 * (`data-ad-slot`), through a `MutationObserver`, so the components carry one
 * data attribute each and no hooks, no refs and no callbacks — see the note in
 * SponsorRails.tsx. Beacons are batched and flushed on `visibilitychange` and
 * `pagehide` via `navigator.sendBeacon`, which is queued by the browser and does
 * not block unload; the periodic flush is a safety net for a very long session.
 */

import { parseRoute } from "core/src/routes";

/** Fraction of the element that must be intersecting to start the clock. */
const VISIBLE_RATIO = 0.5;

/**
 * How long it has to stay there. A second is the IAB's threshold for a display
 * impression, and it is also roughly the point where a marquee chip has stopped
 * being motion in the corner of somebody's eye.
 */
const DWELL_MS = 1000;

/**
 * One impression per slot per page per half hour. Long enough that a long read
 * cannot inflate a rail, short enough that somebody who comes back after lunch
 * is genuinely a second impression.
 */
const DEDUPE_WINDOW_MS = 30 * 60_000;

/** Safety flush, for a session that never hides the tab and never navigates. */
const FLUSH_INTERVAL_MS = 60_000;

/** Matches the server's cap; a batch is dropped past it rather than truncated. */
const MAX_BATCH = 200;

const BASE = import.meta.env.PUBLIC_API_URL ?? "";

type Pending = { slotId: string; purchaseId?: string };

/** Where we are, in the shape the API's `page`/`pageSlug` breakdown expects. */
function pageContext(): { page: string; pageSlug: string } {
	try {
		const route = parseRoute(new URL(location.href));
		return {
			page: route.name === "unknown" ? "other" : route.name,
			pageSlug: "slug" in route ? route.slug : "",
		};
	} catch {
		return { page: "other", pageSlug: "" };
	}
}

let started = false;

export function startAdTracking(): () => void {
	// Guarded rather than assumed: prerendering imports these modules under Bun,
	// and a dev-server fast refresh can run an effect twice.
	if (started || typeof IntersectionObserver === "undefined") return () => {};
	started = true;

	/** slotId|page|pageSlug → when it last counted. */
	const lastCounted = new Map<string, number>();
	/** Elements currently past the threshold, with their pending dwell timer. */
	const dwelling = new Map<Element, ReturnType<typeof setTimeout>>();
	/** page|pageSlug → the slots seen there, not yet sent. */
	const queued = new Map<string, Map<string, Pending>>();

	const cancel = (el: Element) => {
		const timer = dwelling.get(el);
		if (timer !== undefined) clearTimeout(timer);
		dwelling.delete(el);
	};

	const countIt = (el: Element) => {
		dwelling.delete(el);
		const slotId = el.getAttribute("data-ad-slot");
		if (!slotId) return;

		const { page, pageSlug } = pageContext();
		const key = `${slotId}|${page}|${pageSlug}`;
		const now = Date.now();
		const seen = lastCounted.get(key);
		if (seen !== undefined && now - seen < DEDUPE_WINDOW_MS) return;
		lastCounted.set(key, now);

		const bucket = `${page}|${pageSlug}`;
		const batch = queued.get(bucket) ?? new Map<string, Pending>();
		queued.set(bucket, batch);
		batch.set(slotId, {
			slotId,
			// Absent on an open slot advertising itself. Those impressions are still
			// recorded: they are how the value of unsold inventory is argued.
			purchaseId: el.getAttribute("data-ad-purchase") ?? undefined,
		});
	};

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				const visible =
					entry.isIntersecting &&
					entry.intersectionRatio >= VISIBLE_RATIO &&
					document.visibilityState === "visible";
				if (!visible) {
					cancel(entry.target);
					continue;
				}
				if (dwelling.has(entry.target)) continue;
				dwelling.set(
					entry.target,
					setTimeout(() => countIt(entry.target), DWELL_MS),
				);
			}
		},
		{ threshold: [0, VISIBLE_RATIO, 1] },
	);

	const tracked = new WeakSet<Element>();
	const scan = (root: ParentNode) => {
		for (const el of root.querySelectorAll("[data-ad-slot]")) {
			if (tracked.has(el)) continue;
			tracked.add(el);
			observer.observe(el);
		}
	};
	scan(document);

	const mutations = new MutationObserver((records) => {
		for (const record of records) {
			for (const node of record.addedNodes) {
				if (!(node instanceof Element)) continue;
				if (node.hasAttribute("data-ad-slot")) {
					if (!tracked.has(node)) {
						tracked.add(node);
						observer.observe(node);
					}
				}
				scan(node);
			}
			for (const node of record.removedNodes) {
				if (node instanceof Element) cancel(node);
			}
		}
	});
	mutations.observe(document.body, { childList: true, subtree: true });

	const flush = () => {
		if (queued.size === 0) return;
		const batches = [...queued.entries()];
		queued.clear();

		for (const [bucket, slots] of batches) {
			const [page, pageSlug = ""] = bucket.split("|");
			const events = [...slots.values()].slice(0, MAX_BATCH);
			const body = JSON.stringify({ page, pageSlug, events });
			const url = `${BASE}/api/ads/impressions`;

			// sendBeacon is the only thing the browser guarantees to deliver from a
			// page that is going away, and it never delays unload. It cannot carry
			// cookies cross-origin without them being SameSite=None, so the fetch
			// below is what normally runs; the beacon is the unload fallback.
			const sent =
				document.visibilityState === "hidden" &&
				typeof navigator.sendBeacon === "function" &&
				navigator.sendBeacon(
					url,
					new Blob([body], { type: "application/json" }),
				);

			if (!sent) {
				void fetch(url, {
					method: "POST",
					body,
					headers: { "content-type": "application/json" },
					credentials: "include",
					keepalive: true,
				}).catch(() => {});
			}
		}
	};

	const onVisibility = () => {
		if (document.visibilityState === "hidden") {
			// A hidden tab is not being read, so nothing may keep accruing dwell.
			for (const el of dwelling.keys()) cancel(el);
			flush();
		}
	};

	document.addEventListener("visibilitychange", onVisibility);
	addEventListener("pagehide", flush);
	const interval = setInterval(flush, FLUSH_INTERVAL_MS);

	return () => {
		clearInterval(interval);
		document.removeEventListener("visibilitychange", onVisibility);
		removeEventListener("pagehide", flush);
		mutations.disconnect();
		observer.disconnect();
		for (const el of dwelling.keys()) cancel(el);
		flush();
		started = false;
	};
}
