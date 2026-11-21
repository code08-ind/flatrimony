# apps/routing/Dockerfile — Valhalla with Delhi NCR tiles baked in (docs/03 §10.5, ADR-0008).
# Build context: apps/routing. Rebuilt monthly by .github/workflows/routing-build.yml.
#   docker build -t routing apps/routing
ARG VALHALLA_IMAGE=ghcr.io/valhalla/valhalla:3.9.1@sha256:4fd114eb1d26b8fc2f43bcb3df234c1b63a0bf13c277405e5943d5361dc575de

# 1. OpenStreetMap: download (MD5-checked), merge, cut to the NCR bounding box.
# bookworm-20261027-slim, pinned by digest.
FROM debian:bookworm-slim@sha256:99c0b25c46d0214d5a2091092e7908907dcaecd6a962cde0ac700acee222b6f3 AS extract
RUN apt-get update \
  && apt-get install -y --no-install-recommends osmium-tool curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ARG OSM_SOURCES="https://download.geofabrik.de/asia/india/northern-zone/northern-zone-latest.osm.pbf https://download.geofabrik.de/asia/india/central-zone/central-zone-latest.osm.pbf"
# minLng,minLat,maxLng,maxLat = LIMITS.ncrBounds (packages/shared/src/constants.ts)
ARG NCR_BBOX="76.0,27.5,78.5,29.5"
ENV OSM_SOURCES=${OSM_SOURCES} NCR_BBOX=${NCR_BBOX}
WORKDIR /osm
COPY extract.sh /usr/local/bin/extract.sh
RUN extract.sh

# 2. Valhalla tiles.
FROM ${VALHALLA_IMAGE} AS tiles
COPY --from=extract /osm/ncr.osm.pbf /data/ncr.osm.pbf
COPY build-tiles.sh /usr/local/bin/build-tiles.sh
RUN build-tiles.sh

# 3. Runtime: the routing service on :8080 (Cloud Run), as a non-root user. Two worker threads
# for the 2 vCPUs (Cloud Run concurrency 4: infra/terraform).
FROM ${VALHALLA_IMAGE} AS runtime
COPY --from=tiles --chown=65534:65534 /data/valhalla.json /data/valhalla_tiles.tar /data/admins.sqlite /data/timezones.sqlite /data/
USER 65534:65534
EXPOSE 8080
CMD ["valhalla_service", "/data/valhalla.json", "2"]
