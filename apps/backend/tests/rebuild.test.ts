/**
 * The rebuild is nightly and single-flight. The only rule worth testing is that
 * two builds never overlap — concurrent prerenders would interleave half-written
 * HTML into the same files.
 */

import { describe, expect, test } from "bun:test";
import { _reset, rebuild, rebuildState } from "../src/rebuild";

describe("rebuild", () => {
	test("refuses to start while one is already running", async () => {
		_reset({ building: true });
		expect(await rebuild()).toEqual({ started: false });
		expect(rebuildState().builds).toBe(0);
	});

	test("reports state without leaking the mutable object", () => {
		_reset({ builds: 3 });
		const snapshot = rebuildState();
		snapshot.builds = 999;
		expect(rebuildState().builds).toBe(3);
	});
});
