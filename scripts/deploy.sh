#!/usr/bin/env bash
set -euo pipefail

TAG="${IMAGE_TAG:?IMAGE_TAG required}"
: "${VPS_HOST:?VPS_HOST required}"
: "${VPS_USER:?VPS_USER required}"
: "${SSH_PRIVATE_KEY:?SSH_PRIVATE_KEY required}"
: "${GHCR_USERNAME:?GHCR_USERNAME required}"
: "${GHCR_TOKEN:?GHCR_TOKEN required}"
: "${SITE_DOMAIN:?SITE_DOMAIN required}"
: "${NGINX_CONF_DIR:?NGINX_CONF_DIR required}"
: "${APP_DIR:?APP_DIR required}"

SSH_PORT="${SSH_PORT:-22}"
UMAMI_UPSTREAM="${UMAMI_UPSTREAM:-umami:3000}"
NGINX_CONTAINER="${NGINX_CONTAINER:-nginx}"
REMOTE="$APP_DIR"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

KEY="$(mktemp)"
WORK="$(mktemp -d)"
trap 'rm -rf "$KEY" "$WORK"' EXIT
printf '%s\n' "$SSH_PRIVATE_KEY" > "$KEY"
chmod 600 "$KEY"

SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP=(scp -i "$KEY" -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)

sed -e "s/canireplaceit\.com/${SITE_DOMAIN}/g" \
    -e "s/umami:3000/${UMAMI_UPSTREAM}/g" \
    "$ROOT/nginx/canireplaceit.conf" > "$WORK/canireplaceit.conf"

cp "$ROOT/compose.prod.yml" "$WORK/compose.yml"

echo "→ ${VPS_USER}@${VPS_HOST}:${REMOTE}  tag ${TAG}"

"${SSH[@]}" "${VPS_USER}@${VPS_HOST}" "mkdir -p ${REMOTE}"
"${SCP[@]}" "$WORK/compose.yml" "${VPS_USER}@${VPS_HOST}:${REMOTE}/compose.yml"
"${SCP[@]}" "$WORK/canireplaceit.conf" "${VPS_USER}@${VPS_HOST}:${REMOTE}/canireplaceit.conf"

"${SSH[@]}" "${VPS_USER}@${VPS_HOST}" bash -s <<REMOTE_SCRIPT
set -euo pipefail
cd ${REMOTE}

echo '${GHCR_TOKEN}' | docker login ghcr.io -u '${GHCR_USERNAME}' --password-stdin

echo "TAG=${TAG}" > .env.tag

if [ ! -f .env ]; then
  echo "no ${REMOTE}/.env on the box — create it from .env.example first" >&2
  exit 1
fi

docker compose --env-file .env --env-file .env.tag pull
docker compose --env-file .env --env-file .env.tag up -d --wait

install -D -m 644 canireplaceit.conf "${NGINX_CONF_DIR}/canireplaceit.conf"
docker exec ${NGINX_CONTAINER} nginx -t
docker exec ${NGINX_CONTAINER} nginx -s reload

docker image prune -f >/dev/null
REMOTE_SCRIPT

echo "✓ ${TAG} live on ${SITE_DOMAIN}"
