#!/usr/bin/env bash
# Applies database/migrations against a SQLite file using the golang-migrate
# CLI, for manual inspection/debugging. The backend applies migrations
# automatically on every startup — this script is not needed for normal use.
#
# Usage: scripts/migrate.sh <path-to-db-file> [up|down|...]
set -euo pipefail
cd "$(dirname "$0")/.."

DB_PATH="${1:?usage: migrate.sh <path-to-db-file> [command]}"
COMMAND="${2:-up}"

migrate -path database/migrations -database "sqlite://${DB_PATH}" "$COMMAND"
