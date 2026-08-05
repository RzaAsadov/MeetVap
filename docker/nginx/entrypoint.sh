#!/bin/sh
set -eu

# Certificates are renewed by the certbot sidecar. Reload periodically so nginx
# picks up renewed files without granting the sidecar access to Docker itself.
(
  while sleep 21600; do
    nginx -t && nginx -s reload || true
  done
) &

exec nginx -g 'daemon off;'
