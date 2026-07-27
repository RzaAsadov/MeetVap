#!/bin/bash

set -e

PIPE_IN=1
PIPE_OUT=2

disable_limit() {
    echo "Removing old rules..."

    sudo pfctl -d >/dev/null 2>&1 || true
    sudo dnctl -q flush

    echo "Done."
}

if [ "$1" = "off" ]; then
    disable_limit
    exit 0
fi

if [ $# -ne 2 ]; then
    echo ""
    echo "Usage:"
    echo "  $0 <download_kbit> <upload_kbit>"
    echo "  $0 off"
    echo ""
    echo "Example:"
    echo "  $0 256 128"
    exit 1
fi

DOWNLOAD="$1"
UPLOAD="$2"

disable_limit

echo "Creating pipes..."

sudo dnctl pipe $PIPE_IN config bw ${DOWNLOAD}Kbit/s
sudo dnctl pipe $PIPE_OUT config bw ${UPLOAD}Kbit/s

TMPFILE=$(mktemp)

cat > "$TMPFILE" <<EOF
dummynet in all pipe $PIPE_IN
dummynet out all pipe $PIPE_OUT
EOF

sudo pfctl -f "$TMPFILE"
sudo pfctl -e

rm "$TMPFILE"

echo ""
echo "========================================="
echo " Network throttling enabled"
echo "========================================="
echo " Download : ${DOWNLOAD} Kbit/s"
echo " Upload   : ${UPLOAD} Kbit/s"
echo ""
echo "Disable with:"
echo "    $0 off"
echo "========================================="
