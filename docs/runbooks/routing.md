# Routing service: commute zones (T2.9)

`apps/routing` is Valhalla with routing tiles for Delhi NCR baked into the image. The worker's
`commute.compute` job and the API's `POST /v1/commute/preview` ask it for isochrones: the area
reachable from an office or college within the user's maximum commute (FR-BIO-03, ADR-0008).

| Travel mode | Source |
| --- | --- |
| `car` | Valhalla `auto` |
| `two_wheeler` | Valhalla `motorcycle` |
| `walk` | Valhalla `pedestrian` |
| `metro_transit` | Radius approximation until a transit data source is decided (ADR-0008, founder) |

When routing is not configured, is down, or finds no road near the point, the zone is a radius
approximation (`source = 'fallback_radius'`, `approx: true` in the API) at the straight-line speeds
in `packages/routing` (`FALLBACK_SPEED_KMH`: assumptions awaiting founder review). "No road near
the point" is decided by us, not Valhalla: Valhalla snaps a point to a road even kilometres away
and answers 200, so a routed zone that neither contains the pin nor comes within 300 m of it is
replaced by the approximation. The worker stores the approximation and finishes; its daily
`commute.refresh` redraws approximate road zones, zones older than 30 days and missing ones.

**Known limit:** Valhalla has no traffic data, so road zones assume free-flowing roads and are
large (45 min by car: 3,700–5,000 km²). Speed caps for NCR peak traffic are a founder decision
(docs/07 T2.9).

## Data and licence

- OpenStreetMap extracts from Geofabrik: India **Northern Zone** (Delhi, Haryana, Rajasthan) and
  **Central Zone** (Uttar Pradesh), MD5-checked, merged and cut to the NCR bounding box
  (`LIMITS.ncrBounds`) with osmium. About 75 MB after the cut.
- OpenStreetMap data is © OpenStreetMap contributors, available under the Open Database Licence
  (ODbL). **Any screen that shows a commute zone must credit "© OpenStreetMap contributors"**
  (the anchor map picker, T2.8). Confirm the wording in the legal review (T0.10).
- Valhalla image pinned by version and digest in `apps/routing/Dockerfile`.

## Build and run locally

```bash
docker build -t routing:local apps/routing      # downloads ~580 MB, builds tiles (~15–25 min)
docker run -d --name routing -p 8002:8080 routing:local
apps/routing/smoke.sh http://localhost:8002       # a 30-min car isochrone from Cyber City
```

Then point the API and the worker at it with `ROUTING_URL=http://localhost:8002` (their
`.env.local`), and run `pnpm --filter @flatrimony/worker tick` to draw queued zones.

## Staging

- **Build:** `.github/workflows/routing-build.yml` runs monthly (2nd, 02:30 IST) and on demand. It
  builds, smoke-tests, pushes `routing:<sha>-<date>` and deploys the `routing` Cloud Run service
  (2 vCPU, 4 GiB, 0–2 instances). It needs `STAGING_ENABLED` and the GCP secrets (T1.10/T1.12).
- **Access:** no public invoker. Only `api-sa` and `worker-sa` may call it, with Google ID tokens
  from the metadata server (`@flatrimony/routing` `googleIdToken`). Ingress is "all" until both
  callers have Direct VPC egress; then switch it to internal (docs/03 §4).
- **Rollback:** `gcloud run services update-traffic routing --region asia-south1 --to-revisions <previous>=100`.
- **Cold start:** with `min 0` the first request after idle loads the tiles; the API waits at most
  4 s for a preview and falls back to the approximation, the worker 20 s per zone and retries.
