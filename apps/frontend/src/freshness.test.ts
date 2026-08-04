/**
 * The date helpers, which are the only place the site turns stored facts into
 * sentences about time. Both bugs below were caught in a browser, not by a
 * typecheck, which is why they are pinned here.
 *
 *   bun test apps/frontend
 */

import { expect, test } from "bun:test";
import { formatDate, relativeDate } from "./api";

const at = (iso: string, hour = 0) =>
	Date.parse(`${iso}T${String(hour).padStart(2, "0")}:00:00Z`);

test("a date read today reads as today, at any hour of that day", () => {
	// Elapsed-hours arithmetic said "yesterday" from mid-afternoon onwards, so
	// every date on the site aged a day early for most of every day.
	for (const hour of [0, 9, 14, 18, 23]) {
		expect(relativeDate("2026-08-02", "en", at("2026-08-02", hour))).toBe(
			"today",
		);
	}
});

test("calendar days apart, not elapsed hours", () => {
	expect(relativeDate("2026-07-31", "en", at("2026-08-02", 18))).toBe(
		"2 days ago",
	);
	expect(relativeDate("2026-08-01", "en", at("2026-08-02", 18))).toBe(
		"yesterday",
	);
});

test("older readings coarsen to months and years rather than counting days", () => {
	expect(relativeDate("2026-05-02", "en", at("2026-08-02"))).toBe(
		"3 months ago",
	);
	expect(relativeDate("2023-08-02", "en", at("2026-08-02"))).toBe(
		"3 years ago",
	);
});

test("French is formatted by Intl, not by hand", () => {
	expect(formatDate("2026-08-02", "fr")).toBe("2 août 2026");
	expect(relativeDate("2026-08-02", "fr", at("2026-08-02", 18))).toBe(
		"aujourd’hui",
	);
});

test("a malformed date is echoed, never rendered as Invalid Date", () => {
	expect(formatDate("not-a-date", "en")).toBe("not-a-date");
	expect(relativeDate("not-a-date", "en", Date.now())).toBeNull();
});
