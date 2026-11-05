#!/bin/sh
set -eu

# The media volume can be created by Docker from another service's image and
# end up root-owned. Fix ownership as root, then drop to the unprivileged node
# user before starting the API.
MEDIA_DIR="${MEDIA_ROOT:-/app/media}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$MEDIA_DIR"
  chown -R node:node "$MEDIA_DIR"
  exec su-exec node "$@"
fi

exec "$@"
