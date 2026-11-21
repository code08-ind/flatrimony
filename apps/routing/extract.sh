#!/bin/sh
# Downloads the OpenStreetMap extracts that cover Delhi NCR (Geofabrik's India Northern Zone: Delhi,
# Haryana, Rajasthan; Central Zone: Uttar Pradesh), checks each against Geofabrik's MD5, merges them
# and cuts out the NCR bounding box (LIMITS.ncrBounds in packages/shared) as /osm/ncr.osm.pbf.
# OpenStreetMap data is © OpenStreetMap contributors, ODbL: credit it wherever commute zones show.
set -eu
cd /osm
i=0
for url in $OSM_SOURCES; do
  i=$((i + 1))
  echo "download $url"
  curl -fsSL --retry 3 -o "part$i.osm.pbf" "$url"
  expected=$(curl -fsSL --retry 3 "$url.md5" | cut -d' ' -f1)
  actual=$(md5sum "part$i.osm.pbf" | cut -d' ' -f1)
  [ "$expected" = "$actual" ] || { echo "MD5 mismatch for $url" >&2; exit 1; }
done
osmium merge part*.osm.pbf -o merged.osm.pbf
osmium extract --bbox "$NCR_BBOX" --strategy smart merged.osm.pbf -o ncr.osm.pbf
rm part*.osm.pbf merged.osm.pbf
osmium fileinfo ncr.osm.pbf | grep -E "Size|Bounding" || true
