#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
SOURCE="${1:-}"
[[ -n "$SOURCE" && -f "$SOURCE/database.dump" && -f "$SOURCE/uploads.tar.gz" ]] || {
  printf 'Usage: ./restore.sh backups/<timestamp>\n' >&2
  exit 1
}
set -a
source .env
set +a

read -r -p 'This replaces the current database and uploaded files. Type RESTORE: ' CONFIRMATION
[[ "$CONFIRMATION" == "RESTORE" ]] || { printf 'Restore cancelled.\n'; exit 1; }

docker compose -f compose.yml stop server admin
docker compose -f compose.yml exec -T postgres \
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$SOURCE/database.dump"
docker compose -f compose.yml run --rm --no-deps server sh -c 'find /uploads -mindepth 1 -delete'
docker compose -f compose.yml run --rm --no-deps -T server tar -C /uploads -xzf - < "$SOURCE/uploads.tar.gz"
for FILE in config.json admin-config.json livekit-servers.json livekit.yaml nginx.conf runtime-config.js server-optional.env; do
  if [[ -f "$SOURCE/$FILE" ]]; then
    cp "$SOURCE/$FILE" "generated/$FILE"
  fi
done
docker compose -f compose.yml up -d --force-recreate server admin livekit nginx
printf 'Restore completed.\n'
