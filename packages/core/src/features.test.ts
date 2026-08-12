/**
 * The semantics that are easy to get wrong and expensive when wrong: `unknown`
 * behaving as `no`, `paid` quietly counting as `yes`, and a comparison table
 * padded with rows that say nothing.
 *
 *   bun test packages/core
 */

import { expect, test } from "bun:test";
import {
	compare,
	decidedCount,
	domainsFor,
	type FeatureFile,
	featureValue,
	matching,
	sameGenre,
	satisfies,
} from "./features";

const file: FeatureFile = {
	taxonomyVersion: 2,
	domains: [
		{
			key: "auth",
			kind: "crosscutting",
			name: { en: "Authentication" },
			features: [
				{ key: "auth.sso.oidc", name: { en: "OIDC" } },
				{ key: "auth.sso.saml", name: { en: "SAML" } },
				{ key: "auth.local", name: { en: "Password login" } },
			],
		},
		{
			key: "notes",
			kind: "vertical",
			name: { en: "Notes" },
			appliesTo: ["notes-docs"],
			features: [
				{ key: "notes.editor.markdown", name: { en: "Markdown" } },
				{ key: "notes.publish.site", name: { en: "Public site" } },
			],
		},
	],
	projects: {
		outline: {
			"auth.sso.oidc": "yes",
			"auth.sso.saml": "paid",
			"auth.local": "no",
			"notes.editor.markdown": "yes",
			"notes.publish.site": "yes",
		},
		joplin: {
			"auth.local": "yes",
			"notes.editor.markdown": "yes",
		},
	},
	products: {
		notion: {
			"auth.sso.saml": "paid",
			"auth.local": "yes",
			"notes.editor.markdown": "yes",
		},
	},
};

test("an absent key is unknown, and an absent project is too", () => {
	expect(featureValue(file, "outline", "auth.sso.oidc")).toBe("yes");
	// Present project, key never decided.
	expect(featureValue(file, "joplin", "auth.sso.saml")).toBe("unknown");
	// Project we have never looked at at all.
	expect(featureValue(file, "nothing-here", "auth.sso.oidc")).toBe("unknown");
	// The distinction that matters: `no` is a finding, `unknown` is a gap.
	expect(featureValue(file, "outline", "auth.local")).toBe("no");
});

test("products are readable and comparable, but are not projects", () => {
	// The two key spaces are disjoint, so one lookup serves both.
	expect(featureValue(file, "notion", "auth.sso.saml")).toBe("paid");
	expect(decidedCount(file, "notion")).toBe(3);

	// ...but a product must never appear in the open-source list a reader filters.
	expect(matching(file, [{ key: "auth.local" }])).toEqual(["joplin"]);

	// The whole point: the vendor charges for what the alternative ships free.
	const rows = compare(file, ["notion", "outline", "joplin"], {
		bothCheckedOnly: true,
	});
	expect(rows.find((r) => r.key === "auth.local")?.values).toEqual([
		"yes",
		"no",
		"yes",
	]);
	/**
	 * SAML survives even though the two CHECKED sides agree, because the third is
	 * unknown and `differingOnly` compares all columns. With three or more columns
	 * "differing" cannot mean anything tighter than that without deciding which
	 * pair the reader cares about — which is the caller's business, not core's.
	 */
	expect(rows.find((r) => r.key === "auth.sso.saml")?.values).toEqual([
		"paid",
		"paid",
		"unknown",
	]);
});

test("paid does not satisfy a requirement unless the reader opted in", () => {
	// Someone filtering for SSO means "without paying" unless they say otherwise;
	// counting the paid tier silently is the dishonesty `paid` exists to expose.
	expect(satisfies("paid", { key: "auth.sso.saml" })).toBe(false);
	expect(satisfies("paid", { key: "auth.sso.saml", acceptPaid: true })).toBe(
		true,
	);
	expect(satisfies("yes", { key: "auth.sso.oidc" })).toBe(true);
	// Neither an unchecked nor a negative answer is a match.
	expect(satisfies("unknown", { key: "auth.sso.oidc" })).toBe(false);
	expect(satisfies("no", { key: "auth.sso.oidc" })).toBe(false);
	expect(satisfies("partial", { key: "auth.sso.oidc" })).toBe(false);
});

test("filtering requires every requirement, and respects the paid rule", () => {
	expect(matching(file, [{ key: "notes.editor.markdown" }]).sort()).toEqual([
		"joplin",
		"outline",
	]);
	// SAML is paid for Outline, so a plain SAML filter returns nobody.
	expect(matching(file, [{ key: "auth.sso.saml" }])).toEqual([]);
	expect(matching(file, [{ key: "auth.sso.saml", acceptPaid: true }])).toEqual([
		"outline",
	]);
	// Requirements are AND, not OR.
	expect(
		matching(file, [
			{ key: "notes.editor.markdown" },
			{ key: "auth.sso.oidc" },
		]),
	).toEqual(["outline"]);
});

test("compare drops rows that say nothing", () => {
	const rows = compare(file, ["outline", "joplin"]);
	const keys = rows.map((r) => r.key);

	// Both are `yes` — agreement is padding, not a comparison.
	expect(keys).not.toContain("notes.editor.markdown");
	// Neither has been checked — a blank row reads as a verdict, so it is dropped.
	expect(keys).not.toContain("auth.sso.oidc-missing");
	// Genuinely differing rows survive, including yes-vs-unknown.
	expect(keys).toContain("auth.local");
	expect(keys).toContain("notes.publish.site");

	const local = rows.find((r) => r.key === "auth.local");
	expect(local?.values).toEqual(["no", "yes"]);
});

test("a row where every side is unknown is dropped even with differingOnly off", () => {
	const rows = compare(file, ["joplin", "nobody"], { differingOnly: false });
	expect(rows.map((r) => r.key)).not.toContain("auth.sso.saml");
	// But a decided-vs-unknown row is a real difference and stays.
	expect(rows.map((r) => r.key)).toContain("auth.local");
});

test("vertical domains only apply inside their categories", () => {
	// A note-taker sees both.
	expect(domainsFor(file, ["notes-docs"]).map((d) => d.key)).toEqual([
		"auth",
		"notes",
	]);
	// A VPN sees only the crosscutting one — `notes.*` on a VPN is noise, and
	// rendering it as a gap would be a lie of omission.
	expect(domainsFor(file, ["networking-vpn"]).map((d) => d.key)).toEqual([
		"auth",
	]);
	expect(
		compare(file, ["outline", "joplin"], {
			categories: ["networking-vpn"],
		}).every((r) => r.domain === "auth"),
	).toBe(true);
});

test("decidedCount counts answers, not keys in the vocabulary", () => {
	expect(decidedCount(file, "outline")).toBe(5);
	expect(decidedCount(file, "joplin")).toBe(2);
	expect(decidedCount(file, "never-seen")).toBe(0);
});

test("sameGenre excludes the target and anything sharing no category", () => {
	const all = [
		{ key: "outline", categories: ["notes-docs"] },
		{ key: "joplin", categories: ["notes-docs", "productivity"] },
		{ key: "headscale", categories: ["networking-vpn"] },
	];
	expect(sameGenre(all[0], all).map((p) => p.key)).toEqual(["joplin"]);
	expect(sameGenre(all[2], all)).toEqual([]);
});

test("bothCheckedOnly separates real disagreement from our own gaps", () => {
	// Default: decided-vs-unknown counts as differing, because it is a real
	// difference in what we can tell the reader.
	const all = compare(file, ["outline", "joplin"]);
	expect(all.map((r) => r.key)).toContain("notes.publish.site");

	// With the filter on, only rows where two sides were actually checked
	// survive — that is the set a reader can use to choose between them.
	const both = compare(file, ["outline", "joplin"], { bothCheckedOnly: true });
	expect(both.map((r) => r.key)).not.toContain("notes.publish.site");
	expect(both.map((r) => r.key)).toContain("auth.local");
	expect(both.length).toBeLessThan(all.length);
});
