#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${ROOT_DIR}/backup"
STAMP="${1:-$(date +%Y%m%d-%H%M%S)}"
MANIFEST="${BACKUP_DIR}/manifest-${STAMP}.txt"

mkdir -p "${BACKUP_DIR}"
: > "${MANIFEST}"

COMMON_EXCLUDES=(
  --exclude='.git'
  --exclude='.git/*'
  --exclude='.DS_Store'
  --exclude='*.log'
  --exclude='*.tmp'
  --exclude='backup'
  --exclude='backup/*'
  --exclude='node_modules'
  --exclude='node_modules/*'
  --exclude='*/node_modules'
  --exclude='*/node_modules/*'
  --exclude='.expo'
  --exclude='.expo/*'
  --exclude='*/.expo'
  --exclude='*/.expo/*'
  --exclude='.env'
  --exclude='.env.*'
  --exclude='*.p8'
  --exclude='*.keystore'
  --exclude='*.jks'
  --exclude='uploads'
  --exclude='uploads/*'
  --exclude='*/uploads'
  --exclude='*/uploads/*'
  --exclude='ios/Pods'
  --exclude='ios/Pods/*'
  --exclude='ios/build'
  --exclude='ios/build/*'
  --exclude='ios/.xcode.env.local'
  --exclude='android/.gradle'
  --exclude='android/.gradle/*'
  --exclude='android/.idea'
  --exclude='android/.idea/*'
  --exclude='android/.kotlin'
  --exclude='android/.kotlin/*'
  --exclude='android/android'
  --exclude='android/android/*'
  --exclude='android/build'
  --exclude='android/build/*'
  --exclude='android/app/.cxx'
  --exclude='android/app/.cxx/*'
  --exclude='android/app/build'
  --exclude='android/app/build/*'
  --exclude='android/local.properties'
  --exclude='android/keystore.properties'
  --exclude='server/dist'
  --exclude='server/dist/*'
)

archive() {
  local name="$1"
  shift
  local archive_path="${BACKUP_DIR}/${name}-${STAMP}.tar.gz"
  local entries=()

  for entry in "$@"; do
    if [[ -e "${entry}" ]]; then
      entries+=("${entry}")
    else
      echo "Skipping missing path: ${entry}" >&2
    fi
  done

  if [[ "${#entries[@]}" -eq 0 ]]; then
    echo "No existing paths for ${name}; archive was not created." >&2
    return
  fi

  (
    cd "${ROOT_DIR}"
    tar -czf "${archive_path}" "${COMMON_EXCLUDES[@]}" "${entries[@]}"
  )

  echo "${archive_path}" | tee -a "${MANIFEST}"

  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "${archive_path}" >> "${MANIFEST}"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${archive_path}" >> "${MANIFEST}"
  fi
}

MOBILE_COMMON=(
  App.tsx
  src
  assets
  scripts
  docs
  package.json
  package-lock.json
  app.json
  eas.json
  babel.config.js
  tsconfig.json
  config.json
  GoogleService-Info.plist
  google-services.json
  MeetVap.md
  MeetVap_tr.md
  MeetVap_ru.md
)

archive "meetvap-ios-app" "${MOBILE_COMMON[@]}" ios
archive "meetvap-android-app" "${MOBILE_COMMON[@]}" android
archive "meetvap-server" server config.json deploy-to-server docs/AI_AGENT_HANDOFF.md
archive "meetvap-admin" admin deploy-to-admin docs/AI_AGENT_HANDOFF.md
archive "meetvap-partner" partner docs/AI_AGENT_HANDOFF.md

echo "Backup completed."
echo "Archives and checksums are listed in ${MANIFEST}."
