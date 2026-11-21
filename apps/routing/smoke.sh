#!/bin/sh
# Smoke test for a running routing service: a 30-minute car isochrone from Cyber City, Gurugram
# must come back as a polygon. Usage: apps/routing/smoke.sh [base URL, default http://localhost:8002]
set -eu
url="${1:-http://localhost:8002}"
i=0
until curl -fsS "$url/status" > /dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 60 ] && { echo "routing did not start" >&2; exit 1; }; sleep 2
done
body='{"locations":[{"lat":28.495,"lon":77.089}],"costing":"auto","contours":[{"time":30}],"polygons":true}'
out=$(curl -fsS -X POST -H 'content-type: application/json' -d "$body" "$url/isochrone")
echo "$out" | grep -q '"type":"Polygon"\|"type":"MultiPolygon"' || { echo "no polygon: $(echo "$out" | head -c 300)" >&2; exit 1; }
echo "ok: $(echo "$out" | head -c 120)…"
