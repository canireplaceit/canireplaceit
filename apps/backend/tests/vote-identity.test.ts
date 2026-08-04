/**
 * The vote scoring is the only thing standing between the public counter and a
 * script, so it gets real tests.
 *
 *   bun test apps/backend/tests
 */

import { describe, expect, test } from "bun:test";
import {
	hashClient,
	hashNetwork,
	issueVoterId,
	networkKey,
	scoreVote,
	TRUST_THRESHOLD,
	type VoteSignals,
	verifyVoterId,
} from "../src/vote-identity";

const signals = (over: Partial<VoteSignals> = {}): VoteSignals => ({
	humanVerified: true,
	networkVotesToday: 0,
	clientVotesToday: 0,
	datacenter: false,
	freshCookie: false,
	...over,
});

describe("voter cookie", () => {
	test("a freshly issued id verifies", () => {
		expect(verifyVoterId(issueVoterId())).not.toBeNull();
	});

	test("two voters never collide", () => {
		const ids = new Set(Array.from({ length: 500 }, () => issueVoterId()));
		expect(ids.size).toBe(500);
	});

	test("a tampered id is rejected", () => {
		const id = issueVoterId();
		const [random, day, sig] = id.split(".");
		// Same signature, different payload — the whole point of signing it.
		expect(verifyVoterId(`${random}x.${day}.${sig}`)).toBeNull();
		expect(verifyVoterId(`${random}.${Number(day) + 1}.${sig}`)).toBeNull();
	});

	test("garbage is rejected rather than throwing", () => {
		expect(verifyVoterId(undefined)).toBeNull();
		expect(verifyVoterId("")).toBeNull();
		expect(verifyVoterId("not-a-token")).toBeNull();
		expect(verifyVoterId("a.b.c.d")).toBeNull();
	});
});

describe("network grouping", () => {
	test("an IPv4 household collapses to its /24", () => {
		expect(networkKey("203.0.113.7")).toBe(networkKey("203.0.113.200"));
		expect(networkKey("203.0.113.7")).not.toBe(networkKey("203.0.114.7"));
	});

	test("an IPv6 subscriber cannot escape by rotating inside their /64", () => {
		// Rotating the host part of a /64 is free, so it must not create a new key.
		expect(networkKey("2001:db8:1:2:aaaa::1")).toBe(
			networkKey("2001:db8:1:2:ffff::9999"),
		);
		expect(networkKey("2001:db8:1:2::1")).not.toBe(
			networkKey("2001:db8:1:3::1"),
		);
	});

	test("hashes are stable and non-reversible in shape", () => {
		expect(hashNetwork("203.0.113.7")).toBe(hashNetwork("203.0.113.9"));
		expect(hashNetwork("203.0.113.7")).toMatch(/^[0-9a-f]{32}$/);
	});

	test("client hash changes with headers but not with unrelated ones", () => {
		const base = { "user-agent": "Firefox", "accept-language": "en" };
		expect(hashClient(base)).toBe(hashClient({ ...base, referer: "x" }));
		expect(hashClient(base)).not.toBe(
			hashClient({ ...base, "user-agent": "Chrome" }),
		);
	});
});

describe("scoring", () => {
	test("an ordinary reader's vote counts", () => {
		expect(scoreVote(signals()).trust).toBeGreaterThanOrEqual(TRUST_THRESHOLD);
	});

	test("a failed human check is discarded outright", () => {
		expect(scoreVote(signals({ humanVerified: false })).trust).toBe(0);
	});

	test("someone on a VPN still counts — they are probably real", () => {
		const { trust } = scoreVote(signals({ datacenter: true }));
		expect(trust).toBeGreaterThanOrEqual(TRUST_THRESHOLD);
	});

	test("a script looping past the network limit stops counting", () => {
		const { trust, reasons } = scoreVote(signals({ networkVotesToday: 40 }));
		expect(trust).toBeLessThan(TRUST_THRESHOLD);
		expect(reasons).toContain("network-over-daily-limit");
	});

	test("cookie-clearing does not buy unlimited votes", () => {
		// A fresh cookie every time is exactly what clearing storage looks like;
		// the network and client signals have to carry it.
		const { trust } = scoreVote(
			signals({
				freshCookie: true,
				networkVotesToday: 20,
				clientVotesToday: 20,
			}),
		);
		expect(trust).toBe(0);
	});

	test("one office of colleagues is dampened, not silenced", () => {
		const { trust, reasons } = scoreVote(signals({ networkVotesToday: 5 }));
		expect(reasons).toContain("network-busy");
		expect(trust).toBeGreaterThanOrEqual(TRUST_THRESHOLD);
	});

	test("trust never goes negative", () => {
		const { trust } = scoreVote(
			signals({
				humanVerified: null,
				datacenter: true,
				networkVotesToday: 99,
				clientVotesToday: 99,
				freshCookie: true,
			}),
		);
		expect(trust).toBe(0);
	});
});
