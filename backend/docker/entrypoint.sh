#!/bin/sh
set -e

echo "[Entrypoint] Applying schema..."
node_modules/.bin/prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss
echo "[Entrypoint] Schema ready. Starting server..."
exec node dist/server.js
