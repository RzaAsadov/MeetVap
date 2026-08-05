#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(pwd)"
[[ -f .env ]] || { printf 'Run ./install.sh first.\n' >&2; exit 1; }
set -a
source .env
set +a

if [[ "${MEETVAP_SERVER_IMAGE:-}" == "meetvap-server" ]]; then
  BUILD_ROOT="${MEETVAP_BUILD_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  for REQUIRED_PATH in admin/package.json docker/server/Dockerfile meet/package.json server/package.json web/package.json; do
    [[ -e "$BUILD_ROOT/$REQUIRED_PATH" ]] || {
      printf 'Local build source is incomplete: %s is missing.\n' "$BUILD_ROOT/$REQUIRED_PATH" >&2
      exit 1
    }
  done
  docker build --pull -t "meetvap-server:${MEETVAP_VERSION}" -f "$BUILD_ROOT/docker/server/Dockerfile" "$BUILD_ROOT"
  docker build --pull -t "meetvap-admin:${MEETVAP_VERSION}" -f "$BUILD_ROOT/docker/admin/Dockerfile" "$BUILD_ROOT"
  docker build --pull -t "meetvap-nginx:${MEETVAP_VERSION}" -f "$BUILD_ROOT/docker/nginx/Dockerfile" "$BUILD_ROOT"
  docker compose -f compose.yml pull livekit postgres redis certbot-renew
else
  docker compose -f compose.yml pull server admin nginx livekit postgres redis certbot-renew
fi
docker compose -f compose.yml run --rm migration
docker compose -f compose.yml up -d --remove-orphans server admin livekit nginx certbot-renew
docker compose -f compose.yml ps
