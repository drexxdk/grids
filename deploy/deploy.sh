#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
compose=(docker compose --env-file deploy/stack.env -f docker-compose.prod.yml)
caddy_directory="${CADDY_DIRECTORY:-/opt/chatter/deploy/caddy}"
caddy_container="${CADDY_CONTAINER:-chatter-prod-caddy-1}"

test -s deploy/api.env
test -s deploy/stack.env
grep -Fq 'import extras/*.caddy' "$caddy_directory/sites.caddy" || {
  echo "Install the optional extras import in Chatter's Caddy configuration first." >&2
  exit 1
}
"${compose[@]}" config --quiet
"${compose[@]}" build --pull api
if test -n "$("${compose[@]}" ps --status running -q postgres)"; then
  mkdir -p backups
  backup="backups/$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  "${compose[@]}" exec -T postgres pg_dump -U grids grids </dev/null | gzip > "$backup.tmp"
  mv "$backup.tmp" "$backup"
fi
"${compose[@]}" up -d --wait --wait-timeout 180
mkdir -p "$caddy_directory/extras"
cp deploy/caddy/grids.caddy "$caddy_directory/extras/grids.caddy"
docker exec "$caddy_container" caddy validate --config /etc/caddy/direct.Caddyfile --adapter caddyfile
docker exec "$caddy_container" caddy reload --config /etc/caddy/direct.Caddyfile --adapter caddyfile
curl --fail --silent --show-error https://chatter-drexx-api.duckdns.org/grids-api/api/health
