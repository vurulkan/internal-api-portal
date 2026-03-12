#!/bin/sh
set -eu

DATA_PATH="${DATA_PATH:-/data/app.db}"
DATA_DIR="$(dirname "$DATA_PATH")"

mkdir -p "$DATA_DIR"
chown -R portal:portal "$DATA_DIR"

exec su-exec portal /app/server
