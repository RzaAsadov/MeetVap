#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="${1:-/tmp/meetvap-local-build.tar.gz}"

case "$OUTPUT" in
  /*) ;;
  *) OUTPUT="$(pwd)/$OUTPUT" ;;
esac

mkdir -p "$(dirname "$OUTPUT")"

tar -C "$REPO_DIR" -czf "$OUTPUT" \
  --exclude='*/.DS_Store' \
  --exclude='*/.env' \
  --exclude='*/.env.*' \
  --exclude='*/backups' \
  --exclude='*/build' \
  --exclude='*/config.json' \
  --exclude='*/dist' \
  --exclude='*/generated' \
  --exclude='*/node_modules' \
  --exclude='*/secrets' \
  --exclude='*.key' \
  --exclude='*.p8' \
  --exclude='*.p12' \
  --exclude='*.pem' \
  --exclude='*.tsbuildinfo' \
  .dockerignore admin docker meet server web

printf 'Local Docker build bundle created: %s\n' "$OUTPUT"
