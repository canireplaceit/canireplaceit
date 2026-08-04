/**
 * Conventional commits, enforced at commit-msg by lefthook.
 *
 * The scopes are the workspaces plus the few cross-cutting areas, so a subject
 * line says where a change landed without opening it. `chore(release)` is what
 * release-please writes; it has to pass or the release PR cannot be merged.
 */
export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		"scope-enum": [
			2,
			"always",
			[
				"site",
				"backend",
				"frontend",
				"core",
				"content",
				"scripts",
				"deploy",
				"deps",
				"docs",
				"release",
			],
		],
		"scope-empty": [0],
		// 72 is the width a subject stays readable at in `git log --oneline`.
		"header-max-length": [2, "always", 72],
	},
};
