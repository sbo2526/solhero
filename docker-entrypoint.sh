#!/bin/sh
set -eu

# Railway mounts volumes AFTER image build, so Dockerfile chown alone is insufficient.
# Restrict privileged ownership repair to the dedicated application volume.
if [ "${DATA_DIR:-/data}" != /data ]; then
  echo 'Storage setup failed: this image requires DATA_DIR=/data and a dedicated volume at /data.' >&2
  exit 1
fi
export DATA_DIR=/data
if [ "$#" -eq 0 ]; then
  echo 'Container command is missing.' >&2
  exit 1
fi

if [ "$(id -u)" = 0 ]; then
  if [ -L /data ]; then
    echo 'Storage setup failed: /data must be a real directory, not a symbolic link.' >&2
    exit 1
  fi
  if ! mkdir -p /data || ! chown -hR node:node /data || ! chmod 700 /data; then
    echo 'Storage setup failed: cannot prepare /data. Check volume mount, free space and write permissions. No profile was deleted.' >&2
    exit 1
  fi
  echo 'Storage ownership prepared; starting application as non-root node user.'
  # gosu replaces itself, preserving normal SIGTERM delivery and graceful profile close.
  exec gosu node env HOME=/home/node USER=node LOGNAME=node "$@"
fi

# Explicit non-root overrides work only with an already writable volume.
exec "$@"
