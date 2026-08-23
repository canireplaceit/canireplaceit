/**
 * The published skill and its discovery manifest, kept in step.
 *
 * `/.well-known/agent-skills/index.json` carries a sha256 of SKILL.md so an
 * agent can verify what it fetched. That digest is the kind of thing that goes
 * stale the first time somebody fixes a typo in the skill, and a wrong digest
 * is worse than none: a client that checks integrity refuses the skill outright.
 * So the check lives here instead of in somebody's memory.
 *
 * Also asserts the Agent Skills spec rules that a runtime will reject us for
 * (agentskills.io/specification): name shape, description length, and the name
 * matching its own directory.
 *
 *   bun test scripts/skill.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "../apps/frontend/public");
const SKILL_PATH = join(PUBLIC, "agent-skills/canireplaceit/SKILL.md");
const INDEX_PATH = join(PUBLIC, "agent-skills/index.json");

const skill = readFileSync(SKILL_PATH);
const skillText = skill.toString("utf8");
const manifest = JSON.parse(readFileSync(INDEX_PATH, "utf8")) as {
	$schema: string;
	skills: {
		name: string;
		type: string;
		description: string;
		url: string;
		digest: string;
	}[];
};

const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---\n/);

/** One key out of the YAML frontmatter, with folded continuation lines joined. */
const field = (key: string): string => {
	const body = frontmatter?.[1] ?? "";
	const found = body.match(
		new RegExp(`^${key}:\\s*([\\s\\S]*?)(?=\\n\\S|$)`, "m"),
	);
	return (found?.[1] ?? "").replace(/\s+/g, " ").trim();
};

describe("SKILL.md", () => {
	test("has the frontmatter the spec requires", () => {
		expect(frontmatter).not.toBeNull();
		expect(field("name")).toBe("canireplaceit");
		expect(field("description").length).toBeGreaterThan(0);
	});

	test("the name is a legal slug and matches its directory", () => {
		const name = field("name");
		expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		expect(name.length).toBeLessThanOrEqual(64);
		expect(SKILL_PATH).toContain(`/${name}/SKILL.md`);
	});

	test("the description fits the 1024 character ceiling", () => {
		expect(field("description").length).toBeLessThanOrEqual(1024);
	});

	test("stays inside the size a runtime will load in one go", () => {
		// The spec recommends under 500 lines, since the whole body enters the
		// agent's context the moment the skill activates.
		expect(skillText.split("\n").length).toBeLessThan(500);
	});
});

describe("discovery manifest", () => {
	const entry = manifest.skills.find((s) => s.name === "canireplaceit");

	/**
	 * The one URL in this repo that is an identifier rather than a fetch.
	 *
	 * Discovery is a Cloudflare RFC rather than part of the agentskills.io
	 * specification, and it names exactly this URI. We shipped
	 * `agentskills.io/schemas/discovery-0.2.0.json` instead, which 404s, and per
	 * the RFC a client that cannot resolve `$schema` falls back to treating the
	 * index as v0.1.0. It is asserted rather than remembered because the wrong
	 * one looked right for months.
	 */
	test("points at the schema the discovery RFC names", () => {
		expect(manifest.$schema).toBe(
			"https://schemas.agentskills.io/discovery/0.2.0/schema.json",
		);
	});

	test("lists the skill", () => {
		expect(entry).toBeDefined();
		expect(entry?.type).toBe("skill-md");
		expect(entry?.url).toBe("/.well-known/agent-skills/canireplaceit/SKILL.md");
	});

	test("the digest matches the skill on disk", () => {
		const hash = new Bun.CryptoHasher("sha256").update(skill).digest("hex");
		expect(entry?.digest).toBe(`sha256:${hash}`);
	});

	test("the description matches the skill's own frontmatter", () => {
		expect(entry?.description).toBe(field("description"));
	});
});
