# Cloudflare R2: listing walkthrough videos (T3.6)

Walkthrough videos (FR-LST-05) are stored in a private R2 bucket (docs/03 ADR-0010). The API reaches
it through R2's S3 API with an access key pair; the app only ever gets presigned URLs: a 10-minute
PUT for the upload and 1-hour GETs to watch.

Locally there is no R2: `pnpm dev:secrets` points the `R2_*` settings at Supabase Storage's S3
endpoint and its `r2-walkthroughs` bucket (`supabase/config.toml`; create it with
`pnpm exec supabase seed buckets`). The same S3 calls run against both.

## Staging and production (once the Cloudflare account exists)

1. Create the bucket `r2-walkthroughs` (location hint: Asia-Pacific). Keep public access **off** and
   attach no custom domain.
2. Add an object lifecycle rule: prefix `uploads/`, delete objects 1 day after upload. Uploads
   that were never confirmed (or were refused) are removed by it. The API also deletes refused
   uploads immediately.
3. Create an R2 API token with **Object Read & Write** on this bucket only. Put the access key id and
   secret in Secret Manager as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (listed in
   `infra/terraform/envs/staging/variables.tf`).
4. Set on the API: `R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `R2_REGION=auto`,
   `R2_BUCKET=r2-walkthroughs` (the default).

Production refuses to start without `R2_ENDPOINT`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`;
staging without them answers `503 upstream.unavailable` on video uploads.

No CORS rule is needed: only the Android app uploads videos (the web finishes listings on Android).

## Check

1. `POST /v1/listings/{id}/media/upload-url` with `kind: walkthrough_video` from the Android app
   returns a URL on the R2 endpoint; uploading a different size than requested is refused.
2. After confirming, the object is at `<listing_id>/<uuid>.mp4` and nothing is left under `uploads/`.
3. Deleting the listing removes its objects.
