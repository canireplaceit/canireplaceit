// Tags outbound sponsor clicks with UTM params so a buyer can find us in their own analytics.
// Never overwrites a value the sponsor's URL already set, and never fails the click if the URL can't be parsed.

// Named for what a buyer will group by in their own reports, not our internal placement ids.
const MEDIUM: Record<string, string> = {
	rail: "sidebar",
	hero: "homepage",
	category: "category-page",
};

export type ClickContext = {
	/** Slot id — `L2`, `hero-4`, `category-analytics-1`. */
	slotId: string;
	placement: string;
	page: string;
	/** The product/category slug the reader was on, or "". */
	pageSlug: string;
	orderId: string | null;
	source: string;
};

/** `url` with UTM parameters filled in where the sponsor left them empty. Returns the original string unchanged if it cannot be parsed. */
export function taggedUrl(url: string, ctx: ClickContext): string {
	let u: URL;
	try {
		u = new URL(url);
	} catch {
		return url;
	}

	// A mailto:/tel: URL has no query string worth writing to.
	if (u.protocol !== "https:" && u.protocol !== "http:") return url;

	const put = (key: string, value: string) => {
		if (value && !u.searchParams.has(key)) u.searchParams.set(key, value);
	};

	put("utm_source", ctx.source);
	put("utm_medium", MEDIUM[ctx.placement] ?? "sponsor");
	put("utm_campaign", ctx.slotId);
	put("utm_content", ctx.pageSlug ? `${ctx.page}:${ctx.pageSlug}` : ctx.page);
	if (ctx.orderId) put("utm_term", ctx.orderId);

	return u.toString();
}
