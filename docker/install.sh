#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
LOCAL_IMAGES=false

case "${1:-}" in
  '') ;;
  --local-images) LOCAL_IMAGES=true ;;
  *)
    printf 'Usage: ./install.sh [--local-images]\n' >&2
    exit 1
    ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    printf 'Required command is not installed: %s\n' "$1" >&2
    exit 1
  }
}

build_local_images() {
  local build_root="${MEETVAP_BUILD_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd)}"
  local required_path

  for required_path in admin/package.json docker/server/Dockerfile meet/package.json server/package.json web/package.json; do
    if [[ ! -e "$build_root/$required_path" ]]; then
      printf 'Local build source is incomplete: %s is missing.\n' "$build_root/$required_path" >&2
      printf 'Extract the bundle created by docker/export-local-build.sh and run docker/install.sh from that bundle.\n' >&2
      exit 1
    fi
  done

  printf '\nBuilding local MeetVap server image...\n'
  docker build --pull -t meetvap-server:test -f "$build_root/docker/server/Dockerfile" "$build_root"
  printf '\nBuilding local MeetVap admin image...\n'
  docker build --pull -t meetvap-admin:test -f "$build_root/docker/admin/Dockerfile" "$build_root"
  printf '\nBuilding local MeetVap nginx, web, and meet image...\n'
  docker build --pull -t meetvap-nginx:test -f "$build_root/docker/nginx/Dockerfile" "$build_root"
}

normalize_domain() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's#^https?://##; s#/*$##'
}

validate_domain() {
  [[ "$1" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

random_hex() {
  LC_ALL=C od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

ensure_config_defaults() {
  local config_path="$SCRIPT_DIR/generated/config.json"
  local server_image="${MEETVAP_SERVER_IMAGE}:${MEETVAP_VERSION}"

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

prompt_domain() {
  local label="$1"
  local value

  while true; do
    read -r -p "$label: " value
    value="$(normalize_domain "$value")"
    if validate_domain "$value"; then
      printf '%s' "$value"
      return
    fi
    printf 'Enter a hostname such as web.example.com (without a URL path).\n' >&2
  done
}

prompt_main_server_host() {
  local value

  while true; do
    read -r -p 'Main server hostname or HTTPS URL [https://mm.meetvap.com]: ' value
    value="${value:-https://mm.meetvap.com}"
    value="$(normalize_domain "$value")"
    if validate_domain "$value"; then
      printf 'https://%s' "$value"
      return
    fi
    printf 'Enter the main server hostname, such as mm.meetvap.com.\n' >&2
  done
}

require_command docker
docker compose version >/dev/null

if [[ -f .env ]]; then
  printf 'docker/.env already exists. Use ./update.sh or remove it to perform a fresh installation.\n' >&2
  exit 1
fi

if [[ "$LOCAL_IMAGES" == true ]]; then
  build_local_images
fi

printf 'MeetVap Docker installation\n\n'
WEB_DOMAIN="$(prompt_domain 'Web domain')"
MEET_DOMAIN="$(prompt_domain 'Meet domain')"
SERVER_DOMAIN="$(prompt_domain 'Server/API domain')"
while true; do
  ADMIN_DOMAIN="$(prompt_domain 'Admin domain')"
  if [[ "$ADMIN_DOMAIN" != "$WEB_DOMAIN" && "$ADMIN_DOMAIN" != "$MEET_DOMAIN" && "$ADMIN_DOMAIN" != "$SERVER_DOMAIN" ]]; then
    break
  fi
  printf 'The admin domain must be different from the web, meet, and server domains.\n' >&2
done
MAIN_SERVER_HOST="$(prompt_main_server_host)"

while true; do
  read -r -s -p 'Child relay key from the main server admin: ' MAIN_SERVER_KEY
  printf '\n'
  if [[ "$MAIN_SERVER_KEY" =~ ^[A-Za-z0-9_-]{24,}$ ]]; then
    break
  fi
  printf 'The relay key must contain at least 24 ASCII letters, numbers, underscores, or hyphens.\n' >&2
done

while true; do
  read -r -p 'Admin username: ' ADMIN_USERNAME
  if [[ "$ADMIN_USERNAME" =~ ^[A-Za-z0-9_.-]{3,80}$ ]]; then
    break
  fi
  printf 'Use 3-80 letters, numbers, dots, underscores, or hyphens.\n' >&2
done

while true; do
  read -r -s -p 'Admin password (minimum 12 characters): ' ADMIN_PASSWORD
  printf '\n'
  read -r -s -p 'Confirm admin password: ' ADMIN_PASSWORD_CONFIRM
  printf '\n'
  if (( ${#ADMIN_PASSWORD} < 12 )); then
    printf 'Password must contain at least 12 characters.\n' >&2
  elif [[ "$ADMIN_PASSWORD" != "$ADMIN_PASSWORD_CONFIRM" ]]; then
    printf 'Passwords do not match.\n' >&2
  elif [[ "$ADMIN_PASSWORD" == *$'\n'* || "$ADMIN_PASSWORD" == *$'\r'* ]]; then
    printf 'Password cannot contain line breaks.\n' >&2
  else
    break
  fi
done

POSTGRES_PASSWORD="$(random_hex 24)"
JWT_SECRET="$(random_hex 48)"
SERVER_EVENTS_INTERNAL_SECRET="$(random_hex 32)"
LIVEKIT_API_KEY="API$(random_hex 8)"
LIVEKIT_API_SECRET="$(random_hex 32)"
ADMIN_SESSION_SECRET="$(random_hex 48)"

if [[ "$LOCAL_IMAGES" == true ]]; then
  MEETVAP_VERSION=test
  MEETVAP_SERVER_IMAGE=meetvap-server
  MEETVAP_ADMIN_IMAGE=meetvap-admin
  MEETVAP_NGINX_IMAGE=meetvap-nginx
else
  MEETVAP_VERSION=latest
  MEETVAP_SERVER_IMAGE=ghcr.io/rzaasadov/meetvap-server
  MEETVAP_ADMIN_IMAGE=ghcr.io/rzaasadov/meetvap-admin
  MEETVAP_NGINX_IMAGE=ghcr.io/rzaasadov/meetvap-nginx
fi

umask 077
mkdir -p generated secrets backups

cat > .env <<EOF
WEB_DOMAIN=$WEB_DOMAIN
MEET_DOMAIN=$MEET_DOMAIN
SERVER_DOMAIN=$SERVER_DOMAIN
ADMIN_DOMAIN=$ADMIN_DOMAIN
POSTGRES_DB=meetvap
POSTGRES_USER=meetvap
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
JWT_SECRET=$JWT_SECRET
SERVER_EVENTS_INTERNAL_SECRET=$SERVER_EVENTS_INTERNAL_SECRET
LIVEKIT_API_KEY=$LIVEKIT_API_KEY
LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
LIVEKIT_IMAGE=livekit/livekit-server:v1.13.1
MEETVAP_VERSION=$MEETVAP_VERSION
MEETVAP_SERVER_IMAGE=$MEETVAP_SERVER_IMAGE
MEETVAP_ADMIN_IMAGE=$MEETVAP_ADMIN_IMAGE
MEETVAP_NGINX_IMAGE=$MEETVAP_NGINX_IMAGE
EOF

if [[ -f config/config.json ]]; then
  CONFIG_TEMPLATE=config/config.json
else
  CONFIG_TEMPLATE=config/config.example.json
fi

if ! grep -q '__MAIN_SERVER_HOST__' "$CONFIG_TEMPLATE" || ! grep -q '__MAIN_SERVER_KEY__' "$CONFIG_TEMPLATE"; then
  printf '%s must contain __MAIN_SERVER_HOST__ and __MAIN_SERVER_KEY__ placeholders.\n' "$CONFIG_TEMPLATE" >&2
  exit 1
fi

sed \
  -e "s#__MAIN_SERVER_HOST__#$MAIN_SERVER_HOST#g" \
  -e "s#__MAIN_SERVER_KEY__#$MAIN_SERVER_KEY#g" \
  "$CONFIG_TEMPLATE" > generated/config.json

cat > generated/admin-config.json <<EOF
{
  "port": 4300,
  "basePath": "",
  "databaseUrl": "postgresql://meetvap:$POSTGRES_PASSWORD@postgres:5432/meetvap",
  "admin": {
    "username": "$(json_escape "$ADMIN_USERNAME")",
    "password": "$(json_escape "$ADMIN_PASSWORD")"
  },
  "sessionSecret": "$ADMIN_SESSION_SECRET",
  "secureCookies": true,
  "backendPublicUrl": "https://$SERVER_DOMAIN"
}
EOF

cat > generated/livekit-servers.json <<EOF
[
  {
    "id": "docker-livekit",
    "url": "wss://$SERVER_DOMAIN",
    "healthUrl": "http://livekit:7880",
    "apiKey": "$LIVEKIT_API_KEY",
    "apiSecret": "$LIVEKIT_API_SECRET",
    "enabled": true,
    "maxActiveCalls": 100,
    "weight": 1
  }
]
EOF

sed \
  -e "s/__SERVER_DOMAIN__/$SERVER_DOMAIN/g" \
  -e "s/__LIVEKIT_API_KEY__/$LIVEKIT_API_KEY/g" \
  -e "s/__LIVEKIT_API_SECRET__/$LIVEKIT_API_SECRET/g" \
  livekit/livekit.yaml.template > generated/livekit.yaml

sed \
  -e "s/__WEB_DOMAIN__/$WEB_DOMAIN/g" \
  -e "s/__MEET_DOMAIN__/$MEET_DOMAIN/g" \
  -e "s/__SERVER_DOMAIN__/$SERVER_DOMAIN/g" \
  -e "s/__ADMIN_DOMAIN__/$ADMIN_DOMAIN/g" \
  nginx/nginx.conf.template > generated/nginx.conf

cat > generated/server-optional.env <<'EOF'
# Push notifications are relayed through the main server. Do not add FCM or
# APNs provider credentials to a child installation.
# Optional store-purchase verification credentials belong in docker/secrets.
# GOOGLE_PACKAGE_NAME=com.meetvap.messenger
# GOOGLE_SERVICE_ACCOUNT_PATH=/run/secrets/meetvap/google-service-account.json
APPLE_APP_ATTEST_APP_ID_PREFIX=4H68W59Z24
APPLE_APP_ATTEST_ALLOW_DEVELOPMENT=false
APPLE_BUNDLE_ID=com.meetvap.app
# APPLE_SHARED_SECRET=
EOF

cat > generated/runtime-config.js <<EOF
window.__MEETVAP_CONFIG__ = Object.freeze({
  apiUrl: "https://$SERVER_DOMAIN"
});
EOF

chmod 600 .env
chmod 644 generated/admin-config.json generated/config.json generated/livekit-servers.json generated/livekit.yaml generated/nginx.conf generated/server-optional.env generated/runtime-config.js

if [[ "$LOCAL_IMAGES" == true ]]; then
  printf '\nUsing locally built MeetVap images.\n'
  docker compose -f compose.yml pull livekit postgres redis certbot-renew
else
  printf '\nPulling MeetVap application images...\n'
  docker compose -f compose.yml pull server admin nginx livekit postgres redis certbot-renew
fi

ensure_config_defaults

printf '\nStarting PostgreSQL and Redis...\n'
docker compose -f compose.yml up -d postgres redis

printf '\nApplying database migrations...\n'
docker compose -f compose.yml run --rm migration

printf '\nObtaining TLS certificate for all four domains...\n'
docker compose -f compose.yml --profile bootstrap run --rm --service-ports certbot-bootstrap \
  certonly --standalone --non-interactive --agree-tos --register-unsafely-without-email \
  --cert-name meetvap --keep-until-expiring \
  -d "$WEB_DOMAIN" -d "$MEET_DOMAIN" -d "$SERVER_DOMAIN" -d "$ADMIN_DOMAIN"

printf '\nStarting MeetVap services...\n'
docker compose -f compose.yml up -d server admin livekit nginx certbot-renew

printf '\nWaiting for service health checks...\n'
SERVER_HEALTHY=false
for _ in {1..30}; do
  if docker compose -f compose.yml exec -T server node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
    SERVER_HEALTHY=true
    break
  fi
  sleep 2
done

if [[ "$SERVER_HEALTHY" != true ]]; then
  printf 'The API did not become healthy. Inspect: docker compose -f compose.yml logs server\n' >&2
  exit 1
fi

docker compose -f compose.yml ps
printf '\nInstallation completed.\n'
printf 'Web:   https://%s\n' "$WEB_DOMAIN"
printf 'Meet:  https://%s\n' "$MEET_DOMAIN"
printf 'API:   https://%s\n' "$SERVER_DOMAIN"
printf 'Admin: https://%s\n' "$ADMIN_DOMAIN"
printf '\nRemember to whitelist this child server public IP for its domain in the main server admin panel.\n'
