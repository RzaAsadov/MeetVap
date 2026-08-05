#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")"
[[ -f .env ]] || { printf 'Run ./install.sh first.\n' >&2; exit 1; }
set -a
source .env
set +a

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="backups/$STAMP"
mkdir -p "$DESTINATION"

docker compose -f compose.yml exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$DESTINATION/database.dump"
docker compose -f compose.yml exec -T server \
  tar -C /uploads -czf - . > "$DESTINATION/uploads.tar.gz"
cp .env generated/config.json generated/admin-config.json generated/livekit-servers.json \
  generated/livekit.yaml generated/nginx.conf generated/runtime-config.js generated/server-optional.env "$DESTINATION/"

printf 'Backup created at %s\n' "$DESTINATION"
