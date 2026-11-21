#!/bin/sh
# Builds Valhalla routing tiles for /data/ncr.osm.pbf into one tar (/data/valhalla_tiles.tar) plus
# the service config. Isochrones are limited to one contour of at most 90 minutes (FR-BIO-03).
set -eu
cd /data
valhalla_build_config \
  --mjolnir-tile-dir /data/tiles \
  --mjolnir-tile-extract /data/valhalla_tiles.tar \
  --mjolnir-timezone /data/timezones.sqlite \
  --mjolnir-admin /data/admins.sqlite \
  --mjolnir-concurrency "$(nproc)" \
  --httpd-service-listen 'tcp://*:8080' \
  --service-limits-isochrone-max-locations 1 \
  --service-limits-isochrone-max-contours 1 \
  --service-limits-isochrone-max-time-contour 90 \
  > /data/valhalla.json
valhalla_build_timezones > /data/timezones.sqlite
valhalla_build_admins -c /data/valhalla.json /data/ncr.osm.pbf
valhalla_build_tiles -c /data/valhalla.json /data/ncr.osm.pbf
valhalla_build_extract -c /data/valhalla.json -v
rm -rf /data/tiles /data/ncr.osm.pbf
ls -la /data
