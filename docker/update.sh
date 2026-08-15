#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(pwd)"
[[ -f .env ]] || { printf 'Run ./install.sh first.\n' >&2; exit 1; }
set -a
source .env
set +a

ensure_config_defaults() {
  local config_path="$SCRIPT_DIR/generated/config.json"
  local server_image="${MEETVAP_SERVER_IMAGE:-ghcr.io/rzaasadov/meetvap-server}:${MEETVAP_VERSION:-latest}"

  [[ -f "$config_path" ]] || {
    printf 'Generated server config is missing: %s\n' "$config_path" >&2
    exit 1
  }

  docker run --rm \
    --user "$(id -u):$(id -g)" \
    -v "$config_path:/tmp/meetvap-config.json" \
    "$server_image" \
    node -e '
      const fs = require("fs");
      const path = "/tmp/meetvap-config.json";
      const config = JSON.parse(fs.readFileSync(path, "utf8"));
      config.catalog = config.catalog && typeof config.catalog === "object" ? config.catalog : {};
      config.help = config.help && typeof config.help === "object" ? config.help : {};
      config.catalog.url ||= "https://catalog.meetvap.com/index.php";
      config.help.url ||= "https://help.meetvap.com/index.php";
      fs.writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    '
}

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
ensure_config_defaults
docker compose -f compose.yml run --rm migration
docker compose -f compose.yml up -d --remove-orphans server admin livekit nginx certbot-renew
docker compose -f compose.yml ps
