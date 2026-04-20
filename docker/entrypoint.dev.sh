#!/bin/sh
# Dev entrypoint for t1000-dev hot-reload stack.
#
# The repo is bind-mounted at /app. This script:
#   1. Ensures deps are installed (and better-sqlite3 is rebuilt for
#      the container's glibc/arch — host node_modules may be wrong)
#   2. Renders the nginx template and starts nginx
#   3. Launches Vite (HMR) + tsc --watch + node --watch concurrently
#
# A crash in any watcher kills the whole process tree so `docker
# compose up` surfaces the error and restart policy kicks in.

set -e

cd /app

export PORT=${PORT:-8080}
export NODE_ENV=${NODE_ENV:-development}

# The repo is bind-mounted at /app, which shadows any directories the
# Dockerfile pre-created. Make nginx's runtime dirs here.
mkdir -p /app/nginx/logs /app/nginx/cache /app/nginx/client_body

echo "[dev] Rendering nginx config on port $PORT"
envsubst '${PORT}' < /app/docker/nginx.dev.conf.template > /app/nginx/nginx.conf

# Node_modules from the host may be incompatible (different OS/arch).
# Re-run install + rebuild native modules on first boot. After that,
# `.dev-deps-ok` marker skips the install step on subsequent restarts.
if [ ! -f /app/node_modules/.dev-deps-ok ] || [ package.json -nt /app/node_modules/.dev-deps-ok ]; then
    echo "[dev] Installing dependencies + rebuilding native modules (first run or package.json changed)"
    npm ci --force
    npm rebuild better-sqlite3 bcryptjs --force
    touch /app/node_modules/.dev-deps-ok
else
    echo "[dev] Dependencies up-to-date (skip npm ci)"
fi

mkdir -p /app/data /app/data/.opk
chmod 755 /app/data /app/data/.opk 2>/dev/null || true

echo "[dev] Starting nginx"
nginx -c /app/nginx/nginx.conf

echo "[dev] Starting watchers (Vite + tsc --watch + node --watch)"
exec npm run dev:watch
