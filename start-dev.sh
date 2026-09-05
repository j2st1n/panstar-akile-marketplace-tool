#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8788}"

echo "Starting Panstar & Akile Marketplace Tool local debug server on port ${PORT}..."
exec node "${DIR}/server.js"
