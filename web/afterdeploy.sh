#!/bin/sh
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

case "$SCRIPT_DIR" in
  */meetvap-test/web)
    VITE_API_URL=https://mm-test.meetvap.com npm run build
    ;;
  *)
    VITE_API_URL=https://mm.meetvap.com npm run build
    ;;
esac
