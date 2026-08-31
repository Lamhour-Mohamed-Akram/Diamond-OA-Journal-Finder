#!/usr/bin/env bash
# Assembles dist/ — the ONLY directory Netlify publishes (netlify.toml
# publish = "dist"). Explicit allowlist: anything not copied here can never
# reach the live site, no matter what lands in the repo root (out/, scripts/,
# tests/, planning notes, source CSVs...).
set -euo pipefail
cd "$(dirname "$0")/.."

rm -rf dist
mkdir dist

cp index.html \
   robots.txt \
   sitemap.xml \
   cnrst.xml \
   og-image.png \
   favicon.ico \
   favicon.svg \
   favicon-48.png \
   favicon-96.png \
   favicon-192.png \
   favicon-512.png \
   apple-touch-icon.png \
   dist/

cp -R css js data subjects dist/

echo "dist/ assembled: $(find dist -type f | wc -l | tr -d ' ') files"
