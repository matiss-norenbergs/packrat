#!/usr/bin/env bash
# Runs backend and frontend dev servers concurrently. Ctrl+C stops both.
set -euo pipefail
cd "$(dirname "$0")/.."

(cd backend && go run ./cmd/server) &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null' EXIT
wait
