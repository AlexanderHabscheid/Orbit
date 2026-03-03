#!/usr/bin/env bash
set -euo pipefail

orbit up
orbit serve --name text --spec examples/star/echo.worker.spec.json &
SERVE_PID=$!
trap 'kill "$SERVE_PID" >/dev/null 2>&1 || true' EXIT

sleep 1
orbit call text.upper --json @examples/star/request.json
