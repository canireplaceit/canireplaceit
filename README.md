# canireplaceit

Open source alternatives to the SaaS you pay for — with a verdict, not just a list.

Every entry answers one question honestly: **is the open source option actually good enough
yet, and what does switching really cost?** Each product also carries a cheaper-but-still-paid
escape route, for people who want off the expensive thing without running a server.

493 products · 84 categories · 1,701 alternatives · English and French.

## How it works

Content lives in git — one JSON file per product under `data/products/`. There is no admin
UI and no moderation queue: a pull request is how an entry changes, so every change is
reviewable, attributable and revertible. The database holds only what changes without a
deploy — votes, sponsorships, leads, sessions.

Verdicts are editorial. Everything else is derived: the exit ladder, category figures,
project pages and the collections all fall out of the entries themselves, so they cannot
drift from the data.

The site is prerendered to static pages and hydrated, so a crawler and a reader see the same
document.

## Stack

Bun workspaces + Turbo · Elysia + Drizzle + SQLite · Rsbuild + React 19 + Tailwind 4 · Biome.

```
data/                  the dataset — PRs land here
packages/core          content schema, validation, URLs, locale resolution
apps/backend           Elysia API — votes, ads, sign-in, mail
apps/frontend          React, prerendered
scripts/               validate, prerender, icons, health, build, deploy
```

## Running it

See **[DEVGUIDE.md](DEVGUIDE.md)** — prerequisites, first run, configuration, commands and
deploying.

```bash
bun install && bun run env:gen && bun run icons && bun run dev
```

## Contributing

Content changes are the useful ones. See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the entry
schema and what `bun run validate` checks.

Commits are conventional; scopes are in `commitlint.config.js`.

## Known gaps

- **`ssoInFree` is unknown for 374 of 871 projects.** Pages say "not checked" rather than
  guessing, but it is the largest hole in the facts — PRs welcome.
- **No CI on contributions yet.** Entries are validated by hand until that lands.

## Licence

MIT — see [LICENSE](LICENSE).
