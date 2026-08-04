#!/usr/bin/env bash
#
# Build both production images, slim them, throw the fat ones away.
#
#   SITE_URL=https://canireplaceit.com ./scripts/build-images.sh
#
# Leaves exactly two images behind:
#
#   canireplaceit/canireplaceit-be:latest   the API (bun)
#   canireplaceit/canireplaceit-fe:latest   3,052 prerendered pages on nginx
#
# ## Why the frontend needs variables and the backend does not
#
# The API reads its configuration at boot, so one image runs anywhere — the
# domain, the secrets and the Stripe keys all arrive from compose at `up` time.
# The site cannot work that way: `bun run build` writes SITE_URL into every
# canonical link and all 18 sitemap shards, and rsbuild inlines PUBLIC_* into the
# bundle. Those values are frozen the moment the image is built, which is why
# SITE_URL is required here and refused a default — an image built against
# localhost publishes 3,052 pages telling Google it lives on localhost.
#
# ## Why slim, and what it costs
#
# `slim build` runs the image, watches which files it actually opens, and exports
# a new image containing only those. It is not a smaller base — it is the same
# image with everything unproven removed, which is why the include-paths below
# are load-bearing: anything a short probe run never touches has to be named, or
# it is gone. That is also the risk. If you add a runtime dependency that only
# loads on some code path, test the slim image before trusting it.

set -euo pipefail

cd "$(dirname "$0")/.."

# ── What to build with ───────────────────────────────────────────────────────
: "${SITE_URL:?SITE_URL is required (e.g. https://canireplaceit.com) — it is baked into every page}"

TAG="${TAG:-latest}"
BE="canireplaceit/canireplaceit-be"
FE="canireplaceit/canireplaceit-fe"

# Empty means same-origin `/api/...`, which is what the nginx in front proxies to
# the backend. Every call in the frontend already starts with /api, so this is
# right for any deploy where the site and the API share a domain.
PUBLIC_API_URL="${PUBLIC_API_URL:-}"
# An empty website id emits no tracker tag at all, so an unconfigured build is a
# site with no analytics rather than a 404 on all 3,052 pages.
PUBLIC_UMAMI_WEBSITE_ID="${PUBLIC_UMAMI_WEBSITE_ID:-}"
PUBLIC_UMAMI_SRC="${PUBLIC_UMAMI_SRC:-/u/script.js}"

# A same-origin tracker src is served by the edge nginx, not by this image, and
# nothing here can see that file. Say so, because the failure is invisible: an
# unproxied /u/script.js comes back as index.html, the browser declines to run
# it, and the only symptom is a dashboard that reads zero for a month.
if [ -n "$PUBLIC_UMAMI_WEBSITE_ID" ] && [[ $PUBLIC_UMAMI_SRC == /* ]]; then
	echo "note: PUBLIC_UMAMI_SRC=$PUBLIC_UMAMI_SRC is same-origin —"
	echo "      nginx/canireplaceit.conf must carry the matching /u/ proxy, pointed at your Umami host."
fi

command -v docker >/dev/null || { echo "docker not found" >&2; exit 1; }
command -v slim >/dev/null || {
	echo "slim not found — https://github.com/slimtoolkit/slim/releases" >&2
	exit 1
}

size() { docker image inspect "$1" --format '{{.Size}}' 2>/dev/null | numfmt --to=iec; }

# Paths every image needs kept regardless of what the probe run happened to open:
# certificates (outbound TLS to Stripe, SMTP and Umami), and the passwd/group
# entries for the non-root uid the image runs as.
COMMON=(
	--include-path /etc/ssl/certs
	--include-path /etc/passwd
	--include-path /etc/group
	--include-path /tmp
	--include-path /run
	--include-path /usr/bin
	--include-path /usr/local/bin
	--include-path /usr/lib
	--include-path /usr/share
)

# `slim build` writes the slim image under a new tag; the fat one is only an
# input and is removed the moment its replacement exists.
slim_and_drop() {
	local fat=$1 final=$2
	shift 2
	local before
	before=$(size "$fat")

	echo "── slimming $fat"
	# --http-probe-off: the API answers nothing useful without a database and the
	# site is static, so the probe would prove nothing the include-paths do not
	# already cover. --continue-after=1: let it boot for a second, then stop.
	slim build \
		--target "$fat" \
		--tag "$final" \
		--http-probe-off \
		--continue-after=1 \
		"${COMMON[@]}" "$@"

	docker image rm "$fat" >/dev/null
	echo "   $final  $before → $(size "$final")"
}

# ── The API ──────────────────────────────────────────────────────────────────
echo "── building $BE:$TAG"
docker build -f apps/backend/Dockerfile -t "$BE:fat" .
slim_and_drop "$BE:fat" "$BE:$TAG" \
	--include-path /app \
	--include-path /var/lib/canireplaceit

# ── The site ─────────────────────────────────────────────────────────────────
echo "── building $FE:$TAG for $SITE_URL"
docker build -f apps/frontend/Dockerfile -t "$FE:fat" . \
	--build-arg "SITE_URL=$SITE_URL" \
	--build-arg "PUBLIC_API_URL=$PUBLIC_API_URL" \
	--build-arg "PUBLIC_UMAMI_WEBSITE_ID=$PUBLIC_UMAMI_WEBSITE_ID" \
	--build-arg "PUBLIC_UMAMI_SRC=$PUBLIC_UMAMI_SRC"
# busybox is the only thing in this image that can speak HTTP, and /usr/bin/wget
# is a symlink to it. Slim keeps the symlink and drops the target, which leaves a
# healthcheck that can never pass — see compose.prod.yml.
slim_and_drop "$FE:fat" "$FE:$TAG" \
	--include-path /etc/nginx \
	--include-path /var/lib/nginx \
	--include-path /var/cache/nginx \
	--include-bin /bin/busybox

echo
echo "done — $BE:$TAG and $FE:$TAG"
echo "next: docker compose -f compose.prod.yml up -d --wait"
