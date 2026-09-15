# Dev guide

## Prerequisites

- **Bun** 1.3.14
- **Docker** with Compose, for mailpit and Umami. The app's own database is a
  SQLite file in `data/`, so there is no database service to run.

## First run

```bash
bun install
bun run hooks        # lefthook git hooks
bun run env:gen      # writes .env, secrets already generated
bun run icons        # fetches any logo not committed yet
bun run dev          # containers + schema + seed, api :3010, web :3000
```

| | |
|---|---|
| web | http://localhost:3000 |
| api | http://localhost:3010 |
| mailpit | http://localhost:8026 |
| umami | http://localhost:3011 |

`bun run dev:rm` throws the containers, their volumes and the local database
away.

`bun run env:gen` rather than `cp .env.example .env`: the example ships an empty
`VOTE_SECRET` and a placeholder origin, and production refuses to boot on
either — so a copied example is a file that works locally and will not start on
the server. It refuses to overwrite an existing `.env`; `--force` keeps a `.bak`.

Logos are committed under `apps/frontend/public/icons`, and no build fetches
them. After citing a new product or repo, `bun run icons` downloads only the
missing ones; commit them, or those entries show a letter tile.

## Signing in

No seeded account, no password. Put your address in `SITE_ADMIN`, request a link
at `/en/signin`, open it from mailpit. That session is the platform admin and
reaches `/en/admin`. With `SMTP_HOST` unset the link prints to the API's stdout
instead.

## Umami, once

Umami has no seeding API, so the first run needs four clicks. The volume keeps
them.

1. http://localhost:3011 — sign in as `admin` / `umami`, change the password.
2. **Settings → Teams → Create team.** Any name.
3. **Settings → Websites → Add website.** Put it **in the team**, not on
   `admin`, and set the domain to `localhost`. Copy its **Website ID**.
4. **Settings → Users → Create user** (say `stats`), then **Teams → your team →
   Members** and add it with the **View only** role.

Then in `.env`:

```bash
UMAMI_URL=http://localhost:3011
UMAMI_WEBSITE_ID=<from step 3>
UMAMI_USERNAME=stats
UMAMI_PASSWORD=<that user's password>
```

Steps 2 and 3 exist because a website owned by `admin` personally cannot be
shared with anyone — only a team's can. All four variables are required
together; any missing and analytics is off, which the boot banner says out loud.

## Configuration

Every variable is documented in `.env.example`. One file, read in one place
(`apps/backend/src/env.ts`). An unset variable means the feature is off, never a
guessed default.

**Production refuses to boot without**

| | |
|---|---|
| `WEB_ORIGIN` | Every magic link and Stripe return URL is built from it. A localhost value is refused. |
| `VOTE_SECRET` | Signs the voter cookie. The published default is refused. |

**Nothing works properly without**

| | |
|---|---|
| `AUTH_SECRET` | Signs the session cookie. Unset disables sign-in and the admin console. |
| `SITE_ADMIN` | Comma-separated. Who may approve ads and see every campaign. |
| `SMTP_HOST` | Unset prints sign-in links to stdout instead of emailing them. |

**Off unless set:** `PAYMENTS_PROVIDER` + both `STRIPE_*` keys, the four
`UMAMI_*`, `ADMIN_TOKEN`, and `TURNSTILE_SECRET` together with the build-time
`PUBLIC_TURNSTILE_SITE_KEY`, which puts a human check on the submit form.

`NODE_ENV`, `PORT` and `DATABASE_URL` come from `compose.prod.yml`. `SITE_URL`
and `PUBLIC_*` are build-time, passed to `scripts/build-images.sh`.

## Commands

| | |
|---|---|
| `bun run dev` | the whole local stack |
| `bun test` | unit tests |
| `bun run typecheck` | all three workspaces |
| `bunx biome check apps packages scripts` | lint and format |
| `bun run validate` | the dataset: schema, locale coverage, dead links |
| `bun run slugs` | give newly cited tools their permanent address |
| `bun run build` | prerenders every page |
| `bun run icons` | refetch logos |
| `bun run health` | refresh `data/health.json` from the forges |

Lefthook runs biome and content validation on commit, and lint, typecheck and
tests on push. CI runs all four on every PR.

Commits are conventional — `feat(frontend): …`, `fix(backend): …`. Scopes are
listed in `commitlint.config.js`. release-please reads them to decide the next
version, so a commit that does not parse is a release that is wrong.

## Deploying

One environment, production, released and deployed by GitHub Actions.

**On the box, once:** Docker, an nginx already terminating TLS, a DNS A record
for the domain and its `www`, `$APP_DIR/.env` written by hand, and
`docker network connect canireplaceit nginx`.

**Secrets**, set on the `production` environment (not repo-level — both jobs
declare `environment: production`): `GHCR_TOKEN`, `VPS_HOST`, `VPS_USER`,
`SSH_PORT`, `SSH_PRIVATE_KEY`.

`GHCR_TOKEN` is one PAT doing three jobs: opening the release PR, pushing the
tag, and logging in to GHCR. It needs `contents: write`, `pull-requests: write`
and `packages: write`. It is a PAT rather than `GITHUB_TOKEN` because the org
forbids Actions from creating pull requests — a PAT acts as you, so the policy
does not apply.

**Variables**, also on the `production` environment: `APP_DIR`, `SITE_DOMAIN`,
`NGINX_CONF_DIR`, `NGINX_CONTAINER`, `PUBLIC_UMAMI_WEBSITE_ID`, and optionally
`PUBLIC_TURNSTILE_SITE_KEY` and `UMAMI_UPSTREAM` (defaults to `umami:3000`).

**Release.** Run the **Release** workflow with a version. It pushes a
`Release-As` marker commit and release-please opens the release PR — changelog,
`package.json` and the manifest. Merging that PR fires **Release** again (gated
on the merged branch being a `release-please--` one), which cuts the tag and
publishes the GitHub release.

**Deploy.** Merging the release PR also deploys. release-please pushes the tag
with `GHCR_TOKEN`, a PAT, and unlike `GITHUB_TOKEN` a PAT's push does start
workflows, so **Deploy** runs on the new `v*` tag by itself. It checks the tag
out, builds and slims both images, pushes them to GHCR, then ssh's in, pulls,
restarts, and removes all but the two newest image versions. Run **Deploy** by
hand with a version to redeploy, or to roll back to the one before.

So the release PR is the go-live button: leave it open until you want that
version live.

The nginx config is templated at deploy time: `SITE_DOMAIN` and `UMAMI_UPSTREAM` are
substituted into `nginx/canireplaceit.conf`, installed into `NGINX_CONF_DIR` and
reloaded. Its `/u/` block proxies both `/u/script.js` and `/u/api/send` — the
tracker derives its event endpoint from its own `src`, so proxying only the
script gives you a tracker that loads and silently submits nothing.
