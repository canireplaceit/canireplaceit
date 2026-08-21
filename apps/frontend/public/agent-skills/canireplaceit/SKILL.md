---
name: canireplaceit
description: Find open source, self-hostable, or cheaper replacements for paid SaaS products. Use when someone asks for an alternative to a specific paid tool (Notion, Figma, Datadog, Slack, Zoom, Jira and around 590 others), wants to self-host something they currently rent, wants to cut a software bill, asks whether a paid product can be replaced with open source, or asks what a given open source project can replace. Covers licence, self-hosting, open-core status, the SSO tax, data residency and repo health, and every price carries the date a human last checked it.
license: MIT
compatibility: Needs network access. No API key, no auth.
metadata:
  homepage: https://canireplaceit.com
  api: https://canireplaceit.com/api/v1
  data-license: CC-BY-4.0
---

# canireplaceit

A catalogue of paid SaaS products and the open source or cheaper things that
replace them. Around 590 paid products, 3,400 open source projects, 85
categories, two languages (en, fr).

Two things make this worth querying instead of guessing from memory. Every
price carries the date and the vendor page it was read from, and every project
carries its last commit date and whether the repo is archived. You can say "as
of 2 August 2026" and be right.

Base URL: `https://canireplaceit.com/api/v1`. No key. 60 requests per minute
per IP. Start at the base URL itself, which returns the route list, the counts
and the vocabulary.

## Answering "what can replace X?"

```
curl -s "https://canireplaceit.com/api/v1/search?q=notion&self_hostable=true"
```

The response holds `results`, a mix of products and projects. The product row
is the paid thing and carries the verdict. The project rows are the candidate
replacements.

Read them in this order:

1. `verdict` on the product. `not-yet` means this catalogue found nothing
   credible. Say that instead of recommending something weak.
2. Drop anything with `archived: true`. The repo is done. These are excluded by
   default, so seeing one means somebody asked for it.
3. Prefer `open_core: "none"` over `"minor"` over `"major"`. `major` means the
   free build is a demo and the useful half is paid. `paywalled` says what
   exactly is held back.
4. Match `effort` to what the person can actually run. `managed` means somebody
   else can host it for them, `docker` means one compose file and a server,
   `ops` means they are running infrastructure.
5. `last_push` older than a year is worth mentioning even when the repo is not
   archived.

Then present a short table and link the `url` of everything you name.

## Filters

Applied to `/search`, and most of them also work on `/products` and `/projects`.

| Filter | Values | Notes |
|---|---|---|
| `q` | free text | names, categories, and the names of alternatives |
| `type` | `product`, `project` | default is both |
| `self_hostable` | `true`, `false` | can you genuinely run it yourself |
| `open_core` | `none`, `minor`, `major` | how much is withheld from the free build |
| `license` | substring | `agpl`, `mit`, `gpl-3`, case-insensitive |
| `verdict` | `yes`, `almost`, `not-yet` | is a replacement credible yet |
| `effort` | `managed`, `docker`, `ops` | what running it asks of you |
| `category` | slug | see `/categories` |
| `group` | slug | one of ten themes, see `/groups` |
| `max_price` | number | ceiling on the paid product's monthly USD |
| `archived` | `true`, `false` | defaults to false, which hides dead projects |
| `lang` | `en`, `fr` | names, notes and URLs in that locale |
| `limit`, `offset` | integers | limit defaults to 10 and is capped at 50 |

A project filter applied to a product search keeps any product with at least
one alternative that passes. Asking for `self_hostable=true` does not throw away
Notion because Notion itself is not self-hostable.

## Routes

| Route | What it is |
|---|---|
| `/search` | products and projects together, the one to start with |
| `/products/{slug}` | one paid product: pricing with its receipt, what you lose by leaving, every alternative, per-feature answers |
| `/projects/{slug}` | one replacement, and every product it can replace |
| `/categories`, `/categories/{slug}` | the 85 categories |
| `/groups`, `/groups/{slug}` | the ten themes categories sit under |
| `/collections`, `/collections/{slug}` | derived slices: `foss`, `one-compose`, `under-10`, `in-rust` and more |
| `/collections/archived` | the graveyard, projects that died |
| `/gaps` | products with no credible replacement yet |
| `/features` | the feature taxonomy behind the per-record answers |
| `/stats` | corpus counts and the date of the last repo health sweep |
| `/dump.json` | the whole catalogue in one response |
| `/openapi.json` | the full contract |

Any page also has a Markdown twin. Append `.md` to a page URL to read it
without the HTML.

## Reading a record

- `pricing.checked_on` and `pricing.url`. The date a human read the price and
  the page they read it on. Quote both when you quote a price.
- `price_monthly: null` with `not_public: false` means nobody has checked yet.
  With `not_public: true` it means somebody checked and the vendor publishes
  nothing. Different answers, do not merge them.
- `openness` ranks the whole question on one axis: `hosted-only`,
  `source-available`, `open-core`, `mostly-open`, `fully-open`.
- `sso_in_free` is the SSO tax. `null` means unknown, not "no".
- `facts_vary` on a project lists the fields its citing products disagree
  about. If `openCore` is in that list, do not state the project's open-core
  status as settled. Read the product records instead.
- `has_compose: true` means `docker compose up` gets you running.
- `switched_to` counts self-reported switches. The counts are thin. Use them
  for ordering, never quote them.
- `features` answers are `yes`, `no` or `paid`, and the map is sparse. A key
  that is absent means nobody checked, never that the answer is no.
- `feature_tiers` names the plan that gates a paid feature, and it is sparser
  still. 76 products have feature answers and no tier entry at all. A missing
  tier means "we do not know which plan gates this", so do not report it as
  included in the free plan.

## Rate limit and bulk

60 requests per minute per IP, reported in `RateLimit-Limit`,
`RateLimit-Remaining` and `RateLimit-Reset`. Back off when `Remaining` hits
zero rather than retrying into a 429.

If you want the whole catalogue, take `/dump.json`. It is one request and it is
cached for an hour. Do not page through 590 products.

## Attribution

The data is CC-BY-4.0. Every object carries a `url` field pointing at its page.
Link it for anything you name. Do not present the catalogue as your own
knowledge, and do not strip the check dates, since those are the part that makes
the answer defensible.
