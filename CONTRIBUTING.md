# Contributing

Every product on the list is one JSON file in `data/products/<slug>.json`, added by pull
request. There is no web form and no account — the repo is the admin panel.

```bash
bun install
bun run validate     # checks the whole dataset
```

There is no CI. `bun run validate` is run by hand and again at API boot, so a dataset that
does not pass is one the server refuses to start on.

## Adding a product

Create `data/products/<slug>.json`. The filename must match the `slug`.

```jsonc
{
	"slug": "notion",              // lowercase-with-hyphens, matches the filename
	"name": "Notion",
	"domain": "notion.com",        // no scheme, no www. null if there genuinely isn't one
	"category": "notes-docs",      // must already exist in data/categories.json
	"priceMonthly": 10,            // USD/month for the typical paid tier. null if it varies
	"pricing": {                   // optional, but a receipt makes the PR reviewable
		"plan": "Business",
		"basis": "per-seat",       // flat | per-seat | usage | one-time | custom
		"url": "https://www.notion.com/pricing",
		"checkedOn": "2026-08-01", // YYYY-MM-DD
		"confidence": "high"       // high | medium | low
	},
	// "notPublic": true,          // ONLY when you looked and the vendor publishes
	                               // nothing. See "Three kinds of no price" below.
	"verdict": "almost",           // yes | almost | not-yet
	"why": {                       // the argument. One or two sentences, opinionated
		"en": "Databases and relations are the moat…",
		"fr": "Les bases de données et les relations sont le vrai fossé…"
	},
	"whatYouLose": [               // 2-4 SHORT bullets, enforced. A few words each, not
	                               // sentences. One is a shrug; five stop being chips
	                               // and become a paragraph nobody reads.
		{ "en": "Relational databases", "fr": "Bases de données relationnelles" },
		{ "en": "Mobile apps", "fr": "Applications mobiles" }
	],
	"alternatives": [              // at least one must be open source
		{
			"kind": "oss",
			"name": "AppFlowy",
			"source": {                        // NOT "repo" — the host is part of the model
				"host": "github",                // github | gitlab | codeberg | gitea | forgejo |
				                                 // sourcehut | bitbucket | savannah | other
				"path": "AppFlowy-IO/AppFlowy",  // owner/name, or the host's equivalent
				"url": "https://github.com/AppFlowy-IO/AppFlowy"
			},
			"license": "AGPL-3.0",
			"effort": "docker",                // managed | docker | ops
			"note": { "en": "Closest UX clone…", "fr": "Le clone le plus proche…" },
			"facts": {                         // REQUIRED on every oss entry — validation fails
				"selfHostable": true,            //   without it. This block is the actual claim.
				"openCore": "major",             // none | minor | major
				"paywalled": { "en": "More than one member on self-hosted", "fr": "Plus d’un membre en auto-hébergement" },
				"ssoInFree": true,               // true | false | null when genuinely unknown
				"dataResidency": "self"          // self | eu-option | us-only | unknown
			}
		},
		{
			"kind": "cheaper",                 // still paid, just less
			"name": "Anytype",
			"url": "https://anytype.io",
			"priceMonthly": 0,
			"note": { "en": "What you give up…", "fr": "Ce que vous perdez…" }
		}
	],
	"priority": 4                  // 1-5 editorial weight for default ordering
}
```

### The rules that actually matter

**Be honest.** A list where everything is replaceable is worthless. If the open source
option is not there yet, say `not-yet` and explain precisely what is missing. `whatYouLose`
is not a formality — it is the reason anyone trusts the rest of the entry.

**`effort` is the cheapest realistic way to run it**, not the best case:
`managed` (a hosted tier or desktop app exists) · `docker` (one compose file and you're up)
· `ops` (a real server and ongoing attention).

**Every `source` must be real, current and canonical.** Check it is not archived and has
commits in the last year. If a project moved or was forked, link the live one and say so in
the note. Archived is not a style note: if `data/health.json` already records the repo as
archived, `bun run validate` fails, and so does the API at boot.

**Prices drift.** Give the typical entry-tier price and fill in `pricing` so the next person
can re-check it rather than guess. `confidence` is not decoration — the site draws a `low`
price differently from a `high` one, so `high` means you read the figure off the vendor's own
pricing page, `medium` means docs or a secondary source, and `low` means you could not
confirm it.

### Three kinds of "no price"

`priceMonthly: null` used to mean all three of these at once, and the site rendered every one
of them as "free tier". They are now distinct, and which one you write is the difference
between information and a guess:

| What is true | Write |
| --- | --- |
| No single monthly figure fits — usage-metered, or a perpetual licence | `priceMonthly: null` + `pricing` with `basis: "usage"` / `"one-time"` |
| You looked, and the vendor publishes nothing but "contact sales" | `priceMonthly: null` + `notPublic: true` + `pricing` with `basis: "custom"` |
| Nobody has checked yet | `priceMonthly: null`, `pricing: null`, no `notPublic` |

`notPublic` is a claim about the vendor, so the validator requires a `pricing` receipt with
it — the page you read and the date you read it. That receipt is the entire point: without
it the next price sweep re-verifies the same settled entries, which has already happened
three times.

Leaving it out is always safe. The third row is the default and renders as "Price not
checked", with **no date** — the absence of a date is the information.

**Licences are load-bearing here.** Read the actual LICENSE file rather than trusting
GitHub's label. If it is BSL, SSPL, Elastic or a bespoke vendor licence, say so in the note —
"open source" is the whole promise of this site and getting it wrong is the worst thing we
can do.

## Translations

`en` is required and is the fallback. Every other locale is optional — a missing `fr` shows
the English text rather than an empty box, so a partial translation is a welcome PR.

Translate the *argument*, not the words. The validator reports coverage per language:

```
493 products · 84 categories · 1701 alternatives
  verdicts: 199 replaceable, 263 almost, 31 not yet
  209 products also list a cheaper commercial option
  en: 493/493 fully translated (100%)
  fr: 493/493 fully translated (100%)
```

To add a language, add it to `SupportedLangs` in `packages/core/src/index.ts` and start
filling in keys. No schema migration — translations are maps, not columns.

## Icons

Icons live in `apps/frontend/public/icons/` and **are committed**. Add a product, run
`bun run icons` — it only fetches what is missing — then commit the new `.webp` alongside
your JSON. Deploys never touch the network for logos: a build from a tag produces the same
site every time, which it did not when the fetch ran in CI.

Sources are product favicons by domain, open source projects by forge avatar (GitHub,
GitLab, Gitea, Forgejo and Codeberg each have their own API path). Everything is re-encoded
to WebP at 96px, lossy and lossless both tried and the smaller one kept. `--force` re-fetches
everything. Missing icons fall back to a lettermark, so a failed fetch is never fatal.

## Categories

Add to `data/categories.json` only when nothing existing fits:

```jsonc
{ "slug": "notes-docs", "name": { "en": "Notes & docs", "fr": "Notes et docs" },
  "icon": "notebook-pen", "position": 12,
  "blurb": {                     // optional, and the only unique prose a category
                                 // page has. One paragraph on what this corner of
                                 // the catalogue is and where its exits are.
                                 // Leave it out rather than write filler.
    "en": "Almost nothing here is charging you for the editor…",
    "fr": "Presque personne ici ne vous facture l'éditeur…"
  } }
```

`icon` must be a real [lucide](https://lucide.dev/icons/) name. Every category
automatically gets its own sponsor slot, so adding one has a revenue side-effect — don't
create categories with one product in them.

## What `validate` checks

`bun run validate` blocks on: filename/slug mismatch,
duplicate slugs, unknown category, unknown verdict, effort, forge host, `openCore`,
`dataResidency`, `pricing.basis` or `pricing.confidence` value, a `source.path` that does not
look like `owner/name`, a `source.url` that is not `https://`, missing English on any
translated field, a product with no open source alternative, an `oss` entry with no `facts`,
an `openCore` other than `none` that does not say what is paywalled, `cheaper` entries
carrying `source`/`repo`/`license`/`effort`/`facts`/`hasCompose` (or `oss` entries carrying
`url`/`priceMonthly`/`priceOnce`), a perpetual licence written as `priceMonthly: 0`, a
`notPublic` without a receipt, `whatYouLose` outside 2-4 bullets, and any cited repo that
`data/health.json` records as **archived**. It checks content and nothing else: types, lint
and tests are `bun run typecheck`, `bunx biome check apps packages scripts` and `bun test`.

The archived check only ever fires on a positive `archived: true`. A repo with no reading —
a brand new PR's, one on a forge whose unauthenticated API does not report the field, one on
a host `bun run health` does not query — passes, because absence is not evidence. Failing on
a missing reading would block every PR for the crime of being new.

## Project health

Stars, last-commit dates, archived flags and whether a repo ships a compose file are NOT
authored — they go stale the day you write them down. `bun run health` reads them from the
forge into `data/health.json`, which the pages render directly:

```bash
bun run health       # needs GITHUB_TOKEN, or `gh auth token`
```

**Nothing refreshes this file on a schedule.** A weekly job used to commit it back to main;
that job is gone with the rest of CI, so `data/health.json` is only as current as the last
person to run the command — check its `fetchedAt` before trusting a reading, and run it
yourself if a PR turns on whether a repo is alive.

It also reports archived repos, 404s, anything with no push in a year, and licences that
disagree with what we claim. Those are content bugs — fix the entry, don't ignore the
warning. A repo with no entry in the file renders **nothing** rather than a zero: we do not
have a reading, and that is not the same as no activity.
