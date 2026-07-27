#!/usr/bin/env bash
set -euo pipefail
cd android



APK="app/build/outputs/apk/release/app-release.apk"

DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')

if [ -z "$DEVICES" ]; then
  echo "No adb devices connected."
  exit 1
fi

echo "Installing: $APK"

for SERIAL in $DEVICES; do
  echo
  echo "==> $SERIAL"
  adb -s "$SERIAL" install -r "$APK"
done

echo
echo "Done."
